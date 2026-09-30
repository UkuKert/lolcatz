import { fetchResponse } from "./fetch";

export class LoginRejectedError extends Error {}

type LoginTokens = { id_token?: string; access_token?: string };

/** Login setup only; browser API requests never pass through this function. */
export async function linkLogin(tokens: LoginTokens, request: typeof fetch = fetch): Promise<void> {
  if (!tokens.id_token || !tokens.access_token) throw new Error("Missing login tokens");
  const response = await fetchResponse(
    process.env.LOGIN_LINK_URL || "http://lolcatz-uploader:8080/api/upload/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.access_token}` },
      body: JSON.stringify({ id_token: tokens.id_token }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
    request,
  );
  // Do not log tokens or provider/backend responses containing identity data.
  if (!response.ok) throw new LoginRejectedError("Could not link login account");
}
