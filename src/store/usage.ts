// src/store/usage.ts
// The monthly change limit against a store (definition in src/domain/limits.ts), and the comment limit (comment replies, 2026-10-15).
import { effectiveLimit, type BillingFields, type EffectiveLimit } from "../billing/entitlements";
import { countsTowardLimit, limitState, monthWindow, type LimitState } from "../domain/limits";
import type { Change, ChangeSet, Venue } from "../domain/types";
import { localDate } from "../time";
import type { Store } from "./types";

/** A set made only of set_sold_out rows (a dish ran out): allowed whatever the trial, plan or payment state says. */
export function isSoldOutOnly(changes: readonly Pick<Change, "op">[] | undefined): boolean {
  return !!changes && changes.length > 0 && changes.every((c) => c.op === "set_sold_out");
}

export interface ChangeUsage extends LimitState {
  /** YYYY-MM-DD in the venue's zone: the 1st of next month, when the count starts again (a free trial: the day the trial ends). */
  resets_on: string;
  /** Where the limit comes from: the venue's own number, the free trial's, its plan's, or none (unlimited). */
  kind: EffectiveLimit["kind"];
}

/** The venue's fields the change limit reads; the billing ones are optional (a caller that has none gets the plain monthly limit). */
type UsageVenue = Pick<Venue, "id" | "tz" | "change_limit"> & Partial<BillingFields>;
/** The store as the usage code uses it: its billing settings (Store.billingConfig) decide the trial and plan limits. */
type UsageStore = Pick<Store, "countAppliedChangeSets"> & Pick<Partial<Store>, "billingConfig">;

/**
 * Changes the venue used against its limit: in the current calendar month (in venue.tz), or, in a free trial (billing on, no
 * subscription), over the whole trial [trial_started_at, trial_ends_at). The limit is venues.change_limit when set, else the trial's or
 * the plan's (src/billing/entitlements.ts effectiveLimit); with billing off it is change_limit alone, as before.
 */
export async function changeUsage(store: UsageStore, venue: UsageVenue, now: Date): Promise<ChangeUsage> {
  const eff = effectiveLimit(venue, store.billingConfig, now);
  const w = eff.window ?? monthWindow(now, venue.tz);
  const used = await store.countAppliedChangeSets(venue.id, w.from, w.to);
  return { ...limitState(used, eff.limit), resets_on: localDate(new Date(w.to), venue.tz), kind: eff.kind };
}

/** The venue's comment actions (replies + moderations that went out) this calendar month against comment_limit (null = unlimited). */
export interface CommentUsage {
  used: number;
  limit: number | null;
  reached: boolean;
  /** YYYY-MM-DD in the venue's zone: the 1st of next month. */
  resets_on: string;
}
export async function commentUsage(store: Pick<Store, "countCommentActions">, venue: Pick<Venue, "id" | "tz" | "comment_limit">, now: Date): Promise<CommentUsage> {
  const w = monthWindow(now, venue.tz);
  const used = await store.countCommentActions(venue.id, w.from, w.to);
  const limit = venue.comment_limit;
  return { used, limit, reached: limit !== null && used >= limit, resets_on: localDate(new Date(w.to), venue.tz) };
}

/**
 * The apply-time hard stop, called by both stores' applyChangeSet: true when applying this set at `nowIso` would go past the
 * venue's limit for that month. A comment set (source "comment") is stopped by the venue's comment_limit (replies and
 * moderations this month, countCommentActions) and never by the change limit. Other sets that never count
 * (countsTowardLimit: undo, auto, or only set_comment_mode rows, which needs `changes`) are never stopped; a venue without the
 * relevant limit costs no extra query.
 */
export async function limitBlocks(store: Pick<Store, "getVenue" | "countAppliedChangeSets" | "countCommentActions"> & Pick<Partial<Store>, "billingConfig">, cs: Pick<ChangeSet, "venue_id" | "source"> & { changes?: readonly Pick<Change, "op">[] }, nowIso: string): Promise<boolean> {
  if (cs.source === "comment") {
    const venue = await store.getVenue(cs.venue_id);
    if (venue.comment_limit === null) return false;
    return (await commentUsage(store, venue, new Date(nowIso))).reached;
  }
  if (!countsTowardLimit(cs.source, cs.changes)) return false;
  const venue = await store.getVenue(cs.venue_id);
  const eff = effectiveLimit(venue, store.billingConfig, new Date(nowIso));
  if (eff.limit === null) return false;
  // Marking something sold out is operational: the trial's and the plan's limits never stop it. Only a limit set on the venue itself does.
  if (eff.kind !== "override" && isSoldOutOnly(cs.changes)) return false;
  return (await changeUsage(store, venue, new Date(nowIso))).reached;
}
