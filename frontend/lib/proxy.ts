import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

const backends = {
  uploader: "http://lolcatz-uploader:8080",
  browse: "http://lolcatz-browse:8080",
  search: "http://lolcatz-search:8080",
  comments: "http://lolcatz-comments:8080",
} as const;

export async function proxyRequest(
  request: NextRequest,
  path: string[],
  backend: keyof typeof backends,
) {
  const target = new URL(
    path.map(encodeURIComponent).join("/"),
    `${backends[backend]}/`,
  );
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  // Browser requests may omit the token; use the server-side NextAuth session
  // as the source of truth for protected API calls.
  if (!headers.get("authorization")) {
    const session = await getServerSession(authOptions);
    const token = (session as any)?.idToken;
    if (token) headers.set("authorization", `Bearer ${token}`);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}
