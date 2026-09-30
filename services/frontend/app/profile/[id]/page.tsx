"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { requestJSON, errorMessage } from "../../../lib/api";
import { Post, PostCard } from "../../post-card";

export default function PublicProfile() {
  const { id } = useParams<{ id: string }>();
  return <ProfileContent key={id} id={id} />;
}

function ProfileContent({ id }: { id: string }) {
  const [user, setUser] = useState<{ id: number; name: string } | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    requestJSON<{user: {id: number; name: string}; images: Post[]}>(`/api/browse/users/${encodeURIComponent(id)}?offset=${offset}`, { signal: controller.signal })
      .then(data => { setUser(data.user); setPosts(previous => offset ? [...previous, ...data.images] : data.images); setMore(data.images.length === 25); })
      .catch(error => { const message = errorMessage(error); if (!controller.signal.aborted) setError(message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, offset]);
  return <div>
    <h1>{user?.name || "Profile"}</h1>
    {error && <p role="alert">{error}</p>}
    <div className="feed">{posts.map(post => <PostCard key={post.id} post={post} />)}</div>
    {loading ? <p className="empty">Loading…</p> : !error && posts.length === 0 ? <p className="empty">No uploads yet.</p> : null}
    {more && !loading && !error && <button className="btn" onClick={() => setOffset(posts.length)}>Load more</button>}
  </div>;
}
