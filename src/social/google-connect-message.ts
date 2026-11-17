// src/social/google-connect-message.ts
// What happens right after a Google Business Profile is connected (src/server/google-connect.ts calls it as onConnected):
// every reachable owner (src/social/comments-propose.ts) hears that Google is connected, in their language. When Google's
// regular hours differ from the website's, nothing is overwritten: the conflict is recorded in the destination config
// (hours_conflict + google_hours, which the adapter honours, src/destinations/google.ts) and the owners get a proposal to put
// the website's week on Google. That set has source "auto": it changes nothing on the website, so it uses no monthly change
// (src/domain/limits.ts). ✅ applies it, which pushes the week to Google and clears the conflict. Nothing is written to Google
// here. Never throws; log lines carry ids, counts and error classes only.
import { randomUUID } from "node:crypto";
import type { Messenger } from "../bot/messenger";
import { maskRef } from "../channels/ref";
import type { GoogleLocation } from "../destinations/google-api";
import { formatGooglePeriods, formatWeek, fromRegularHours, hasNoHours, sameWeek } from "../destinations/google-hours";
import { planChange } from "../domain/changes";
import { baseLang, keep, quote } from "../domain/format";
import { renderPreview } from "../domain/preview";
import type { Lang, Member, Venue } from "../domain/types";
import type { Destination, Store } from "../store/types";
import { reachableOwners } from "./comments-propose";

export type ConnectOutcome = "plain" | "proposal" | "conflict_text" | "unreachable";

export interface AnnounceDeps {
  store: Store;
  messenger: Messenger;
  now: () => Date;
  log?: (s: string) => void;
}

const SUMMARY_BG = "Работното време от сайта отива в Google";
const SUMMARY_EN = "The website's hours go to Google";

const errorTag = (e: unknown) => (e instanceof Error ? e.name : "error");

export function googleConnectedText(lang: Lang, title: string, address: string): string {
  const where = address.trim() ? `${keep(title)}, ${keep(address)}` : keep(title);
  return lang === "bg"
    ? `Google е свързан: ${where}. Оттук нататък работното време и почивните дни, които променяте тук, отиват и в Google, след вашето потвърждение. Новите отзиви в Google ще идват тук с готов отговор.`
    : `Google connected: ${where}. From now on, hours and holidays you change here go to Google too, after your tick. New Google reviews will come here with a drafted reply.`;
}

/** `website` "" means the website has no opening hours yet; `canUseGoogle` is false when Google's week cannot be taken over as is. */
export function hoursDifferText(lang: Lang, google: string, website: string, canUseGoogle: boolean): string {
  const bg = lang === "bg";
  const useGoogle = quote(bg ? "вземи тези от Google" : "use Google's", lang);
  if (!website) {
    return bg
      ? `В Google пише ${google}; на сайта ви пише още няма работно време. Кажете ми работното време или ${useGoogle}.`
      : `Google says ${google}; your website says no opening hours yet. Tell me your hours, or say ${useGoogle}.`;
  }
  const head = bg
    ? `В Google пише ${google}; на сайта ви пише ${website}. ✅ оставя часовете от сайта и в Google.`
    : `Google says ${google}; your website says ${website}. ✅ keeps the website's hours on Google.`;
  if (!canUseGoogle) return head;
  return bg
    ? `${head} За да вземем часовете от Google за сайта, натиснете ✏️ и кажете ${useGoogle}.`
    : `${head} To use Google's hours on the website instead, tap ✏️ and say ${useGoogle}.`;
}

/** Sends the connect message to every reachable owner (in each owner's language) and, when Google's hours differ, records the conflict. Never throws. */
export async function announceGoogleConnected(d: AnnounceDeps, venue: Venue, destination: Destination, current: GoogleLocation): Promise<ConnectOutcome> {
  const log = d.log ?? ((s: string) => console.log(s));
  try {
    return await announce(d, log, venue, destination, current);
  } catch (e) {
    log(`[google] connect message for venue ${venue.id} failed: ${errorTag(e)}`);
    return "unreachable";
  }
}

async function announce(d: AnnounceDeps, log: (s: string) => void, venue: Venue, destination: Destination, current: GoogleLocation): Promise<ConnectOutcome> {
  const now = d.now();
  const title = typeof destination.config.title === "string" ? destination.config.title : "";
  const address = typeof destination.config.address === "string" ? destination.config.address : "";
  const periods = current.regularHours?.periods ?? [];
  const site = await d.store.getSite(venue.id);
  const website = site.venue.hours;
  const googleWeek = fromRegularHours(periods);
  const { reachable } = await reachableOwners(d.store, venue.id, now);

  /** Plain messages to every reachable owner; true when at least one went out. */
  const sendPlain = async (text: (lang: Lang) => string): Promise<boolean> => {
    let sent = 0;
    for (const m of reachable) {
      try {
        if ((await d.messenger.send(m.chat_ref, text(baseLang(m.lang)), { proactive: true })) !== null) sent++;
      } catch (e) {
        log(`[google] connect message to ${maskRef(m.chat_ref)} failed: ${errorTag(e)}`);
      }
    }
    return sent > 0;
  };

  if (periods.length === 0 || (googleWeek !== null && sameWeek(googleWeek, website))) {
    if (reachable.length === 0) {
      log(`[google] venue ${venue.id} connected; no owner reachable`);
      return "unreachable";
    }
    await sendPlain((lang) => googleConnectedText(lang, title, address));
    return "plain";
  }

  // Google's week differs: recorded before anything is sent, so the adapter keeps Google's week until the owner chooses.
  const stored = (await d.store.getDestination(venue.id, "google"))?.config ?? destination.config;
  await d.store.updateDestination(destination.id, { config: { ...stored, hours_conflict: true, google_hours: periods } });
  if (reachable.length === 0) {
    log(`[google] venue ${venue.id}: hours differ from Google's; no owner reachable`);
    return "unreachable";
  }
  const websiteHasNone = hasNoHours(website);
  const text = (lang: Lang) => {
    const google = googleWeek ? formatWeek(googleWeek, lang) : formatGooglePeriods(periods, lang);
    return `${googleConnectedText(lang, title, address)}\n\n${hoursDifferText(lang, google, websiteHasNone ? "" : formatWeek(website, lang), googleWeek !== null)}`;
  };
  if (websiteHasNone) {
    await sendPlain(text);
    return "conflict_text";
  }
  return propose(d, log, venue, site, reachable, text);
}

async function propose(d: AnnounceDeps, log: (s: string) => void, venue: Venue, site: Awaited<ReturnType<Store["getSite"]>>, owners: Member[], text: (lang: Lang) => string): Promise<ConnectOutcome> {
  const changes = [planChange(site, { op: "set_hours", hours: site.venue.hours }, { newId: randomUUID, now: d.now().toISOString() })];
  const cs = await d.store.createChangeSet({
    venue_id: venue.id, chat_ref: owners[0].chat_ref, summary_bg: SUMMARY_BG, summary_en: SUMMARY_EN,
    preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz),
    source: "auto", status: "proposed", changes,
  });
  const refs: Record<string, string> = {};
  for (const m of owners) {
    const lang = baseLang(m.lang);
    try {
      const ref = await d.messenger.sendProposal(m.chat_ref, text(lang), cs.id, lang);
      if (ref !== null) refs[m.chat_ref] = ref;
    } catch (e) {
      log(`[google] hours proposal to ${maskRef(m.chat_ref)} failed: ${errorTag(e)}`);
    }
  }
  if (Object.keys(refs).length === 0) {
    // A set nobody can tap would only expire; the conflict stays recorded for the dashboard.
    await d.store.cancelChangeSet(cs.id, d.now().toISOString());
    log(`[google] venue ${venue.id}: hours proposal ${cs.id} reached no owner and was cancelled`);
    return "unreachable";
  }
  await d.store.updateChangeSet(cs.id, { message_ref: refs[owners[0].chat_ref] ?? null, proposal_refs: refs });
  log(`[google] venue ${venue.id}: hours proposal ${cs.id} sent to ${Object.keys(refs).length} owner(s)`);
  return "proposal";
}
