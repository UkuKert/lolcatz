"""Bounded application metrics; no IDs, filenames, subjects or exception messages."""
import os
import socket
import threading
from http.server import ThreadingHTTPServer
from time import monotonic
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, MetricsHandler

REGISTRY = CollectorRegistry()
REQUESTS = Counter("lolcatz_http_requests_total", "Completed application requests excluding health.", ["route", "method", "code"], registry=REGISTRY)
DURATION = Histogram("lolcatz_http_request_duration_seconds", "Application request latency.", ["route", "method"], buckets=(.01, .05, .1, .25, .5, 1, 2, 5, 10, 30), registry=REGISTRY)
INFLIGHT = Gauge("lolcatz_http_requests_in_flight", "Application requests currently executing.", registry=REGISTRY)
FALLBACKS = Counter("lolcatz_thumbnail_fallbacks_total", "Thumbnail requests redirected to originals after generation failure.", registry=REGISTRY)
THUMBNAIL_GENERATION = Histogram("lolcatz_thumbnail_generation_duration_seconds", "Successful thumbnail generation: shared decode/preparation plus per-size resize/encode, excluding storage I/O.", ["size"], buckets=(.001, .005, .01, .025, .05, .1, .25, .5, 1, 2, 5, 10, 30), registry=REGISTRY)
COMMITTED = Counter("lolcatz_worker_committed_total", "Records processed and successfully committed, including intentional skips.", registry=REGISTRY)
FAILURES = Counter("lolcatz_worker_failures_total", "Worker failures by stage; fatal failures also require restart alerts.", ["stage"], registry=REGISTRY)
ACTIVE = Gauge("lolcatz_worker_active_since_seconds", "Start timestamp of the active record, or zero when idle.", registry=REGISTRY)
POLL = Gauge("lolcatz_worker_last_poll_timestamp_seconds", "Last completed consumer poll, including empty polls.", registry=REGISTRY)
LAST_COMMIT = Gauge("lolcatz_worker_last_commit_timestamp_seconds", "Last successful offset commit; zero before first commit.", registry=REGISTRY)
PROCESSING = Histogram("lolcatz_worker_processing_duration_seconds", "Record processing and commit duration.", buckets=(.1, .5, 1, 5, 10, 30, 60, 120), registry=REGISTRY)
for stage in ("poll", "process", "commit"):
    FAILURES.labels(stage)


def start_exporter():
    class InternalHandler(MetricsHandler.factory(REGISTRY)):
        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/health":
                self.send_response(200)
                self.end_headers()
            elif path == "/metrics":
                super().do_GET()
            else:
                self.send_error(404)

    class InternalServer(ThreadingHTTPServer):
        address_family = socket.AF_INET6

        def server_bind(self):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            super().server_bind()

    server = InternalServer(("::", int(os.environ.get("METRICS_PORT", "9090"))), InternalHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread



class HTTPMetrics:
    """WSGI instrumentation records framework 500s and streaming failures."""
    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        if environ.get("PATH_INFO") == "/health":
            yield from self.app(environ, start_response)
            return
        # There is only one application route, validate it without exposing IDs.
        path = environ.get("PATH_INFO", "").split("/")
        route = "/api/thumbnails/v1/<image_id>" if len(path) == 5 and path[1:4] == ["api", "thumbnails", "v1"] else "unmatched"
        method = environ.get("REQUEST_METHOD", "OTHER")
        if method not in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}:
            method = "OTHER"
        status = "500"
        started = monotonic()
        completed = False
        iterable = None
        INFLIGHT.inc()
        def response(value, headers, exc_info=None):
            nonlocal status
            status = value.split(" ", 1)[0]
            return start_response(value, headers, exc_info)
        try:
            iterable = self.app(environ, response)
            yield from iterable
            completed = True
        finally:
            REQUESTS.labels(route, method, status if completed else "500").inc()
            DURATION.labels(route, method).observe(monotonic() - started)
            INFLIGHT.dec()
            if iterable is not None and hasattr(iterable, "close"):
                iterable.close()
