package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
)

// Signature verification is supplied by go-oidc in production. This test key
// set lets the middleware tests exercise issuer, audience, expiry and roles.
type testKeys struct{}

func (testKeys) VerifySignature(_ context.Context, raw string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.Split(raw, ".")[1])
}
func TestAdminAuthorization(t *testing.T) {
	devToken = ""
	verifier = gooidc.NewVerifier("https://issuer.example", testKeys{}, &gooidc.Config{ClientID: "lolcatz"})
	handler := requireAdmin(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })
	for _, tc := range []struct {
		name, audience string
		groups         []string
		expired        bool
		want           int
	}{
		{"member", "lolcatz", []string{"member"}, false, 403},
		{"admin", "lolcatz", []string{"github.com:codemowers:admins"}, false, 204},
		{"legacy admin", "lolcatz", []string{"admin"}, false, 403},
		{"legacy app admin", "lolcatz", []string{"lolcatz-admin"}, false, 403},
		{"group prefix", "lolcatz", []string{"github.com:codemowers:admins-extra"}, false, 403},
		{"other audience", "other-app", []string{"github.com:codemowers:admins"}, false, 401},
		{"expired", "lolcatz", []string{"github.com:codemowers:admins"}, true, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			expiry := time.Now().Add(time.Hour).Unix()
			if tc.expired {
				expiry = time.Now().Add(-time.Hour).Unix()
			}
			payload, _ := json.Marshal(map[string]any{"iss": "https://issuer.example", "sub": "user", "aud": tc.audience, "exp": expiry, "groups": tc.groups, "scope": "lolcatz:boards:write", "email": "user@example.test", "email_verified": true})
			raw := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"at+jwt"}`)) + "." + base64.RawURLEncoding.EncodeToString(payload) + ".c2ln"
			req := httptest.NewRequest("GET", "/api/admin/me", nil)
			req.Header.Set("Authorization", "Bearer "+raw)
			response := httptest.NewRecorder()
			handler(response, req)
			if response.Code != tc.want {
				t.Fatalf("got %d: %s", response.Code, response.Body.String())
			}
		})
	}
}
