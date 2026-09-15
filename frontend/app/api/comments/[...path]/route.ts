import type { NextRequest } from "next/server";
import { proxyRequest } from "../../../../lib/proxy";

type Context = { params: { path: string[] } };
const handler = (request: NextRequest, { params }: Context) =>
  proxyRequest(request, params.path, "comments");

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
