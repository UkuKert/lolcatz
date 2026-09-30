"use client";

import Link from "next/link";
import { useAdminAccess } from "../../../lib/admin-access";
import { AdminStatus } from "../../admin-status";
import { BoardAdmin } from "../board-admin";

export default function ManageBoardsPage() {
  const { allowed, status, token } = useAdminAccess();
  return <div>
    <div className="page-head"><h2 className="page-title">Manage boards</h2><Link className="btn btn-ghost" href="/profile">Your profile</Link></div>
    <AdminStatus />
    {allowed && token && <BoardAdmin token={token} disabled={status !== "allowed"} />}
  </div>;
}
