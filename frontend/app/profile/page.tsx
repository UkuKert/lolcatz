"use client";

import { signIn, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

interface UploadedImage {
  id: string;
  board: string;
  title: string;
  filename: string;
  uploaded_at: string;
  image_url: string;
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const devToken = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN;
  const token = devToken || (session as any)?.idToken;
  const attributes = (session as any)?.oidcAttributes ?? {};
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/api/upload/me/images", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        if (!response.ok) throw new Error((await response.text()).trim() || `HTTP ${response.status}`);
        return response.json();
      })
      .then(data => setImages(Array.isArray(data) ? data : []))
      .catch(err => setError(err.message || "Could not load uploads"));
  }, [token]);

  const deletePost = async (image: UploadedImage) => {
    if (!token || !window.confirm(`Delete “${image.title || image.filename}” and all of its replies?`)) return;

    setDeletingId(image.id);
    setError("");
    try {
      const response = await fetch(`/api/upload/images/${image.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error((await response.text()).trim() || `HTTP ${response.status}`);
      }
      setImages(current => current.filter(item => item.id !== image.id));
    } catch (err: any) {
      setError(err.message || "Could not delete post");
    } finally {
      setDeletingId(null);
    }
  };

  if (status === "loading" && !devToken) {
    return <div className="auth-prompt">Checking login…</div>;
  }

  if (status !== "authenticated" && !devToken) {
    return (
      <div className="auth-prompt">
        <h3>Your profile</h3>
        <p>Sign in to see your account attributes and uploaded images.</p>
        <button type="button" onClick={() => signIn("passmower", { callbackUrl: "/profile" })}>
          Sign in
        </button>
      </div>
    );
  }

  const rows = devToken
    ? { email: "developer@localhost", environment: "local development" }
    : attributes;
  const cliSnippet = `curl --fail --progress-bar -T './lolcats/*.{jpg,jpeg,png,gif,webp}' \\\n  -H "Authorization: Bearer ${token}" \\\n  "${typeof window !== "undefined" ? window.location.origin : ""}/api/upload/bulk/"`;

  const displaySnippet = `for j in *.jpg *.jpeg *.png *.webp; do
  curl --fail --progress-bar -T "$j" -H "Authorization: Bearer ${token}" "${typeof window !== "undefined" ? window.location.origin : ""}/api/upload/bulk/$(basename "$j")"
done`;

  return (
    <div>
      <h2 style={{ color: "#34345c", marginBottom: 12 }}>Your profile</h2>
      <section className="profile-card">
        {session?.user?.image && <img src={session.user.image} alt="Your Gravatar" />}
        <table className="attributes"><tbody>
          {Object.entries(rows)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{Array.isArray(value) ? value.join(", ") : String(value)}</td>
              </tr>
            ))}
        </tbody></table>
      </section>

      <section className="profile-card cli-upload-card">
        <h3>Bulk upload from the command line</h3>
        <p>Select a directory of images and use this starter snippet.</p>
        <pre className="cli-snippet"><code>{displaySnippet}</code></pre>
        <button type="button" onClick={() => navigator.clipboard?.writeText(displaySnippet)}>Copy snippet</button>
      </section>

      <h2 style={{ color: "#34345c", marginBottom: 8 }}>Your uploads</h2>
      {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
      {!error && images.length === 0 && <p>No uploads yet.</p>}
      <div>
        {images.map(image => (
          <div key={image.id} className="post">
            <a href={`/thread/${image.id}`}>
              <img src={image.image_url} alt={image.title || image.filename} />
            </a>
            <div className="title">{image.title || image.filename}</div>
            <div className="meta">/{image.board}/ · {new Date(image.uploaded_at).toLocaleString()}</div>
            <button
              type="button"
              className="delete-post"
              disabled={deletingId === image.id}
              onClick={() => deletePost(image)}
            >
              {deletingId === image.id ? "Deleting…" : "Delete"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
