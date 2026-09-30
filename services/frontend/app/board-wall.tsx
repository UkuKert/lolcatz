"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage, requestJSON } from "../lib/api";
import { LoadError } from "./load-error";
import { Post, PostCard } from "./post-card";

const pageSize = 25;

export function BoardWall({ board }: { board: string }) {
  const baseURL = `/api/browse/boards/${encodeURIComponent(board)}`;
  const [url, setURL] = useState(baseURL);
  const [images, setImages] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    requestJSON<Post[]>(url, { signal: controller.signal }).then(page => {
      if (controller.signal.aborted) return;
      setImages(previous => {
        const seen = new Set(previous.map(image => image.id));
        return [...previous, ...page.filter(image => !seen.has(image.id))];
      });
      setMore(page.length === pageSize);
      setLoading(false);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setError(errorMessage(error));
      setLoading(false);
    });
    return () => controller.abort();
  }, [url, attempt]);

  useEffect(() => {
    if (loading || error || !more || !images.length || !sentinel.current) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const last = images[images.length - 1];
      // Preserve PostgreSQL's timestamp precision; Date would truncate it.
      const query = new URLSearchParams({ before: last.uploaded_at, before_id: last.id });
      setLoading(true);
      setURL(`${baseURL}?${query}`);
    }, { rootMargin: "600px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [baseURL, images, loading, more, error]);

  return <>
    <div className="feed" aria-label="Posts, newest uploads first">
      {images.map(image => <PostCard key={image.id} post={image} />)}
    </div>
    <div ref={sentinel} className="wall-status">
      {error && <LoadError error={error} retry={() => setAttempt(value => value + 1)} />}
      <p className="empty" role="status">
        {loading ? "Loading posts…" : error ? "" : !images.length
          ? "Nothing here yet. Be the first."
          : !more ? `All ${images.length} posts loaded.` : "Scroll for more posts."}
      </p>
    </div>
  </>;
}
