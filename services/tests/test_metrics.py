import io
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics import HTTPMetrics, REGISTRY, start_exporter
from prometheus_client import generate_latest


class MetricsTests(unittest.TestCase):
    def test_internal_listener_serves_health_and_metrics(self):
        import os
        import urllib.request
        from unittest.mock import patch
        with patch.dict(os.environ, METRICS_PORT="0"):
            server, thread = start_exporter()
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            for host in ("127.0.0.1", "[::1]"):
                base = f"http://{host}:{server.server_port}"
                with client.open(base + "/health", timeout=2) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), b"")
                with client.open(base + "/metrics", timeout=2) as response:
                    self.assertIn(b"lolcatz_http_requests", response.read())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_health_response_body_is_preserved_without_recording_request(self):
        before = generate_latest(REGISTRY)
        app = HTTPMetrics(lambda env, start: (start("200 OK", []), [b"ok"])[1])
        self.assertEqual(list(app({"PATH_INFO": "/health"}, lambda *args: None)), [b"ok"])
        self.assertEqual(generate_latest(REGISTRY), before)

    def test_framework_errors_and_unknown_paths_have_bounded_labels(self):
        def app(env, start):
            start("503 Service Unavailable", [])
            return [b"unavailable"]
        response = HTTPMetrics(app)({"PATH_INFO": "/private-id/token", "REQUEST_METHOD": "GET"}, lambda *args: None)
        self.assertEqual(b"".join(response), b"unavailable")
        metrics = generate_latest(REGISTRY).decode()
        self.assertIn('lolcatz_http_requests_total{code="503",method="GET",route="unmatched"}', metrics)
        self.assertNotIn("private-id", metrics)

    def test_streaming_failure_propagates_and_releases_inflight(self):
        def app(env, start):
            start("200 OK", [])
            yield b"partial"
            raise TypeError("bug")
        with self.assertRaises(TypeError):
            list(HTTPMetrics(app)({"PATH_INFO": "/api/thumbnails/v1/private-id", "REQUEST_METHOD": "GET"}, lambda *args: None))
        metrics = generate_latest(REGISTRY).decode()
        self.assertIn('lolcatz_http_requests_total{code="500",method="GET",route="/api/thumbnails/v1/<image_id>"}', metrics)
        self.assertIn("lolcatz_http_requests_in_flight 0.0", metrics)
