"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { APIError, isRequestError, request } from "./api";

type AccessStatus = "checking" | "allowed" | "denied" | "expired" | "unavailable" | "signed-out";
type Access = { status: AccessStatus; allowed: boolean; token?: string; retry: () => void };
const AdminContext = createContext<Access>({ status: "checking", allowed: false, retry: () => {} });

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status: sessionStatus } = useSession();
  const devToken = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN;
  const token = devToken || session?.accessToken;
  const identity = devToken ? "local" : session?.oidcAttributes?.subject;
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<{
    identity?: string; checkedToken?: string; status: AccessStatus; allowed: boolean;
  }>({ status: "checking", allowed: false });

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    // Keep the form mounted while the same user's renewed token is checked.
    setAccess(previous => ({ identity, status: "checking", allowed: previous.identity === identity && previous.allowed }));
    request("/api/admin/me", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(() => {
        if (!controller.signal.aborted) setAccess({ identity, checkedToken: token, status: "allowed", allowed: true });
      }).catch(error => {
        if (!isRequestError(error)) throw error;
        if (controller.signal.aborted) return;
        const status = error instanceof APIError && error.status === 403 ? "denied"
          : error instanceof APIError && error.status === 401 ? "expired" : "unavailable";
        setAccess(previous => ({ identity, status, allowed: status === "unavailable" && previous.allowed }));
      });
    return () => controller.abort();
  }, [token, identity, revision]);

  const sameIdentity = access.identity === identity;
  const status: AccessStatus = !token ? (sessionStatus === "loading" ? "checking" : "signed-out")
    : !sameIdentity || (access.status === "allowed" && access.checkedToken !== token) ? "checking" : access.status;
  return <AdminContext.Provider value={{
    status, allowed: Boolean(token) && sameIdentity && access.allowed, token,
    retry: () => setRevision(value => value + 1),
  }}>{children}</AdminContext.Provider>;
}

export function useAdminAccess() { return useContext(AdminContext); }
