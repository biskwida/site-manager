// src/server/session-refresh.ts
// The Supabase session refresh for proxy.ts (the @supabase/ssr "updateSession" pattern). Edge-safe: no store, no secrets.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** The pages that read the session. Whole path segments; never /api, venue pages or /admin (the key page). /new is the wizard: its done page links the venue to the signed-in account. */
const SESSION_PREFIXES = ["/dashboard", "/login", "/start", "/onboarding", "/billing", "/auth", "/new"];

export function needsSessionRefresh(pathname: string): boolean {
  return SESSION_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Asks Supabase to verify the access token (getUser), which refreshes an expired one. The new cookies are written to the request
 * (so the page renders with the fresh session) and to the response (so the browser keeps it). Never throws: a Supabase outage
 * lets the page load, and the page itself then sees "signed out".
 */
export async function refreshSession(request: NextRequest, env: { url: string; anonKey: string }): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  try {
    const supabase = createServerClient(env.url, env.anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list, headers) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
          // Supabase's cache headers (no-store on a response that sets auth cookies) keep a CDN from sharing them.
          for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
        },
      },
    });
    await supabase.auth.getUser();
  } catch {
    // keep going with whatever response we have
  }
  return response;
}
