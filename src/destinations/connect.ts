// src/destinations/connect.ts
// Server-only. Connects a venue to its WordPress site: validates the URL, exchanges the one-time code for the
// plugin token over the handshake route, and stores the token encrypted. Never logs the code or the token.
import { promises as dns } from "node:dns";
import type { Destination, DestinationWithSecrets, Store } from "../store/types";
import { decryptSecrets, encryptSecrets } from "./secrets";
import { isLocalHost, isPrivateAddress, PRIVATE_NETWORK_REASON, WordPressApiError, WordPressClient, validateSiteUrl } from "./wordpress-client";
import type { WpSiteInfo } from "./wordpress-types";

export interface ConnectDeps {
  store: Store;
  /** null = secrets cannot be stored (production without DESTINATION_SECRET_KEY). */
  secretKey: Buffer | null;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Accept local hosts and plain http (memory store, Docker smoke test); never in production. */
  allowLocal?: boolean;
  /** Hostname → IP addresses; default: the system resolver (dns.lookup, all addresses). */
  resolve?: (host: string) => Promise<string[]>;
}

async function systemResolve(host: string): Promise<string[]> {
  return (await dns.lookup(host, { all: true })).map((a) => a.address);
}

/** Refuses a host whose DNS answer contains a private address (or that does not resolve); local hosts pass only with allowLocal. */
async function checkResolvedHost(d: ConnectDeps, siteUrl: string): Promise<{ bg: string; en: string } | null> {
  const host = new URL(siteUrl).hostname.toLowerCase();
  if (d.allowLocal && isLocalHost(host)) return null;
  let addresses: string[];
  try {
    addresses = await (d.resolve ?? systemResolve)(host.startsWith("[") ? host.slice(1, -1) : host);
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) return { bg: "Не намерих такъв сайт. Проверете адреса.", en: "I could not find that site. Check the address." };
  if (addresses.some(isPrivateAddress)) return { ...PRIVATE_NETWORK_REASON };
  return null;
}
export type ConnectResult = { ok: true; site: WpSiteInfo; destination: Destination } | { ok: false; reason: { bg: string; en: string } };

/** Keys kept in venue_destinations.config for kind "wordpress" (non-secret). */
export const WP_CONFIG_KEYS = ["site_url", "site_name", "wp_version", "plugin_version", "connected_at", "connected_user"] as const;

export async function connectWordPress(d: ConnectDeps, venueId: string, rawSiteUrl: string, code: string): Promise<ConnectResult> {
  if (!d.secretKey) return { ok: false, reason: { bg: "Свързването не е включено на този сървър (липсва DESTINATION_SECRET_KEY).", en: "Connecting is not enabled on this server (DESTINATION_SECRET_KEY is missing)." } };
  const v = validateSiteUrl(rawSiteUrl, { allowLocal: d.allowLocal });
  if (!v.ok) return v;
  const refused = await checkResolvedHost(d, v.url);
  if (refused) return { ok: false, reason: refused };
  const venue = await d.store.getVenue(venueId);
  const anon = new WordPressClient({ siteUrl: v.url, token: null, fetch: d.fetch });
  let hs: { token: string; site: WpSiteInfo };
  try {
    hs = await anon.handshake(code.trim().toUpperCase(), venue.slug);
  } catch (e) {
    return { ok: false, reason: handshakeReason(e) };
  }
  const now = (d.now ?? (() => new Date()))().toISOString();
  const destination = await d.store.upsertDestination({
    venue_id: venueId,
    kind: "wordpress",
    config: { site_url: v.url, site_name: hs.site.name, wp_version: hs.site.wp_version, plugin_version: hs.site.plugin_version, connected_at: now, connected_user: hs.site.connected_user?.login ?? null },
    secrets: encryptSecrets({ token: hs.token }, d.secretKey),
    status: "connected",
  });
  return { ok: true, site: hs.site, destination };
}

function handshakeReason(e: unknown): { bg: string; en: string } {
  if (e instanceof WordPressApiError) {
    if (e.status === 0) return { bg: "Не успях да се свържа със сайта. Проверете адреса и дали плъгинът е активиран.", en: "I could not reach the site. Check the address and that the plugin is active." };
    if (e.status === 403) return { bg: "Кодът е грешен, изтекъл или плъгинът е настроен за друго заведение. Генерирайте нов код от настройките на плъгина.", en: "The code is wrong or expired, or the plugin is set up for another venue. Generate a new code on the plugin's settings page." };
    if (e.status === 404 || e.code === "sm_bad_json") return { bg: "На този адрес няма активен плъгин Site Manager.", en: "There is no active Site Manager plugin at that address." };
    if (e.status === 429) return { bg: "Твърде много опити. Изчакайте минута и опитайте пак.", en: "Too many attempts. Wait a minute and try again." };
    if (e.code === "sm_redirect") return { bg: "Сайтът пренасочва към друг адрес. Изпратете крайния адрес (например с www или https://).", en: "The site redirects to another address. Send its final address (for example with www or https://)." };
    return { bg: "Сайтът отговори с грешка. Опитайте пак след малко.", en: "The site answered with an error. Try again in a moment." };
  }
  return { bg: "Възникна неочаквана грешка при свързването.", en: "Something unexpected went wrong while connecting." };
}

/** Removes the stored connection (the plugin keeps working for reading; its own Disconnect button drops the token there). */
export async function disconnectWordPress(d: ConnectDeps, venueId: string): Promise<boolean> {
  const row = await d.store.getDestination(venueId, "wordpress");
  if (!row) return false;
  await d.store.deleteDestination(row.id);
  return true;
}

/** A ready client for the venue's WordPress site, or null when nothing is connected (or secrets cannot be read). */
export async function wordPressClientFor(d: ConnectDeps, venueId: string): Promise<{ client: WordPressClient; destination: DestinationWithSecrets } | null> {
  const row = await d.store.getDestination(venueId, "wordpress");
  if (!row || row.status === "disconnected" || !d.secretKey) return null;
  const secrets = decryptSecrets(row.secrets, d.secretKey);
  const siteUrl = String(row.config.site_url ?? "");
  if (!siteUrl || !secrets.token) return null;
  return { client: new WordPressClient({ siteUrl, token: secrets.token, fetch: d.fetch }), destination: row };
}
