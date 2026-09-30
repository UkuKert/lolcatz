package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/codemowers/lolcatz/services/internal/auth"
)

// Login is the only place where email resolves a local account. Validate both
// tokens and bind their subjects before trusting the ID token's email claim.
// Application requests continue to use access tokens directly.
func handleLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if loginVerifier == nil {
		http.Error(w, "OIDC login unavailable", http.StatusServiceUnavailable)
		return
	}
	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || raw == "" {
		auth.InvalidToken(w)
		return
	}
	access, valid := auth.Verify(w, r, verifier, raw, "lolcatz:images:read")
	if !valid {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32768)
	var body struct {
		IDToken string `json:"id_token"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || body.IDToken == "" {
		http.Error(w, "id_token required", http.StatusBadRequest)
		return
	}
	identity, err := loginVerifier.Verify(r.Context(), body.IDToken)
	if err != nil || identity.Subject != access.Subject || identity.Issuer != access.Issuer {
		auth.InvalidToken(w)
		return
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if identity.Claims(&claims) != nil || !claims.EmailVerified || strings.TrimSpace(claims.Email) == "" {
		http.Error(w, "verified email required at login", http.StatusForbidden)
		return
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	_, err = db.ExecContext(r.Context(), `
        INSERT INTO users (email, subject, name)
        VALUES ($1, $2, COALESCE(NULLIF($3, ''), $1))
        ON CONFLICT (email) DO UPDATE
        SET subject = EXCLUDED.subject, name = COALESCE(NULLIF($3, ''), users.name)`,
		email, identity.Subject, claims.Name)
	if err != nil {
		http.Error(w, "could not link account", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
