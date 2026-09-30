package platform

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
)

// ClientTLS uses system roots plus an optional mounted CA bundle.
func ClientTLS(enabled bool) *tls.Config {
	if !enabled {
		return nil
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		panic(err)
	}
	if file := os.Getenv("SSL_CERT_FILE"); file != "" {
		pem, err := os.ReadFile(file)
		if err != nil {
			panic(err)
		}
		if !roots.AppendCertsFromPEM(pem) {
			panic(fmt.Errorf("no CA certificates in %s", file))
		}
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}
}
