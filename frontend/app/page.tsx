"use client";

import { useEffect, useState } from "react";

const boards = [
  { id: "b", name: "Random", icon: "🎲" },
  { id: "g", name: "Technology", icon: "💾" },
  { id: "k", name: "Weapons", icon: "⚔️" },
  { id: "a", name: "Anime", icon: "🌸" },
  { id: "mu", name: "Music", icon: "🎵" },
  { id: "v", name: "Video Games", icon: "🎮" },
];

export default function Home() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch("/api/browse/boards/counts")
      .then(response => {
        if (!response.ok) throw new Error("Could not load post counts");
        return response.json();
      })
      .then(setCounts)
      .catch(() => setCounts({}));
  }, []);

  return (
    <div className="home">
      <div className="home-intro">
        <span className="eyebrow">Choose your chaos</span>
        <h2>Subchannels</h2>
        <p>Fresh takes, questionable uptime, lovingly orchestrated.</p>
      </div>
      <div className="board-grid">
        {boards.map(board => (
          <a key={board.id} href={`/board/${board.id}`} className="board-card">
            <span className="board-icon" aria-hidden="true">{board.icon}</span>
            <span className="board-details">
              <strong>/{board.id}/</strong>
              <span>{board.name}</span>
            </span>
            <span className="post-count">
              <strong>{counts === null ? "…" : (counts[board.id] ?? 0).toLocaleString()}</strong>
              <span>{counts?.[board.id] === 1 ? "post" : "posts"}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
