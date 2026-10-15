// src/server/admin-comments.ts
// The dashboard's "Comments" card: what is waiting and what was answered, and the owner's actions. The owner's key is the
// authority, so "reply" posts at once (a comment set made by createCommentSet and applied immediately, pushed through the
// store hook) and the owners' chats are told. Comment sets are decided only here or in the chat, never in the generic
// pending list (src/server/admin.ts). Never logs comment text or replies.
import { copy } from "../bot/copy";
import { syncLines } from "../destinations/sync";
import { commentModeLabel } from "../domain/comment-preview";
import { quote, tr } from "../domain/format";
import { COMMENT_MODES, type ChangeSet, type CommentMode, type CommentNetwork, type Venue } from "../domain/types";
import { cancelCommentSet, commentLimitState, createCommentSet, reachableOwners, type CommentSetDeps, type CommentSetItem } from "../social/comments-propose";
import type { DraftKind } from "../social/comments-draft";
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

function view(c: SocialComment): CommentView {
  return {
    id: c.id, network: c.network, author_name: c.author_name, text: c.text, post_caption: c.post_caption, post_permalink: c.post_permalink,
    created_at: c.created_at, status: c.status, draft_text: c.draft_text, draft_kind: c.draft_kind, change_set_id: c.change_set_id,
    reply_text: c.status === "replied" ? c.draft_text : null, replied_at: c.replied_at,
  };
}

/** Never includes secrets: comment rows and the destinations' `comments` flag only. */
export async function commentsOverview(store: Store, venue: Venue, now: Date): Promise<CommentsOverview> {
  const [pending, answered, limit, fb, ig] = await Promise.all([
    store.listComments(venue.id, { status: PENDING, limit: 100 }),
    store.listComments(venue.id, { status: ANSWERED, limit: ANSWERED_MAX }),
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
    pending: pending.filter((c) => c.parent_id === null).map(view),
    answered: answered.map(view),
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

type Result = { ok: boolean; status?: string; change_set_id?: string; error?: string };
const DECIDED_MEANWHILE = "The proposal in the chat was decided meanwhile.";

/** Notification mode: the venue fields at once (choosing how to hear about comments is not a site change), owners told. */
async function setCommentMode(d: AdminDeps, venue: Venue, a: Extract<AdminCommentAction, { action: "set_comment_mode" }>): Promise<Result> {
  if (a.digest_hour !== undefined && !validHour(a.digest_hour)) return { ok: false, error: "digest_hour must be a whole hour 0–23." };
  let updated: Venue;
  try {
    updated = await d.store.updateVenue(venue.id, { comment_mode: a.mode, ...(a.digest_hour !== undefined ? { comment_digest_hour: a.digest_hour } : {}) });
  } catch {
    return { ok: false, error: "The notification mode could not be saved." };
  }
  const { reachable } = await reachableOwners(d.store, venue.id, d.now());
  for (const m of reachable) {
    const summary = copy(m.lang).commentModeSummary(commentModeLabel(updated.comment_mode, updated.comment_digest_hour, m.lang));
    await d.messenger.send(m.chat_ref, `${summary}\n\n${tr(m.lang, "✅ Приложено от таблото.", "✅ Applied from the dashboard.")}`, { proactive: true });
  }
  return { ok: true, status: "applied" };
}

export async function adminCommentAction(d: AdminDeps, venue: Venue, a: AdminCommentAction): Promise<Result> {
  if (a.action === "set_comment_mode") return setCommentMode(d, venue, a);
  const cd: CommentSetDeps = { store: d.store, messenger: d.messenger, now: d.now };
  const c = await d.store.getComment(a.comment_id);
  if (!c || c.venue_id !== venue.id) return { ok: false, error: "Comment not found." };

  if (a.action === "ignore_comment") {
    if (c.status === "ignored") return { ok: true, status: "ignored" };
    if (c.status !== "new" && c.status !== "proposed" && c.status !== "expired") return { ok: false, error: `Comment is "${c.status}".` };
    const pending = await pendingSetOf(d.store, c);
    // The whole set is cancelled (a batch puts its other comments back to new); only this comment becomes ignored.
    if (pending && !(await cancelCommentSet(cd, pending, { bg: "❌ Отказано от таблото.", en: "❌ Cancelled from the dashboard." }))) return { ok: false, error: DECIDED_MEANWHILE };
    await d.store.updateComment(c.id, { status: "ignored", change_set_id: null, deferred: false });
    return { ok: true, status: "ignored" };
  }

  if (c.status === "replied") return { ok: false, error: "Comment already answered." };
  if (c.status === "own" || c.status === "nested" || c.status === "deleted") return { ok: false, error: `Comment is "${c.status}".` };
  const now = d.now();
  const limit = await commentLimitState(d.store, venue, now);
  if (limit.reached) return { ok: false, error: copy("en").commentLimitReached(limit.limit ?? limit.used, limit.used, limit.resets_on) };
  const pending = await pendingSetOf(d.store, c);
  if (pending && !(await cancelCommentSet(cd, pending, { bg: "✅ Отговорено от таблото.", en: "✅ Answered from the dashboard." }))) return { ok: false, error: DECIDED_MEANWHILE };
  const fresh = (await d.store.getComment(c.id)) ?? c;
  const item: CommentSetItem = { comment: fresh, reply_text: a.reply_text, moderate: null, ...(fresh.draft_kind ? { kind: fresh.draft_kind as DraftKind } : {}) };
  const made = await createCommentSet(cd, venue, [item], { silent: true });
  if (!made.set) return { ok: false, error: made.limited ? "Comment limit reached." : "Could not create the reply." };
  const r = await d.store.applyChangeSet(made.set.id, now.toISOString());
  if (r !== "applied") {
    // Refused at apply time (the comment limit, a race): the comment is free again for the next try.
    await d.store.updateComment(c.id, { status: "new", change_set_id: null });
    return { ok: false, status: r, change_set_id: made.set.id, error: r === "limited" ? "Comment limit reached." : `Change set is "${r}".` };
  }
  // Like the other dashboard decisions, the owners' chats hear about it (Meta channels within the window).
  const { reachable } = await reachableOwners(d.store, venue.id, now);
  for (const m of reachable) {
    const who = c.author_name || tr(m.lang, "клиент", "a customer");
    const head = tr(m.lang, `✅ Отговорено от таблото на ${who}: ${quote(a.reply_text, "bg")}`, `✅ Answered from the dashboard to ${who}: ${quote(a.reply_text, "en")}`);
    await d.messenger.send(m.chat_ref, [head, ...(await syncLines(d.store, made.set.id, m.lang))].join("\n"), { proactive: true });
  }
  return { ok: true, status: "applied", change_set_id: made.set.id };
}
