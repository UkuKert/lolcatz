"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

interface Image {
  id: string;
  board: string;
  title: string;
  filename: string;
  tags: string[];
  uploaded_at: string;
  image_url: string;
}

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const [results, setResults] = useState<Image[]>([]);
  const [q, setQ] = useState(params.get("q") || "");
  const [tag, setTag] = useState(params.get("tag") || "");

  const search = (query: string, tagFilter: string) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (tagFilter) p.set("tag", tagFilter);
    fetch(`/api/search/search?${p}`)
      .then(r => r.json())
      .then(setResults)
      .catch(() => {});
  };

  useEffect(() => {
    search(params.get("q") || "", params.get("tag") || "");
  }, [params.toString()]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div>
      <h2 style={{ color: "#34345c", marginBottom: 8 }}>Search</h2>
      <form onSubmit={submit} className="search-bar">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search titles..." />
        <button type="submit">Go</button>
      </form>
      {tag && <div style={{ marginBottom: 8 }}>Showing tag: <strong>[{tag}]</strong></div>}
      <div>
        {results.map(img => (
          <div key={img.id} className="post">
            <a href={`/thread/${img.id}`}>
              <img src={img.image_url} alt={img.title || img.filename} />
            </a>
            <div className="title">{img.title || img.filename}</div>
            <div className="tags">{img.tags?.map(t => `[${t}]`).join(" ")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
