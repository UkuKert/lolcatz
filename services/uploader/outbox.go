package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"github.com/segmentio/kafka-go"
)

func enqueueUpload(ctx context.Context, tx *sql.Tx, event ImageEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return enqueueEvent(ctx, tx, event.ID, payload)
}

func enqueueEvent(ctx context.Context, tx *sql.Tx, id string, payload []byte) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO image_outbox (image_id, payload) VALUES ($1, $2)`, id, payload)
	return err
}

type eventPublisher interface {
	WriteMessages(context.Context, ...kafka.Message) error
}

// Serialize dispatch across uploader replicas, including retries. In particular,
// an upload must never be published after its deletion tombstone. A crash after
// Kafka acknowledges but before commit can duplicate an event; consumers are
// idempotent and the next event is not dispatched until this one is retired.
func dispatchEvent(ctx context.Context, connection *sql.DB, writer eventPublisher) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	// kafka-go can keep sending after a canceled WriteMessages call returns.
	// Drain this bounded write before releasing the DB lock, even on shutdown,
	// so another replica cannot publish a tombstone ahead of an in-flight upload.
	ctx = context.WithoutCancel(ctx)
	tx, err := connection.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var locked bool
	if err := tx.QueryRowContext(ctx, `SELECT pg_try_advisory_xact_lock(1819241571, 1)`).Scan(&locked); err != nil || !locked {
		return false, err
	}
	var sequence int64
	var id string
	var payload []byte
	err = tx.QueryRowContext(ctx, `SELECT sequence, image_id, payload FROM image_outbox ORDER BY sequence LIMIT 1 FOR UPDATE`).Scan(&sequence, &id, &payload)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err = writer.WriteMessages(ctx, kafka.Message{Key: []byte(id), Value: payload}); err != nil {
		return false, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM image_outbox WHERE sequence = $1`, sequence); err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func startOutbox(connection *sql.DB, writer eventPublisher) func() {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		for ctx.Err() == nil {
			sent, err := dispatchEvent(ctx, connection, writer)
			if err != nil && ctx.Err() == nil {
				log.Printf("publish pending image event; will retry: %v", err)
			}
			if sent {
				continue
			}
			timer := time.NewTimer(time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
			case <-timer.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
