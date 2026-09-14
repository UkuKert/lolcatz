"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

interface Image {
  id: string; board: string; title: string; filename: string;
  content_type: string; tags: string[]; uploaded_at: string; image_url: string;
}

export default function BoardPage() {
  const { board } = useParams<{ board: string }>();
  const { data: session, status } = useSession();
  const [images, setImages] = useState<Image[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const load = () =>
    fetch(`/api/browse/boards/${board}`)
      .then(r => r.json())
      .then(d => setImages(Array.isArray(d) ? d : []))
      .catch(() => {});

  useEffect(() => { load(); }, [board]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status !== "authenticated") { signIn("passmower"); return; }
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setProgress("Getting upload URL...");

    try {
      // Step 1: presign — no auth needed for this
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type,
          board,
          title: titleRef.current?.value || "",
        }),
      });
      if (!presignRes.ok) throw new Error(`presign failed: ${presignRes.status}`);
      const { id, put_url, board: b, title, filename } = await presignRes.json();

      // Step 2: PUT directly to minio (no auth — presigned URL handles it)
      setProgress("Uploading...");
      const putRes = await fetch(put_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`upload failed: ${putRes.status}`);

      // Step 3: confirm — requires auth so we know who posted
      setProgress("Saving...");
      const confirmRes = await fetch("/api/upload/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${(session as any).idToken}`,
        },
        body: JSON.stringify({ id, board: b, title, filename, content_type: file.type }),
      });
      if (!confirmRes.ok) throw new Error(`confirm failed: ${confirmRes.status}`);

      titleRef.current && (titleRef.current.value = "");
      fileRef.current && (fileRef.current.value = "");
      setProgress("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h2 style={{ color: "#34345c", marginBottom: 8 }}>/{board}/</h2>

      <form className="upload-form" onSubmit={submit}>
        <h2>New Post</h2>
        {status === "unauthenticated" && (
          <button type="button" onClick={() => signIn("passmower")}
            style={{ background: "#34345c", color: "white", border: "none", padding: "4px 12px", cursor: "pointer", marginBottom: 8 }}>
            Sign in to post
          </button>
        )}
        {status === "authenticated" && (
          <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>
            posting as {session.user?.email}
            {" · "}<a href="/api/auth/signout" style={{ color: "#666" }}>sign out</a>
          </div>
        )}
        <label>Title</label>
        <input ref={titleRef} type="text" placeholder="Subject" />
        <label>Image</label>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" required />
        {progress && <div style={{ fontSize: 11, color: "#666" }}>{progress}</div>}
        {error && <div style={{ color: "red", fontSize: 11 }}>{error}</div>}
        <button type="submit" disabled={uploading}>
          {uploading ? "Posting..." : status === "authenticated" ? "Post" : "Sign in to post"}
        </button>
      </form>

      <div>
        {images.map(img => (
          <div key={img.id} className="post">
            <a href={`/thread/${img.id}`}>
              <img src={img.image_url} alt={img.title || img.filename} />
            </a>
            <div className="title">{img.title || img.filename}</div>
            {img.tags?.length > 0 && (
              <div className="tags">
                {img.tags.map(t => (
                  <a key={t} href={`/search?tag=${t}`} style={{ marginRight: 4, color: "#800000" }}>[{t}]</a>
                ))}
              </div>
            )}
            <div className="meta">{new Date(img.uploaded_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
