package auth

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
)

// The verifier checks issuer, signature, expiry, not-before and API audience.
// Check token type as well so a login ID token cannot authorize API requests.
func Verify(w http.ResponseWriter, r *http.Request, verifier *gooidc.IDTokenVerifier, raw, requiredScope string) (*gooidc.IDToken, bool) {
	parts := strings.Split(raw, ".")
	var header struct {
		Type string `json:"typ"`
	}
	if len(parts) != 3 {
		InvalidToken(w)
		return nil, false
	}
	encoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(encoded, &header) != nil || (header.Type != "at+jwt" && header.Type != "application/at+jwt") {
		InvalidToken(w)
		return nil, false
	}
	token, err := verifier.Verify(r.Context(), raw)
	if err != nil || token.Subject == "" {
		InvalidToken(w)
		return nil, false
	}
	var claims struct {
		Scope string `json:"scope"`
	}
	if token.Claims(&claims) != nil {
		InvalidToken(w)
		return nil, false
	}
	for _, scope := range strings.Fields(claims.Scope) {
		if scope == requiredScope {
			return token, true
		}
	}
	w.Header().Set("WWW-Authenticate", `Bearer error="insufficient_scope", scope="`+requiredScope+`"`)
	http.Error(w, "required scope: "+requiredScope, http.StatusForbidden)
	return nil, false
}

func InvalidToken(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
	http.Error(w, "unauthorized", http.StatusUnauthorized)
}
