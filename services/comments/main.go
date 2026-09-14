package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	_ "github.com/lib/pq"
)

var (
	db       *sql.DB
	verifier *gooidc.IDTokenVerifier
)

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

	issuer := mustEnv("OIDC_ISSUER")
	provider, err := gooidc.NewProvider(context.Background(), issuer)
	if err != nil {
		log.Fatalf("oidc provider: %v", err)
	}
	verifier = provider.Verifier(&gooidc.Config{SkipClientIDCheck: true})

	db, err = sql.Open("postgres", mustEnv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	if err = db.Ping(); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /images/{id}/comments", requireAuth(handlePost))
	mux.HandleFunc("DELETE /comments/{id}", requireAuth(handleDelete))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("comments listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		rawToken := strings.TrimPrefix(authHeader, "Bearer ")
		token, err := verifier.Verify(r.Context(), rawToken)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var claims struct {
			Email  string   `json:"email"`
			Sub    string   `json:"sub"`
			Groups []string `json:"groups"`
		}
		if err := token.Claims(&claims); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		r.Header.Set("X-User-Email", claims.Email)
		r.Header.Set("X-User-Sub", claims.Sub)
		r.Header.Set("X-User-Groups", strings.Join(claims.Groups, ","))
		next(w, r)
	}
}

func handlePost(w http.ResponseWriter, r *http.Request) {
	imageID := r.PathValue("id")
	var body struct {
		Body string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Body == "" {
		http.Error(w, "body required", 400)
		return
	}
	author := r.Header.Get("X-User-Email")
	if author == "" {
		author = "Anonymous"
	}

	var id int64
	err := db.QueryRowContext(r.Context(),
		`INSERT INTO comments (image_id, body, author) VALUES ($1,$2,$3) RETURNING id`,
		imageID, body.Body, author,
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
		if strings.TrimSpace(g) == "admins" || strings.Contains(g, "codemowers:admins") {
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
