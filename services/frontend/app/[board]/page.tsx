"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { NetworkError } from "../../lib/fetch";
import { APIError, errorMessage, requestJSON, request } from "../../lib/api";
import { BoardWall } from "../board-wall";

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
      else reject(new APIError(request.status, `upload failed: ${request.status}${request.responseText ? ` — ${request.responseText.trim()}` : ""}`));
    });
    request.addEventListener("error", () => reject(new NetworkError()));
    request.addEventListener("abort", () => reject(new NetworkError()));
    request.send(file);
  });
}

export default function BoardPage() {
  const { board } = useParams<{ board: string }>();
  return <BoardContent key={board} board={board} />;
}

function BoardContent({ board }: { board: string }) {
  const { data: session, status } = useSession();
  const devToken = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN;
  const authenticated = Boolean(devToken) || status === "authenticated";
  const authToken = devToken || session?.accessToken;
  const [feedRevision, setFeedRevision] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const updateUpload = (index: number, update: Partial<UploadItem>) => {
    setUploads(current => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...update } : item
    ));
  };

  const uploadOne = async (file: File, index: number, title: string) => {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      throw new APIError(400, `${file.name}: choose a JPEG, PNG, GIF or WebP image.`);
    }
    updateUpload(index, { status: "preparing", percent: 2 });

    const { id, put_url, board: uploadBoard, title: uploadTitle, filename } = await requestJSON<{ id: string; put_url: string; board: string; title: string; filename: string }>("/api/upload/presign", {
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
    updateUpload(index, { status: "uploading", percent: 5 });
    await uploadFile(put_url, file, percent => {
      updateUpload(index, { percent: 5 + Math.round(percent * 0.85) });
    });

    updateUpload(index, { status: "saving", percent: 95 });
    await request("/api/upload/confirm", {
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
        } catch (err) {
          failures += 1;
          updateUpload(index, {
            status: "error",
            error: errorMessage(err),
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
      if (failures < files.length) {
        setFeedRevision(value => value + 1);
        window.dispatchEvent(new Event("boards-changed"));
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h2 className="page-title">/{board}/</h2>
      </div>

      {!authenticated && status !== "loading" ? (
        <div className="panel auth-prompt">
          <h3>Want to post?</h3>
          <p>Sign in with Passmower to upload images and join the discussion.</p>
          <button className="btn" type="button"
                  onClick={() => signIn("passmower", { callbackUrl: window.location.href })}>
            Sign in to post
          </button>
        </div>
      ) : authenticated ? (
        <div className="composer">
          <button className="btn btn-ghost composer-toggle" type="button"
                  disabled={uploading}
                  aria-expanded={composerOpen}
                  onClick={() => setComposerOpen(open => !open)}>
            <span className="composer-plus" aria-hidden="true">{composerOpen ? "−" : "+"}</span>
            {composerOpen ? "Close composer" : `Post something to /${board}/`}
          </button>

          {composerOpen && (
            <form className="composer-body" onSubmit={submit}>
              <h2>New post</h2>
              <div className="posting-as">
                posting as {devToken ? "developer@localhost" : session?.user?.email}
              </div>

              <div className="field">
                <label htmlFor="post-title">Title</label>
                <input id="post-title" ref={titleRef} type="text"
                       placeholder="Optional title for a single image" disabled={uploading} />
              </div>

              <div className="field">
                <label htmlFor="post-files">Images</label>
                {/* Leave accept unset: Android image pickers can redact GPS EXIF. */}
                <input id="post-files" ref={fileRef} type="file"
                       multiple required disabled={uploading} />
                <div className="field-hint">JPEG, PNG, GIF or WebP. Select one or many. Bulk posts are left untitled.</div>
              </div>

              {uploads.length > 0 && (
                <div className="upload-progress">
                  <div className="upload-progress-label">
                    <span>{uploading ? "Uploading batch…" : "Batch finished"}</span>
                    <span>{uploads.filter(item => item.status === "done").length}/{uploads.length}</span>
                  </div>
                  <div className="upload-progress-track" role="progressbar"
                       aria-label="Overall upload progress" aria-valuemin={0} aria-valuemax={100}
                       aria-valuenow={Math.round(uploads.reduce((sum, item) => sum + item.percent, 0) / uploads.length)}>
                    <div className="upload-progress-fill"
                         style={{ width: `${Math.round(uploads.reduce((sum, item) => sum + item.percent, 0) / uploads.length)}%` }} />
                  </div>
                  <div className="upload-list">
                    {uploads.map((item, index) => (
                      <div className={`upload-item upload-item-${item.status}`}
                           key={`${item.name}-${index}`} title={item.error}>
                        <span>{item.name}</span>
                        <span>{item.status === "error" ? "failed" : item.status === "done" ? "done" : `${item.percent}%`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <div className="form-error">{error}</div>}
              <button className="btn" type="submit" disabled={uploading}>
                {uploading ? `Uploading ${uploads.length}…` : "Post"}
              </button>
            </form>
          )}
        </div>
      ) : (
        <p className="empty">Checking login…</p>
      )}

      <BoardWall key={feedRevision} board={board} />
    </div>
  );
}
