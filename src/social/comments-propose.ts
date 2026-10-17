// src/social/comments-propose.ts
// Turns customer comments into change sets with source "comment": one social_reply or social_moderate row per comment, sent
// with the ✅/✏️/❌ buttons to every owner of the venue (the first tap wins, src/bot/approvals.ts). Telegram owners always get
// the buttons; an owner on a Meta channel only inside the 23-hour window since their last message. When no owner can be
// reached the comments are held (deferred, status stays new) for the next tick; after HOLD_MAX_ATTEMPTS sends that reached
// nobody (the bot blocked) a comment waits until an owner writes. A set holds at most COMMENT_SET_MAX_ROWS comments and stays
// under Telegram's message size (splitCommentItems); a larger batch becomes several sets. A comment set never counts toward the monthly
// change limit; the venue's comment_limit caps replies and moderations instead (here and at apply time, src/store/usage.ts).
// Never logs comment text or drafts: log lines carry ids and counts only.
import { CHANNEL_NAMES } from "../bot/members";
import { copy } from "../bot/copy";
import type { Messenger } from "../bot/messenger";
import { channelOf, isMetaChannel, maskRef } from "../channels/ref";
import { PROACTIVE_WINDOW_MS } from "../channels/router";
import { excerpt } from "../domain/comment-preview";
import { baseLang, keep, quote, tr } from "../domain/format";
import { renderPreview } from "../domain/preview";
import { NETWORK_NAMES, type Change, type ChangeSet, type ChangeSource, type Lang, type Member, type ModerateAction, type SocialModerateRow, type SocialReplyRow, type Venue } from "../domain/types";
import type { CommentStatus, SocialComment, Store } from "../store/types";
import { commentUsage, type CommentUsage } from "../store/usage";
import { draftContextOf, type DraftFn, type DraftKind } from "./comments-draft";

const HOUR = 3_600_000;
/** At most this many comments in one set; a larger batch (the digest, held comments) is split into further sets. */
export const COMMENT_SET_MAX_ROWS = 10;
/** The proposal message and the set's preview stay under this (Telegram refuses a message over 4096 characters). */
const MESSAGE_BUDGET = 3800;
/** A comment in a batch line is cut to this many characters (the dashboard shows it in full). */
const BATCH_COMMENT_MAX = 200;
/** A single comment's text in its own proposal is cut to this (a Facebook comment can be 8000 characters). */
const SINGLE_COMMENT_MAX = 1500;
/** After this many proposal sends in a row that reached no owner, the comment waits (new) until an owner writes. */
export const HOLD_MAX_ATTEMPTS = 5;
/** A comment proposal waits a day for the owners (spec); every other proposal keeps the 2 hours of src/tick.ts. */
export const COMMENT_PROPOSAL_TTL_MS = 24 * HOUR;
const DEFAULT_TTL_MS = 2 * HOUR;
export function proposalTtlMs(source: ChangeSource): number {
  return source === "comment" ? COMMENT_PROPOSAL_TTL_MS : DEFAULT_TTL_MS;
}
export function proposalTtlHours(source: ChangeSource): number {
  return proposalTtlMs(source) / HOUR;
}

export interface ProposeDeps {
  store: Store;
  messenger: Messenger;
  now: () => Date;
  draft: DraftFn;
  log?: (s: string) => void;
}
/** Exactly one of reply_text / moderate is set. */
export interface CommentSetItem {
  comment: SocialComment;
  reply_text: string | null;
  moderate: ModerateAction | null;
  kind?: DraftKind;
}
/** What createCommentSet and cancelCommentSet need: no drafting. */
export type CommentSetDeps = Pick<ProposeDeps, "store" | "messenger" | "now" | "log">;
export interface CommentSetResult {
  set: ChangeSet | null;
  /** Chat refs that got the buttons. */
  sent: string[];
  /** True when no owner could be reached: the comments are held (deferred) for the next tick. */
  deferred: boolean;
  /** True when the venue's comment_limit is reached: nothing was created. */
  limited: boolean;
}
/** The venue's comment actions this calendar month against comment_limit (src/store/usage.ts). */
export type CommentLimitState = CommentUsage;

const log = (d: Pick<ProposeDeps, "log">, s: string) => (d.log ?? ((x: string) => console.log(x)))(s);

export function commentChanges(items: CommentSetItem[]): Change[] {
  return items.map((it, position): Change => {
    const c = it.comment;
    if (it.moderate) {
      const row: SocialModerateRow = { network: c.network, comment_id: c.comment_id, author_name: c.author_name, comment_text: c.text, action: it.moderate };
      return { position, op: "social_moderate", entity: "social_moderate", entity_id: c.comment_id, before: null, after: row as unknown as Change["after"] };
    }
    // permalink is stored as null when Meta gave none (the row keeps a fixed shape for the adapter and the dashboard).
    const row: Omit<SocialReplyRow, "permalink"> & { permalink: string | null } = { network: c.network, comment_id: c.comment_id, post_ref: c.post_ref, author_name: c.author_name, comment_text: c.text, reply_text: it.reply_text ?? "", permalink: c.post_permalink };
    return { position, op: "social_reply", entity: "social_reply", entity_id: c.comment_id, before: null, after: row as unknown as Change["after"] };
  });
}

// In the proposal text the customer's name and words, the post's caption and the drafted reply stay as written in any language
// (kept, src/bot/translate.ts); so does the name in the set's summaries (commentSetSummary), which every reader strips.
const author = (c: SocialComment, lang: Lang) => keep(c.author_name) || tr(lang, "клиент", "a customer");
const captionOf = (c: SocialComment, lang: Lang) => (c.post_caption.trim() ? keep(excerpt(c.post_caption)) : tr(lang, "(без текст)", "(no caption)"));
const networkName = (c: SocialComment) => NETWORK_NAMES[c.network] ?? c.network;

/** Keeps the lines (unlike excerpt), cut to `max` characters. */
function clip(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text.trim();
}

function bgCount(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** The message with the buttons: one comment with its draft, one moderation, or a numbered batch. */
export function commentProposalText(items: CommentSetItem[], lang: Lang, o: { batch?: boolean } = {}): string {
  const bg = lang === "bg";
  if (!o.batch && items.length === 1) {
    const it = items[0];
    const c = it.comment;
    const where = bg
      ? `под поста ${quote(captionOf(c, lang), lang)} (${networkName(c)}) от ${author(c, lang)}: ${quote(keep(clip(c.text, SINGLE_COMMENT_MAX)), lang)}`
      : `under the post ${quote(captionOf(c, lang), lang)} (${networkName(c)}) by ${author(c, lang)}: ${quote(keep(clip(c.text, SINGLE_COMMENT_MAX)), lang)}`;
    if (it.moderate) {
      const why = bg ? "Този коментар изглежда спам или обиден." : "This comment looks like spam or abuse.";
      const what = it.moderate === "delete"
        ? (bg ? "Предлагам да го изтрием (не може да се отмени).\n\nДа го изтрия ли?" : "I suggest deleting it (this cannot be undone).\n\nDelete it?")
        : (bg ? "Предлагам да го скрием.\n\nДа го скрия ли?" : "I suggest hiding it.\n\nHide it?");
      return `⚠️ ${bg ? "Коментар" : "Comment"} ${where}\n\n${why} ${what}`;
    }
    return `💬 ${bg ? "Нов коментар" : "New comment"} ${where}\n\n${bg ? "Предложен отговор" : "Suggested reply"}:\n${quote(keep(it.reply_text ?? ""), lang)}\n\n${bg ? "Да отговоря ли?" : "Reply?"}`;
  }
  const posts = new Set(items.map((it) => it.comment.post_ref)).size;
  const head = bg
    ? `💬 ${bgCount(items.length, "нов коментар", "нови коментара")} под ${bgCount(posts, "пост", "поста")}`
    : `💬 ${items.length} new ${items.length === 1 ? "comment" : "comments"} under ${posts} ${posts === 1 ? "post" : "posts"}`;
  const lines = items.flatMap((it, i) => {
    const c = it.comment;
    const first = `${i + 1}. ${author(c, lang)} (${networkName(c)}) ${bg ? "под" : "under"} ${quote(captionOf(c, lang), lang)}: ${quote(keep(excerpt(c.text, BATCH_COMMENT_MAX)), lang)}`;
    const second = it.moderate
      ? `   → ${it.moderate === "delete" ? tr(lang, "изтриване (спам или обиден)", "deletion (spam or abuse)") : tr(lang, "скриване (спам или обиден)", "hiding (spam or abuse)")}`
      : `   → ${quote(keep(it.reply_text ?? ""), lang)}`;
    return [first, second];
  });
  const foot = bg ? "✅ отговаря на всички · ✏️ кажете кое да променя · ❌ отказва всички" : "✅ replies to all · ✏️ tell me which to change · ❌ cancels all";
  return [head, "", ...lines, "", foot].join("\n");
}

export function commentSetSummary(items: CommentSetItem[]): { summary_bg: string; summary_en: string } {
  if (items.length === 1) {
    const it = items[0];
    // Kept: the dashboard's undo line (src/server/admin.ts) sends a summary to the chat.
    const name = keep(it.comment.author_name) || "клиент";
    const nameEn = keep(it.comment.author_name) || "a customer";
    if (it.moderate === "delete") return { summary_bg: `Изтриване на коментар от ${name}`, summary_en: `Delete a comment by ${nameEn}` };
    if (it.moderate) return { summary_bg: `Скриване на коментар от ${name}`, summary_en: `Hide a comment by ${nameEn}` };
    return { summary_bg: `Отговор на коментар от ${name}`, summary_en: `Reply to ${nameEn}'s comment` };
  }
  return { summary_bg: `Отговори на ${bgCount(items.length, "коментар", "коментара")}`, summary_en: `Replies to ${items.length} comments` };
}

/**
 * Splits items into proposal-sized groups, in order: at most COMMENT_SET_MAX_ROWS each, and only as many as keep the proposal
 * text (both languages) and `extra` (the set's preview) under MESSAGE_BUDGET. A single item always makes a group of its own.
 */
export function splitCommentItems(items: CommentSetItem[], o: { batch: boolean; extra?: (group: CommentSetItem[]) => number }): CommentSetItem[][] {
  const fits = (g: CommentSetItem[]) => {
    const batch = o.batch || g.length > 1;
    const text = Math.max(commentProposalText(g, "bg", { batch }).length, commentProposalText(g, "en", { batch }).length);
    return text <= MESSAGE_BUDGET && (o.extra?.(g) ?? 0) <= MESSAGE_BUDGET;
  };
  const groups: CommentSetItem[][] = [];
  let cur: CommentSetItem[] = [];
  for (const it of items) {
    const next = [...cur, it];
    if (cur.length > 0 && (next.length > COMMENT_SET_MAX_ROWS || !fits(next))) {
      groups.push(cur);
      cur = [it];
    } else cur = next;
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

/** The longer of a group's two previews (renderPreview), for splitCommentItems. */
export function previewLength(site: Parameters<typeof renderPreview>[0], tz: string): (group: CommentSetItem[]) => number {
  return (g) => {
    const changes = commentChanges(g);
    return Math.max(renderPreview(site, changes, "bg", tz).length, renderPreview(site, changes, "en", tz).length);
  };
}

/** The venue's comment actions this calendar month (in its zone) against comment_limit (null = unlimited). */
export const commentLimitState = commentUsage;

/** Owners who may be messaged now: every Telegram owner; a Meta-channel owner only within 23 h of their last message. */
export async function reachableOwners(store: Pick<Store, "listMembers">, venueId: string, now: Date): Promise<{ reachable: Member[]; deferred: Member[] }> {
  const owners = (await store.listMembers(venueId)).filter((m) => m.role === "owner");
  const ok = (m: Member) => !isMetaChannel(channelOf(m.chat_ref)) || (m.last_seen_at !== null && now.getTime() - Date.parse(m.last_seen_at) <= PROACTIVE_WINDOW_MS);
  return { reachable: owners.filter(ok), deferred: owners.filter((m) => !ok(m)) };
}

/** The comments a set was made for (by change_set_id). */
export async function commentsOfSet(store: Pick<Store, "listComments">, cs: Pick<ChangeSet, "id" | "venue_id">): Promise<SocialComment[]> {
  return store.listComments(cs.venue_id, { changeSetId: cs.id, limit: 500 });
}

/** Every owner chat that got this set's buttons, with its message ref (falls back to the primary chat for an old set). */
export function proposalTargets(cs: Pick<ChangeSet, "proposal_refs" | "chat_ref" | "message_ref">): [string, string | null][] {
  if (cs.proposal_refs) return Object.entries(cs.proposal_refs);
  return cs.chat_ref !== null ? [[cs.chat_ref, cs.message_ref]] : [];
}

/**
 * Concludes every owner's proposal message of a comment set but `except` (the chat that decided; its own message is concluded
 * by the caller): Telegram loses the buttons, Meta channels get `line` as a new message inside the window. Best-effort and
 * never throws (like the router): it runs after the decision is stored, so a failure must not cost the tapper's own answer.
 */
export async function concludeCommentOwners(d: Pick<CommentSetDeps, "store" | "messenger">, cs: ChangeSet, line: (lang: Lang) => string, o: { except?: string } = {}): Promise<void> {
  let failed = 0;
  for (const [chatRef, messageRef] of proposalTargets(cs)) {
    if (chatRef === o.except) continue;
    try {
      const lang = baseLang((await d.store.findMember(chatRef))?.lang ?? "bg");
      const l = line(lang);
      await d.messenger.conclude(chatRef, messageRef, `${lang === "bg" ? cs.preview_bg : cs.preview_en}\n\n${l}`, l, { proactive: true });
    } catch (e) {
      failed++;
      console.error(`[comments] conclude ${maskRef(chatRef)} for set ${cs.id} failed:`, e instanceof Error ? e.name : "error");
    }
  }
  if (failed > 0) console.error(`[comments] set ${cs.id}: ${failed} owner message(s) not concluded`);
}

/**
 * One change set for the items, sent to every reachable owner (`o.chatRef`, when given and reachable, becomes the primary
 * chat: the owner who asked). Returns without a set when the comment limit is reached or no owner can be reached (then the
 * comments are marked deferred and stay `new`). `o.silent` (the dashboard) sends no message: the caller applies the set itself.
 */
export async function createCommentSet(d: CommentSetDeps, venue: Venue, items: CommentSetItem[], o: { chatRef?: string | null; batch?: boolean; silent?: boolean } = {}): Promise<CommentSetResult> {
  const now = d.now();
  if ((await commentLimitState(d.store, venue, now)).reached) return { set: null, sent: [], deferred: false, limited: true };
  const reachable = o.silent ? [] : (await reachableOwners(d.store, venue.id, now)).reachable;
  /**
   * Nobody has the buttons: the comments stay `new`, keep their drafts and are retried by the next tick. `failedSend` (a send
   * was tried and reached nobody) counts toward HOLD_MAX_ATTEMPTS; "no owner reachable" costs nothing and is not counted.
   */
  const hold = async (why: string, failedSend: boolean): Promise<CommentSetResult> => {
    const nowIso = d.now().toISOString();
    for (const it of items) {
      const attempts = failedSend ? ((await d.store.getComment(it.comment.id))?.hold_attempts ?? it.comment.hold_attempts ?? 0) + 1 : undefined;
      await d.store.updateComment(it.comment.id, { status: "new", change_set_id: null, deferred: true, draft_text: it.reply_text, draft_kind: it.kind ?? it.comment.draft_kind ?? null, ...(failedSend ? { hold_attempts: attempts, held_at: nowIso } : {}) });
    }
    log(d, `[comments] venue ${venue.id}: ${why}, ${items.length} comment(s) held`);
    return { set: null, sent: [], deferred: true, limited: false };
  };
  if (!o.silent && reachable.length === 0) return hold("no owner reachable", false);
  const primary = reachable.find((m) => m.chat_ref === o.chatRef) ?? reachable[0] ?? null;
  const ordered = primary ? [primary, ...reachable.filter((m) => m !== primary)] : [];
  const changes = commentChanges(items);
  const site = await d.store.getSite(venue.id);
  const cs = await d.store.createChangeSet({
    venue_id: venue.id, chat_ref: primary?.chat_ref ?? null, ...commentSetSummary(items),
    preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz),
    source: "comment", status: "proposed", changes,
  });
  const refs: Record<string, string> = {};
  for (const m of ordered) {
    const lang = baseLang(m.lang);
    const ref = await d.messenger.sendProposal(m.chat_ref, commentProposalText(items, lang, { batch: o.batch }), cs.id, lang);
    if (ref !== null) refs[m.chat_ref] = ref;
  }
  if (!o.silent && Object.keys(refs).length === 0) {
    // Every send failed (outage, bot blocked): a set nobody can tap would expire unseen and lose the comments.
    await d.store.cancelChangeSet(cs.id, d.now().toISOString());
    return hold(`set ${cs.id} reached no owner and was cancelled`, true);
  }
  await d.store.updateChangeSet(cs.id, { message_ref: primary ? refs[primary.chat_ref] ?? null : null, proposal_refs: refs });
  for (const it of items) await d.store.updateComment(it.comment.id, { status: "proposed", change_set_id: cs.id, draft_text: it.reply_text, draft_kind: it.kind ?? it.comment.draft_kind ?? null, deferred: false, hold_attempts: 0, held_at: null });
  log(d, `[comments] set ${cs.id} for venue ${venue.id}: ${items.length} row(s), sent to ${Object.keys(refs).length} owner(s)`);
  return { set: await d.store.getChangeSet(cs.id), sent: Object.keys(refs), deferred: false, limited: false };
}

/**
 * Drafts a reply for every new top-level comment (a stored draft is reused: a held comment is not drafted twice) and proposes.
 * `batch` makes batch sets for all (the digest, "answer the unanswered comments"), split by splitCommentItems. `each` makes one
 * set per comment, except that comments held earlier (deferred) that become sendable together go out as batch sets (a single
 * held one as its own set). Comments that gave up after HOLD_MAX_ATTEMPTS failed sends are skipped until an owner writes.
 * Spam or abuse becomes a hide proposal (by the draft's kind, never by an empty reply). When the comment limit is reached a
 * batch tells the reachable owners once; `each` only logs.
 */
export async function proposeForComments(d: ProposeDeps, venue: Venue, comments: SocialComment[], o: { mode: "each" | "batch" }): Promise<{ sets: ChangeSet[]; deferred: number; limited: boolean }> {
  const candidates = comments.filter((c) => c.status === "new" && c.parent_id === null);
  if (candidates.length === 0) return { sets: [], deferred: 0, limited: false };
  // A comment whose proposal reached nobody HOLD_MAX_ATTEMPTS times waits until an owner writes (a message after the last
  // failed send) or the dashboard decides it: no more sets nobody can tap, tick after tick.
  const gaveUp = candidates.filter((c) => (c.hold_attempts ?? 0) >= HOLD_MAX_ATTEMPTS);
  let fresh = candidates;
  if (gaveUp.length > 0) {
    const seen = (await d.store.listMembers(venue.id)).filter((m) => m.role === "owner" && m.last_seen_at !== null).map((m) => Date.parse(m.last_seen_at as string));
    const waiting = new Set(gaveUp.filter((c) => !seen.some((t) => c.held_at !== null && t > Date.parse(c.held_at))).map((c) => c.id));
    if (waiting.size > 0) {
      log(d, `[comments] venue ${venue.id}: ${waiting.size} comment(s) not proposed after ${HOLD_MAX_ATTEMPTS} failed sends; waiting for an owner's message`);
      fresh = candidates.filter((c) => !waiting.has(c.id));
    }
  }
  if (fresh.length === 0) return { sets: [], deferred: 0, limited: false };
  const now = d.now();
  const limit = await commentLimitState(d.store, venue, now);
  if (limit.reached) {
    if (o.mode === "batch") {
      const { reachable } = await reachableOwners(d.store, venue.id, now);
      for (const m of reachable) await d.messenger.send(m.chat_ref, copy(baseLang(m.lang)).commentLimitReached(limit.limit ?? limit.used, limit.used, limit.resets_on), { proactive: true });
    }
    log(d, `[comments] venue ${venue.id}: comment limit reached (${limit.used}/${limit.limit}), ${fresh.length} comment(s) not proposed`);
    return { sets: [], deferred: 0, limited: true };
  }
  const site = await d.store.getSite(venue.id);
  const items: CommentSetItem[] = [];
  for (const c of fresh) {
    let kind = (c.draft_kind ?? null) as DraftKind | null;
    let reply = c.draft_text;
    if (kind === null) {
      const r = await d.draft(draftContextOf(site, { author_name: c.author_name, text: c.text, post_caption: c.post_caption }));
      kind = r.kind;
      reply = r.reply;
      await d.store.updateComment(c.id, { draft_text: kind === "spam" || kind === "abuse" ? null : reply, draft_kind: kind });
    }
    const moderate = kind === "spam" || kind === "abuse";
    items.push({ comment: c, reply_text: moderate ? null : reply ?? "", moderate: moderate ? "hide" : null, kind });
  }
  const groups: { items: CommentSetItem[]; batch: boolean }[] = [];
  const extra = previewLength(site, venue.tz);
  if (o.mode === "batch") for (const g of splitCommentItems(items, { batch: true, extra })) groups.push({ items: g, batch: true });
  else {
    for (const it of items.filter((x) => !x.comment.deferred)) groups.push({ items: [it], batch: false });
    const held = items.filter((x) => x.comment.deferred);
    for (const g of splitCommentItems(held, { batch: false, extra })) groups.push({ items: g, batch: g.length > 1 });
  }
  const sets: ChangeSet[] = [];
  let deferred = 0;
  let limited = false;
  for (const g of groups) {
    const r = await createCommentSet(d, venue, g.items, { batch: g.batch });
    if (r.set) sets.push(r.set);
    if (r.deferred) deferred += g.items.length;
    if (r.limited) limited = true;
  }
  return { sets, deferred, limited };
}

/**
 * Cancels a comment set only if it is still proposed (a ✅ that won the race keeps it applied), concludes every owner's
 * proposal message but `except`, and puts its comments back to `status` (default new). Returns false, changing nothing,
 * when the set was already decided.
 */
export async function cancelCommentSet(d: CommentSetDeps, cs: ChangeSet, mark: { bg: string; en: string }, o: { except?: string; status?: CommentStatus } = {}): Promise<boolean> {
  if ((await d.store.cancelChangeSet(cs.id, d.now().toISOString())) !== "cancelled") return false;
  await concludeCommentOwners(d, cs, (lang) => (lang === "bg" ? mark.bg : mark.en), { except: o.except });
  for (const c of await commentsOfSet(d.store, cs)) await d.store.updateComment(c.id, { status: o.status ?? "new", change_set_id: null, deferred: false });
  return true;
}

/** For src/bot/approvals.ts: the line other owners see once one of them decided. */
export function decidedLine(lang: Lang, decision: "apply" | "cancel", byChatRef: string): string {
  return copy(lang).decidedByOther(decision, CHANNEL_NAMES[channelOf(byChatRef)]);
}
