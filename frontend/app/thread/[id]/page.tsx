"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Comment {
  id: number;
  body: string;
  author: string;
  created_at: string;
}

interface Image {
  id: string;
  board: string;
  title: string;
  filename: string;
  content_type: string;
  tags: string[];
  uploaded_at: string;
}

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const [image, setImage] = useState<Image | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("Anonymous");
  const s3Base = process.env.S3_PUBLIC_URL || "";

  const load = () =>
    fetch(`/api/browse/images/${id}`)
      .then(r => r.json())
      .then(d => { setImage(d.image); setComments(d.comments || []); })
      .catch(() => {});

  useEffect(() => { load(); }, [id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`/api/comments/images/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author }),
    });
    setBody("");
    load();
  };

  if (!image) return <div>Loading...</div>;

  return (
    <div>
      <div className="thread">
        <img
          src={`${s3Base}/lolcatz-images/${image.board}/${image.id}`}
          alt={image.title || image.filename}
        />
        <div>
          <strong style={{ color: "#0f0c5d" }}>{image.title || image.filename}</strong>
          {image.tags?.length > 0 && (
            <div className="tags" style={{ marginTop: 4 }}>
              {image.tags.map(t => (
                <a key={t} href={`/search?tag=${t}`} style={{ marginRight: 4 }}>[{t}]</a>
              ))}
            </div>
          )}
          <div style={{ color: "#666", fontSize: 11, marginTop: 4 }}>
            {new Date(image.uploaded_at).toLocaleString()}
          </div>
        </div>
        <div style={{ clear: "both" }} />
      </div>

      {comments.map(c => (
        <div key={c.id} className="reply">
          <strong style={{ color: "#117743" }}>{c.author}</strong>{" "}
          <span style={{ color: "#666", fontSize: 11 }}>{new Date(c.created_at).toLocaleString()}</span>
          <div style={{ marginTop: 4 }}>{c.body}</div>
        </div>
      ))}

      <form onSubmit={submit} style={{ marginTop: 12, maxWidth: 400 }}>
        <div className="upload-form">
          <h2>Reply</h2>
          <label>Name</label>
          <input value={author} onChange={e => setAuthor(e.target.value)} />
          <label>Comment</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} required />
          <button type="submit">Post Reply</button>
        </div>
      </form>
    </div>
  );
}
