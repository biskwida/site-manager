// proxy.ts (Next 16's name for middleware): sends owner pages that are opened on another host, such as the old
// site-manager-lovat.vercel.app, to the app host. Chat bots, webhooks and venue sites are not touched (see hostRedirect).
import { NextResponse, type NextRequest } from "next/server";
import { hostRedirect, resolveAppHost } from "@/src/server/host";

export function proxy(request: NextRequest) {
  const target = hostRedirect(request.nextUrl, resolveAppHost(process.env));
  return target ? NextResponse.redirect(target, 308) : NextResponse.next();
}

export const config = { matcher: ["/((?!api/|_next/).*)"] };
