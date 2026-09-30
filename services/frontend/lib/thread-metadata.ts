import { fetchResponse, NetworkError } from "./fetch";
import type { Metadata } from "next";

const siteName = "Can I Haz Kubernetes";
const fallback: Metadata = {
  title: siteName,
  description: "A cloud-native image board running on Kubernetes",
};

interface PreviewImage {
  id: string;
  title?: string;
  filename?: string;
  board: string;
  author?: string;
  ocr?: { text?: string } | null;
  tags?: { name: string }[];
}

function compact(text: string, limit: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export async function threadMetadata(
  id: string,
  { browseURL, siteURL, fetcher = fetch }: {
    browseURL?: string;
    siteURL?: string;
    fetcher?: typeof fetch;
  },
): Promise<Metadata> {
  if (!browseURL || !siteURL) return fallback;
  let response: Response;
  try {
    response = await fetchResponse(
      `${browseURL.replace(/\/$/, "")}/api/browse/images/${encodeURIComponent(id)}`,
      { cache: "no-store", signal: AbortSignal.timeout(3000) },
      fetcher,
    );
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    return fallback;
  }
  if (!response.ok) return fallback;
  const { image } = await response.json() as { image?: PreviewImage };
  if (!image || image.id !== id) return fallback;

  const title = compact(image.title?.trim() || image.filename || "Untitled image", 160);
  const context = [
    `Posted${image.author ? ` by ${image.author}` : ""} in /${image.board}/`,
    image.tags?.map(tag => tag.name).join(", "),
  ].filter(Boolean).join(" · ");
  const description = compact(image.ocr?.text?.trim() || context, 240);
  const origin = new URL(siteURL).origin;
  const url = new URL(`/thread/${encodeURIComponent(id)}`, origin).href;
  // Keep a stable URL: the thumbnail endpoint issues a fresh signed S3 redirect.
  const imageURL = new URL(`/api/thumbnails/v1/${encodeURIComponent(id)}?size=256`, origin).href;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName,
      title,
      description,
      url,
      images: [{ url: imageURL, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: imageURL, alt: title }],
    },
  };
}
