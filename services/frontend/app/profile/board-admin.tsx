"use client";

import Link from "next/link";
import { useState } from "react";
import type { Board } from "../../lib/boards";

import { request, errorMessage } from "../../lib/api";
import { useResource } from "../../lib/use-resource";
import { LoadError } from "../load-error";

export function BoardAdmin({ token, disabled = false }: { token: string; disabled?: boolean }) {
  const { data: boards = [], error: loadError, loading, reload } = useResource<Board[]>("/api/browse/boards");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const mutate = async (path: string, method: string, body?: object) => {
    await request(`/api/admin/boards${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    reload();
    window.dispatchEvent(new Event("boards-changed"));
  };
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || busy) return;
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    setBusy(true); setError(""); setSuccess("");
    try { await mutate("", "POST", body); form.reset(); setSuccess("Board created."); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const remove = async (board: Board) => {
    if (disabled || busy) return;
    if (!window.confirm(`Delete /${board.id}/?`)) return;
    setBusy(true); setError(""); setSuccess("");
    try { await mutate(`/${board.id}`, "DELETE"); setSuccess("Board deleted."); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return <section className="panel">
    <p>Only empty boards can be deleted. /b/ is the default upload board.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loadError && <LoadError error={loadError} retry={reload} />}
    {loading && <p role="status">Loading boards…</p>}
    {success && <p role="status">{success}</p>}
    <form className="board-admin-form" onSubmit={create}>
      <fieldset disabled={disabled || busy} className="board-admin-fields">
      <label>Slug<input name="id" required pattern="[a-z0-9]{1,16}" maxLength={16} /></label>
      <label>Name<input name="name" required maxLength={100} /></label>
      <label>Icon<input name="icon" maxLength={32} /></label>
      <label>Description<input name="blurb" maxLength={500} /></label>
      <button className="btn" disabled={busy}>Add board</button>
      </fieldset>
    </form>
    {boards.map(board => <div className="admin-board" key={board.id}>
      <span><Link href={`/${board.id}`}>/{board.id}/ — {board.name}</Link> · {board.count} posts</span>
      <button className="btn btn-danger" disabled={disabled || busy || board.count > 0 || board.id === "b"}
        onClick={() => remove(board)}>Delete</button>
    </div>)}
  </section>;
}
