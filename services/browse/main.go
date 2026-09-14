package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"

	_ "github.com/lib/pq"
)

var db *sql.DB

type Image struct {
	ID          string   `json:"id"`
	Board       string   `json:"board"`
	Title       string   `json:"title"`
	Filename    string   `json:"filename"`
	ContentType string   `json:"content_type"`
	Size        int64    `json:"size"`
	Tags        []string `json:"tags"`
	UploadedAt  string   `json:"uploaded_at"`
}

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("required env var %s is not set", k)
	}
	return v
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
	mux.HandleFunc("GET /boards/{board}", handleBoard)
	mux.HandleFunc("GET /images/{id}", handleImage)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("browse listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func getEnvOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func handleBoard(w http.ResponseWriter, r *http.Request) {
	board := r.PathValue("board")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	rows, err := db.QueryContext(r.Context(), `
		SELECT id, board, title, filename, content_type, size, tags, uploaded_at
		FROM images WHERE board=$1
		ORDER BY uploaded_at DESC
		LIMIT $2 OFFSET $3
	`, board, limit, offset)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	images := []Image{}
	for rows.Next() {
		var img Image
		if err := rows.Scan(&img.ID, &img.Board, &img.Title, &img.Filename,
			&img.ContentType, &img.Size, &img.Tags, &img.UploadedAt); err != nil {
			continue
		}
		images = append(images, img)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(images)
}

func handleImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var img Image
	err := db.QueryRowContext(r.Context(), `
		SELECT id, board, title, filename, content_type, size, tags, uploaded_at
		FROM images WHERE id=$1
	`, id).Scan(&img.ID, &img.Board, &img.Title, &img.Filename,
		&img.ContentType, &img.Size, &img.Tags, &img.UploadedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", 404)
		return
	}
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}

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
