// Server-only: reads SITE_MANAGER_URL and SITE_MANAGER_SLUG (set on the Vercel project at creation) and fetches the public feed.
import type { SiteState } from "@/src/domain/types";

export const SLUG = (process.env.SITE_MANAGER_SLUG ?? "").trim();
const BASE = (process.env.SITE_MANAGER_URL ?? "").trim().replace(/\/+$/, "");
/** Absolute feed URL; the template polls it in the browser, the pages fetch it on the server. */
export const FEED_URL = `${BASE}/api/site/${encodeURIComponent(SLUG)}`;

/** This site's own origin (Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every deployment). */
export function siteUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host}` : "http://localhost:3000";
}

/** The venue state, revalidated every 10 s; null when the env is missing or Site Manager is unreachable. */
export async function loadFeed(): Promise<SiteState | null> {
  if (!BASE || !SLUG) return null;
  try {
    const res = await fetch(FEED_URL, { next: { revalidate: 10 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { state: SiteState };
    return data.state;
  } catch {
    return null;
  }
}

/** <html lang> for this site: the venue's main language; "bg" when the feed is unavailable. */
export function htmlLang(state: SiteState | null): "bg" | "en" {
  return state?.venue.default_lang === "en" ? "en" : "bg";
}
