"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export function AuthStatus() {
  const { data: session, status } = useSession();
  const devToken = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN;

  if (devToken) {
    return <span className="auth-status"><a href="/profile">developer@localhost (local)</a></span>;
  }

  if (status === "loading") {
    return <span className="auth-status">Checking login…</span>;
  }

  if (status === "authenticated") {
    return (
      <span className="auth-status">
        <a href="/profile" className="profile-link">
          {session.user?.image && <img src={session.user.image} alt="" />}
          <span>{session.user?.name ?? session.user?.email ?? "Profile"}</span>
        </a>
        <button type="button" onClick={() => signOut({ callbackUrl: "/" })}>
          Sign out
        </button>
      </span>
    );
  }

  return (
    <button
      className="auth-button"
      type="button"
      onClick={() => signIn("passmower", { callbackUrl: window.location.href })}
    >
      Sign in
    </button>
  );
}
