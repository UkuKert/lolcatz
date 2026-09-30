package platform

import (
	"context"
	"crypto/tls"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Serve drains requests on termination. TLS certificates are read for each
// handshake so cert-manager's projected Secret renewals require no restart.
func Serve(mux *http.ServeMux) error {
	stopMetrics, err := StartMetrics()
	if err != nil {
		return err
	}
	defer stopMetrics()
	handler := Instrument(mux)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{
		Addr: "[::]:" + port, Handler: handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	cert, key := os.Getenv("TLS_CERT_FILE"), os.Getenv("TLS_KEY_FILE")
	if (cert == "") != (key == "") {
		return errors.New("TLS_CERT_FILE and TLS_KEY_FILE must be configured together")
	}
	if cert != "" {
		server.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
			certificate, err := tls.LoadX509KeyPair(cert, key)
			return &certificate, err
		}}
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	done := make(chan error, 1)
	go func() {
		if cert != "" {
			done <- server.ListenAndServeTLS("", "")
		} else {
			done <- server.ListenAndServe()
		}
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		drain, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := server.Shutdown(drain); err != nil {
			server.Close()
			return err
		}
		return nil
	}
}
