// src/server/host.ts
// Pure host logic, shared by config.ts and proxy.ts. No secrets, no store: proxy.ts must stay light.
export const DEFAULT_APP_HOST = "app.getclaudia.app";
export const DEFAULT_LANDING_URL = "https://getclaudia.app";

/** Browser pages that live on the app host. Whole path segments: `/start` and `/start/x`, never `/startup`. */
const APP_PREFIXES = ["/start", "/login", "/dashboard", "/onboarding", "/admin"];

/** APP_HOST cleaned up: a pasted scheme or trailing slash is dropped, lowercase; empty means the default. */
export function resolveAppHost(env: Record<string, string | undefined>): string {
  const raw = env.APP_HOST?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return raw || DEFAULT_APP_HOST;
}

function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Where a browser page on another host (the old site-manager-lovat.vercel.app) should go, or null when it stays where it is:
 * already on the app host, on a local host, or a path that is not an owner page (every /api path, venue sites, the wizard).
 * The path and the query are kept, so an old `/admin/<slug>?key=` link still opens.
 */
export function hostRedirect(url: URL, appHost: string): URL | null {
  const host = appHost.toLowerCase();
  if (url.host.toLowerCase() === host || isLocal(url.hostname.toLowerCase())) return null;
  const path = url.pathname;
  if (!APP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return new URL(`${path}${url.search}`, `https://${host}`);
}
