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

	"github.com/lib/pq"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var (
	db          *sql.DB
	minioClient *minio.Client
	publicMinio *minio.Client
	bucket      string
)

type Image struct {
	ID          string          `json:"id"`
	Board       string          `json:"board"`
	Title       string          `json:"title"`
	Filename    string          `json:"filename"`
	ContentType string          `json:"content_type"`
	Size        int64           `json:"size"`
	Author      string          `json:"author"`
	Tags        []string        `json:"tags"`
	Metadata    json.RawMessage `json:"metadata"`
	UploadedAt  time.Time       `json:"uploaded_at"`
	ImageURL    string          `json:"image_url"`
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
	publicEndpoint, err := url.Parse(mustEnv("S3_PUBLIC_URL"))
	if err != nil || publicEndpoint.Host == "" {
		log.Fatalf("invalid S3_PUBLIC_URL")
	}
	publicMinio, err = minio.New(publicEndpoint.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(mustEnv("S3_ACCESS_KEY"), mustEnv("S3_SECRET_KEY"), ""),
		Secure: publicEndpoint.Scheme == "https",
		Region: getEnvOr("S3_REGION", "us-east-1"),
	})
	if err != nil {
		log.Fatalf("public minio: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /boards/counts", handleBoardCounts)
	mux.HandleFunc("GET /boards/{board}", handleBoard)
	mux.HandleFunc("GET /media/{id}", handleMedia)
	mux.HandleFunc("GET /images/{id}", handleImage)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("browse listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func handleBoardCounts(w http.ResponseWriter, r *http.Request) {
	rows, err := db.QueryContext(r.Context(), `
		SELECT board, COUNT(*) FROM images GROUP BY board
	`)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	counts := map[string]int64{}
	for rows.Next() {
		var board string
		var count int64
		if err := rows.Scan(&board, &count); err != nil {
			continue
		}
		counts[board] = count
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(counts)
}

func presign(ctx context.Context, board, id string) string {
	objectKey := board + "/" + id
	responseHeaders := url.Values{
		"response-cache-control": {"public, max-age=31536000, immutable"},
	}
	u, err := publicMinio.PresignedGetObject(ctx, bucket, objectKey, time.Hour, responseHeaders)
	if err != nil {
		return ""
	}
	return u.String()
}

func mediaURL(id string) string {
	return "/api/browse/media/" + url.PathEscape(id)
}

func handleMedia(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var board string
	if err := db.QueryRowContext(r.Context(), `SELECT board FROM images WHERE id = $1`, id).Scan(&board); err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	location := presign(r.Context(), board, id)
	if location == "" {
		http.Error(w, "could not sign image URL", http.StatusBadGateway)
		return
	}

	// Cache the redirect well inside the one-hour signature lifetime. The
	// object response itself is immutable because uploaded IDs never change.
	w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=60")
	http.Redirect(w, r, location, http.StatusFound)
}

func scanImages(rows *sql.Rows) []Image {
	images := []Image{}
	for rows.Next() {
		var img Image
		if err := rows.Scan(&img.ID, &img.Board, &img.Title, &img.Filename,
			&img.ContentType, &img.Size, &img.Author, pq.Array(&img.Tags), &img.Metadata, &img.UploadedAt); err != nil {
			continue
		}
		img.ImageURL = mediaURL(img.ID)
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
		SELECT i.id, i.board, i.title, i.filename, i.content_type, i.size,
		       COALESCE(u.name, i.author), i.tags, i.metadata, i.uploaded_at
		FROM images i LEFT JOIN users u ON u.email = i.author
		WHERE i.board=$1
		ORDER BY uploaded_at DESC
		LIMIT $2 OFFSET $3
	`, board, limit, offset)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(scanImages(rows))
}

func handleImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var img Image
	err := db.QueryRowContext(r.Context(), `
		SELECT i.id, i.board, i.title, i.filename, i.content_type, i.size,
		       COALESCE(u.name, i.author), i.tags, i.metadata, i.uploaded_at
		FROM images i LEFT JOIN users u ON u.email = i.author
		WHERE i.id=$1
	`, id).Scan(&img.ID, &img.Board, &img.Title, &img.Filename,
		&img.ContentType, &img.Size, &img.Author, pq.Array(&img.Tags), &img.Metadata, &img.UploadedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", 404)
		return
	}
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	img.ImageURL = mediaURL(img.ID)

	rows, err := db.QueryContext(r.Context(), `
		SELECT c.id, c.body, COALESCE(u.name, c.author), c.created_at
		FROM comments c LEFT JOIN users u ON u.email = c.author
		WHERE c.image_id=$1 ORDER BY c.created_at ASC
	`, id)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	type Comment struct {
		ID        int64     `json:"id"`
		Body      string    `json:"body"`
		Author    string    `json:"author"`
		CreatedAt time.Time `json:"created_at"`
	}
	comments := []Comment{}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.Body, &c.Author, &c.CreatedAt); err != nil {
			continue
		}
		comments = append(comments, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"image": img, "comments": comments})
}
