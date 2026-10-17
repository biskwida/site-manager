// src/server/admin-comments.ts
// The dashboard's "Comments" card: what is waiting and what was answered, and the owner's actions. The owner's key is the
// authority, so "reply" posts at once (a comment set made by createCommentSet and applied immediately, pushed through the
// store hook) and the owners' chats are told. Comment sets are decided only here or in the chat, never in the generic
// pending list (src/server/admin.ts). Never logs comment text or replies.
import { copy } from "../bot/copy";
import { syncLines } from "../destinations/sync";
import { commentModeLabel } from "../domain/comment-preview";
import { baseLang, keep, quote, tr } from "../domain/format";
import { maskRef } from "../channels/ref";
import { COMMENT_MODES, type ChangeSet, type CommentMode, type CommentNetwork, type Lang, type ModerateAction, type Venue } from "../domain/types";
import { cancelCommentSet, commentLimitState, commentsOfSet, createCommentSet, previewLength, reachableOwners, splitCommentItems, type CommentSetDeps, type CommentSetItem } from "../social/comments-propose";
import type { DraftKind } from "../social/comments-draft";
import { COMMENT_RETENTION_MS } from "../social/comments-poll";
import type { CommentStatus, SocialComment, Store } from "../store/types";
import type { AdminDeps } from "./admin";

export interface CommentView {
  id: string;
  network: CommentNetwork;
  author_name: string;
  text: string;
  post_caption: string;
  post_permalink: string | null;
  created_at: string;
  status: CommentStatus;
  draft_text: string | null;
  draft_kind: string | null;
  change_set_id: string | null;
  /** The reply as posted (replied rows only). */
  reply_text: string | null;
  replied_at: string | null;
  /** A proposed comment whose set was approved (or scheduled) and whose push is still on its way (a Meta outage, a retry):
   *  the card shows "being posted" instead of Reply / Ignore, and the actions are refused (a second set would reply twice). */
  posting: boolean;
}
export interface CommentsOverview {
  mode: CommentMode;
  digest_hour: number;
  limit: { used: number; limit: number | null };
  /** A connected network whose connection predates the comment permissions (config.comments !== true): the card asks to connect again. */
  needs_reconnect: { facebook: boolean; instagram: boolean };
  pending: CommentView[];
  answered: CommentView[];
}
const PENDING: CommentStatus[] = ["new", "proposed"];
const ANSWERED: CommentStatus[] = ["replied", "ignored", "expired", "hidden", "deleted"];
const ANSWERED_MAX = 20;
const REPLY_MAX = 500;

function view(c: SocialComment, posting = false): CommentView {
  return {
    id: c.id, network: c.network, author_name: c.author_name, text: c.text, post_caption: c.post_caption, post_permalink: c.post_permalink,
    created_at: c.created_at, status: c.status, draft_text: c.draft_text, draft_kind: c.draft_kind, change_set_id: c.change_set_id,
    reply_text: c.status === "replied" ? c.draft_text : null, replied_at: c.replied_at, posting,
  };
}

/** Never includes secrets: comment rows and the destinations' `comments` flag only. */
export async function commentsOverview(store: Store, venue: Venue, now: Date): Promise<CommentsOverview> {
  // Older rows keep no customer text (purgeOldComments blanks it after 30 days; the row stays for the monthly count).
  const since = new Date(now.getTime() - COMMENT_RETENTION_MS).toISOString();
  const [pending, answered, limit, fb, ig] = await Promise.all([
    store.listComments(venue.id, { status: PENDING, limit: 100, since }),
    store.listComments(venue.id, { status: ANSWERED, limit: ANSWERED_MAX, since }),
    commentLimitState(store, venue, now),
    store.getDestination(venue.id, "facebook"),
    store.getDestination(venue.id, "instagram"),
  ]);
  const stale = (d: typeof fb) => !!d && d.status !== "disconnected" && d.config.comments !== true;
  return {
    mode: venue.comment_mode,
    digest_hour: venue.comment_digest_hour,
    limit: { used: limit.used, limit: limit.limit },
    needs_reconnect: { facebook: stale(fb), instagram: stale(ig) },
    pending: await Promise.all(pending.filter((c) => c.parent_id === null).map(async (c) => view(c, await isPosting(store, c)))),
    answered: answered.map((c) => view(c)),
  };
}

export type AdminCommentAction =
  | { action: "reply_comment"; comment_id: string; reply_text: string }
  | { action: "ignore_comment"; comment_id: string }
  | { action: "set_comment_mode"; mode: CommentMode; digest_hour?: number };

const validHour = (h: unknown): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;

export function parseAdminCommentAction(body: unknown): AdminCommentAction | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.action === "reply_comment" && typeof b.comment_id === "string" && typeof b.reply_text === "string") {
    const text = b.reply_text.trim();
    if (text === "" || Array.from(text).length > REPLY_MAX) return null;
    return { action: "reply_comment", comment_id: b.comment_id, reply_text: text };
  }
  if (b.action === "ignore_comment" && typeof b.comment_id === "string") return { action: "ignore_comment", comment_id: b.comment_id };
  if (b.action === "set_comment_mode" && typeof b.mode === "string" && (COMMENT_MODES as readonly string[]).includes(b.mode)) {
    const h = b.digest_hour;
    if (h !== undefined && !validHour(h)) return null;
    return { action: "set_comment_mode", mode: b.mode as CommentMode, ...(h !== undefined ? { digest_hour: h } : {}) };
  }
  return null;
}

/** The comment's own set while it still waits for the owners' buttons. */
async function pendingSetOf(store: Store, c: SocialComment): Promise<ChangeSet | null> {
  if (!c.change_set_id) return null;
  const cs = await store.getChangeSet(c.change_set_id).catch(() => null);
  return cs && cs.source === "comment" && cs.status === "proposed" ? cs : null;
}

/**
 * True while a proposed comment's set is decided but its reply or moderation has not gone out yet: the set is scheduled, or
 * applied with a destination push still pending (retrying after a Meta outage or an unknown outcome). The comment stays
 * `proposed` until the push reports, so without this check the dashboard would make a second set and reply twice. A push
 * that gave up for good (failed) or finished leaves nothing in flight, and the comment may be answered again.
 */
async function isPosting(store: Store, c: SocialComment): Promise<boolean> {
  if (c.status !== "proposed" || !c.change_set_id) return false;
  const cs = await store.getChangeSet(c.change_set_id).catch(() => null);
  if (!cs || cs.source !== "comment") return false;
  if (cs.status === "scheduled") return true;
  if (cs.status !== "applied") return false;
  return (await store.listSyncs({ changeSetId: cs.id })).some((s) => s.status === "pending");
}

/** Why an action was refused: the card shows "limit" and "decided" in words, everything else as the generic failure line. */
export type AdminCommentErrorCode = "not_found" | "answered" | "state" | "limit" | "decided" | "invalid" | "failed";
type Result = { ok: boolean; status?: string; change_set_id?: string; error?: string; code?: AdminCommentErrorCode };
const DECIDED_MEANWHILE: Result = { ok: false, code: "decided", error: "The proposal in the chat was decided meanwhile." };
const BEING_POSTED: Result = { ok: false, code: "decided", error: "The approved reply is being posted; it shows as answered once it is out." };

/** Sends each reachable owner its line; one failed send never stops the others or costs the dashboard's answer. */
async function tellOwners(d: AdminDeps, venueId: string, now: Date, text: (lang: Lang) => Promise<string> | string): Promise<void> {
  const { reachable } = await reachableOwners(d.store, venueId, now);
  for (const m of reachable) {
    try {
      await d.messenger.send(m.chat_ref, await text(baseLang(m.lang)), { proactive: true });
    } catch (e) {
      console.error(`[comments] dashboard notice to ${maskRef(m.chat_ref)} failed:`, e instanceof Error ? e.name : "error");
    }
  }
}

/** Notification mode: the venue fields at once (choosing how to hear about comments is not a site change), owners told. */
async function setCommentMode(d: AdminDeps, venue: Venue, a: Extract<AdminCommentAction, { action: "set_comment_mode" }>): Promise<Result> {
  if (a.digest_hour !== undefined && !validHour(a.digest_hour)) return { ok: false, code: "invalid", error: "digest_hour must be a whole hour 0–23." };
  // A second click on the active mode (and hour) changes nothing and tells nobody.
  if (a.mode === venue.comment_mode && (a.digest_hour === undefined || a.digest_hour === venue.comment_digest_hour)) return { ok: true, status: "unchanged" };
  let updated: Venue;
  try {
    updated = await d.store.updateVenue(venue.id, { comment_mode: a.mode, ...(a.digest_hour !== undefined ? { comment_digest_hour: a.digest_hour } : {}) });
  } catch {
    return { ok: false, code: "failed", error: "The notification mode could not be saved." };
  }
  await tellOwners(d, venue.id, d.now(), (lang) => `${copy(lang).commentModeSummary(commentModeLabel(updated.comment_mode, updated.comment_digest_hour, lang))}\n\n${tr(lang, "✅ Приложено от таблото.", "✅ Applied from the dashboard.")}`);
  return { ok: true, status: "applied" };
}

/** What a pending set proposed for each of its comments but `exceptId` (reply text or moderation), read before the cancel frees them. */
async function restOf(store: Store, cs: ChangeSet, exceptId: string): Promise<CommentSetItem[]> {
  const position = (x: SocialComment) => cs.changes.findIndex((c) => c.entity_id === x.comment_id);
  // In the set's own order (commentsOfSet is newest first).
  const others = (await commentsOfSet(store, cs)).filter((x) => x.id !== exceptId && x.status === "proposed").sort((a, b) => position(a) - position(b));
  return others.map((x) => {
    const ch = cs.changes.find((c) => c.entity_id === x.comment_id);
    const row = (ch?.after ?? {}) as Record<string, unknown>;
    const moderate = ch?.op === "social_moderate" && (row.action === "hide" || row.action === "delete") ? (row.action as ModerateAction) : null;
    const reply = moderate ? null : typeof row.reply_text === "string" ? row.reply_text : (x.draft_text ?? "");
    return { comment: x, reply_text: reply, moderate, ...(x.draft_kind ? { kind: x.draft_kind as DraftKind } : {}) };
  });
}

/**
 * Takes one comment out of its pending set: cancels the set with an accurate line for every owner's message and returns the
 * set's other comments to propose again at once (empty when there are none or `room` is false: the comment limit leaves no
 * room, so they wait in the dashboard as new). Null when the set was decided meanwhile (nothing changed).
 */
async function releaseFromSet(cd: CommentSetDeps, cs: ChangeSet, c: SocialComment, decision: "reply" | "ignore", room: boolean): Promise<CommentSetItem[] | null> {
  const rest = await restOf(cd.store, cs, c.id);
  const restMode = rest.length === 0 ? "none" : room ? "again" : "waiting";
  const line = { bg: copy("bg").dashboardCommentDecided(decision, restMode), en: copy("en").dashboardCommentDecided(decision, restMode) };
  if (!(await cancelCommentSet(cd, cs, line))) return null;
  return restMode === "again" ? rest : [];
}

/** The rest of a batch as a new proposal to every reachable owner (createCommentSet handles the limit and unreachable owners),
 *  split like any batch (splitCommentItems) so an old, larger set never becomes a message Telegram refuses. */
async function proposeRest(cd: CommentSetDeps, venue: Venue, rest: CommentSetItem[]): Promise<void> {
  if (rest.length === 0) return;
  try {
    const site = await cd.store.getSite(venue.id);
    for (const g of splitCommentItems(rest, { batch: false, extra: previewLength(site, venue.tz) })) await createCommentSet(cd, venue, g, { batch: g.length > 1 });
  } catch (e) {
    console.error(`[comments] venue ${venue.id}: re-proposing ${rest.length} comment(s) failed:`, e instanceof Error ? e.name : "error");
  }
}

export async function adminCommentAction(d: AdminDeps, venue: Venue, a: AdminCommentAction): Promise<Result> {
  if (a.action === "set_comment_mode") return setCommentMode(d, venue, a);
  const cd: CommentSetDeps = { store: d.store, messenger: d.messenger, now: d.now };
  const c = await d.store.getComment(a.comment_id);
  if (!c || c.venue_id !== venue.id) return { ok: false, code: "not_found", error: "Comment not found." };
  const now = d.now();
  const limit = await commentLimitState(d.store, venue, now);

  if (a.action === "ignore_comment") {
    if (c.status === "ignored") return { ok: true, status: "ignored" };
    if (c.status !== "new" && c.status !== "proposed" && c.status !== "expired") return { ok: false, code: "state", error: `Comment is "${c.status}".` };
    const pending = await pendingSetOf(d.store, c);
    if (!pending && (await isPosting(d.store, c))) return BEING_POSTED;
    let rest: CommentSetItem[] = [];
    if (pending) {
      const r = await releaseFromSet(cd, pending, c, "ignore", !limit.reached);
      if (r === null) return DECIDED_MEANWHILE;
      rest = r;
    }
    await d.store.updateComment(c.id, { status: "ignored", change_set_id: null, deferred: false });
    await proposeRest(cd, venue, rest);
    return { ok: true, status: "ignored" };
  }

  if (c.status === "replied") return { ok: false, code: "answered", error: "Comment already answered." };
  if (c.status === "own" || c.status === "nested" || c.status === "deleted") return { ok: false, code: "state", error: `Comment is "${c.status}".` };
  if (limit.reached) return { ok: false, code: "limit", error: copy("en").commentLimitReached(limit.limit ?? limit.used, limit.used, limit.resets_on) };
  const pending = await pendingSetOf(d.store, c);
  if (!pending && (await isPosting(d.store, c))) return BEING_POSTED;
  let rest: CommentSetItem[] = [];
  if (pending) {
    // This reply takes one action of the limit: the rest is proposed again only when room is left after it.
    const r = await releaseFromSet(cd, pending, c, "reply", limit.limit === null || limit.used + 1 < limit.limit);
    if (r === null) return DECIDED_MEANWHILE;
    rest = r;
  }
  try {
    const fresh = (await d.store.getComment(c.id)) ?? c;
    const item: CommentSetItem = { comment: fresh, reply_text: a.reply_text, moderate: null, ...(fresh.draft_kind ? { kind: fresh.draft_kind as DraftKind } : {}) };
    const made = await createCommentSet(cd, venue, [item], { silent: true });
    if (!made.set) return made.limited ? { ok: false, code: "limit", error: "Comment limit reached." } : { ok: false, code: "failed", error: "Could not create the reply." };
    const r = await d.store.applyChangeSet(made.set.id, now.toISOString());
    if (r !== "applied") {
      // Refused at apply time (the comment limit, a race): the comment is free again for the next try.
      await d.store.updateComment(c.id, { status: "new", change_set_id: null });
      return { ok: false, status: r, change_set_id: made.set.id, ...(r === "limited" ? { code: "limit", error: "Comment limit reached." } : { code: "failed", error: `Change set is "${r}".` }) };
    }
    // Like the other dashboard decisions, the owners' chats hear about it (Meta channels within the window).
    const setId = made.set.id;
    await tellOwners(d, venue.id, now, async (lang) => {
      // The customer's name and the reply as published stay as written in any language (kept).
      const who = keep(c.author_name) || tr(lang, "клиент", "a customer");
      const head = tr(lang, `✅ Отговорено от таблото на ${who}: ${quote(keep(a.reply_text), "bg")}`, `✅ Answered from the dashboard to ${who}: ${quote(keep(a.reply_text), "en")}`);
      return [head, ...(await syncLines(d.store, setId, lang))].join("\n");
    });
    return { ok: true, status: "applied", change_set_id: setId };
  } finally {
    // The rest of a batch goes out again after the owners heard about this reply, whatever its outcome.
    await proposeRest(cd, venue, rest);
  }
}
