"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useResource } from "../../lib/use-resource";
import { LoadError } from "../load-error";
import { Post, PostCard } from "../post-card";

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(params.get("q") || "");
  const tag = params.get("tag") || "";

  const search = new URLSearchParams();
  const q = params.get("q") || "";
  if (q) search.set("q", q);
  if (tag) search.set("tag", tag);
  const hasQuery = Boolean(q || tag);
  const { data: results = [], loading, error, reload } = useResource<Post[]>(hasQuery ? `/api/search/search?${search}` : null);

  useEffect(() => { setQuery(params.get("q") || ""); }, [params]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <div>
      <div className="page-head">
        <h2 className="page-title">Search</h2>
      </div>

      <form onSubmit={submit} className="search-page-input" role="search">
        <input value={query} onChange={event => setQuery(event.target.value)}
               placeholder="Search titles and captions…" aria-label="Search query" />
        <button className="btn" type="submit">Go</button>
      </form>

      {tag && (
        <div className="active-tag-filter">
          Showing tag <span className="tag-badge">{tag}</span>
        </div>
      )}

      {loading && <p className="empty">Searching…</p>}
      {error && <LoadError error={error} retry={reload} />}
      {!hasQuery && <p className="empty">Enter a search term to find posts.</p>}
      {hasQuery && !loading && !error && results.length === 0 && <p className="empty">Nothing found.</p>}

      <div className="feed">
        {results.map(post => <PostCard key={post.id} post={post} />)}
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
