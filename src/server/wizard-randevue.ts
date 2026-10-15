// src/server/wizard-randevue.ts
// "Import from Randevue" for the wizard's Menu step: POST /api/new/[id]/randevue { url } fetches the venue's menu page on
// randevue.app in both locales, parses the embedded dataset (src/wizard/randevue.ts) and answers the same ExtractResult the photo
// extraction gives, so the owner reviews it in the existing review step before anything is inserted. No model call, so no
// AI quota: its own per-draft limit instead. Fetches only https://randevue.app/<locale>/<uuid>, never follows redirects, and
// stops reading a page over RANDEVUE_MAX_HTML_BYTES. Page contents are never logged.
import type { Venue, WeekHours } from "../domain/types";
import { postProcessExtract, type ExtractResult } from "../wizard/extract";
import { mergeRandevuePages, parseRandevuePage, parseRandevueUrl, randevueHours, randevuePageUrl, randevueToExtract, RANDEVUE_LOCALES, type RandevueLocale, type RandevuePage } from "../wizard/randevue";
import { ALREADY_PUBLISHED, WizardError, wizardErrorResponse, type WizardDeps } from "./wizard";

export interface RandevueDeps extends Pick<WizardDeps, "store" | "now"> {
  /** Outbound HTTP (ServerDeps.fetch); tests inject a fake. */
  fetch: typeof fetch;
}

/** What the route answers: the menu for the review step (post-processed) and the venue details the Menu step may copy. */
export interface RandevueImport {
  menu: ExtractResult;
  venue: {
    name: string;
    table: string;
    /** Local opening hours (Randevue stores UTC), or null when they could not be read. */
    hours: WeekHours | null;
    logo_url: string | null;
    cover_url: string | null;
  };
}

export const RANDEVUE_PER_DRAFT_PER_HOUR = 20;
/** The real page is about 500 KB; anything larger is not a menu page we know. */
export const RANDEVUE_MAX_HTML_BYTES = 4 * 1024 * 1024;
export const RANDEVUE_FETCH_TIMEOUT_MS = 15_000;
const HOUR_MS = 3_600_000;
const NO_STORE = { "cache-control": "no-store" };

export function randevueRateLimitKey(venueId: string): string {
  return `randevue:${venueId}`;
}

const BAD_URL = () => new WizardError("bad_request", 400, "Поставете линк от randevue.app, например https://randevue.app/bg-BG/…", "Paste a link from randevue.app, for example https://randevue.app/bg-BG/…");
const RATE_LIMITED = () => new WizardError("rate_limited", 429, "Твърде много опити за внасяне. Опитайте след малко.", "Too many import attempts. Try again in a little while.");
const UNREADABLE = () => new WizardError("randevue_error", 502, "Не успяхме да прочетем тази страница от Randevue. Качете снимки на менюто вместо това.", "Could not read this Randevue page. Use menu photos instead.");

/** Reads at most `max` bytes of text; null when the body is larger. */
async function readText(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) {
    const t = await res.text();
    return t.length > max ? null : t;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/** The parsed page for one locale, or null for any failure (network, status, redirect, size, no payload). */
export async function fetchRandevuePage(f: typeof fetch, id: string, locale: RandevueLocale): Promise<RandevuePage | null> {
  let res: Response;
  try {
    res = await f(randevuePageUrl(id, locale), { redirect: "manual", headers: { accept: "text/html", "accept-language": locale }, signal: AbortSignal.timeout(RANDEVUE_FETCH_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  let html: string | null;
  try {
    html = await readText(res, RANDEVUE_MAX_HTML_BYTES);
  } catch {
    return null;
  }
  return html ? parseRandevuePage(html, locale) : null;
}

/** POST /api/new/[id]/randevue `{ url }` → `RandevueImport` for the owner to review (never inserted here). */
export async function handleRandevue(req: Request, d: RandevueDeps, venue: Venue): Promise<Response> {
  try {
    if (venue.status !== "draft") throw ALREADY_PUBLISHED(venue.slug);
    const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
    const link = typeof body?.url === "string" ? parseRandevueUrl(body.url) : null;
    if (!link) throw BAD_URL();
    if (!(await d.store.bumpRateLimit(randevueRateLimitKey(venue.id), HOUR_MS, RANDEVUE_PER_DRAFT_PER_HOUR, d.now().toISOString()))) throw RATE_LIMITED();
    const fetched = await Promise.all(RANDEVUE_LOCALES.map(async (loc) => [loc, await fetchRandevuePage(d.fetch, link.id, loc)] as const));
    const pages: Partial<Record<RandevueLocale, RandevuePage>> = {};
    for (const [loc, page] of fetched) if (page) pages[loc] = page;
    if (!Object.keys(pages).length) throw UNREADABLE();
    const now = d.now();
    const merged = mergeRandevuePages(pages);
    const menu = postProcessExtract(randevueToExtract(merged, now));
    const out: RandevueImport = {
      menu,
      venue: { name: merged.venue.name, table: merged.venue.table, hours: randevueHours(merged.venue.hours, merged.venue.time_zone || "Europe/Sofia", now), logo_url: merged.venue.logo_url, cover_url: merged.venue.cover_url },
    };
    return Response.json(out, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}
