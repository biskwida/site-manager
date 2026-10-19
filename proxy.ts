// proxy.ts (Next 16's name for middleware):
// 1. Sends owner pages opened on a legacy host (LEGACY_HOSTS, such as the old site-manager-lovat.vercel.app) to APP_HOST. Off until
//    both are set in env. Chat bots, webhooks and venue sites are never touched.
// 2. Refreshes the Supabase session on the account pages and the wizard only (dashboard, login, start, onboarding, billing, auth, new),
//    when the public Supabase env is set. Never on /api (the matcher keeps it out), venue pages or the key page.
import { NextResponse, type NextRequest } from "next/server";
import { explicitAppHost, hostRedirect, parseLegacyHosts } from "@/src/server/host";
import { needsSessionRefresh, refreshSession } from "@/src/server/session-refresh";
import { supabasePublicEnv } from "@/src/server/session";

export function proxy(request: NextRequest): NextResponse | Promise<NextResponse> {
  const target = hostRedirect(request.nextUrl, explicitAppHost(process.env), parseLegacyHosts(process.env));
  if (target) return NextResponse.redirect(target, 308);
  if (needsSessionRefresh(request.nextUrl.pathname)) {
    const env = supabasePublicEnv();
    if (env) return refreshSession(request, env);
  }
  return NextResponse.next();
}

// Not /api, /_next, favicon.ico or any other file with an extension.
export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
