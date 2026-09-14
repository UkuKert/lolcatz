"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

interface Image {
  id: string;
  board: string;
  title: string;
  filename: string;
  content_type: string;
  tags: string[];
  uploaded_at: string;
}

export default function BoardPage() {
  const { board } = useParams<{ board: string }>();
  const { data: session, status } = useSession();
  const [images, setImages] = useState<Image[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const s3Base = process.env.S3_PUBLIC_URL || "";

  const load = () =>
    fetch(`/api/browse/boards/${board}`)
      .then(r => r.json())
      .then(setImages)
      .catch(() => {});

  useEffect(() => { load(); }, [board]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileRef.current?.files?.[0]) return;
    if (status !== "authenticated") { signIn("passmower"); return; }

    setUploading(true);
    setError("");
    const fd = new FormData();
    fd.append("file", fileRef.current.files[0]);
    fd.append("board", board);
    fd.append("title", titleRef.current?.value || "");

    const res = await fetch("/api/upload/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${(session as any).idToken}` },
      body: fd,
    });
    setUploading(false);
    if (!res.ok) {
      setError(`Upload failed: ${res.status}`);
    } else {
      if (titleRef.current) titleRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
      load();
    }
  };

  return (
    <div>
      <h2 style={{ color: "#34345c", marginBottom: 8 }}>/{board}/</h2>

      <form className="upload-form" onSubmit={submit}>
        <h2>New Post</h2>
        {status === "unauthenticated" && (
          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={() => signIn("passmower")}
              style={{ background: "#34345c", color: "white", border: "none", padding: "4px 12px", cursor: "pointer", marginBottom: 8 }}>
              Sign in to post
            </button>
          </div>
        )}
        {status === "authenticated" && (
          <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>
            Posting as {session.user?.email}
          </div>
        )}
        <label>Title</label>
        <input ref={titleRef} type="text" placeholder="Subject" />
        <label>Image</label>
        <input ref={fileRef} type="file" accept="image/*" required />
        {error && <div style={{ color: "red", fontSize: 11 }}>{error}</div>}
        <button type="submit" disabled={uploading}>
          {uploading ? "Uploading..." : "Post"}
        </button>
      </form>

      <div>
        {(images || []).map(img => (
          <div key={img.id} className="post">
            <a href={`/thread/${img.id}`}>
              <img
                src={`${s3Base}/lolcatz-images/${img.board}/${img.id}`}
                alt={img.title || img.filename}
              />
            </a>
            <div className="title">{img.title || img.filename}</div>
            {img.tags?.length > 0 && (
              <div className="tags">
                {img.tags.map(t => (
                  <a key={t} href={`/search?tag=${t}`} style={{ marginRight: 4, color: "#800000" }}>
                    [{t}]
                  </a>
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
