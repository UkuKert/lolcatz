package platform

import (
	"context"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var Registry = prometheus.NewRegistry()
var requests = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "lolcatz_http_requests_total", Help: "Completed application requests, excluding health and metrics."}, []string{"route", "method", "code"})
var duration = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "lolcatz_http_request_duration_seconds", Help: "Application request latency.", Buckets: []float64{.01, .05, .1, .25, .5, 1, 2, 5, 10, 30}}, []string{"route", "method"})
var inflight = prometheus.NewGauge(prometheus.GaugeOpts{Name: "lolcatz_http_requests_in_flight", Help: "Application requests currently executing."})
var WorkerCommitted = prometheus.NewCounter(prometheus.CounterOpts{Name: "lolcatz_worker_committed_total", Help: "Records processed and successfully committed, including intentional skips."})
var WorkerFailures = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "lolcatz_worker_failures_total", Help: "Worker failures by stage; fatal failures also require restart alerts."}, []string{"stage"})
var WorkerStarted = prometheus.NewGauge(prometheus.GaugeOpts{Name: "lolcatz_worker_active_since_seconds", Help: "Start timestamp of the active record, or zero when idle."})
var WorkerPoll = prometheus.NewGauge(prometheus.GaugeOpts{Name: "lolcatz_worker_last_poll_timestamp_seconds", Help: "Last completed consumer poll, including empty polls."})
var WorkerCommitTime = prometheus.NewGauge(prometheus.GaugeOpts{Name: "lolcatz_worker_last_commit_timestamp_seconds", Help: "Last successful offset commit; zero before first commit."})
var WorkerDuration = prometheus.NewHistogram(prometheus.HistogramOpts{Name: "lolcatz_worker_processing_duration_seconds", Help: "Record processing and commit duration, including retries.", Buckets: []float64{.1, .5, 1, 5, 10, 30, 60, 120}})
var WorkerSkipped = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "lolcatz_worker_skipped_total", Help: "Intentionally skipped records."}, []string{"reason"})

func init() { Registry.MustRegister(requests, duration, inflight) }

func RegisterWorkerMetrics() {
	Registry.MustRegister(WorkerCommitted, WorkerFailures, WorkerStarted, WorkerPoll, WorkerCommitTime, WorkerDuration, WorkerSkipped)
	for _, stage := range []string{"poll", "process", "commit"} {
		WorkerFailures.WithLabelValues(stage)
	}
}

// Instrument uses ServeMux's registered patterns, never user IDs or raw URLs.
func Instrument(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			mux.ServeHTTP(w, r)
			return
		}
		_, route := mux.Handler(r)
		if route == "" {
			route = "unmatched"
		}
		method := r.Method
		switch method {
		case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
		default:
			method = "OTHER"
		}
		// Keep promhttp's status/optional-interface handling (streaming, flushing).
		handler := promhttp.InstrumentHandlerCounter(requests.MustCurryWith(prometheus.Labels{"route": route, "method": method}),
			promhttp.InstrumentHandlerDuration(duration.MustCurryWith(prometheus.Labels{"route": route, "method": method}), mux))
		inflight.Inc()
		defer inflight.Dec()
		handler.ServeHTTP(w, r)
	})
}

// StartMetrics binds before returning so an unusable exporter fails startup.
// Metrics use internal plaintext HTTP independently of application TLS.
func StartMetrics() (func(), error) {
	address := os.Getenv("METRICS_ADDRESS")
	if address == "" {
		address = "[::]:9090"
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.HandlerFor(Registry, promhttp.HandlerOpts{}))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			panic(err)
		}
	}()
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			server.Close()
		}
	}, nil
}
