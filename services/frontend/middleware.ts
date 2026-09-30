import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  // This frontend uses direct API calls, not Server Actions. Reject action
  // requests before Next.js tries to resolve an ID and logs a stack trace.
  if (request.headers.has("next-action")) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [{ source: "/:path*", has: [{ type: "header", key: "next-action" }] }],
};
