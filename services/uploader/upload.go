package main

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/codemowers/lolcatz/services/internal/auth"
)

func validUploadFields(w http.ResponseWriter, title, filename string) bool {
	// Keep every accepted event below Kafka's message-size limit so a single
	// oversized title cannot permanently block the ordered outbox.
	if len(title) > 16384 || len(filename) > 1024 {
		http.Error(w, "title or filename is too long", http.StatusBadRequest)
		return false
	}
	return true
}

func lockImage(ctx context.Context, tx *sql.Tx, id string) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, id)
	return err
}

// Persist the post and its canonical event atomically, including the actual
// database upload timestamp. Kafka delivery can safely happen after the response.
func insertUpload(ctx context.Context, tx *sql.Tx, event ImageEvent, size int64, user auth.User, userAgent string) error {
	err := tx.QueryRowContext(ctx, `INSERT INTO images
		(id, board, title, filename, content_type, size, author, user_agent, user_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING uploaded_at`,
		event.ID, event.Board, event.Title, event.Filename, event.ContentType, size,
		user.Name, userAgent, user.ID).Scan(&event.UploadedAt)
	if err != nil {
		return err
	}
	return enqueueUpload(ctx, tx, event)
}
