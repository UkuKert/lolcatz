"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";

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
  const [images, setImages] = useState<Image[]>([]);
  const [uploading, setUploading] = useState(false);
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
    setUploading(true);
    const fd = new FormData();
    fd.append("file", fileRef.current.files[0]);
    fd.append("board", board);
    fd.append("title", titleRef.current?.value || "");
    await fetch("/api/upload/upload", { method: "POST", body: fd });
    setUploading(false);
    load();
  };

  return (
    <div>
      <h2 style={{ color: "#34345c", marginBottom: 8 }}>/{board}/ — Post</h2>

      <form className="upload-form" onSubmit={submit}>
        <h2>New Post</h2>
        <label>Title</label>
        <input ref={titleRef} type="text" placeholder="Subject" />
        <label>Image</label>
        <input ref={fileRef} type="file" accept="image/*" required />
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
