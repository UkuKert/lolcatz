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
	devToken = os.Getenv("DEV_AUTH_TOKEN")
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
		log.Fatalf("db: %v", err)
	}
	if err = db.Ping(); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /images/{id}/comments", requireAuth(handlePost))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("comments listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || raw == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if devToken != "" {
			if raw != devToken {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			email := getEnvOr("DEV_AUTH_EMAIL", "developer@localhost")
			name := getEnvOr("DEV_AUTH_NAME", "Developer")
			r.Header.Set("X-User-Email", email)
			upsertUser(r, email, name)
			next(w, r)
			return
		}
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
		r.Header.Set("X-User-Email", claims.Email)
		if claims.Name == "" {
			claims.Name = claims.Email
		}
		upsertUser(r, claims.Email, claims.Name)
		next(w, r)
	}
}

func upsertUser(r *http.Request, email, name string) {
	if _, err := db.ExecContext(r.Context(), `
		INSERT INTO users (email, name) VALUES ($1, $2)
		ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
	`, email, name); err != nil {
		log.Printf("upsert user: %v", err)
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
