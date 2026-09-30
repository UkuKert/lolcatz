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
