// src/store/usage.ts
// The monthly change limit against a store (definition in src/domain/limits.ts), and the comment limit (comment replies, 2026-10-15).
import { countsTowardLimit, limitState, monthWindow, type LimitState } from "../domain/limits";
import type { Change, ChangeSet, Venue } from "../domain/types";
import { localDate } from "../time";
import type { Store } from "./types";

export interface ChangeUsage extends LimitState {
  /** YYYY-MM-DD in the venue's zone: the 1st of next month, when the count starts again. */
  resets_on: string;
}

/** Changes the venue used in its current calendar month (in venue.tz) against its limit. */
export async function changeUsage(store: Pick<Store, "countAppliedChangeSets">, venue: Pick<Venue, "id" | "tz" | "change_limit">, now: Date): Promise<ChangeUsage> {
  const w = monthWindow(now, venue.tz);
  const used = await store.countAppliedChangeSets(venue.id, w.from, w.to);
  return { ...limitState(used, venue.change_limit), resets_on: localDate(new Date(w.to), venue.tz) };
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
export async function limitBlocks(store: Pick<Store, "getVenue" | "countAppliedChangeSets" | "countCommentActions">, cs: Pick<ChangeSet, "venue_id" | "source"> & { changes?: readonly Pick<Change, "op">[] }, nowIso: string): Promise<boolean> {
  if (cs.source === "comment") {
    const venue = await store.getVenue(cs.venue_id);
    if (venue.comment_limit === null) return false;
    return (await commentUsage(store, venue, new Date(nowIso))).reached;
  }
  if (!countsTowardLimit(cs.source, cs.changes)) return false;
  const venue = await store.getVenue(cs.venue_id);
  if (venue.change_limit === null) return false;
  return (await changeUsage(store, venue, new Date(nowIso))).reached;
}
