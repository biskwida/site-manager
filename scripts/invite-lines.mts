// scripts/invite-lines.mts
// Shared by venue-create.mts and invite-create.mts: argument parsing, the own-site URL check, invite lookup and the printed invite lines.
import { INVITE_TTL_MS } from "../src/bot/links";
import { startLinks, type LinkConfig } from "../src/channels/links";
import type { Role, Venue } from "../src/domain/types";
import type { Store } from "../src/store/types";

/** `--key value` pairs after the script name. */
export function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ""), argv[i + 1] ?? "");
  return args;
}

/** A plain https URL with a real hostname (no credentials, query or fragment), without a trailing slash; null otherwise. */
export function parseSiteUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !u.hostname.includes(".")) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
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
  if (o.siteUrl && venue.site_url !== o.siteUrl) venue = await store.updateVenue(venue.id, { site_url: o.siteUrl });
  const open = await store.findOpenInvite(venue.id, o.role, o.now.toISOString());
  if (open) return { ok: true, venue, code: open, reused: true };
  const code = await store.createInvite(venue.id, o.role, new Date(o.now.getTime() + INVITE_TTL_MS).toISOString());
  return { ok: true, venue, code, reused: false };
}
