"use client";

import Link from "next/link";
import { useResource } from "../lib/use-resource";
import { LoadError } from "./load-error";
import type { Board } from "../lib/boards";

export default function Home() {
  const { data: boards = [], loading, error, reload } = useResource<Board[]>("/api/browse/boards");

  return (
    <div>
      <div className="home-intro">
        <span className="eyebrow">Choose your chaos</span>
        <h2>Subchannels</h2>
        <p>Fresh takes, questionable uptime, lovingly orchestrated.</p>
      </div>
      {loading && <p className="empty">Loading boards…</p>}
      {error && <LoadError error={error} retry={reload} />}
      {!loading && !error && boards.length === 0 && <p className="empty">No boards yet.</p>}
      <div className="board-grid">
        {(boards ?? []).map(board => (
          <Link key={board.id} href={`/${board.id}`} className="board-card">
            <span className="board-icon" aria-hidden="true">{board.icon}</span>
            <span className="board-details">
              <strong>/{board.id}/</strong>
              <span>{board.name}</span>
            </span>
            <span className="post-count">
              <strong>{board.count.toLocaleString()}</strong>
              <span>{board.count === 1 ? "post" : "posts"}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
