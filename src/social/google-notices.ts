// src/social/google-notices.ts
// Server-only. The two Google messages the tick sends on its own: the one-time "Google disconnected itself" notice to the
// venue's reachable owners (a CONNECTION code on the destination, or the location gone / not connected as the review poll found;
// stamped in config.revoked_notified_at, cleared by a reconnect that writes a new config), and the line for an hours push that failed for good (the owner edits the profile by hand).
// Logs carry ids and codes only.
import type { Messenger } from "../bot/messenger";
import { GOOGLE_EDIT_URL } from "../destinations/google-api";
import { CONNECTION_CODES } from "../destinations/sync";
import { parseSyncError } from "../destinations/wp-errors";
import { baseLang, tr } from "../domain/format";
import type { Lang, Venue } from "../domain/types";
import type { DestinationSync, Store } from "../store/types";
import { reachableOwners } from "./comments-propose";

export interface NoticeDeps {
  store: Store;
  messenger: Messenger;
  now: Date;
  baseUrl: string;
  log?: (s: string) => void;
}

const log = (d: NoticeDeps, s: string) => (d.log ?? ((x: string) => console.log(x)))(s);

/** Codes on an `error` destination that get the one-time notice: the connection codes, plus the two the review poll stops on. */
const NOTICE_CODES: ReadonlySet<string> = new Set([...CONNECTION_CODES, "sm_google_not_found", "sm_social_not_connected"]);

export function googleBrokenText(lang: Lang, baseUrl: string, slug: string, code?: string): string {
  const link = `${baseUrl}/dashboard/${slug}#google`;
  if (code === "sm_google_not_found") {
    return tr(
      lang,
      `Профилът ви в Google не е намерен (изтрит е или е преместен в друг Google акаунт). Свържете Google отново от таблото: ${link}`,
      `Your Google profile could not be found (it was deleted or moved to another Google account). Connect Google again from the dashboard: ${link}`,
    );
  }
  if (code === "sm_social_not_connected") return tr(lang, `Google не е свързан. Свържете го отново от таблото: ${link}`, `Google is not connected. Connect it again from the dashboard: ${link}`);
  return tr(
    lang,
    `Връзката с Google прекъсна (разрешението е премахнато). Свържете Google отново от таблото: ${link}`,
    `Google disconnected itself (the permission was removed). Connect Google again from the dashboard: ${link}`,
  );
}

export function googleHoursFailedLine(lang: Lang): string {
  return tr(lang, `Google профил: не е обновен. Отворете профила си и го променете ръчно: ${GOOGLE_EDIT_URL}`, `Google listing: not updated. Open your profile to change it by hand: ${GOOGLE_EDIT_URL}`);
}

/** Once per broken connection: destination google in `error` with a NOTICE code and no config.revoked_notified_at. Returns true when it sent. */
export async function notifyGoogleBroken(d: NoticeDeps, venue: Venue): Promise<boolean> {
  const dest = await d.store.getDestination(venue.id, "google");
  if (!dest || dest.status !== "error" || dest.config.revoked_notified_at) return false;
  const code = parseSyncError(dest.last_error ?? "").code;
  if (!code || !NOTICE_CODES.has(code)) return false;
  const { reachable } = await reachableOwners(d.store, venue.id, d.now);
  let delivered = 0;
  for (const m of reachable) {
    if ((await d.messenger.send(m.chat_ref, googleBrokenText(baseLang(m.lang), d.baseUrl, venue.slug, code), { proactive: true })) !== null) delivered++;
  }
  if (delivered === 0) return false; // nobody heard it: tried again on the next tick
  // Re-read: written onto the current config (a concurrent writer is never reverted).
  const fresh = await d.store.getDestination(venue.id, "google");
  if (fresh) await d.store.updateDestination(fresh.id, { config: { ...fresh.config, revoked_notified_at: d.now.toISOString() } });
  log(d, `[google] venue ${venue.id}: disconnected notice (${code}) sent to ${delivered} owner(s)`);
  return true;
}

/** For a Google sync row that just failed for good with a non-connection code: tells the set's chat (or the reachable owners). */
export async function notifyGoogleHoursFailed(d: NoticeDeps, sync: DestinationSync): Promise<void> {
  const cs = await d.store.getChangeSet(sync.change_set_id);
  const venue = await d.store.getVenue(sync.venue_id);
  const text = (lang: Lang) => `${lang === "bg" ? cs.summary_bg : cs.summary_en}\n${googleHoursFailedLine(lang)}`;
  const member = cs.chat_ref !== null ? await d.store.findMember(cs.chat_ref) : null;
  if (cs.chat_ref !== null && member && member.venue_id === venue.id) {
    await d.messenger.send(cs.chat_ref, text(baseLang(member.lang)), { proactive: true });
    return;
  }
  for (const m of (await reachableOwners(d.store, venue.id, d.now)).reachable) await d.messenger.send(m.chat_ref, text(baseLang(m.lang)), { proactive: true });
}
