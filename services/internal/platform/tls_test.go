package platform

import (
	"crypto/x509"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestClientTLSVerifiesMountedCAAndHostname(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer server.Close()
	file := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SSL_CERT_FILE", file)
	config := ClientTLS(true)
	if config.InsecureSkipVerify {
		t.Fatal("TLS verification must remain enabled")
	}
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: config}}
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	config = config.Clone()
	config.ServerName = "wrong.example"
	client = &http.Client{Transport: &http.Transport{TLSClientConfig: config}}
	if _, err := client.Get(server.URL); err == nil {
		t.Fatal("wrong hostname was accepted")
	}
	config = config.Clone()
	config.ServerName = ""
	config.RootCAs = x509.NewCertPool()
	client = &http.Client{Transport: &http.Transport{TLSClientConfig: config}}
	if _, err := client.Get(server.URL); err == nil {
		t.Fatal("untrusted certificate was accepted")
	}
}

func TestTLSRemainsOptional(t *testing.T) {
	if ClientTLS(false) != nil {
		t.Fatal("plaintext mode must not configure TLS")
	}
}
