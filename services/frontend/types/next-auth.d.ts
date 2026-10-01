import "next-auth";
import "next-auth/jwt";

type SessionError = "RefreshTokenError" | "RefreshTokenRetry";
type OIDCAttributes = {
  subject?: string;
  email?: string;
  name?: string;
  username?: string;
  groups?: string[];
  issuer?: string;
};

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: SessionError;
    oidcAttributes?: OIDCAttributes;
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
    refreshRetryAt?: number;
    refreshFailures?: number;
    error?: SessionError;
    oidcAttributes?: OIDCAttributes;
  }
}
