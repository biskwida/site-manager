// src/social/reviews-poll.ts
// Server-only. Reads the Google reviews of a venue's connected Business Profile location (the newest 50, newest update first) and
// stores them as social_comments rows with network "google", next to the Meta comments, so the comment flow proposes the replies.
// Per venue at most every 15 minutes (last_review_poll_at in the destination config), once a minute on demand. Only reads: a
// reply goes out through an approved change set alone. A review is kept 30 days from its last update (created_at stores the
// review's updateTime, so the purge never blanks a review edited today while its proposal waits).
// Logs carry venue ids, counts and error codes only: never a review's text, never a reviewer's name, never a token.
import { googleClientFor } from "../destinations/google";
import { GoogleApiError, listReviews, type GoogleReview } from "../destinations/google-api";
import { decryptSecrets } from "../destinations/secrets";
import { CONNECTION_CODES, type SyncDeps } from "../destinations/sync";
import { formatSyncError } from "../destinations/wp-errors";
import type { Venue } from "../domain/types";
import type { DestinationPatch, DestinationWithSecrets, NewSocialComment, SocialComment, SocialCommentPatch } from "../store/types";
import { COMMENT_ON_DEMAND_MIN_GAP_MS, COMMENT_POLL_EVERY_MS, COMMENT_RETENTION_MS } from "./comments-poll";

/** The first poll after a connect stores reviews older than this before connected_at as ignored (never proposed). */
export const REVIEW_BACKLOG_MS = 7 * 24 * 3_600_000;

export interface ReviewPollReport {
  polled: boolean;
  inserted: SocialComment[];
  /** Rows whose review was edited by its author; `had_set` is the proposal that was waiting on the old text, if any. */
  edited: { comment: SocialComment; had_set: string | null }[];
  error: string | null; // error code
}

/** Errors a retry cannot fix: the destination is marked `error` (the owner connects again). */
const STOP_CODES: ReadonlySet<string> = new Set([...CONNECTION_CODES, "sm_social_not_connected"]);
const STARS: Readonly<Record<string, number>> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

const log = (d: SyncDeps, s: string) => (d.log ?? ((x: string) => console.log(x)))(s);
const codeOf = (e: unknown) => (e instanceof GoogleApiError ? e.code : e instanceof Error ? e.name : "error");

/** ONE..FIVE → 1..5; unspecified or absent → null. */
export function starsOf(r: GoogleReview["starRating"]): number | null {
  return (r && STARS[r]) ?? null;
}

function isDue(dest: DestinationWithSecrets, now: Date, minGapMs: number): boolean {
  const last = Date.parse(String(dest.config.last_review_poll_at ?? ""));
  return !Number.isFinite(last) || now.getTime() - last >= minGapMs;
}

/** Re-reads the destination and writes the stamp onto its current config, so a concurrent writer (an hours push) is never reverted. */
async function markPolled(d: SyncDeps, venueId: string, now: Date, extra: Omit<DestinationPatch, "config"> = {}): Promise<void> {
  const fresh = await d.store.getDestination(venueId, "google");
  if (!fresh) return; // disconnected meanwhile
  await d.store.updateDestination(fresh.id, { ...extra, config: { ...fresh.config, last_review_poll_at: now.toISOString() } });
}

/** The review's own fields, as stored on its row (new or edited). */
function reviewFields(r: GoogleReview) {
  return { text: r.comment ?? "", author_name: r.reviewer?.displayName ?? "", rating: starsOf(r.starRating), review_updated_at: r.updateTime, created_at: r.updateTime };
}

/** A reply at least as new as the review's last update answers the review as it is now. */
function answered(r: GoogleReview): boolean {
  const reply = Date.parse(r.reviewReply?.updateTime ?? "");
  return r.reviewReply !== undefined && Number.isFinite(reply) && reply >= Date.parse(r.updateTime);
}

/**
 * One venue's review poll: at most every 15 min (config.last_review_poll_at), `onDemand` every minute. Never throws.
 * Reviews come newest update first; the poll stops at the first one already stored with the same update time.
 */
export async function pollVenueReviews(d: SyncDeps, venue: Venue, now: Date, o: { onDemand?: boolean } = {}): Promise<ReviewPollReport> {
  const report: ReviewPollReport = { polled: false, inserted: [], edited: [], error: null };
  if (!d.secretKey) return report;
  let dest: DestinationWithSecrets | null;
  try {
    dest = await d.store.getDestination(venue.id, "google");
  } catch (e) {
    log(d, `[reviews] destination read for venue ${venue.id} failed: ${codeOf(e)}`);
    return report;
  }
  if (!dest || dest.status !== "connected" || !isDue(dest, now, o.onDemand ? COMMENT_ON_DEMAND_MIN_GAP_MS : COMMENT_POLL_EVERY_MS)) return report;
  try {
    const locationV4 = typeof dest.config.location_v4 === "string" ? dest.config.location_v4 : "";
    if (!locationV4) throw new GoogleApiError(0, "sm_social_not_connected", "Google is not connected.", { retry: false });
    const client = await googleClientFor(d, decryptSecrets(dest.secrets, d.secretKey));
    const reviews = (await listReviews(client, locationV4)).sort((a, b) => Date.parse(b.updateTime) - Date.parse(a.updateTime));
    const firstPoll = !Number.isFinite(Date.parse(String(dest.config.last_review_poll_at ?? "")));
    const backlogBefore = Date.parse(String(dest.config.connected_at ?? "")) - REVIEW_BACKLOG_MS;
    const oldest = now.getTime() - COMMENT_RETENTION_MS;
    for (const r of reviews) {
      const updated = Date.parse(r.updateTime);
      if (!Number.isFinite(updated) || updated < oldest) break; // newest first: everything after is older than 30 days, never stored
      const known = await d.store.findComment(venue.id, r.name);
      if (known && known.review_updated_at === r.updateTime) break; // seen: so is everything older
      const fields = reviewFields(r);
      if (!known) {
        const status = r.reviewReply ? "replied" : firstPoll && Number.isFinite(backlogBefore) && updated < backlogBefore ? "ignored" : "new";
        const row: NewSocialComment = { network: "google", post_ref: locationV4, comment_id: r.name, parent_id: null, author_id: "", ...fields, seen_at: now.toISOString(), status, post_caption: "" };
        const [inserted] = await d.store.upsertComments(venue.id, [row]);
        if (!inserted) continue; // stored meanwhile (the tick and an on-demand read at once)
        if (r.reviewReply) {
          // Not Claudia's reply: replied_at stays null, so it never counts toward comment_limit.
          const patch: SocialCommentPatch = { reply_id: r.name, draft_text: r.reviewReply.comment ?? null };
          await d.store.updateComment(inserted.id, patch);
          Object.assign(inserted, patch);
        }
        report.inserted.push(inserted);
        continue;
      }
      if (answered(r)) {
        await d.store.updateComment(known.id, { ...fields, status: "replied", reply_id: r.name, draft_text: r.reviewReply?.comment ?? null });
        continue;
      }
      // Edited by its author: proposed again from the new text. draft_text with draft_kind null carries the previous reply.
      const patch: SocialCommentPatch = { ...fields, status: "new", draft_kind: null, draft_text: r.reviewReply?.comment ?? null, deferred: false, hold_attempts: 0, held_at: null };
      await d.store.updateComment(known.id, patch);
      report.edited.push({ comment: { ...known, ...patch }, had_set: known.status === "proposed" ? known.change_set_id : null });
    }
    await markPolled(d, venue.id, now);
    report.polled = true;
    if (report.inserted.length || report.edited.length) log(d, `[reviews] poll for venue ${venue.id}: ${report.inserted.length} new, ${report.edited.length} edited of ${reviews.length} read`);
  } catch (e) {
    const code = codeOf(e);
    report.error = code;
    log(d, `[reviews] poll for venue ${venue.id} failed: ${code}`);
    if (e instanceof GoogleApiError && STOP_CODES.has(e.code)) {
      await markPolled(d, venue.id, now, { status: "error", last_error: formatSyncError(e.code, e.message) }).catch(() => undefined);
    }
  }
  return report;
}
