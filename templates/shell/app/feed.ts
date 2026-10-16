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

/** The last state this instance read, served while Site Manager is down so an outage never turns the site into a 404. */
let lastGood: SiteState | null = null;

/**
 * The venue state. null when the env is missing or the feed says the venue is gone (404).
 * On any other failure: the last good state, or a thrown error (a temporary 5xx, not "not found") when there is none yet.
 */
export async function loadFeed(): Promise<SiteState | null> {
  if (!BASE || !SLUG) return null;
  let failure: string;
  try {
    const res = await fetch(FEED_URL, { next: { revalidate: 10 } });
    if (res.status === 404) {
      lastGood = null;
      return null;
    }
    if (res.ok) {
      const data = (await res.json()) as { state: SiteState };
      lastGood = data.state;
      return data.state;
    }
    failure = `HTTP ${res.status}`;
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  if (lastGood) {
    console.warn(`[feed] Site Manager unavailable (${failure}); serving the last good state`);
    return lastGood;
  }
  throw new Error(`Site Manager feed unavailable (${failure})`);
}

/** loadFeed for metadata, <html lang> and the share image: these fall back to defaults instead of failing the page. */
export function loadFeedOrNull(): Promise<SiteState | null> {
  return loadFeed().catch(() => null);
}

/** <html lang> for this site: the venue's main language; "bg" when the feed is unavailable. */
export function htmlLang(state: SiteState | null): "bg" | "en" {
  return state?.venue.default_lang === "en" ? "en" : "bg";
}
