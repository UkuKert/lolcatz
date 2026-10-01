import type { JWT } from "next-auth/jwt";
import { Issuer, errors } from "openid-client";

export function tokenExpiry(value: unknown): number {
  if (typeof value !== "string") return 0;
  const payload = value.split(".")[1];
  if (!payload) return 0;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return 0;
  }
  return claims && typeof claims.exp === "number" ? claims.exp * 1000 : 0;
}

let clientPromise: Promise<InstanceType<InstanceType<typeof Issuer>["Client"]>> | undefined;
async function getClient() {
  if (!clientPromise) {
    clientPromise = Issuer.discover(process.env.OIDC_ISSUER!).then(issuer => new issuer.Client({
      client_id: process.env.OIDC_CLIENT_ID!,
      client_secret: process.env.OIDC_CLIENT_SECRET!,
      token_endpoint_auth_method: "client_secret_basic",
    })).catch(error => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

type RenewedTokens = { access_token?: string; id_token?: string; refresh_token?: string };
// Coalesce simultaneous session requests and briefly reuse rotated tokens.
const renewals = new Map<string, Promise<RenewedTokens>>();
async function renew(refreshToken: string): Promise<RenewedTokens> {
  let pending = renewals.get(refreshToken);
  if (!pending) {
    pending = getClient().then(client => client.refresh(refreshToken, { exchangeBody: { resource: process.env.OIDC_AUDIENCE } }));
    renewals.set(refreshToken, pending);
    const clear = () => { setTimeout(() => renewals.delete(refreshToken), 30_000).unref(); };
    pending.then(clear, () => renewals.delete(refreshToken));
  }
  return pending;
}

export async function refreshLoginToken(
  token: JWT,
  refresh: (value: string) => Promise<RenewedTokens> = renew,
  now = Date.now(),
): Promise<JWT> {
  if (tokenExpiry(token.accessToken) > now + 120_000) return token;
  if (typeof token.refreshToken !== "string" || token.error === "RefreshTokenError") {
    return { ...token, accessToken: undefined, error: "RefreshTokenError" };
  }
  if (typeof token.refreshRetryAt === "number" && token.refreshRetryAt > now) {
    return { ...token, accessToken: tokenExpiry(token.accessToken) > now ? token.accessToken : undefined };
  }
  let updated: RenewedTokens;
  try {
    updated = await refresh(token.refreshToken);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    const providerError = error instanceof errors.OPError || error instanceof errors.RPError;
    const status = providerError ? error.response?.statusCode : undefined;
    const transient = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ERR_OUTGOING_REQUEST_TIMEOUT"].includes(code || "") ||
      status === 429 || (status !== undefined && status >= 500) ||
      (error instanceof errors.OPError && ["server_error", "temporarily_unavailable"].includes(error.error || ""));
    if (transient) {
      const failures = Math.min((token.refreshFailures ?? 0) + 1, 5);
      return {
        ...token,
        accessToken: tokenExpiry(token.accessToken) > now ? token.accessToken : undefined,
        error: "RefreshTokenRetry",
        refreshFailures: failures,
        refreshRetryAt: now + Math.min(5_000 * 2 ** (failures - 1), 60_000),
      };
    }
    if (!providerError) throw error;
    return { ...token, accessToken: undefined, error: "RefreshTokenError" };
  }
  if (tokenExpiry(updated.access_token) <= now + 120_000) {
    return { ...token, accessToken: undefined, error: "RefreshTokenError" };
  }
  return {
    ...token,
    accessToken: updated.access_token,
    idToken: updated.id_token ?? token.idToken,
    refreshToken: updated.refresh_token ?? token.refreshToken,
    error: undefined,
    refreshRetryAt: undefined,
    refreshFailures: undefined,
  };
}
