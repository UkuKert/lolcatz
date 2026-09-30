"use client";

import { signIn } from "next-auth/react";
import { useAdminAccess } from "../lib/admin-access";

export function AdminStatus() {
  const { status, retry } = useAdminAccess();
  if (status === "allowed") return null;
  if (status === "checking") return <p role="status">Checking admin access…</p>;
  if (status === "denied") return <p>You do not have access to manage boards.</p>;
  if (status === "signed-out" || status === "expired") return <div className="panel auth-prompt">
    <p>{status === "expired" ? "Your session has expired." : "Sign in to manage boards."}</p>
    <button className="btn" onClick={() => signIn("passmower", { callbackUrl: window.location.href })}>Sign in</button>
  </div>;
  return <div className="form-error" role="alert">
    <p>Board administration is unavailable. Your access could not be checked.</p>
    <button className="btn btn-ghost" onClick={retry}>Try again</button>
  </div>;
}
