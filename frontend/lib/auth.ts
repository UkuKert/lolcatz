import type { NextAuthOptions } from "next-auth";
import { createHash } from "node:crypto";

const oidcCallbackUrl = `${process.env.NEXTAUTH_URL}/api/auth/callback`;

function gravatarUrl(email?: string) {
  if (!email) return undefined;
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=160`;
}

function oidcAttributes(idToken: string) {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return {
      subject: claims.sub,
      email: claims.email,
      name: claims.name,
      username: claims.preferred_username,
      groups: claims.groups ?? [],
      issuer: claims.iss,
    };
  } catch {
    return {};
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "passmower",
      name: "Passmower",
      type: "oauth",
      wellKnown: `${process.env.OIDC_ISSUER}.well-known/openid-configuration`,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid profile email groups",
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
          email: profile.email,
          image: gravatarUrl(profile.email),
        };
      },
    },
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account }) {
      // Persist the access_token so we can pass it to backend services
      if (account?.id_token) {
        token.idToken = account.id_token;
        token.oidcAttributes = oidcAttributes(account.id_token);
      }
      return token;
    },
    async session({ session, token }) {
      // Expose idToken to client so frontend can pass it as Bearer
      (session as any).idToken = token.idToken;
      (session as any).oidcAttributes = token.oidcAttributes ??
        (typeof token.idToken === "string" ? oidcAttributes(token.idToken) : {});
      if (session.user) session.user.image = gravatarUrl(session.user.email ?? undefined);
      return session;
    },
  },
};
