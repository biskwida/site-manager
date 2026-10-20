// src/tick.ts
import type { Messenger } from "./bot/messenger";
import { runPendingSyncs, type SyncDeps } from "./destinations/sync";
import { refreshInstagramTokens } from "./destinations/instagram";
import { pollDeployments } from "./deploy/run";
import type { Deployer } from "./deploy/types";
import { planChange } from "./domain/changes";
import { baseLang, itemName, keep, tr } from "./domain/format";
import type { Lang, Venue } from "./domain/types";
import type { ApplyResult, ExpiredTimer, SocialComment, Store } from "./store/types";
import { limitReachedLine, usageLine } from "./bot/limit";
import { channelOf, isMetaChannel } from "./channels/ref";
import { formatDateTime } from "./time";
import { COMMENT_POST_WINDOW_MS, pollVenueComments, purgeOldComments } from "./social/comments-poll";
import { COMMENT_PROPOSAL_TTL_MS, commentsOfSet, proposalTargets, proposalTtlHours, proposeForComments } from "./social/comments-propose";
import type { DraftFn } from "./social/comments-draft";
import { runCommentDigests } from "./social/comments-digest";
import { planIncludes } from "./billing/entitlements";
import { pauseExpiredTrials, sendTrialReminders, type TrialBilling } from "./billing/reminders";

export interface TickDeps {
  store: Store;
  messenger: Messenger | null;
  now: Date;
  /** Restrict to one venue (the per-webhook tick). */
  venueId?: string;
  /** Destination pushes to retry (src/destinations/sync.ts); null/undefined = skip. */
  sync?: SyncDeps | null;
  /** When set, in-flight deployments are polled (pollDeployments). */
  deployer?: Deployer | null;
  /** Comment reply drafting (src/social/comments-draft.ts); null/undefined = comments are polled but never proposed. */
  comments?: { draft: DraftFn } | null;
  /** Billing (BILLING_ENABLED on): the free trial's end and its reminders. null/undefined = billing is off, the tick does none of it. */
  billing?: TrialBilling | null;
}
export interface TickReport {
  applied: string[];
  auto: string[];
  reminded: string[];
  expired: string[];
  /** Venue ids whose site became ready / failed this tick. */
  deployed: string[];
  deployFailed: string[];
  /** Draft venue ids deleted this tick. */
  cleaned: string[];
  /** Destination sync rows pushed by this tick. */
  pushed?: string[];
  /** Due scheduled sets refused by the monthly change limit (now cancelled). */
  limited?: string[];
  /** New customer comments stored this tick (comment replies, 2026-10-15); absent without sync deps. */
  comments_found?: number;
  /** Comment sets proposed this tick (mode "each"); absent without sync deps. */
  comments_proposed?: number;
  /** Venue ids that got their daily comment digest this tick (global tick only). */
  digests?: string[];
  /** Venue ids whose free trial ran out and were paused this tick (billing on only). */
  trials_paused?: string[];
  /** Trial reminders sent this tick (billing on only). */
  trial_reminders?: number;
}

const HOUR = 3_600_000;
const PROPOSAL_TTL_MS = 2 * HOUR;
const REMIND_WINDOW_MS = 24 * HOUR;
/** Wizard drafts nobody published are deleted after this. */
export const DRAFT_TTL_MS = 48 * HOUR;

async function langFor(store: Store, venueId: string, chatRef: string | null): Promise<{ lang: Lang; tz: string }> {
  const venue = await store.getVenue(venueId);
  const member = chatRef === null ? null : await store.findMember(chatRef);
  return { lang: member ? baseLang(member.lang) : venue.default_lang, tz: venue.tz };
}

/** Applies due scheduled sets, writes auto sets for elapsed timers, reminds about upcoming sets, expires stale proposals. */
export async function runTick(d: TickDeps): Promise<TickReport> {
  const now = d.now.toISOString();
  const report: TickReport = { applied: [], auto: [], reminded: [], expired: [], deployed: [], deployFailed: [], cleaned: [], limited: [] };

  // 1. Stale proposals (before applying, so an old proposal cannot be applied by a late tap). 2 h; comment sets 24 h, and
  //    every owner who got a comment set's buttons is told; its comments become expired.
  const cutoff = new Date(d.now.getTime() - PROPOSAL_TTL_MS).toISOString();
  for (const cs of await d.store.listProposedBefore(cutoff, d.venueId)) {
    if (cs.source === "comment" && Date.parse(cs.created_at) > d.now.getTime() - COMMENT_PROPOSAL_TTL_MS) continue;
    // Conditional: a tap that confirmed the set between the list and this write wins.
    if ((await d.store.expireChangeSet(cs.id, now)) !== "expired") continue;
    report.expired.push(cs.id);
    if (d.messenger) {
      const hours = proposalTtlHours(cs.source);
      for (const [chatRef, messageRef] of proposalTargets(cs)) {
        const { lang } = await langFor(d.store, cs.venue_id, chatRef);
        const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
        const line = tr(lang, `⌛ Изтекло: предложението не беше потвърдено в рамките на ${hours} часа.`, `⌛ Expired: the proposal was not confirmed within ${hours} hours.`);
        await d.messenger.conclude(chatRef, messageRef, `${preview}\n\n${line}`, line, { proactive: true });
      }
    }
    if (cs.source === "comment") for (const c of await commentsOfSet(d.store, cs)) await d.store.updateComment(c.id, { status: "expired" });
  }

  // 2. Due scheduled sets.
  for (const cs of await d.store.listDue(now, d.venueId)) {
    let result: ApplyResult;
    try {
      result = await d.store.applyChangeSet(cs.id, now);
    } catch (e) {
      console.error(`[tick] apply ${cs.id} failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    if (result === "limited") {
      // The store cancelled it (monthly change limit), so later ticks leave it alone; the owner hears why once.
      // Its "⏰ Scheduled for …" message is concluded with the limit line, like an expired proposal. Telegram edits that message
      // in place without a notification, so the owner also gets a new message; elsewhere conclude already sends `text` as one.
      report.limited?.push(cs.id);
      if (d.messenger && cs.chat_ref !== null) {
        const { lang } = await langFor(d.store, cs.venue_id, cs.chat_ref);
        const summary = lang === "bg" ? cs.summary_bg : cs.summary_en;
        const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
        const line = await limitReachedLine(d.store, cs.venue_id, d.now, lang);
        const text = `${tr(lang, "⛔ Не е приложено по график", "⛔ Not applied as scheduled")}: ${summary}\n${line}`;
        if (cs.message_ref !== null) await d.messenger.conclude(cs.chat_ref, cs.message_ref, `${preview}\n\n${line}`, text, { proactive: true });
        if (cs.message_ref === null || !isMetaChannel(channelOf(cs.chat_ref))) await d.messenger.send(cs.chat_ref, text, { proactive: true });
      }
      continue;
    }
    if (result !== "applied") continue;
    report.applied.push(cs.id);
    if (d.messenger && cs.chat_ref !== null) {
      const { lang } = await langFor(d.store, cs.venue_id, cs.chat_ref);
      const summary = lang === "bg" ? cs.summary_bg : cs.summary_en;
      const usage = await usageLine(d.store, cs.venue_id, d.now, lang);
      const text = cs.source === "undo" ? `${tr(lang, "↩️ Отменено", "↩️ Reverted")}: ${summary}` : `${tr(lang, "✅ Приложено по график", "✅ Applied as scheduled")}: ${summary}`;
      await d.messenger.send(cs.chat_ref, usage ? `${text}\n${usage}` : text, { proactive: true });
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

  // 3b. The free trial's end (billing on only): pause trials that ran out, then send the two reminders (once each). Pausing stops NEW owner
  //     proposals only; the due scheduled sets above and the auto reverts of step 3 have already run, and nothing goes offline.
  if (d.billing?.config.billingEnabled) {
    try {
      const b = { store: d.store, messenger: d.messenger, billing: d.billing, venueId: d.venueId };
      report.trials_paused = await pauseExpiredTrials(b, d.now);
      report.trial_reminders = await sendTrialReminders(b, d.now);
    } catch (e) {
      console.error("[tick] trial end failed:", e instanceof Error ? e.message : e);
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
      await d.messenger.send(cs.chat_ref, `${tr(lang, "⏰ Напомняне: на", "⏰ Reminder: on")} ${formatDateTime(cs.apply_at, lang, tz)} ${tr(lang, "ще се приложи", "this will be applied")}: ${summary}`, { proactive: true });
    }
  }

  // 5. Deployments in flight (only when the caller has a deployer; tests of the content tick pass none).
  if (d.deployer) {
    try {
      const r = await pollDeployments({ store: d.store, deployer: d.deployer, messenger: d.messenger, now: () => d.now, venueId: d.venueId });
      report.deployed = r.ready;
      report.deployFailed = r.failed;
    } catch (e) {
      console.error("[tick] pollDeployments failed:", e instanceof Error ? e.message : e);
    }
  }

  // 6. Abandoned wizard drafts.
  report.cleaned = await cleanupDrafts({ store: d.store, now: d.now, venueId: d.venueId });

  // 7. Destination pushes that failed earlier (WordPress etc.), with backoff.
  if (d.sync) {
    try {
      const r = await runPendingSyncs(d.sync, { venueId: d.venueId, now: d.now });
      report.pushed = r.done;
    } catch (e) {
      console.error("[tick] destination syncs failed:", e instanceof Error ? e.message : e);
    }
    // 8. Instagram tokens older than 30 days (social track, appended 2026-10-11): refresh before they expire at 60.
    try {
      await refreshInstagramTokens(d.sync, { venueId: d.venueId, now: d.now });
    } catch (e) {
      console.error("[tick] instagram token refresh failed:", e instanceof Error ? e.message : e);
    }
    // 9. Customer comments under the venue's posts (comment replies, 2026-10-15), global tick only: read every 15 min per venue
    //    (after step 8, so Instagram tokens are fresh) and propose in mode "each" (digest venues wait for their daily digest,
    //    "off" venues only show them on the dashboard). The per-venue tick runs before an owner's agent turn inside the webhook
    //    budget: it makes no Graph read and no model call, and only re-sends that venue's held comments (deferred, drafts
    //    stored), so the owner who just wrote gets them at once. Keep 30 days: the purge runs on the global tick only.
    // With billing on, comments are read and drafted only for venues whose plan includes them (a free trial with no plan has every feature).
    // Paused venues are not gated here: the owner decides what to do with replies, and nothing is posted before their tap.
    const commentsAllowed = (venue: Pick<Venue, "plan">) => !d.billing?.config.billingEnabled || planIncludes(venue.plan, "comments");
    report.comments_found = 0;
    report.comments_proposed = 0;
    let venues: Venue[] = [];
    try {
      venues = d.venueId ? [await d.store.getVenue(d.venueId)] : await d.store.listVenues({ status: "live" });
    } catch (e) {
      console.error("[tick] comment poll failed:", e instanceof Error ? e.name : "error");
    }
    for (const venue of venues) {
      // One venue's failure (Graph, drafting) never stops the others.
      try {
        if (!commentsAllowed(venue)) continue; // billing on: the plan has no comments, so nothing is read or drafted for it
        if (!d.venueId) {
          const r = await pollVenueComments(d.sync, venue, d.now);
          report.comments_found += r.inserted.length;
        }
        if (!d.comments || !d.messenger || venue.comment_mode !== "each") continue;
        const since = new Date(d.now.getTime() - COMMENT_POST_WINDOW_MS).toISOString();
        const fresh = (await d.store.listComments(venue.id, { status: ["new"], since })).filter((c) => c.parent_id === null && (!d.venueId || (c.deferred && c.draft_kind !== null)));
        if (fresh.length === 0) continue;
        const draft = d.venueId ? noDraftOnScopedTick : d.comments.draft;
        // Read the status again right before proposing: the owner's agent turn (list_comments, then reply_to_comments) may have
        // proposed some of these meanwhile, and a second proposal for the same comment must not go out.
        const current = await Promise.all(fresh.map((c) => d.store.getComment(c.id)));
        const still = current.filter((c): c is SocialComment => c !== null && c.status === "new");
        if (still.length === 0) continue;
        const p = await proposeForComments({ store: d.store, messenger: d.messenger, now: () => d.now, draft, log: d.sync.log }, venue, still, { mode: "each" });
        report.comments_proposed += p.sets.length;
      } catch (e) {
        console.error(`[tick] comments for venue ${venue.id} failed:`, e instanceof Error ? e.name : "error");
      }
    }
    // 10. Daily comment digests (venues in "digest" mode) at their local hour, once per local day. Global tick only: the
    //     per-venue tick before an owner's message leaves it to the cron.
    if (!d.venueId && d.comments && d.messenger) {
      try {
        const r = await runCommentDigests({ store: d.store, messenger: d.messenger, now: () => d.now, draft: d.comments.draft, log: d.sync.log }, { now: d.now, eligible: commentsAllowed });
        report.digests = r.sent;
      } catch (e) {
        console.error("[tick] comment digests failed:", e instanceof Error ? e.name : "error");
      }
    }
    if (!d.venueId) {
      try {
        await purgeOldComments(d.store, d.now);
      } catch (e) {
        console.error("[tick] comment purge failed:", e instanceof Error ? e.name : "error");
      }
    }
  }
  return report;
}

/** The per-venue tick only re-sends held comments, whose drafts are stored: it never calls the model. */
const noDraftOnScopedTick: DraftFn = async () => {
  throw new Error("no drafting on a per-venue tick");
};

/**
 * Deletes draft venues created more than DRAFT_TTL_MS ago (cookie-only drafts nobody published), with their stored images.
 * Never touches a live venue. Runs only on the global tick (cron): a per-venue tick (webhook, ?key=) skips it entirely.
 * Returns the deleted ids.
 */
export async function cleanupDrafts(d: { store: Store; now: Date; venueId?: string }): Promise<string[]> {
  if (d.venueId) return [];
  const cutoff = d.now.getTime() - DRAFT_TTL_MS;
  const out: string[] = [];
  for (const v of await d.store.listVenues({ status: "draft" })) {
    if (v.status !== "draft") continue; // belt and braces: a store that ignores the filter must still never lose a live venue
    if (Date.parse(v.created_at) >= cutoff) continue;
    // Fresh read right before the delete: a draft published between the list and this point must survive (R10).
    let fresh;
    try {
      fresh = await d.store.getVenue(v.id);
    } catch {
      continue;
    }
    if (fresh.status !== "draft") continue;
    try {
      await d.store.deleteVenue(v.id, { withStorage: true });
      out.push(v.id);
    } catch (e) {
      console.error(`[tick] delete draft ${v.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

async function writeAutoSet(store: Store, t: ExpiredTimer, now: string): Promise<string> {
  const site = await store.getSite(t.item.venue_id);
  const ctx = { newId: () => crypto.randomUUID(), now };
  const change = t.kind === "sold_out"
    ? planChange(site, { op: "set_sold_out", item_id: t.item.id, until: null }, ctx)
    : planChange(site, { op: "remove_item", item_id: t.item.id }, ctx);
  // Kept like the dish names of every preview (src/domain/preview.ts): an undo of this set carries its summary into the chat. The
  // dashboard and the agent's tool results read them without the markers.
  const nameBg = keep(itemName(t.item, "bg"));
  const nameEn = keep(itemName(t.item, "en"));
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
