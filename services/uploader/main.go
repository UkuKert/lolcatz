package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/segmentio/kafka-go"
	_ "github.com/lib/pq"
)

var (
	db          *sql.DB
	minioClient *minio.Client
	kafkaWriter *kafka.Writer
	bucket      = mustEnv("S3_BUCKET")
	s3PublicURL = mustEnv("S3_PUBLIC_URL")
)

type ImageEvent struct {
	ID          string    `json:"id"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	Board       string    `json:"board"`
	Title       string    `json:"title"`
	UploadedAt  time.Time `json:"uploaded_at"`
}

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("required env var %s is not set", k)
	}
	return v
}

func getEnvOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	var err error

	db, err = sql.Open("postgres", mustEnv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	if err = db.Ping(); err != nil {
		log.Fatalf("db ping: %v", err)
	}
	if err = migrate(db); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	minioClient, err = minio.New(mustEnv("S3_ENDPOINT"), &minio.Options{
		Creds:  credentials.NewStaticV4(mustEnv("S3_ACCESS_KEY"), mustEnv("S3_SECRET_KEY"), ""),
		Secure: false,
	})
	if err != nil {
		log.Fatalf("minio: %v", err)
	}

	kafkaWriter = &kafka.Writer{
		Addr:     kafka.TCP(getEnvOr("KAFKA_BROKERS", "")),
		Topic:    "lolcatz-images",
		Balancer: &kafka.LeastBytes{},
	}
	defer kafkaWriter.Close()

	mux := http.NewServeMux()
	// Step 1: browser asks for a presigned PUT URL
	mux.HandleFunc("POST /presign", handlePresign)
	// Step 2: browser calls this after uploading to minio to register the image
	mux.HandleFunc("POST /confirm", handleConfirm)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("uploader listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS images (
			id           TEXT PRIMARY KEY,
			board        TEXT NOT NULL DEFAULT 'b',
			title        TEXT NOT NULL DEFAULT '',
			filename     TEXT NOT NULL,
			content_type TEXT NOT NULL,
			size         BIGINT NOT NULL DEFAULT 0,
			author       TEXT NOT NULL DEFAULT 'Anonymous',
			tags         TEXT[] NOT NULL DEFAULT '{}',
			uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS comments (
			id         BIGSERIAL PRIMARY KEY,
			image_id   TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
			body       TEXT NOT NULL,
			author     TEXT NOT NULL DEFAULT 'Anonymous',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS comments_image_id ON comments(image_id);
		CREATE INDEX IF NOT EXISTS images_board ON images(board, uploaded_at DESC);
		CREATE INDEX IF NOT EXISTS images_tags ON images USING GIN(tags);
	`)
	return err
}

func handlePresign(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Filename    string `json:"filename"`
		ContentType string `json:"content_type"`
		Board       string `json:"board"`
		Title       string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}

	allowed := map[string]bool{
		"image/jpeg": true, "image/png": true,
		"image/gif": true, "image/webp": true,
	}
	if !allowed[req.ContentType] {
		http.Error(w, "unsupported content type", http.StatusUnsupportedMediaType)
		return
	}
	if req.Board == "" {
		req.Board = "b"
	}

	id := uuid.New().String()
	objectKey := fmt.Sprintf("%s/%s", req.Board, id)

	// Presigned PUT — browser uploads directly to minio
	putURL, err := minioClient.PresignedPutObject(
		r.Context(), bucket, objectKey, 15*time.Minute,
	)
	if err != nil {
		log.Printf("presign: %v", err)
		http.Error(w, "presign error", 500)
		return
	}

	// Rewrite to public URL
	publicPut := rewriteToPublic(putURL)
	// Public GET URL (no signing needed — bucket is public)
	publicGet := fmt.Sprintf("%s/%s/%s", s3PublicURL, bucket, objectKey)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"id":       id,
		"put_url":  publicPut,
		"get_url":  publicGet,
		"board":    req.Board,
		"title":    req.Title,
		"filename": req.Filename,
	})
}

func handleConfirm(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID          string `json:"id"`
		Board       string `json:"board"`
		Title       string `json:"title"`
		Filename    string `json:"filename"`
		ContentType string `json:"content_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}

	objectKey := fmt.Sprintf("%s/%s", req.Board, req.ID)

	// Verify object actually exists in minio
	info, err := minioClient.StatObject(r.Context(), bucket, objectKey, minio.StatObjectOptions{})
	if err != nil {
		log.Printf("stat object %s: %v", objectKey, err)
		http.Error(w, "object not found in storage", 404)
		return
	}

	_, err = db.ExecContext(r.Context(),
		`INSERT INTO images (id, board, title, filename, content_type, size)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (id) DO NOTHING`,
		req.ID, req.Board, req.Title, req.Filename, req.ContentType, info.Size,
	)
	if err != nil {
		log.Printf("db insert: %v", err)
		http.Error(w, "db error", 500)
		return
	}

	event := ImageEvent{
		ID: req.ID, Filename: req.Filename, ContentType: req.ContentType,
		Board: req.Board, Title: req.Title, UploadedAt: time.Now(),
	}
	payload, _ := json.Marshal(event)
	if kafkaWriter.Addr.String() != "" {
		if err := kafkaWriter.WriteMessages(context.Background(), kafka.Message{
			Key: []byte(req.ID), Value: payload,
		}); err != nil {
			log.Printf("kafka write (non-fatal): %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": req.ID})
}

func rewriteToPublic(u *url.URL) string {
	pub, err := url.Parse(s3PublicURL)
	if err != nil {
		return u.String()
	}
	u.Scheme = pub.Scheme
	u.Host = pub.Host
	return u.String()
}
