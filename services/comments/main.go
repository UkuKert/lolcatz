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
	mux.HandleFunc("POST /images/{id}/comments", handlePost)
	mux.HandleFunc("DELETE /comments/{id}", handleDelete)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("comments listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func handlePost(w http.ResponseWriter, r *http.Request) {
	imageID := r.PathValue("id")
	var body struct {
		Body   string `json:"body"`
		Author string `json:"author"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if body.Body == "" {
		http.Error(w, "body required", 400)
		return
	}
	if body.Author == "" {
		body.Author = "Anonymous"
	}

	var id int64
	err := db.QueryRowContext(r.Context(),
		`INSERT INTO comments (image_id, body, author) VALUES ($1,$2,$3) RETURNING id`,
		imageID, body.Body, body.Author,
	).Scan(&id)
	if err != nil {
		log.Printf("db insert: %v", err)
		http.Error(w, "db error", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"id": id})
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	groups := r.Header.Get("X-User-Groups")
	isAdmin := false
	for _, g := range strings.Split(groups, ",") {
		if strings.TrimSpace(g) == "admins" {
			isAdmin = true
			break
		}
	}
	if !isAdmin {
		http.Error(w, "forbidden", 403)
		return
	}
	id := r.PathValue("id")
	res, err := db.ExecContext(r.Context(), `DELETE FROM comments WHERE id=$1`, id)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.Error(w, "not found", 404)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
