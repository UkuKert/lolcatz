package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	_ "github.com/lib/pq"
)

var db *sql.DB

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

type Image struct {
	ID          string   `json:"id"`
	Board       string   `json:"board"`
	Title       string   `json:"title"`
	Filename    string   `json:"filename"`
	ContentType string   `json:"content_type"`
	Tags        []string `json:"tags"`
	UploadedAt  string   `json:"uploaded_at"`
	ImageURL    string   `json:"image_url"`
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

	mux := http.NewServeMux()
	mux.HandleFunc("GET /search", handleSearch)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("search listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	board := strings.TrimSpace(r.URL.Query().Get("board"))
	minioBase := mustEnv("S3_PUBLIC_URL")

	var rows *sql.Rows
	var err error

	switch {
	case tag != "":
		rows, err = db.QueryContext(r.Context(), `
			SELECT id, board, title, filename, content_type, tags, uploaded_at
			FROM images WHERE $1 = ANY(tags)
			ORDER BY uploaded_at DESC LIMIT 50
		`, tag)
	case q != "" && board != "":
		rows, err = db.QueryContext(r.Context(), `
			SELECT id, board, title, filename, content_type, tags, uploaded_at
			FROM images WHERE board=$1 AND title ILIKE '%' || $2 || '%'
			ORDER BY uploaded_at DESC LIMIT 50
		`, board, q)
	case q != "":
		rows, err = db.QueryContext(r.Context(), `
			SELECT id, board, title, filename, content_type, tags, uploaded_at
			FROM images WHERE title ILIKE '%' || $1 || '%'
			ORDER BY uploaded_at DESC LIMIT 50
		`, q)
	default:
		http.Error(w, "provide q or tag", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	images := []Image{}
	for rows.Next() {
		var img Image
		if err := rows.Scan(&img.ID, &img.Board, &img.Title, &img.Filename,
			&img.ContentType, &img.Tags, &img.UploadedAt); err != nil {
			continue
		}
		img.ImageURL = minioBase + "/lolcatz-images/" + img.Board + "/" + img.ID
		images = append(images, img)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(images)
}
