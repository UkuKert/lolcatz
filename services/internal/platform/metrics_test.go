package platform

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestHTTPMetricsBoundedLabelsAndHealthExclusion(t *testing.T) {
	requests.Reset()
	duration.Reset()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /images/{id}", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) })
	handler := Instrument(mux)
	for _, url := range []string{"/images/alice-secret", "/images/bob-secret", "/unknown-secret", "/health"} {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", url, nil))
	}
	if n := testutil.ToFloat64(requests.WithLabelValues("GET /images/{id}", "GET", "503")); n != 2 {
		t.Fatalf("5xx count=%v", n)
	}
	if n := testutil.ToFloat64(inflight); n != 0 {
		t.Fatalf("in flight=%v", n)
	}
	families, err := Registry.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, family := range families {
		if family.GetName() != "lolcatz_http_requests_total" {
			continue
		}
		if len(family.Metric) != 2 {
			t.Fatalf("expected route and unmatched series, got %v", family)
		}
	}
}

func TestInternalHealthListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	t.Setenv("METRICS_ADDRESS", address)
	stop, err := StartMetrics()
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	client := &http.Client{Timeout: 2 * time.Second}
	for _, path := range []string{"/health", "/metrics"} {
		response, err := client.Get("http://" + address + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s: %d", path, response.StatusCode)
		}
	}
}
