package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
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
	verifier    *gooidc.IDTokenVerifier
	bucket      = mustEnv("S3_BUCKET")
)

type ImageEvent struct {
	ID          string    `json:"id"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	UploadedAt  time.Time `json:"uploaded_at"`
	Board       string    `json:"board"`
	Title       string    `json:"title"`
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

	// OIDC verifier — fetches JWKS from issuer
	issuer := mustEnv("OIDC_ISSUER")
	provider, err := gooidc.NewProvider(context.Background(), issuer)
	if err != nil {
		log.Fatalf("oidc provider: %v", err)
	}
	verifier = provider.Verifier(&gooidc.Config{SkipClientIDCheck: true})

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
		Addr:     kafka.TCP(mustEnv("KAFKA_BROKERS")),
		Topic:    "lolcatz-images",
		Balancer: &kafka.LeastBytes{},
	}
	defer kafkaWriter.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /upload", requireAuth(handleUpload))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	addr := ":" + getEnvOr("PORT", "8080")
	log.Printf("uploader listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

// requireAuth validates the Bearer token from Authorization header.
// Sets X-User-Email and X-User-Sub on the request context via header injection.
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
			log.Printf("token verify: %v", err)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var claims struct {
			Email string `json:"email"`
			Sub   string `json:"sub"`
		}
		if err := token.Claims(&claims); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		r.Header.Set("X-User-Email", claims.Email)
		r.Header.Set("X-User-Sub", claims.Sub)
		next(w, r)
	}
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS images (
			id          TEXT PRIMARY KEY,
			board       TEXT NOT NULL DEFAULT 'b',
			title       TEXT NOT NULL DEFAULT '',
			filename    TEXT NOT NULL,
			content_type TEXT NOT NULL,
			size        BIGINT NOT NULL,
			author      TEXT NOT NULL DEFAULT 'Anonymous',
			tags        TEXT[] NOT NULL DEFAULT '{}',
			uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

func handleUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	ct := header.Header.Get("Content-Type")
	if ct != "image/jpeg" && ct != "image/png" && ct != "image/gif" && ct != "image/webp" {
		http.Error(w, "unsupported content type", http.StatusUnsupportedMediaType)
		return
	}

	id := uuid.New().String()
	board := r.FormValue("board")
	if board == "" {
		board = "b"
	}
	title := r.FormValue("title")
	author := r.Header.Get("X-User-Email")
	if author == "" {
		author = "Anonymous"
	}
	objectKey := fmt.Sprintf("%s/%s", board, id)

	ctx := r.Context()
	info, err := minioClient.PutObject(ctx, bucket, objectKey, file, header.Size, minio.PutObjectOptions{
		ContentType: ct,
	})
	if err != nil {
		log.Printf("minio put: %v", err)
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}

	_, err = db.ExecContext(ctx,
		`INSERT INTO images (id, board, title, filename, content_type, size, author) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		id, board, title, header.Filename, ct, info.Size, author,
	)
	if err != nil {
		log.Printf("db insert: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	event := ImageEvent{
		ID:          id,
		Filename:    header.Filename,
		ContentType: ct,
		Size:        info.Size,
		UploadedAt:  time.Now(),
		Board:       board,
		Title:       title,
	}
	payload, _ := json.Marshal(event)
	if err := kafkaWriter.WriteMessages(context.Background(), kafka.Message{
		Key:   []byte(id),
		Value: payload,
	}); err != nil {
		log.Printf("kafka write (non-fatal): %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": id, "board": board})
}
