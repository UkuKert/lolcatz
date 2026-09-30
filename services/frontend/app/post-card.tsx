import Link from "next/link";
import { AnnotatedImage } from "./annotated-image";
import type { Annotation } from "../lib/annotations";
import { TimeStamp } from "../lib/time";
import { ExifInfo, OCRInfo, PostDetails, Tag } from "./post-metadata";

export interface Post {
  id: string;
  user_id?: number | null;
  author?: string;
  board: string;
  title: string;
  filename: string;
  tags?: Tag[];
  annotations?: Annotation[];
  uploaded_at: string;
  comment_count?: number;
  captured_at?: string | null;
  exif?: ExifInfo | null;
  ocr?: OCRInfo | null;
  image_url: string;
}

export function PostCard({ post, children }: { post: Post; children?: React.ReactNode }) {
  const title = post.title || post.filename;
  const replies = post.comment_count ?? 0;
  const replyLabel = `${replies} ${replies === 1 ? "reply" : "replies"}`;

  return (
    <article className="card">
      <Link className="card-title card-heading" href={`/thread/${post.id}`}>{title}</Link>
      <AnnotatedImage
        src={`/api/thumbnails/v1/${encodeURIComponent(post.id)}?size=256`}
        srcSet={`/api/thumbnails/v1/${encodeURIComponent(post.id)}?size=256 1x, /api/thumbnails/v1/${encodeURIComponent(post.id)}?size=512 2x`}
        fallbackSrc={post.image_url} alt={title} href={`/thread/${post.id}`}
      />
      <div className="card-meta">
        <Link className="card-chip" href={`/${post.board}`}>/{post.board}/</Link>
        {post.user_id && <Link href={`/profile/${post.user_id}`}>{post.author || "User"}</Link>}
        <TimeStamp value={post.uploaded_at} />
        <Link className="comment-count" href={`/thread/${post.id}#replies`} aria-label={replyLabel} title={replyLabel}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3v-6a7.5 7.5 0 0 1 0-9A7.5 7.5 0 0 1 9 4h3.5a7.5 7.5 0 0 1 7.5 7.5Z" />
          </svg>
          <span>{replies}</span>
        </Link>
      </div>
      <PostDetails tags={post.tags} exif={post.exif} ocr={post.ocr}
                   capturedAt={post.captured_at} compact />
      {children && <div className="card-foot">{children}</div>}
    </article>
  );
}
