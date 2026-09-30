"use client";
import { SessionProvider, signIn, useSession } from "next-auth/react";
import { AdminProvider } from "../lib/admin-access";
import { PreferencesProvider } from "../lib/preferences";

function SessionGuard({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  if (!process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN && session?.error === "RefreshTokenError") {
    return <div className="panel auth-prompt" role="alert">
      <p>Your session could not be renewed. Sign in again to continue.</p>
      <button className="btn" onClick={() => signIn("passmower", { callbackUrl: window.location.href })}>Sign in again</button>
    </div>;
  }
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus refetchWhenOffline={false}>
      <PreferencesProvider><AdminProvider><SessionGuard>{children}</SessionGuard></AdminProvider></PreferencesProvider>
    </SessionProvider>
  );
}
