// Server-only: the Google Business Profile destination. Pushes the venue's opening hours and holidays (regularHours /
// specialHours) after an approved change set: dry run first (validateOnly), then the write, then a read-back. Removes only
// the special dates Claudia wrote herself; a period set by hand in Google stays. Also posts an approved review reply (PUT on
// the review) and deletes it on undo, through pushCommentChanges. A set holds hours rows or a review reply, never both kinds.
import type { Change, SiteState } from "../domain/types";
import { localDate } from "../time";
import { getLocation, GoogleApiError, googleAccessToken, GoogleClient, patchLocation, type GoogleLocation, type GooglePeriod, type GoogleSpecialPeriod } from "./google-api";
import { fromRegularHours, hasNoHours, longestClosedRun, mergeSpecial, sameWeek, toRegularPeriods, toSpecialPeriods } from "./google-hours";
import { pushCommentChanges } from "./comment-push";
import { googleSyncLine } from "./google-lines";
import { commentNetworkOf, commentResultIn } from "./social-common";
import type { SyncDeps } from "./sync";
import type { DestinationAdapter, PushContext, PushResult } from "./types";
import { formatSyncError } from "./wp-errors";

const READ_MASK = "regularHours,specialHours,metadata";
/** A run of this many closed days gets the "temporarily closed" note (this release does not set openInfo.status). */
const LONG_CLOSURE_DAYS = 7;

export interface GoogleHoursResult {
  /** regular: the week was sent; conflict: it was held back because Google's own week differs from the website's. */
  hours: { regular: boolean; conflict: boolean; special: number; kept: number; reviewing: boolean; long_closure: boolean };
}

/** Rows that change what Google shows as opening hours: the week, a holiday, or their undo rows. */
export function isHoursChange(c: Change): boolean {
  if (c.op === "set_hours" || c.op === "add_holiday" || c.op === "remove_holiday") return true;
  if (c.entity === "holiday") return true;
  const row = c.after ?? c.before;
  return c.entity === "venue" && row !== null && Object.prototype.hasOwnProperty.call(row, "hours");
}

/** Rows that change the week (set_hours, or a venue row carrying hours, their undo included): only these send regularHours after the first push. */
export function isWeekChange(c: Change): boolean {
  if (c.op === "set_hours") return true;
  const row = c.after ?? c.before;
  return c.entity === "venue" && row !== null && Object.prototype.hasOwnProperty.call(row, "hours");
}

/** A client bound to a fresh access token (never stored). Throws sm_social_not_connected without credentials or a refresh token. */
export async function googleClientFor(d: Pick<SyncDeps, "fetch" | "google">, secrets: Record<string, string>): Promise<GoogleClient> {
  if (!d.google || !secrets.refresh_token) throw new GoogleApiError(0, "sm_social_not_connected", "Google is not connected.", { retry: false });
  const f = d.fetch ?? fetch;
  return new GoogleClient(await googleAccessToken(f, d.google, secrets.refresh_token), f);
}

const lines = (status: "done" | "pending" | "failed", result: Record<string, unknown> | null, stored: string | null) => ({
  bg: googleSyncLine(status, result, stored, "bg"),
  en: googleSyncLine(status, result, stored, "en"),
});

function failure(code: string, message: string, retry: boolean, partial?: Record<string, unknown>): PushResult {
  return { ok: false, retry, error: message, code, line: lines(retry ? "pending" : "failed", null, formatSyncError(code, message)), ...(partial ? { partial } : {}) };
}

export interface HoursPlan {
  mask: string;
  body: Pick<GoogleLocation, "regularHours" | "specialHours">;
  /** The week is sent. */
  regular: boolean;
  /** The week is held back: Google's own week differs from the website's and the owner has not chosen. */
  conflict: boolean;
  /** Claudia's own special periods (the venue's holidays from today). */
  mine: GoogleSpecialPeriod[];
  kept: number;
  /** The config keys a successful write sets (`set`) and removes (`remove`); nothing else of the config is touched. */
  set: Record<string, unknown>;
  remove: string[];
}

/**
 * What an hours push sends, read against Google's current location. The week (regularHours) goes out only with a week change
 * or on the first push: a holiday alone never reverts a week someone changed directly in Google. While Google's week differs
 * from the website's and the owner has not chosen, only a new week from the owner replaces it. The first push decides that
 * itself (the after-connect read may have failed): a non-empty Google week that differs from the website's, or that the
 * website cannot express, is not overwritten. Shared with scripts/google-live-check.mts.
 */
export function planHoursPush(config: Record<string, unknown>, site: Pick<SiteState, "venue" | "holidays">, current: GoogleLocation, weekChange: boolean, now: Date): HoursPlan {
  const today = localDate(now, site.venue.tz);
  const mine = toSpecialPeriods(site.holidays, today);
  const pushedBefore = Array.isArray(config.special_dates_pushed) ? config.special_dates_pushed.filter((x): x is string => typeof x === "string") : [];
  const merged = mergeSpecial(mine, current.specialHours?.specialHourPeriods ?? [], pushedBefore, today);
  const firstPush = config.hours_pushed !== true;
  let conflictWeek: GooglePeriod[] | null = null;
  if (!weekChange && firstPush && config.hours_conflict !== true) {
    const googlePeriods = current.regularHours?.periods ?? [];
    const googleWeek = googlePeriods.length ? fromRegularHours(googlePeriods) : null;
    if (googlePeriods.length && (!googleWeek || !sameWeek(googleWeek, site.venue.hours))) conflictWeek = googlePeriods;
  }
  const conflict = !weekChange && (config.hours_conflict === true || conflictWeek !== null);
  const regular = weekChange || (firstPush && !conflict);
  const body: HoursPlan["body"] = { specialHours: { specialHourPeriods: merged.periods } };
  if (regular) body.regularHours = { periods: toRegularPeriods(site.venue.hours) };
  const set: Record<string, unknown> = { last_hours_push_at: now.toISOString(), special_dates_pushed: merged.pushed };
  const remove: string[] = [];
  if (regular) {
    Object.assign(set, { hours_pushed: true, hours_conflict: false });
    remove.push("google_hours");
  } else if (conflictWeek) {
    Object.assign(set, { hours_conflict: true, google_hours: conflictWeek });
  }
  return { mask: regular ? "regularHours,specialHours" : "specialHours", body, regular, conflict, mine, kept: merged.periods.length - mine.length, set, remove };
}

async function pushHours(ctx: PushContext, hoursRows: Change[]): Promise<PushResult> {
  const config = ctx.destination.config;
  const locationName = typeof config.location_name === "string" ? config.location_name : "";
  if (!locationName || !ctx.secrets.refresh_token || !ctx.google) return failure("sm_social_not_connected", "Google is not connected.", false);
  if (!ctx.loadSite) return failure("sm_social_not_connected", "The site could not be loaded.", false);
  const site = await ctx.loadSite();
  if (hasNoHours(site.venue.hours)) return failure("sm_google_no_hours", "The venue has no opening hours.", false);
  try {
    const client = await googleClientFor({ fetch: ctx.fetch, google: ctx.google }, ctx.secrets);
    const current = await getLocation(client, locationName, READ_MASK);
    const plan = planHoursPush(config, site, current, hoursRows.some(isWeekChange), ctx.now);
    await patchLocation(client, locationName, plan.mask, plan.body, { validateOnly: true });
    await patchLocation(client, locationName, plan.mask, plan.body);
    // The write is done: a failed read-back only loses the "Google is reviewing" hint, never the push.
    let reviewing = false;
    try {
      const after = await getLocation(client, locationName, READ_MASK);
      reviewing = after.metadata?.hasGoogleUpdated === true || after.metadata?.hasPendingEdits === true;
    } catch (e) {
      if (!(e instanceof GoogleApiError)) throw e;
    }
    // Only the keys this push owns, onto the destination as it is now (a disconnect or a poll stamp meanwhile is kept).
    await ctx.patchConfig?.(plan.set, plan.remove);
    const result: GoogleHoursResult = {
      hours: { regular: plan.regular, conflict: plan.conflict, special: plan.mine.length, kept: plan.kept, reviewing, long_closure: longestClosedRun(plan.mine) >= LONG_CLOSURE_DAYS },
    };
    const stored = result as unknown as Record<string, unknown>;
    return { ok: true, result: stored, line: lines("done", stored, null) };
  } catch (e) {
    if (e instanceof GoogleApiError) return failure(e.code, e.message, e.retryable);
    throw e;
  }
}

const isReviewReply = (c: Change) => commentNetworkOf(c) === "google";

/** Posts (or, on undo, deletes) the approved review replies; earlier attempts' results are skipped. No location call. */
async function pushReplies(ctx: PushContext): Promise<PushResult> {
  const acc = commentResultIn(ctx.prior ?? []);
  const current = () => ({ ...acc }) as unknown as Record<string, unknown>;
  if (!ctx.secrets.refresh_token || !ctx.google) return failure("sm_social_not_connected", "Google is not connected.", false, current());
  try {
    const client = await googleClientFor({ fetch: ctx.fetch, google: ctx.google }, ctx.secrets);
    await pushCommentChanges(ctx, "google", client, acc, async () => ctx.checkpoint?.(current()));
    const result = current();
    return { ok: true, result, line: lines("done", result, null) };
  } catch (e) {
    if (e instanceof GoogleApiError) return failure(e.code, e.message, e.retryable, current());
    throw e;
  }
}

export const googleAdapter: DestinationAdapter = {
  kind: "google",
  relevant: (changes) => changes.filter((c) => isHoursChange(c) || isReviewReply(c)).sort((a, b) => a.position - b.position),
  async push(ctx) {
    const hoursRows = ctx.changes.filter(isHoursChange);
    if (hoursRows.length) return pushHours(ctx, hoursRows);
    if (ctx.changes.some(isReviewReply)) return pushReplies(ctx);
    return { ok: true, result: {}, line: lines("done", {}, null) };
  },
};
