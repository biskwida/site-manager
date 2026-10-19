// scripts/invite-lines.mts
// Shared by venue-create.mts and invite-create.mts: argument parsing, the own-site URL check, invite lookup and the printed invite lines.
import { INVITE_TTL_MS } from "../src/bot/links";
import { startLinks, type LinkConfig } from "../src/channels/links";
import type { Role, SiteMode, Venue } from "../src/domain/types";
import { parseSiteUrl } from "../src/domain/site-url";
import type { Store } from "../src/store/types";

/** `--key value` pairs after the script name. */
export function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ""), argv[i + 1] ?? "");
  return args;
}

export { parseSiteUrl };

/**
 * venue:create's --site-mode with --site-url: --site-url alone implies "own"; no flags = "claudia". "own" needs a site URL and the
 * other modes refuse one, so the two flags can never disagree.
 */
export function resolveSiteMode(mode: string | undefined, siteUrl: string | null): { ok: true; mode: SiteMode } | { ok: false; error: string } {
  const m = mode === undefined ? (siteUrl ? "own" : "claudia") : mode;
  if (m !== "claudia" && m !== "own" && m !== "none") return { ok: false, error: `--site-mode "${mode}" must be claudia, own or none` };
  if (m === "own" && !siteUrl) return { ok: false, error: `--site-mode own needs --site-url https://…` };
  if (m !== "own" && siteUrl) return { ok: false, error: `--site-url only goes with --site-mode own (not ${m})` };
  return { ok: true, mode: m };
}

/** venue:create's site line: the hosted site for claudia, the own URL for own, the hosted page (not a website) for none. */
export function siteLines(venue: Pick<Venue, "slug" | "site_mode" | "site_url">, baseUrl: string): string[] {
  if (venue.site_mode === "own" && venue.site_url) return [`own site:    ${venue.site_url}   (reads ${baseUrl}/api/site/${venue.slug}; no Vercel project is created)`];
  if (venue.site_mode === "none") return [`page:        ${baseUrl}/${venue.slug}   (social media only: no website, no Vercel project is created)`];
  return [`site:        ${baseUrl}/${venue.slug}`];
}

export interface PrintedInvite {
  role: Role;
  code: string;
  /** Shown in brackets after the /start line, e.g. "valid 7 days, one use". */
  note: string;
}

/** The /start line per code, the deep link per enabled channel, then the bare-code note (the first invite named, the rest in brackets). */
export function inviteLines(cfg: LinkConfig, invites: PrintedInvite[]): string[] {
  const lines = invites.map((i) => `${i.role} code:  /start ${i.code}   (${i.note})`);
  for (const i of invites) for (const [channel, url] of Object.entries(startLinks(cfg, i.code))) lines.push(`${i.role} link (${channel}): ${url}`);
  const [first, ...rest] = invites;
  if (first) lines.push(`On Messenger, Instagram and WhatsApp the ${first.role} can also just send the bare code as a message: ${first.code}${rest.map((r) => ` (${r.role}: ${r.code})`).join("")}.`);
  return lines;
}

export type PreparedInvite = { ok: true; venue: Venue; code: string; reused: boolean } | { ok: false; error: string };

/**
 * invite:create: for an existing venue, sets `siteUrl` first (so the deploy skip is in place before anyone redeems), then
 * returns the open invite for `role` when there is one, or a new one valid INVITE_TTL_MS.
 */
export async function prepareInvite(store: Store, o: { slug: string; role: Role; siteUrl?: string; now: Date }): Promise<PreparedInvite> {
  let venue = await store.getVenueBySlug(o.slug);
  if (!venue) return { ok: false, error: `no venue with slug "${o.slug}"` };
  // A site URL is an own site: the mode moves with it, so the deploy skip is in place before anyone redeems.
  if (o.siteUrl && (venue.site_url !== o.siteUrl || venue.site_mode !== "own")) venue = await store.updateVenue(venue.id, { site_url: o.siteUrl, site_mode: "own" });
  const open = await store.findOpenInvite(venue.id, o.role, o.now.toISOString());
  if (open) return { ok: true, venue, code: open, reused: true };
  const code = await store.createInvite(venue.id, o.role, new Date(o.now.getTime() + INVITE_TTL_MS).toISOString());
  return { ok: true, venue, code, reused: false };
}
