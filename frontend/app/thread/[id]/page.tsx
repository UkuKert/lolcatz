"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { TagBadges } from "../../tag-badges";
import { ImageMetadata, MapLink, MetadataDetails } from "../../post-metadata";

interface Comment { id: number; body: string; author: string; created_at: string; }
interface Image { id: string; board: string; title: string; filename: string; author: string; tags: string[]; metadata?: ImageMetadata; uploaded_at: string; image_url: string; }

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, status } = useSession();
  const devToken = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN;
  const authenticated = Boolean(devToken) || status === "authenticated";
  const authToken = devToken || (session as any)?.idToken;
  const [image, setImage] = useState<Image | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");

  const load = () =>
    fetch(`/api/browse/images/${id}`)
      .then(r => r.json())
      .then(d => { setImage(d.image); setComments(d.comments || []); })
      .catch(() => {});

  useEffect(() => { load(); }, [id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authenticated) { signIn("passmower"); return; }
    await fetch(`/api/comments/images/${id}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
      },
      body: JSON.stringify({ body }),
    });
    setBody("");
    load();
  };

  if (!image) return <div>Loading...</div>;

  return (
    <div>
      <div className="thread">
        <img src={image.image_url} alt={image.title || image.filename} />
        <div>
          <strong style={{ color: "#0f0c5d" }}>{image.title || image.metadata?.ocr_text?.split("\n")[0] || image.filename}</strong>
          <TagBadges tags={image.tags} />
          <MapLink metadata={image.metadata} />
          <div style={{ color: "#666", fontSize: 11, marginTop: 4 }}>
            <strong style={{ color: "#117743" }}>{image.author || "Anonymous"}</strong>{" "}
            {new Date(image.uploaded_at).toLocaleString()}
          </div>
          <MetadataDetails metadata={image.metadata} />
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
          {!authenticated && status === "unauthenticated" && (
            <button type="button" onClick={() => signIn("passmower")}
              style={{ background: "#34345c", color: "white", border: "none", padding: "4px 12px", cursor: "pointer", marginBottom: 8 }}>
              Sign in to reply
            </button>
          )}
          {authenticated && <>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} required />
            <button type="submit">Post Reply</button>
          </>}
        </div>
      </form>
    </div>
  );
}
