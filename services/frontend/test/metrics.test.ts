import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
const { routeLabel, registry, instrument, metricsHandler } = require("../metrics.cjs");

test("metric routes exclude IDs, query strings and health checks", () => {
  assert.equal(routeLabel("/thread/private-id"), "/thread/[id]");
  assert.equal(routeLabel("/profile/private-id"), "/profile/[id]");
  assert.equal(routeLabel("/api/auth/callback/passmower"), "/api/auth/*");
  assert.equal(routeLabel("/health"), null);
  assert.equal(routeLabel("/_next/static/private-hash"), null);
});
test("HTTP failures and disconnects are counted once without private labels", async () => {
  registry.resetMetrics();
  for (const finished of [true, false]) {
    const res = Object.assign(new EventEmitter(), { statusCode: 503, writableFinished: finished });
    instrument(() => {} )({ url: "/thread/private-id?token=private", method: "GET" }, res);
    res.emit("close"); res.emit("close");
  }
  const metrics = await registry.metrics();
  assert.match(metrics, /lolcatz_http_requests_total\{route="\/thread\/\[id\]",method="GET",code="503"\} 1/);
  assert.match(metrics, /code="499"\} 1/);
  assert.match(metrics, /lolcatz_http_requests_in_flight 0/);
  assert.doesNotMatch(metrics, /private/);
});

test("internal listener serves health separately from metrics", async () => {
  for (const [url, expected] of [["/health", 200], ["/unknown", 404]] as const) {
    let status = 0;
    let ended = false;
    await metricsHandler({ url }, { writeHead(code: number) { status = code; }, end() { ended = true; } });
    assert.equal(status, expected);
    assert.equal(ended, true);
  }
});
