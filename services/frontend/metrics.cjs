const { Registry, Counter, Histogram, Gauge } = require("prom-client");
const registry = new Registry();
const requests = new Counter({ name: "lolcatz_http_requests_total", help: "Completed application requests excluding health and static assets.", labelNames: ["route", "method", "code"], registers: [registry] });
const duration = new Histogram({ name: "lolcatz_http_request_duration_seconds", help: "Application request latency.", labelNames: ["route", "method"], buckets: [.01, .05, .1, .25, .5, 1, 2, 5, 10, 30], registers: [registry] });
const inflight = new Gauge({ name: "lolcatz_http_requests_in_flight", help: "Application requests currently executing.", registers: [registry] });
function routeLabel(path) {
  if (path === "/health" || path.startsWith("/_next/") || path === "/favicon.ico" || path === "/github.svg") return null;
  if (/^\/api\/auth(?:\/|$)/.test(path)) return "/api/auth/*";
  if (/^\/thread\/[^/]+\/?$/.test(path)) return "/thread/[id]";
  if (["/", "/search", "/profile", "/profile/boards"].includes(path)) return path;
  if (/^\/profile\/[^/]+\/?$/.test(path)) return "/profile/[id]";
  if (/^\/[^/]+\/?$/.test(path)) return "/[board]";
  return "unmatched";
}
function instrument(handler) {
  return (req, res) => {
    const route = routeLabel(req.url.split("?", 1)[0]);
    if (route === null) return handler(req, res);
    const method = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(req.method) ? req.method : "OTHER";
    const start = process.hrtime.bigint();
    inflight.inc();
    res.once("close", () => {
      requests.inc({ route, method, code: res.writableFinished ? String(res.statusCode) : "499" });
      duration.observe({ route, method }, Number(process.hrtime.bigint() - start) / 1e9);
      inflight.dec();
    });
    return handler(req, res);
  };
}
async function metricsHandler(req, res) {
  const path = req.url.split("?", 1)[0];
  if (path === "/health") { res.writeHead(200); res.end(); return; }
  if (path !== "/metrics") { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", registry.contentType);
  res.end(await registry.metrics());
}
module.exports = { instrument, metricsHandler, routeLabel, registry };
