/** Only use an issuer-verified email as the local account lookup key. */
export function verifiedEmail(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const claims = profile as { email?: unknown; email_verified?: unknown };
  if (claims.email_verified !== true || typeof claims.email !== "string") return null;
  return claims.email.trim().toLowerCase() || null;
}
