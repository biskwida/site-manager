// src/social/comments-digest.ts
// Venues in "digest" mode get one batch proposal a day with every new comment, at comment_digest_hour in the venue's zone.
// "Once a day" is a local date (last_comment_digest_at read in the venue's zone), so the DST change neither doubles nor skips
// a digest. A day without new comments sends nothing and stays unmarked, so a comment that arrives later that day goes out
// on the next tick. When no owner can be reached the day stays unmarked too and a later tick tries again (a Meta-channel
// owner becomes reachable with their next message). Runs from the global tick (step 10). Logs ids and counts, never text.
import type { Venue } from "../domain/types";
import { localDate, localTime } from "../time";
import { COMMENT_POST_WINDOW_MS } from "./comments-poll";
import { proposeForComments, type ProposeDeps } from "./comments-propose";

export function digestDue(venue: Pick<Venue, "comment_mode" | "comment_digest_hour" | "last_comment_digest_at" | "tz">, now: Date): boolean {
  if (venue.comment_mode !== "digest") return false;
  const today = localDate(now, venue.tz);
  if (venue.last_comment_digest_at && localDate(new Date(venue.last_comment_digest_at), venue.tz) === today) return false;
  return Number(localTime(now, venue.tz).slice(0, 2)) >= venue.comment_digest_hour;
}

const log = (d: ProposeDeps, s: string) => (d.log ?? ((x: string) => console.log(x)))(s);

/** Sends the due digests (one venue with `venueId`, else every live venue); returns venue ids. Never throws. */
export async function runCommentDigests(d: ProposeDeps, o: { venueId?: string; now: Date; eligible?: (venue: Venue) => boolean }): Promise<{ sent: string[]; skipped: string[] }> {
  const out = { sent: [] as string[], skipped: [] as string[] };
  let venues: Venue[];
  try {
    venues = o.venueId ? [await d.store.getVenue(o.venueId)] : await d.store.listVenues({ status: "live" });
  } catch (e) {
    log(d, `[comments] digest venue list failed: ${e instanceof Error ? e.name : "error"}`);
    return out;
  }
  for (const venue of venues) {
    if (o.eligible && !o.eligible(venue)) continue; // e.g. a plan without comments (billing)
    if (!digestDue(venue, o.now)) {
      if (venue.comment_mode === "digest") out.skipped.push(venue.id);
      continue;
    }
    try {
      const since = new Date(o.now.getTime() - COMMENT_POST_WINDOW_MS).toISOString();
      const fresh = (await d.store.listComments(venue.id, { status: ["new"], since })).filter((c) => c.parent_id === null);
      if (fresh.length === 0) {
        out.skipped.push(venue.id); // nothing today yet: the day stays open
        continue;
      }
      const r = await proposeForComments(d, venue, fresh, { mode: "batch" });
      if (r.sets.length === 0 && r.deferred > 0) {
        out.skipped.push(venue.id); // nobody reachable: the comments are held, a later tick tries again
        continue;
      }
      if (r.sets.length > 0) out.sent.push(venue.id);
      else out.skipped.push(venue.id); // comment limit reached: the limit line went out instead, once for the day
      await d.store.updateVenue(venue.id, { last_comment_digest_at: o.now.toISOString() });
      log(d, `[comments] digest for venue ${venue.id}: ${fresh.length} comment(s), ${r.sets.length} set(s)`);
    } catch (e) {
      out.skipped.push(venue.id);
      log(d, `[comments] digest for venue ${venue.id} failed: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  return out;
}
