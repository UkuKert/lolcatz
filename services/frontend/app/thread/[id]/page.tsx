"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { TimeStamp } from "../../../lib/time";
import { PostDetails } from "../../post-metadata";
import { AnnotatedImage } from "../../annotated-image";
import type { Post } from "../../post-card";
import { useResource } from "../../../lib/use-resource";
import { isRequestError, request, errorMessage } from "../../../lib/api";
import { LoadError } from "../../load-error";
import { SafeMarkdown } from "../../safe-markdown";

interface Comment {
  id: number;
  user_id?: number | null;
  body: string;
  author: string;
  created_at: string;
}

interface ThreadImage extends Post {
  author: string;
}

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  return <ThreadContent key={id} id={id} />;
}

function ThreadContent({ id }: { id: string }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const devToken = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN;
  const authenticated = Boolean(devToken) || status === "authenticated";
  const authToken = devToken || session?.accessToken;
  const { data, loading, error: loadError, reload } = useResource<{ image: ThreadImage; comments: Comment[] }>(`/api/browse/images/${encodeURIComponent(id)}`);
  const image = data?.image;
  const comments = data?.comments ?? [];
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [body, setBody] = useState("");
  const [account, setAccount] = useState<{ token: string; id: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (image && window.location.hash === "#replies") {
      document.getElementById("replies")?.scrollIntoView();
    }
  }, [image?.id]);

  useEffect(() => {
    if (!authToken) { setAccount(null); return; }
    const controller = new AbortController();
    request("/api/upload/me", {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : null)
      .then(user => setAccount(user ? { token: authToken, id: user.id } : null))
      .catch(error => {
        if (!isRequestError(error)) throw error;
        if (!controller.signal.aborted) setAccount(null);
      });
    return () => controller.abort();
  }, [authToken]);

  const ownsThread = Boolean(image && image.id === id && account && account.token === authToken && account.id === image.user_id);

  const deleteThread = async () => {
    if (!image || !ownsThread || deleting || !window.confirm(`Delete “${image.title || image.filename}” and all of its replies?`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await request(`/api/upload/images/${image.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      window.dispatchEvent(new Event("boards-changed"));
      router.replace(`/${image.board}`);
    } catch (error) {
      setDeleteError(errorMessage(error));
      setDeleting(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authenticated) { signIn("passmower", { callbackUrl: window.location.href }); return; }
    if (submittingRef.current || !body.trim()) return;
    submittingRef.current = true;
    setSubmitting(true);
    setReplyError("");
    try {
      await request(`/api/comments/images/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ body }),
      });
      setBody("");
      reload();
    } catch (error) {
      setReplyError(errorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loadError) return <LoadError error={loadError} retry={reload} />;
  if (!image) return <p className="empty">{loading ? "Loading thread…" : "Thread not found."}</p>;

  const title = image.title || image.filename;

  return (
    <div>
      <article className="thread">
        <AnnotatedImage className="thread-media"
          src={`/api/thumbnails/v1/${encodeURIComponent(image.id)}?size=1024`}
          fallbackSrc={image.image_url} alt={title} annotations={image.annotations} />
        <div className="thread-body">
          <div className="thread-header">
            <div className="thread-title"><SafeMarkdown>{title}</SafeMarkdown></div>
            <a className="btn btn-ghost" href={`/api/browse/media/${encodeURIComponent(image.id)}?download=1`} download={image.filename}>
              Download original
            </a>
            {ownsThread && <button type="button" className="btn btn-danger thread-delete" disabled={deleting} onClick={deleteThread}>
              {deleting ? "Deleting…" : "Delete thread"}
            </button>}
          </div>

          <div className="byline">
            <strong>{image.user_id ? <Link href={`/profile/${image.user_id}`}>{image.author || "User"}</Link> : image.author || "Anonymous"}</strong>
            <span>·</span>
            <span>Uploaded <TimeStamp value={image.uploaded_at} /></span>
            {/* Capture time is only known once the exif consumer has run, and
                only for files that actually carried EXIF. */}
            {image.captured_at && (
              <>
                <span>·</span>
                <span>Created <TimeStamp value={image.captured_at} naive /></span>
              </>
            )}
          </div>

          {deleteError && <p className="form-error" role="alert">{deleteError}</p>}

          <PostDetails
            tags={image.tags}
            exif={image.exif}
            ocr={image.ocr}
            capturedAt={image.captured_at}
            showMap
          />
        </div>
      </article>

      <h3 className="replies-head" id="replies">
        {comments.length === 0 ? "Replies" : `${comments.length} ${comments.length === 1 ? "reply" : "replies"}`}
      </h3>

      {comments.length === 0 && <p className="empty">No replies yet.</p>}
      {comments.map(comment => (
        <div key={comment.id} className="reply">
          <div className="byline">
            <strong>{comment.user_id ? <Link href={`/profile/${comment.user_id}`}>{comment.author || "User"}</Link> : comment.author}</strong>
            <span>·</span>
            <TimeStamp value={comment.created_at} />
          </div>
          <div className="reply-body"><SafeMarkdown>{comment.body}</SafeMarkdown></div>
        </div>
      ))}

      <div className="composer" style={{ marginTop: 18 }}>
        <form className="composer-body" onSubmit={submit}>
          <h2>Reply</h2>
          {!authenticated && status === "unauthenticated" ? (
            <button className="btn" type="button" onClick={() => signIn("passmower")}>
              Sign in to reply
            </button>
          ) : authenticated ? (
            <>
              <div className="field">
                <textarea disabled={submitting} aria-label="Reply" value={body} onChange={event => setBody(event.target.value)}
                          rows={4} required placeholder="Say something…" />
              </div>
              {replyError && <p className="form-error" role="alert">{replyError}</p>}
              <button className="btn" type="submit" disabled={submitting || !body.trim()}>{submitting ? "Posting…" : "Post reply"}</button>
            </>
          ) : null}
        </form>
      </div>
    </div>
  );
}
