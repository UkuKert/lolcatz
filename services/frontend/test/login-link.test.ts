import assert from "node:assert/strict";
import { test } from "node:test";
import { linkLogin } from "../lib/login-link";

test("login links signed identity and API tokens without accepting an email parameter", async () => {
  let calls = 0;
  await linkLogin({ id_token: "identity", access_token: "api" }, (async (_url, options) => {
    calls++;
    assert.equal(options?.method, "POST");
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer api");
    assert.deepEqual(JSON.parse(String(options?.body)), { id_token: "identity" });
    return new Response(null, { status: 204 });
  }) as typeof fetch);
  assert.equal(calls, 1);
});

test("failed or incomplete account linking blocks login", async () => {
  await assert.rejects(linkLogin({ id_token: "identity" }), /Missing login tokens/);
  await assert.rejects(linkLogin({ id_token: "identity", access_token: "api" },
    (async () => new Response(null, { status: 401 })) as typeof fetch), /Could not link/);
});
