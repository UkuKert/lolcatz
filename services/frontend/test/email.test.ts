import assert from "node:assert/strict";
import { test } from "node:test";
import { verifiedEmail } from "../lib/email";

test("login requires a nonempty issuer-verified email", () => {
  for (const profile of [undefined, {}, { email: "user@example.com" },
    { email: "user@example.com", email_verified: false },
    { email: "user@example.com", email_verified: "true" },
    { email: "  ", email_verified: true }]) {
    assert.equal(verifiedEmail(profile), null);
  }
});

test("email account keys are trimmed and case insensitive", () => {
  assert.equal(verifiedEmail({ email: " User@Example.COM ", email_verified: true }), "user@example.com");
});
