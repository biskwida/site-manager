// src/social/google-connect-message.ts
// What happens right after a Google Business Profile is connected (src/server/google-connect.ts calls it as onConnected):
// every reachable owner (src/social/comments-propose.ts) hears that Google is connected, in their language. When Google's
// regular hours differ from the website's, nothing is overwritten: the conflict is recorded in the destination config
// (hours_conflict + google_hours, which the adapter honours, src/destinations/google.ts) and one owner (the first reachable
// one whose send succeeds: only the set's chat may decide it, src/bot/approvals.ts) gets a proposal to put the website's week
// on Google; the other owners get the comparison as plain text and who was asked. That set has source "auto": it changes nothing on the website, so it uses no monthly change
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

/** "Google says <google>; your website says <website>." (the comparison alone, for the owners without the buttons). */
export function hoursCompareText(lang: Lang, google: string, website: string): string {
  return lang === "bg" ? `В Google пише ${google}; на сайта ви пише ${website}.` : `Google says ${google}; your website says ${website}.`;
}

/** `website` "" means the website has no opening hours yet; `canUseGoogle` is false when Google's week cannot be taken over as is. */
export function hoursDifferText(lang: Lang, google: string, website: string, canUseGoogle: boolean): string {
  const bg = lang === "bg";
  const useGoogle = quote(bg ? "вземи тези от Google" : "use Google's", lang);
  if (!website) {
    const compare = hoursCompareText(lang, google, bg ? "още няма работно време" : "no opening hours yet");
    if (!canUseGoogle) return `${compare} ${bg ? "Кажете ми работното време." : "Tell me your hours."}`;
    return bg ? `${compare} Кажете ми работното време или ${useGoogle}.` : `${compare} Tell me your hours, or say ${useGoogle}.`;
  }
  const head = bg
    ? `${hoursCompareText(lang, google, website)} ✅ оставя часовете от сайта и в Google.`
    : `${hoursCompareText(lang, google, website)} ✅ keeps the website's hours on Google.`;
  if (!canUseGoogle) return head;
  return bg
    ? `${head} За да вземем часовете от Google за сайта, натиснете ✏️ и кажете ${useGoogle}.`
    : `${head} To use Google's hours on the website instead, tap ✏️ and say ${useGoogle}.`;
}

/** The last line for the owners who did not get the buttons. Members carry no display name, so the fallback words are used. */
export function askedOtherOwnerText(lang: Lang): string {
  return lang === "bg" ? "Попитах другия собственик кое работно време да остане." : "I asked another owner which hours to keep.";
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
  const googleText = (lang: Lang) => (googleWeek ? formatWeek(googleWeek, lang) : formatGooglePeriods(periods, lang));
  const text = (lang: Lang) =>
    `${googleConnectedText(lang, title, address)}\n\n${hoursDifferText(lang, googleText(lang), websiteHasNone ? "" : formatWeek(website, lang), googleWeek !== null)}`;
  if (websiteHasNone) {
    await sendPlain(text);
    return "conflict_text";
  }
  const decider = await propose(d, log, venue, site, reachable, text);
  if (!decider) return "unreachable";
  // The proposal (with the buttons) went to one owner only, who alone can decide it; the others are told who was asked.
  const others = reachable.filter((m) => m.chat_ref !== decider.chat_ref);
  for (const m of others) {
    const lang = baseLang(m.lang);
    try {
      await d.messenger.send(m.chat_ref, `${googleConnectedText(lang, title, address)}\n\n${hoursCompareText(lang, googleText(lang), formatWeek(website, lang))}\n${askedOtherOwnerText(lang)}`, { proactive: true });
    } catch (e) {
      log(`[google] connect message to ${maskRef(m.chat_ref)} failed: ${errorTag(e)}`);
    }
  }
  return "proposal";
}

/**
 * Sends the proposal to the first owner whose send succeeds, with a set made for that owner (only cs.chat_ref may decide a
 * non-comment set, src/bot/approvals.ts). A set whose send failed is cancelled before the next owner is tried, so no set
 * stays live for a chat that never got its buttons. Returns the owner who got it, or null when every send failed.
 */
async function propose(d: AnnounceDeps, log: (s: string) => void, venue: Venue, site: Awaited<ReturnType<Store["getSite"]>>, owners: Member[], text: (lang: Lang) => string): Promise<Member | null> {
  const changes = [planChange(site, { op: "set_hours", hours: site.venue.hours }, { newId: randomUUID, now: d.now().toISOString() })];
  for (const m of owners) {
    const cs = await d.store.createChangeSet({
      venue_id: venue.id, chat_ref: m.chat_ref, summary_bg: SUMMARY_BG, summary_en: SUMMARY_EN,
      preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz),
      source: "auto", status: "proposed", changes,
    });
    const lang = baseLang(m.lang);
    let ref: string | null = null;
    try {
      ref = await d.messenger.sendProposal(m.chat_ref, text(lang), cs.id, lang);
    } catch (e) {
      log(`[google] hours proposal to ${maskRef(m.chat_ref)} failed: ${errorTag(e)}`);
    }
    if (ref === null) {
      await d.store.cancelChangeSet(cs.id, d.now().toISOString());
      continue;
    }
    await d.store.updateChangeSet(cs.id, { message_ref: ref, proposal_refs: { [m.chat_ref]: ref } });
    log(`[google] venue ${venue.id}: hours proposal ${cs.id} sent`);
    return m;
  }
  log(`[google] venue ${venue.id}: hours proposal reached no owner`);
  return null;
}
