import type { NextAuthOptions } from "next-auth";

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "passmower",
      name: "Passmower",
      type: "oauth",
      wellKnown: `${process.env.OIDC_ISSUER}.well-known/openid-configuration`,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      authorization: { params: { scope: "openid profile email groups" } },
      idToken: true,
      checks: ["pkce", "state"],
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name ?? profile.email,
          email: profile.email,
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
      }
      return token;
    },
    async session({ session, token }) {
      // Expose idToken to client so frontend can pass it as Bearer
      (session as any).idToken = token.idToken;
      return session;
    },
  },
};
