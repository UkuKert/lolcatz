package auth

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"strings"
)

type userContextKey struct{}
type User struct {
	ID   int64
	Name string
}

func RequestUser(r *http.Request) User {
	user, _ := r.Context().Value(userContextKey{}).(User)
	return user
}

func AuthenticateUser(w http.ResponseWriter, r *http.Request, db *sql.DB, subject string, development bool) (*http.Request, bool) {
	var user User
	var err error
	if development {
		email := strings.ToLower(strings.TrimSpace(identityEnv("DEV_AUTH_EMAIL", "developer@localhost")))
		err = db.QueryRowContext(r.Context(), `INSERT INTO users (email, name) VALUES ($1, $2)
   ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id, name`,
			email, identityEnv("DEV_AUTH_NAME", "Developer")).Scan(&user.ID, &user.Name)
	} else {
		err = db.QueryRowContext(r.Context(), `SELECT id, name FROM users WHERE subject = $1`, subject).Scan(&user.ID, &user.Name)
	}
	if err == sql.ErrNoRows {
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
		http.Error(w, "sign in to link your account", http.StatusUnauthorized)
		return r, false
	}
	if err != nil {
		http.Error(w, "could not resolve user", http.StatusServiceUnavailable)
		return r, false
	}
	return r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)), true
}

func identityEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
