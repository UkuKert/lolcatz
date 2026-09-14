package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	_ "github.com/lib/pq"
)

var (
	db          *sql.DB
	minioClient *minio.Client
	bucket      string
)

type Image struct {
	ID          string   `json:"id"`
	Board       string   `json:"board"`
	Title       string   `json:"title"`
	Filename    string   `json:"filename"`
	ContentType string   `json:"content_type"`
	Size        int64    `json:"size"`
	Author      string   `json:"author"`
	Tags        []string `json:"tags"`
	UploadedAt  string   `json:"uploaded_at"`
	ImageURL    string   `json:"image_url"`
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
		log.Fatalf("db: %v", err)
	}
	if err = db.Ping(); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	bucket = mustEnv("S3_BUCKET")
	minioClient, err = minio.New(mustEnv("S3_ENDPOINT"), &minio.Options{
		Creds:  credentials.NewStaticV4(mustEnv("S3_ACCESS_KEY"), mustEnv("S3_SECRET_KEY"), ""),
		Secure: false,
	})
	if err != nil {
		log.Fatalf("minio: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /boards/{board}", handleBoard)
	mux.HandleFunc("GET /images/{id}", handleImage)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("browse listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func presign(ctx context.Context, board, id string) string {
	objectKey := board + "/" + id
	// Use the public minio URL for the presigned URL host
	publicURL := os.Getenv("S3_PUBLIC_URL")
	u, err := minioClient.PresignedGetObject(ctx, bucket, objectKey, time.Hour, url.Values{})
	if err != nil {
		return ""
	}
	if publicURL != "" {
		u.Host = ""
		u.Scheme = ""
		return publicURL + u.String()
	}
	return u.String()
}

func scanImages(rows *sql.Rows, ctx context.Context) []Image {
	images := []Image{}
	for rows.Next() {
		var img Image
		if err := rows.Scan(&img.ID, &img.Board, &img.Title, &img.Filename,
			&img.ContentType, &img.Size, &img.Author, &img.Tags, &img.UploadedAt); err != nil {
			continue
		}
		img.ImageURL = presign(ctx, img.Board, img.ID)
		images = append(images, img)
	}
	return images
}

func handleBoard(w http.ResponseWriter, r *http.Request) {
	board := r.PathValue("board")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	rows, err := db.QueryContext(r.Context(), `
		SELECT id, board, title, filename, content_type, size, author, tags, uploaded_at
		FROM images WHERE board=$1
		ORDER BY uploaded_at DESC
		LIMIT $2 OFFSET $3
	`, board, limit, offset)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(scanImages(rows, r.Context()))
}

func handleImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var img Image
	err := db.QueryRowContext(r.Context(), `
		SELECT id, board, title, filename, content_type, size, author, tags, uploaded_at
		FROM images WHERE id=$1
	`, id).Scan(&img.ID, &img.Board, &img.Title, &img.Filename,
		&img.ContentType, &img.Size, &img.Author, &img.Tags, &img.UploadedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", 404)
		return
	}
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	img.ImageURL = presign(r.Context(), img.Board, img.ID)

	rows, err := db.QueryContext(r.Context(), `
		SELECT id, body, author, created_at FROM comments
		WHERE image_id=$1 ORDER BY created_at ASC
	`, id)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	type Comment struct {
		ID        int64  `json:"id"`
		Body      string `json:"body"`
		Author    string `json:"author"`
		CreatedAt string `json:"created_at"`
	}
	comments := []Comment{}
	for rows.Next() {
		var c Comment
		rows.Scan(&c.ID, &c.Body, &c.Author, &c.CreatedAt)
		comments = append(comments, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"image": img, "comments": comments})
}
