// src/tick.ts
import type { Messenger } from "./bot/messenger";
import { planChange } from "./domain/changes";
import { itemName, tr } from "./domain/format";
import type { Lang } from "./domain/types";
import type { ExpiredTimer, Store } from "./store/types";
import { formatDateTime } from "./time";

export interface TickDeps {
  store: Store;
  messenger: Messenger | null;
  now: Date;
  /** Restrict to one venue (the per-webhook tick). */
  venueId?: string;
}
export interface TickReport {
  applied: string[];
  auto: string[];
  reminded: string[];
  expired: string[];
}

const HOUR = 3_600_000;
const PROPOSAL_TTL_MS = 2 * HOUR;
const REMIND_WINDOW_MS = 24 * HOUR;

async function langFor(store: Store, venueId: string, chatRef: string | null): Promise<{ lang: Lang; tz: string }> {
  const venue = await store.getVenue(venueId);
  const member = chatRef === null ? null : await store.findMember(chatRef);
  return { lang: member?.lang ?? venue.default_lang, tz: venue.tz };
}

/** Applies due scheduled sets, writes auto sets for elapsed timers, reminds about upcoming sets, expires stale proposals. */
export async function runTick(d: TickDeps): Promise<TickReport> {
  const now = d.now.toISOString();
  const report: TickReport = { applied: [], auto: [], reminded: [], expired: [] };

  // 1. Stale proposals (before applying, so a 2 h-old proposal cannot be applied by a late tap).
  const cutoff = new Date(d.now.getTime() - PROPOSAL_TTL_MS).toISOString();
  for (const cs of await d.store.listProposedBefore(cutoff, d.venueId)) {
    // Conditional: a tap that confirmed the set between the list and this write wins.
    if ((await d.store.expireChangeSet(cs.id, now)) !== "expired") continue;
    report.expired.push(cs.id);
    if (d.messenger && cs.chat_ref !== null && cs.message_ref !== null) {
      const { lang } = await langFor(d.store, cs.venue_id, cs.chat_ref);
      const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
      await d.messenger.edit(cs.chat_ref, cs.message_ref, `${preview}\n\n${tr(lang, "⌛ Изтекло: предложението не беше потвърдено в рамките на 2 часа.", "⌛ Expired: the proposal was not confirmed within 2 hours.")}`);
    }
  }

  // 2. Due scheduled sets.
  for (const cs of await d.store.listDue(now, d.venueId)) {
    let result: "applied" | "skipped";
    try {
      result = await d.store.applyChangeSet(cs.id, now);
    } catch (e) {
      console.error(`[tick] apply ${cs.id} failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    if (result !== "applied") continue;
    report.applied.push(cs.id);
    if (d.messenger && cs.chat_ref !== null) {
      const { lang } = await langFor(d.store, cs.venue_id, cs.chat_ref);
      const summary = lang === "bg" ? cs.summary_bg : cs.summary_en;
      await d.messenger.send(cs.chat_ref, cs.source === "undo" ? `${tr(lang, "↩️ Отменено", "↩️ Reverted")}: ${summary}` : `${tr(lang, "✅ Приложено по график", "✅ Applied as scheduled")}: ${summary}`);
    }
  }

  // 3. Auto sets for elapsed timers (read-time effectiveness already hides them; this makes the log complete).
  for (const t of await d.store.listExpiredTimers(now, d.venueId)) {
    try {
      const id = await writeAutoSet(d.store, t, now);
      report.auto.push(id);
    } catch (e) {
      console.error(`[tick] auto set for ${t.item.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // 4. Reminders for sets due within 24 h.
  const until = new Date(d.now.getTime() + REMIND_WINDOW_MS).toISOString();
  for (const cs of await d.store.listUpcoming(now, until, d.venueId)) {
    await d.store.updateChangeSet(cs.id, { reminded_at: now });
    report.reminded.push(cs.id);
    if (d.messenger && cs.chat_ref !== null && cs.apply_at) {
      const { lang, tz } = await langFor(d.store, cs.venue_id, cs.chat_ref);
      const summary = lang === "bg" ? cs.summary_bg : cs.summary_en;
      await d.messenger.send(cs.chat_ref, `${tr(lang, "⏰ Напомняне: на", "⏰ Reminder: on")} ${formatDateTime(cs.apply_at, lang, tz)} ${tr(lang, "ще се приложи", "this will be applied")}: ${summary}`);
    }
  }
  return report;
}

async function writeAutoSet(store: Store, t: ExpiredTimer, now: string): Promise<string> {
  const site = await store.getSite(t.item.venue_id);
  const ctx = { newId: () => crypto.randomUUID(), now };
  const change = t.kind === "sold_out"
    ? planChange(site, { op: "set_sold_out", item_id: t.item.id, until: null }, ctx)
    : planChange(site, { op: "remove_item", item_id: t.item.id }, ctx);
  const nameBg = itemName(t.item, "bg");
  const nameEn = itemName(t.item, "en");
  const cs = await store.createChangeSet({
    venue_id: t.item.venue_id,
    chat_ref: null,
    summary_bg: t.kind === "sold_out" ? `${nameBg} отново в наличност` : `Специалното „${nameBg}“ изтече`,
    summary_en: t.kind === "sold_out" ? `${nameEn} back in stock` : `Special “${nameEn}” expired`,
    preview_bg: t.kind === "sold_out" ? `• ${nameBg}: отново в наличност` : `• Премахва ${nameBg}`,
    preview_en: t.kind === "sold_out" ? `• ${nameEn}: back in stock` : `• Removes ${nameEn}`,
    source: "auto",
    status: "proposed",
    changes: [change],
  });
  await store.applyChangeSet(cs.id, now);
  return cs.id;
}
