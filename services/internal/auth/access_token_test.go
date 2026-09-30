package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	jose "github.com/go-jose/go-jose/v4"
)

func TestAccessTokenValidation(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	verifier := gooidc.NewVerifier("https://issuer.example/", &gooidc.StaticKeySet{PublicKeys: []crypto.PublicKey{&key.PublicKey}}, &gooidc.Config{ClientID: "https://lolcatz.example/api"})
	for _, tc := range []struct {
		name, typ, issuer, audience, scope, subject string
		expired, future, tampered                   bool
		want                                        int
	}{
		{name: "valid", want: 200},
		{name: "ID token", typ: "JWT", want: 401},
		{name: "other issuer", issuer: "https://other.example/", want: 401},
		{name: "other audience", audience: "frontend-client", want: 401},
		{name: "expired", expired: true, want: 401},
		{name: "not yet valid", future: true, want: 401},
		{name: "invalid signature", tampered: true, want: 401},
		{name: "missing scope", scope: "openid", want: 403},
		{name: "scope prefix is insufficient", scope: "lolcatz:images:write-extra", want: 403},
		{name: "no email", want: 200},
		{name: "unverified email", want: 200},
		{name: "missing email verification", want: 200},
		{name: "no subject", subject: "missing", want: 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			typ := tc.typ
			if typ == "" {
				typ = "at+jwt"
			}
			issuer := tc.issuer
			if issuer == "" {
				issuer = "https://issuer.example/"
			}
			audience := tc.audience
			if audience == "" {
				audience = "https://lolcatz.example/api"
			}
			scope := tc.scope
			if scope == "" {
				scope = "openid lolcatz:images:write lolcatz:images:read"
			}
			expiry := time.Now().Add(time.Hour).Unix()
			if tc.expired {
				expiry = time.Now().Add(-time.Hour).Unix()
			}
			claims := map[string]any{"iss": issuer, "aud": audience, "sub": "user", "exp": expiry, "scope": scope, "email": "user@example.test", "email_verified": true}
			if tc.name == "no email" {
				delete(claims, "email")
			}
			if tc.name == "unverified email" {
				claims["email_verified"] = false
			}
			if tc.name == "missing email verification" {
				delete(claims, "email_verified")
			}
			if tc.future {
				claims["nbf"] = time.Now().Add(time.Hour).Unix()
			}
			if tc.subject == "missing" {
				delete(claims, "sub")
			}
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType(jose.ContentType(typ)))
			if err != nil {
				t.Fatal(err)
			}
			payload, _ := json.Marshal(claims)
			signed, err := signer.Sign(payload)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := signed.CompactSerialize()
			if err != nil {
				t.Fatal(err)
			}
			if tc.tampered {
				parts := strings.Split(raw, ".")
				parts[2] = "c2ln"
				raw = strings.Join(parts, ".")
			}
			response := httptest.NewRecorder()
			_, ok := Verify(response, httptest.NewRequest("POST", "/", nil), verifier, raw, "lolcatz:images:write")
			if response.Code != tc.want || ok != (tc.want == 200) {
				t.Fatalf("got %d, ok=%v: %s", response.Code, ok, response.Body.String())
			}
			if tc.want == 403 && !strings.Contains(response.Header().Get("WWW-Authenticate"), "insufficient_scope") {
				t.Fatal("missing scope challenge")
			}
		})
	}
}
