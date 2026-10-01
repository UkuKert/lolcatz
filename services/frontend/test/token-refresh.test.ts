import assert from "node:assert/strict";
import { test } from "node:test";
import { errors } from "openid-client";
import { refreshLoginToken } from "../lib/token-refresh";

const now = 1_800_000_000_000;
const jwt = (expiry: number) => `header.${Buffer.from(JSON.stringify({ exp: expiry / 1000 })).toString("base64url")}.signature`;

test("refresh follows access-token expiry even while the ID token is valid", async () => {
  const token = { accessToken: jwt(now - 1000), idToken: jwt(now + 3600000), refreshToken: "old" };
  const updated = await refreshLoginToken(token, async value => {
    assert.equal(value, "old");
    return { access_token: jwt(now + 1800000), refresh_token: "rotated" };
  }, now);
  assert.equal(updated.accessToken, jwt(now + 1800000));
  assert.equal(updated.refreshToken, "rotated");
  assert.equal(updated.idToken, token.idToken);
});

test("valid access tokens do not cause a refresh", async () => {
  const token = { accessToken: jwt(now + 3600000) };
  assert.equal(await refreshLoginToken(token, async () => { throw new Error("must not refresh"); }, now), token);
});

test("missing, opaque or expired renewed access tokens fail closed", async () => {
  for (const access_token of [undefined, "opaque", jwt(now - 1000)]) {
    const updated = await refreshLoginToken({ accessToken: jwt(now - 1000), refreshToken: "old" }, async () => ({ access_token }), now);
    assert.equal(updated.accessToken, undefined);
    assert.equal(updated.error, "RefreshTokenError");
  }
});

test("refresh errors clear the API token", async () => {
  const updated = await refreshLoginToken({ accessToken: jwt(now - 1000), refreshToken: "old" }, async () => { throw new errors.OPError({ error: "invalid_grant" }); }, now);
  assert.equal(updated.accessToken, undefined);
  assert.equal(updated.error, "RefreshTokenError");
});

test("unexpected refresh failures propagate", async () => {
  await assert.rejects(refreshLoginToken({ accessToken: jwt(now - 1000), refreshToken: "old" }, async () => { throw new TypeError("bug"); }, now), /bug/);
});

test("temporary failures preserve valid tokens, back off, and recover", async () => {
  const original = { accessToken: jwt(now + 60_000), refreshToken: "old" };
  for (const error of [
    Object.assign(new Error("DNS"), { code: "EAI_AGAIN" }),
    new errors.OPError({ error: "temporarily_unavailable" }),
    new errors.RPError({ message: "HTTP failure", response: { statusCode: 503 } as any }),
    new errors.RPError({ message: "rate limited", response: { statusCode: 429 } as any }),
  ]) {
    const failed = await refreshLoginToken(original, async () => { throw error; }, now);
    assert.equal(failed.accessToken, original.accessToken);
    assert.equal(failed.error, "RefreshTokenRetry");
    const waiting = await refreshLoginToken(failed, async () => { throw new Error("must back off"); }, now + 1000);
    assert.equal(waiting.refreshRetryAt, now + 5000);
    const renewed = await refreshLoginToken(waiting, async token => {
      assert.equal(token, "old");
      return { access_token: jwt(now + 3600000), refresh_token: "new" };
    }, now + 5000);
    assert.equal(renewed.error, undefined);
    assert.equal(renewed.refreshRetryAt, undefined);
    assert.equal(renewed.refreshFailures, undefined);
    assert.equal(renewed.refreshToken, "new");
  }
});

test("expired tokens are withheld during retries and backoff is capped", async () => {
  let token = { accessToken: jwt(now + 1000), refreshToken: "old" };
  const unavailable = async () => { throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); };
  let current = await refreshLoginToken(token, unavailable, now);
  current = await refreshLoginToken(current, unavailable, now + 2000);
  assert.equal(current.accessToken, undefined);
  assert.equal(current.error, "RefreshTokenRetry");
  for (let attempt = 0; attempt < 10; attempt++) {
    const retryAt = current.refreshRetryAt!;
    current = await refreshLoginToken(current, unavailable, retryAt);
    assert.ok(current.refreshRetryAt! - retryAt <= 60_000);
  }
  current = await refreshLoginToken(current, async () => ({ access_token: jwt(now + 3600000) }), current.refreshRetryAt!);
  assert.equal(current.error, undefined);
  assert.equal(current.accessToken, jwt(now + 3600000));
});

test("revoked credentials do not trigger repeated refresh attempts", async () => {
  const failed = await refreshLoginToken({ refreshToken: "old" }, async () => {
    throw new errors.OPError({ error: "invalid_grant" });
  }, now);
  const again = await refreshLoginToken(failed, async () => { throw new Error("must not retry"); }, now + 60000);
  assert.equal(again.error, "RefreshTokenError");
});
