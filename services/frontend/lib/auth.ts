import type { NextAuthOptions } from "next-auth";
import { createHash } from "node:crypto";
import { NetworkError } from "./fetch";
import { linkLogin, LoginRejectedError } from "./login-link";
import { verifiedEmail } from "./email";
import { refreshLoginToken } from "./token-refresh";

const oidcCallbackUrl = `${process.env.NEXTAUTH_URL}/api/auth/callback`;

function gravatarUrl(email?: string) {
  if (!email) return undefined;
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=160`;
}

function oidcAttributes(idToken: string) {
  const payload = idToken.split(".")[1];
  if (!payload) return {};
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return {};
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return {};
  return {
    subject: claims.sub,
    email: typeof claims.email === "string" ? claims.email.trim().toLowerCase() : undefined,
    name: claims.name,
    username: claims.preferred_username,
    groups: claims.groups ?? [],
    issuer: claims.iss,
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "passmower",
      name: process.env.OIDC_PROVIDER_NAME || "OpenID",
      type: "oauth",
      wellKnown: `${process.env.OIDC_ISSUER}.well-known/openid-configuration`,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid profile email groups lolcatz:images:read lolcatz:images:write lolcatz:comments:write lolcatz:boards:write",
          resource: process.env.OIDC_AUDIENCE,
          redirect_uri: oidcCallbackUrl,
        },
      },
      // Passmower's generic OpenID client registers one callback without a
      // provider suffix. Keep the same URI for the code exchange as the one
      // used by the authorization request.
      token: {
        async request({ params, checks, client }: any) {
          const tokens = await client.callback(oidcCallbackUrl, params, checks);
          return { tokens };
        },
      },
      idToken: true,
      checks: ["pkce", "state"],
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name ?? profile.email,
          email: verifiedEmail(profile) ?? undefined,
          image: gravatarUrl(profile.email),
        };
      },
    },
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ profile, account }) {
      if (verifiedEmail(profile) === null || !account) return false;
      try {
        await linkLogin(account);
        return true;
      } catch (error) {
        if (!(error instanceof LoginRejectedError || error instanceof NetworkError)) throw error;
        return false;
      }
    },
    async jwt({ token, account }) {
      // Keep renewal credentials in the encrypted, HttpOnly session cookie.
      if (account?.id_token) {
        token.idToken = account.id_token;
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.error = undefined;
        token.oidcAttributes = oidcAttributes(account.id_token);
        return token;
      }
      const updated = await refreshLoginToken(token);
      if (typeof updated.idToken === "string") updated.oidcAttributes = oidcAttributes(updated.idToken);
      return updated;
    },
    async session({ session, token }) {
      // The browser calls each API directly with its audience-bound access token.
      session.accessToken = token.accessToken;
      session.error = token.error;
      session.oidcAttributes = token.oidcAttributes ?? {};
      if (session.user) session.user.image = gravatarUrl(session.user.email ?? undefined);
      return session;
    },
  },
};
