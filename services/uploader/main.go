package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/segmentio/kafka-go"
)

var (
	db          *sql.DB
	minioClient *minio.Client
	publicMinio *minio.Client
	kafkaWriter *kafka.Writer
	verifier    *gooidc.IDTokenVerifier
	bucket      = mustEnv("S3_BUCKET")
	s3PublicURL = mustEnv("S3_PUBLIC_URL")
	devToken    = os.Getenv("DEV_AUTH_TOKEN")
)

type ImageEvent struct {
	ID          string    `json:"id"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	Board       string    `json:"board"`
	Title       string    `json:"title"`
	UploadedAt  time.Time `json:"uploaded_at"`
}

type UploadedImage struct {
	ID          string    `json:"id"`
	Board       string    `json:"board"`
	Title       string    `json:"title"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	Tags        []string  `json:"tags"`
	UploadedAt  time.Time `json:"uploaded_at"`
	ImageURL    string    `json:"image_url"`
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
	if devToken == "" {
		provider, err := gooidc.NewProvider(context.Background(), mustEnv("OIDC_ISSUER"))
		if err != nil {
			log.Fatalf("oidc provider: %v", err)
		}
		verifier = provider.Verifier(&gooidc.Config{SkipClientIDCheck: true})
	} else {
		log.Printf("WARNING: development authentication is enabled")
	}

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
	publicEndpoint, err := url.Parse(s3PublicURL)
	if err != nil || publicEndpoint.Host == "" {
		log.Fatalf("invalid S3_PUBLIC_URL %q", s3PublicURL)
	}
	publicMinio, err = minio.New(publicEndpoint.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(mustEnv("S3_ACCESS_KEY"), mustEnv("S3_SECRET_KEY"), ""),
		Secure: publicEndpoint.Scheme == "https",
		Region: getEnvOr("S3_REGION", "us-east-1"),
	})
	if err != nil {
		log.Fatalf("public minio: %v", err)
	}

	kafkaWriter = &kafka.Writer{
		Addr:     kafka.TCP(getEnvOr("KAFKA_BROKERS", "")),
		Topic:    "lolcatz-images",
		Balancer: &kafka.LeastBytes{},
	}
	defer kafkaWriter.Close()

	mux := http.NewServeMux()
	// Step 1: browser asks for a presigned PUT URL
	mux.HandleFunc("POST /presign", requireAuth(handlePresign))
	mux.HandleFunc("POST /bulk", requireAuth(handleBulk))
	mux.HandleFunc("PUT /bulk/{filename}", requireAuth(handleBulk))
	mux.HandleFunc("PUT /bulk", requireAuth(handleBulk))
	mux.HandleFunc("PUT /bulk/", requireAuth(handleBulk))
	// Step 2: browser calls this after uploading to minio to register the image
	mux.HandleFunc("POST /confirm", requireAuth(handleConfirm))
	mux.HandleFunc("GET /me/images", requireAuth(handleMyImages))
	mux.HandleFunc("DELETE /images/{id}", requireAuth(handleDeleteImage))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("uploader listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || raw == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		email := ""
		name := ""
		if devToken != "" {
			if raw != devToken {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			email = getEnvOr("DEV_AUTH_EMAIL", "developer@localhost")
			name = getEnvOr("DEV_AUTH_NAME", "Developer")
		} else {
			token, err := verifier.Verify(r.Context(), raw)
			if err != nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var claims struct {
				Email string `json:"email"`
				Name  string `json:"name"`
			}
			if err := token.Claims(&claims); err != nil || claims.Email == "" {
				http.Error(w, "invalid token claims", http.StatusUnauthorized)
				return
			}
			email = claims.Email
			name = claims.Name
		}

		r.Header.Set("X-User-Email", email)
		if name == "" {
			name = email
		}
		if _, err := db.ExecContext(r.Context(), `
			INSERT INTO users (email, name) VALUES ($1, $2)
			ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
		`, email, name); err != nil {
			log.Printf("upsert user: %v", err)
		}
		next(w, r)
	}
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
			metadata     JSONB NOT NULL DEFAULT '{}',
			uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		ALTER TABLE images ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
		CREATE TABLE IF NOT EXISTS comments (
			id         BIGSERIAL PRIMARY KEY,
			image_id   TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
			body       TEXT NOT NULL,
			author     TEXT NOT NULL DEFAULT 'Anonymous',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS users (
			email TEXT PRIMARY KEY,
			name  TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS comments_image_id ON comments(image_id);
		CREATE INDEX IF NOT EXISTS images_board ON images(board, uploaded_at DESC);
		CREATE INDEX IF NOT EXISTS images_tags ON images USING GIN(tags);
	`)
	return err
}

func handleMyImages(w http.ResponseWriter, r *http.Request) {
	rows, err := db.QueryContext(r.Context(), `
		SELECT id, board, title, filename, content_type, tags, uploaded_at
		FROM images
		WHERE author = $1
		ORDER BY uploaded_at DESC
		LIMIT 100
	`, r.Header.Get("X-User-Email"))
	if err != nil {
		log.Printf("list own images: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	images := []UploadedImage{}
	for rows.Next() {
		var img UploadedImage
		if err := rows.Scan(&img.ID, &img.Board, &img.Title, &img.Filename,
			&img.ContentType, pq.Array(&img.Tags), &img.UploadedAt); err != nil {
			log.Printf("scan own image: %v", err)
			continue
		}
		img.ImageURL = "/api/browse/media/" + url.PathEscape(img.ID)
		images = append(images, img)
	}
	if err := rows.Err(); err != nil {
		log.Printf("iterate own images: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(images)
}

func handleDeleteImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	author := r.Header.Get("X-User-Email")

	var board string
	err := db.QueryRowContext(r.Context(), `
		SELECT board FROM images WHERE id = $1 AND author = $2
	`, id, author).Scan(&board)
	if err == sql.ErrNoRows {
		http.Error(w, "post not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("find post for deletion: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	objectKey := fmt.Sprintf("%s/%s", board, id)
	if err := minioClient.RemoveObject(r.Context(), bucket, objectKey, minio.RemoveObjectOptions{}); err != nil {
		log.Printf("delete object %s: %v", objectKey, err)
		http.Error(w, "storage error", http.StatusBadGateway)
		return
	}

	result, err := db.ExecContext(r.Context(), `
		DELETE FROM images WHERE id = $1 AND author = $2
	`, id, author)
	if err != nil {
		log.Printf("delete post %s: %v", id, err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	deleted, err := result.RowsAffected()
	if err != nil || deleted != 1 {
		http.Error(w, "post not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
	putURL, err := publicMinio.PresignedPutObject(
		r.Context(), bucket, objectKey, 15*time.Minute,
	)
	if err != nil {
		log.Printf("presign: %v", err)
		http.Error(w, "presign error", 500)
		return
	}

	// Public GET URL (no signing needed — bucket is public)
	publicGet := fmt.Sprintf("%s/%s/%s", s3PublicURL, bucket, objectKey)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"id":       id,
		"put_url":  putURL.String(),
		"get_url":  publicGet,
		"board":    req.Board,
		"title":    req.Title,
		"filename": req.Filename,
	})
}

func handleBulk(w http.ResponseWriter, r *http.Request) {
	var file io.Reader
	var closer io.Closer
	filename := r.PathValue("filename")
	contentType := r.Header.Get("Content-Type")
	size := r.ContentLength
	if r.Method == http.MethodPut {
		file, closer = r.Body, r.Body
		if filename == "" {
			filename = "upload-" + uuid.New().String() + ".jpg"
		}
	} else {
		upload, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "multipart field 'file' is required", 400)
			return
		}
		file, closer, filename, size = upload, upload, header.Filename, header.Size
		if contentType == "" {
			contentType = header.Header.Get("Content-Type")
		}
	}
	defer closer.Close()
	filename = filepath.Base(filename)
	board := r.FormValue("board")
	if r.Method == http.MethodPut {
		board = r.URL.Query().Get("board")
	}
	if board == "" {
		board = "b"
	}
	title := r.FormValue("title")
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = mime.TypeByExtension(strings.ToLower(filepath.Ext(filename)))
	}
	allowed := map[string]bool{"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true}
	if !allowed[contentType] {
		http.Error(w, "unsupported content type", 415)
		return
	}
	id := uuid.New().String()
	key := fmt.Sprintf("%s/%s", board, id)
	info, err := minioClient.PutObject(r.Context(), bucket, key, file, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		http.Error(w, "storage upload failed", 500)
		return
	}
	if _, err = db.ExecContext(r.Context(), `INSERT INTO images (id,board,title,filename,content_type,size,author) VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, board, title, filename, contentType, info.Size, r.Header.Get("X-User-Email")); err != nil {
		http.Error(w, "db insert failed", 500)
		return
	}
	event := ImageEvent{ID: id, Filename: filename, ContentType: contentType, Board: board, Title: title, UploadedAt: time.Now()}
	payload, _ := json.Marshal(event)
	if kafkaWriter.Addr.String() != "" {
		_ = kafkaWriter.WriteMessages(r.Context(), kafka.Message{Key: []byte(id), Value: payload})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"id": id, "filename": filename})
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
		`INSERT INTO images (id, board, title, filename, content_type, size, author)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (id) DO NOTHING`,
		req.ID, req.Board, req.Title, req.Filename, req.ContentType, info.Size,
		r.Header.Get("X-User-Email"),
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
