// proxy.ts (Next 16's name for middleware): sends owner pages opened on a legacy host (LEGACY_HOSTS, such as the old
// site-manager-lovat.vercel.app) to APP_HOST. Off until both are set in env. Chat bots, webhooks and venue sites are never touched.
import { NextResponse, type NextRequest } from "next/server";
import { explicitAppHost, hostRedirect, parseLegacyHosts } from "@/src/server/host";

export function proxy(request: NextRequest) {
  const target = hostRedirect(request.nextUrl, explicitAppHost(process.env), parseLegacyHosts(process.env));
  return target ? NextResponse.redirect(target, 308) : NextResponse.next();
}

// Not /api, /_next, favicon.ico or any other file with an extension.
export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
