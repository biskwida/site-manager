// src/server/host.ts
// Pure host logic, shared by config.ts and proxy.ts. No secrets, no store: proxy.ts must stay light.
export const DEFAULT_APP_HOST = "getclaudia.app";
export const DEFAULT_LANDING_URL = "https://getclaudia.app";

/** Browser pages that live on the app host. Whole path segments: `/start` and `/start/x`, never `/startup`. */
const APP_PREFIXES = ["/start", "/login", "/dashboard", "/onboarding", "/admin"];

/** APP_HOST cleaned up: a pasted scheme or trailing slash is dropped, lowercase; empty means the default. */
export function resolveAppHost(env: Record<string, string | undefined>): string {
  const raw = env.APP_HOST?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return raw || DEFAULT_APP_HOST;
}

/** APP_HOST only when it is set explicitly in env (the default is for building links, never for redirecting); null otherwise. */
export function explicitAppHost(env: Record<string, string | undefined>): string | null {
  return env.APP_HOST?.trim() ? resolveAppHost(env) : null;
}

/** LEGACY_HOSTS: comma-separated hostnames whose owner pages move to the app host. No default: empty means no redirect at all. */
export function parseLegacyHosts(env: Record<string, string | undefined>): string[] {
  return (env.LEGACY_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, ""))
    .filter(Boolean);
}

/**
 * Where an owner's browser page on a legacy host (LEGACY_HOSTS, e.g. the old site-manager-lovat.vercel.app) should go, or null
 * when it stays: no legacy host listed, APP_HOST not set explicitly (`appHost` null), any other host (previews, LAN, localhost,
 * the app host itself), or a path that is not an owner page (every /api path, venue sites, the wizard). The hostname is compared
 * lowercased with the port ignored. The path and the query are kept, so an old `/admin/<slug>?key=` link still opens.
 */
export function hostRedirect(url: URL, appHost: string | null, legacyHosts: readonly string[]): URL | null {
  if (!appHost || !legacyHosts.length) return null;
  const host = appHost.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  if (!legacyHosts.includes(hostname) || hostname === host.replace(/:.*$/, "")) return null;
  const path = url.pathname;
  if (!APP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return new URL(`${path}${url.search}`, `https://${host}`);
}

/**
 * Where `/` should send a visitor, or null to render the built-in fallback landing: when the landing URL's host is the host the
 * request came in on (getclaudia.app serving the app and LANDING_URL=https://getclaudia.app), redirecting would loop.
 */
export function landingRedirect(landingUrl: string, requestHost: string | null | undefined): string | null {
  const own = requestHost?.trim().toLowerCase().replace(/:\d+$/, "");
  try {
    return own && new URL(landingUrl).hostname.toLowerCase() === own ? null : landingUrl;
  } catch {
    return null;
  }
}
