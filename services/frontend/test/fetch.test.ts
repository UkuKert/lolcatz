import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchResponse, NetworkError } from "../lib/fetch";
import { errorMessage } from "../lib/api";

test("expected fetch transport failures become safe user-facing errors", async () => {
  for (const error of [new TypeError("Failed to fetch"), new DOMException("timeout", "TimeoutError"), new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })]) {
    await assert.rejects(fetchResponse("http://example.test", {}, async () => { throw error; }), NetworkError);
  }
});
test("programming and TLS configuration errors are not disguised as transient outages", async () => {
  for (const error of [new TypeError("invalid configuration"), new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } })]) {
    await assert.rejects(fetchResponse("http://example.test", {}, async () => { throw error; }), value => value === error);
    assert.throws(() => errorMessage(error), value => value === error);
  }
});
