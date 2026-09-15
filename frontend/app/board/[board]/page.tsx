"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { TagBadges } from "../../tag-badges";
import { ImageMetadata, MapLink } from "../../post-metadata";

interface Image {
  id: string; board: string; title: string; filename: string;
  content_type: string; tags: string[]; metadata?: ImageMetadata; uploaded_at: string; image_url: string;
}

interface UploadItem {
  name: string;
  status: "queued" | "preparing" | "uploading" | "saving" | "done" | "error";
  percent: number;
  error?: string;
}

function uploadFile(url: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", file.type);
    request.upload.addEventListener("progress", event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`upload failed: ${request.status}${request.responseText ? ` — ${request.responseText.trim()}` : ""}`));
    });
    request.addEventListener("error", () => reject(new Error("upload failed: network error")));
    request.addEventListener("abort", () => reject(new Error("upload cancelled")));
    request.send(file);
  });
}

export default function BoardPage() {
  const { board } = useParams<{ board: string }>();
  const { data: session, status } = useSession();
  const devToken = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN;
  const authenticated = Boolean(devToken) || status === "authenticated";
  const authToken = devToken || (session as any)?.idToken;
  const [images, setImages] = useState<Image[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const load = () =>
    fetch(`/api/browse/boards/${board}`)
      .then(r => r.json())
      .then(d => setImages(Array.isArray(d) ? d : []))
      .catch(() => {});

  useEffect(() => { load(); }, [board]);

  const updateUpload = (index: number, update: Partial<UploadItem>) => {
    setUploads(current => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...update } : item
    ));
  };

  const uploadOne = async (file: File, index: number, title: string) => {
    updateUpload(index, { status: "preparing", percent: 2 });

    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type,
        board,
        title,
      }),
    });
    if (!presignRes.ok) {
      const detail = await presignRes.text();
      throw new Error(`presign failed: ${presignRes.status}${detail ? ` — ${detail.trim()}` : ""}`);
    }
    const { id, put_url, board: uploadBoard, title: uploadTitle, filename } = await presignRes.json();

    updateUpload(index, { status: "uploading", percent: 5 });
    await uploadFile(put_url, file, percent => {
      updateUpload(index, { percent: 5 + Math.round(percent * 0.85) });
    });

    updateUpload(index, { status: "saving", percent: 95 });
    const confirmRes = await fetch("/api/upload/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        id,
        board: uploadBoard,
        title: uploadTitle,
        filename,
        content_type: file.type,
      }),
    });
    if (!confirmRes.ok) {
      const detail = await confirmRes.text();
      throw new Error(`confirm failed: ${confirmRes.status}${detail ? ` — ${detail.trim()}` : ""}`);
    }

    updateUpload(index, { status: "done", percent: 100 });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authenticated) { signIn("passmower"); return; }
    const files = Array.from(fileRef.current?.files || []);
    if (!files.length) return;

    setUploading(true);
    setError("");
    setUploads(files.map(file => ({ name: file.name, status: "queued", percent: 0 })));

    const typedTitle = titleRef.current?.value.trim() || "";
    let nextFile = 0;
    let failures = 0;
    const worker = async () => {
      while (nextFile < files.length) {
        const index = nextFile++;
        const file = files[index];
        const title = files.length === 1 ? typedTitle : "";
        try {
          await uploadOne(file, index, title);
        } catch (err: any) {
          failures += 1;
          updateUpload(index, {
            status: "error",
            error: err.message || "Upload failed",
          });
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
      titleRef.current && (titleRef.current.value = "");
      fileRef.current && (fileRef.current.value = "");
      if (failures > 0) {
        setError(`${failures} of ${files.length} uploads failed. You can reselect those files and try again.`);
      }
      if (failures < files.length) await load();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h2 style={{ color: "#34345c", marginBottom: 8 }}>/{board}/</h2>

      {!authenticated && status !== "loading" ? (
        <div className="auth-prompt">
          <h3>Want to post?</h3>
          <p>Sign in with Passmower to upload images and join the discussion.</p>
          <button type="button" onClick={() => signIn("passmower", { callbackUrl: window.location.href })}>
            Sign in to post
          </button>
        </div>
      ) : authenticated ? (
      <form className="upload-form" onSubmit={submit}>
        <h2>New Post</h2>
        <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>
          posting as {devToken ? "developer@localhost" : session?.user?.email}
        </div>
        <label>Title <span className="field-hint">(single upload)</span></label>
        <input ref={titleRef} type="text" placeholder="Subject; bulk uploads use filenames" disabled={uploading} />
        <label>Images</label>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple required disabled={uploading} />
        <div className="field-hint">Select one or many images. Bulk posts are left untitled.</div>
        {uploads.length > 0 && (
          <div className="upload-progress">
            <div className="upload-progress-label">
              <span>{uploading ? "Uploading batch…" : "Batch finished"}</span>
              <span>{uploads.filter(item => item.status === "done").length}/{uploads.length}</span>
            </div>
            <div className="upload-progress-track" role="progressbar" aria-label="Overall upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploads.reduce((sum, item) => sum + item.percent, 0) / uploads.length)}>
              <div className="upload-progress-fill" style={{ width: `${Math.round(uploads.reduce((sum, item) => sum + item.percent, 0) / uploads.length)}%` }} />
            </div>
            <div className="upload-list">
              {uploads.map((item, index) => (
                <div className={`upload-item upload-item-${item.status}`} key={`${item.name}-${index}`} title={item.error}>
                  <span>{item.name}</span>
                  <span>{item.status === "error" ? "failed" : item.status === "done" ? "done" : `${item.percent}%`}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <div style={{ color: "red", fontSize: 11 }}>{error}</div>}
        <button type="submit" disabled={uploading}>
          {uploading ? `Uploading ${uploads.length}…` : "Post"}
        </button>
      </form>
      ) : (
        <div className="auth-prompt">Checking login…</div>
      )}

      <div>
        {images.map(img => (
          <div key={img.id} className="post">
            <a href={`/thread/${img.id}`}>
              <img src={img.image_url} alt={img.title || img.filename} />
            </a>
            <div className="title">{img.title || img.metadata?.ocr_text?.split("\n")[0] || img.filename}</div>
            <TagBadges tags={img.tags} />
            <MapLink metadata={img.metadata} />
            <div className="meta">{new Date(img.uploaded_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
