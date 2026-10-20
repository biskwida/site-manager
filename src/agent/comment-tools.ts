// src/agent/comment-tools.ts
// Agent tools for customer comments under the venue's Facebook/Instagram posts: how the owner is notified (set_comment_mode),
// what is waiting (list_comments) and replying or moderating (reply_to_comments). Registered only when a network is connected;
// owner only. list_comments first reads Instagram and Facebook right then (AgentDeps.liveComments, src/social/comments-poll.ts), so a
// comment from five minutes ago is not missed; the read is capped and any failure falls back to the saved comments. set_comment_mode is an ordinary proposal through the agent's propose path (source of the turn, ✅/✏️/❌ buttons);
// a set made only of set_comment_mode rows never counts toward the monthly change limit (countsTowardLimit, src/domain/limits.ts).
// reply_to_comments goes through src/social/comments-propose.ts (createCommentSet / cancelCommentSet): one set sent to every
// owner, never blocked by a pending menu proposal and never blocking one. Nothing is posted by the agent itself.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { copy } from "../bot/copy";
import { commentModeLabel } from "../domain/comment-preview";
import { COMMENT_MODES, type ChangeSet, type CommentMode, type CommentNetwork } from "../domain/types";
import { REPLY_MAX } from "../social/comments-draft";
import { COMMENT_ON_DEMAND_TIMEOUT_MS } from "../social/comments-poll";
import { cancelCommentSet, commentLimitState, createCommentSet, previewLength, splitCommentItems, type CommentSetItem } from "../social/comments-propose";
import type { CommentStatus, SocialComment } from "../store/types";
import type { AgentDeps, ToolKit } from "./tools";

/** A set of customer-comment replies or moderations (createCommentSet); set_comment_mode sets and any other set are not. */
export function isCommentReplySet(cs: Pick<ChangeSet, "source" | "changes">): boolean {
  return cs.source === "comment" && cs.changes.some((ch) => ch.op === "social_reply" || ch.op === "social_moderate");
}

export const SetCommentModeSchema = z.object({
  mode: z.enum(COMMENT_MODES as [CommentMode, ...CommentMode[]]).describe('"each" = a proposal for every new comment within 15 minutes; "digest" = one batch a day at digest_hour; "off" = comments only on the dashboard, no messages. "спри известията за коментари" → off; "веднъж дневно в 10" → digest with digest_hour 10; "уведомявай ме за всеки коментар" → each.'),
  digest_hour: z.number().int().min(0, "digest_hour must be 0–23").max(23, "digest_hour must be 0–23").optional().describe("Local hour (0–23, the venue's time zone) for the daily digest; keeps the current hour when omitted. Only meaningful with mode digest."),
});

const LISTABLE = ["new", "proposed", "replied", "ignored", "expired", "hidden", "deleted"] as const;
export const ListCommentsSchema = z.object({
  status: z.enum(LISTABLE).optional().describe('Default "new": unanswered comments. "proposed": waiting for the owner\'s tap. "replied", "ignored", "hidden", "deleted", "expired": history.'),
  days: z.number().int().min(1).max(30).default(14).describe("How far back, in days (default 14)."),
});
export const ReplyItemSchema = z.object({
  comment_id: z.string().min(1).describe("The id from list_comments"),
  reply_text: z.string().max(REPLY_MAX).optional().describe("The reply, exactly as it will be posted (1–2 sentences, the comment's language). Omit when action is set."),
  action: z.enum(["hide", "delete"]).optional().describe('Moderation instead of a reply: "hide" for spam or abuse, "delete" when the owner says "изтрий го" / "delete it" (cannot be undone).'),
});
export const ReplyToCommentsSchema = z.object({
  summary_bg: z.string().min(1).optional().describe("Optional one-line summary in Bulgarian (default: built from the comments)"),
  summary_en: z.string().min(1).optional().describe("The same in English"),
  replies: z.array(ReplyItemSchema).min(1).max(20).describe(`One entry per comment, 1–20 (more than fit one message go out as several proposals). For a digest the owner corrected, send every comment again: the unchanged drafts and the changed one.`),
});

/** Statuses a reply or moderation may be proposed for ("proposed": the pending set holding it is replaced). */
const ANSWERABLE: readonly CommentStatus[] = ["new", "proposed", "expired", "ignored", "hidden"];

/** Why this comment cannot get `action` (null = it can). */
function refusal(c: SocialComment, action: string | null | undefined): string | null {
  const id = c.id;
  if (c.status === "own") return `Comment ${id} is the venue's own comment; it needs no reply.`;
  if (c.status === "nested") return `Comment ${id} is a reply to a reply; replies to replies are not supported yet.`;
  if (c.status === "replied") return `Comment ${id} is already answered; undo the reply first if the owner wants a different one.`;
  if (c.status === "deleted") return `Comment ${id} was deleted.`;
  if (!ANSWERABLE.includes(c.status)) return `Comment ${id} is "${c.status}".`;
  if (c.status === "hidden" && action === "hide") return `Comment ${id} is already hidden.`;
  return null;
}

export function commentTools(d: AgentDeps, k: ToolKit) {
  const social = d.social;
  if (!social || (!social.facebook && !social.instagram)) return [];

  const setMode = betaZodTool({
    name: "set_comment_mode",
    description: "Change how the owner hears about new customer comments under the venue's Facebook/Instagram posts: each (one proposal per comment), digest (one batch a day at digest_hour, venue time) or off (dashboard only). Owner only. Proposed with the buttons like any change; never counts toward the monthly change limit.",
    inputSchema: SetCommentModeSchema,
    run: (input) =>
      k.attempt(async () => {
        const hour = input.digest_hour ?? (await d.store.getVenue(d.venueId)).comment_digest_hour;
        return k.propose({
          summary_bg: copy("bg").commentModeSummary(commentModeLabel(input.mode, hour, "bg")),
          summary_en: copy("en").commentModeSummary(commentModeLabel(input.mode, hour, "en")),
          changes: [{ op: "set_comment_mode", mode: input.mode, ...(input.digest_hour !== undefined ? { digest_hour: input.digest_hour } : {}) }],
        }, null);
      }),
  });

  /** Staff get the same refusal social_post gives. */
  const requireOwner = () => {
    if (d.member.role !== "owner") throw new Error("Comments on Facebook and Instagram are only the owner's decision; tell the owner to send this.");
  };

  /** The live read before listing. Never throws; the answer is what list_comments tells the agent about it. */
  async function liveCheck(): Promise<{ failed: boolean; note?: string; last_checked_at?: string | null }> {
    const live = d.liveComments;
    if (!live) return { failed: false };
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctl.abort();
          reject(new Error("timeout"));
        }, COMMENT_ON_DEMAND_TIMEOUT_MS);
      });
      const r = await Promise.race([live.poll(d.venueId, ctl.signal), timeout]);
      if (r.errors.length === 0) return { failed: false };
      const named = [...new Set(r.errors.map((e) => e.network).filter((n): n is CommentNetwork => n !== null))].map(networkLabel);
      const unnamed = r.errors.some((e) => e.network === null);
      return { failed: true, ...(await failure(`${unnamed || named.length === 0 ? "The comments" : named.join(" and ")} could not be checked just now`)) };
    } catch {
      return { failed: true, ...(await failure("The comments could not be checked in time")) };
    } finally {
      clearTimeout(timer);
    }
  }
  const networkLabel = (n: CommentNetwork) => (n === "instagram" ? "Instagram" : "Facebook");
  async function failure(what: string): Promise<{ note: string; last_checked_at: string | null }> {
    const last = (await d.liveComments?.lastCheckedAt(d.venueId).catch(() => null)) ?? { at: null, never: [] };
    const never = last.never.length ? ` ${last.never.map(networkLabel).join(" and ")} ${last.never.length > 1 ? "have" : "has"} not been checked yet.` : "";
    return {
      last_checked_at: last.at,
      note: `LIVE CHECK FAILED: ${what}, so these are only the comments saved at the last successful check${last.at ? ` (${last.at})` : " (no successful check yet)"}.${never} Tell the owner this in one sentence${last.at ? " with that time in the venue's time zone" : ""}; never say there are no new comments, and offer to try again in a minute.`,
    };
  }

  const list = betaZodTool({
    name: "list_comments",
    description: "Customer comments under the venue's Facebook/Instagram posts: id, network, author, text, the post's caption, status, the detected kind (question, praise, complaint, spam, abuse, other) and the drafted reply. Default: unanswered comments of the last 14 days, newest first. Reads Instagram and Facebook right then before answering (skipped when they were read less than a minute ago); if that fails it says so in live_check_failed and answers from the saved comments. Call it before replying when the owner names a comment by author or content. Owner only.",
    inputSchema: ListCommentsSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const live = await liveCheck();
        const since = new Date(d.now().getTime() - input.days * 24 * 3_600_000).toISOString();
        const rows = (await d.store.listComments(d.venueId, { status: [input.status ?? "new"], since, limit: 100 })).filter((c) => c.parent_id === null);
        const unanswered = input.status === undefined || input.status === "new";
        return {
          ...(live.failed ? { live_check_failed: live.note, last_checked_at: live.last_checked_at } : {}),
          count: rows.length,
          comments: rows.map((c) => ({ id: c.id, network: c.network, author: c.author_name, text: c.text, post_caption: c.post_caption, created_at: c.created_at, status: c.status, kind: c.draft_kind, draft: c.draft_text })),
          note: unanswered ? "Reply with reply_to_comments (one call for several comments). Nothing is posted before the owner's ✅." : undefined,
          next: unanswered && rows.length > 0 ? "If the owner asked to check, see or answer the comments, propose replies for these now: one reply_to_comments call for the whole list, without asking first (nothing is posted before the owner's ✅). If they only asked how many are waiting, answer with the count." : undefined,
        };
      }),
  });

  const reply = betaZodTool({
    name: "reply_to_comments",
    description: "Propose replies to customer comments (or hiding/deleting spam): one change set with one row per comment (several sets when they do not fit one message, at most 10 comments each), sent to every owner with ✅ Apply / ✏️ Change / ❌ Cancel. Replaces a pending comment proposal that covers any of the same comments. Never blocked by a pending menu proposal. Nothing is posted before ✅. Owner only.",
    inputSchema: ReplyToCommentsSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        await k.ensureEntitled("comments");
        const venue = await d.store.getVenue(d.venueId);
        const limit = await commentLimitState(d.store, venue, d.now());
        if (limit.reached) {
          const line = copy(k.lang).commentLimitReached(limit.limit ?? limit.used, limit.used, limit.resets_on);
          throw new Error(`Comment limit reached (${limit.used}/${limit.limit} this month): nothing was proposed. Do not retry; reply to the owner with exactly this line: "${line}"`);
        }
        const items: CommentSetItem[] = [];
        const seen = new Set<string>();
        for (const r of input.replies) {
          const text = r.reply_text?.trim() ?? "";
          if ((text === "") === (r.action === undefined)) throw new Error(`Comment ${r.comment_id}: give either reply_text or action, not both and not neither.`);
          if (seen.has(r.comment_id)) throw new Error(`Comment ${r.comment_id} is listed more than once; send one entry per comment.`);
          seen.add(r.comment_id);
          const c = await d.store.getComment(r.comment_id);
          if (!c || c.venue_id !== d.venueId) throw new Error(`comment_id "${r.comment_id}" not found; use an id from list_comments.`);
          const why = refusal(c, r.action);
          if (why) throw new Error(why);
          items.push({ comment: c, reply_text: r.action ? null : text, moderate: r.action ?? null });
        }
        // A pending comment reply set that holds any of these comments, or the one the owner tapped ✏️ on, is replaced: every
        // owner's message of it is concluded (the asker's too) and its comments go back to new. Menu and set_comment_mode
        // proposals are never touched.
        const replaced = new Set(items.map((it) => it.comment.change_set_id).filter((id): id is string => !!id));
        if (d.correctionFor) replaced.add(d.correctionFor);
        for (const id of replaced) {
          const cs = await d.store.getChangeSet(id).catch(() => null);
          if (cs && cs.venue_id === d.venueId && cs.status === "proposed" && isCommentReplySet(cs)) {
            await cancelCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, cs, { bg: "✏️ Заменено с ново предложение.", en: "✏️ Replaced by a new proposal." });
          }
        }
        // Read again: a set that was decided meanwhile (another owner's ✅) could not be replaced, so its comments may be answered now.
        for (const it of items) {
          const c = (await d.store.getComment(it.comment.id)) ?? it.comment;
          const why = c.status === "proposed" ? `Comment ${c.id} is in a proposal another owner is deciding right now; try again in a moment.` : refusal(c, it.moderate);
          if (why) throw new Error(why);
          it.comment = c;
        }
        // One proposal per group that fits a message (at most 10 comments, under Telegram's size; splitCommentItems, like the
        // digest): usually one; a long batch becomes several, each to every owner.
        const site = await d.store.getSite(d.venueId);
        const groups = splitCommentItems(items, { batch: true, extra: previewLength(site, venue.tz) });
        const summary = { ...(input.summary_bg ? { summary_bg: input.summary_bg } : {}), ...(input.summary_en ? { summary_en: input.summary_en } : {}) };
        const made: ChangeSet[] = [];
        let rows = 0;
        let stopped: "limited" | "held" | null = null;
        for (const g of groups) {
          const r = await createCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, venue, g, { chatRef: d.chatRef, batch: items.length > 1 });
          if (r.limited) {
            stopped = "limited";
            break;
          }
          if (!r.set) {
            stopped = "held";
            continue;
          }
          if (Object.keys(summary).length) await d.store.updateChangeSet(r.set.id, summary);
          made.push(r.set);
          rows += g.length;
        }
        if (made.length === 0 && stopped === "limited") throw new Error("Comment limit reached: nothing was proposed. Do not retry.");
        if (made.length === 0) throw new Error("No owner could be messaged right now; the comments are kept and proposed again later. Tell the owner in one short sentence.");
        const rest = items.length - rows;
        return {
          change_set_id: made[0].id,
          change_set_ids: made.map((x) => x.id),
          status: "proposed",
          rows,
          preview: made.map((x) => k.mine(x)).join("\n\n"),
          ...(rest > 0 ? { not_proposed: rest, why: stopped === "limited" ? "The comment limit was reached; the rest stay unanswered (dashboard)." : "No owner could be messaged for the rest; they are kept and proposed again later." } : {}),
          next: made.length > 1 ? `Sent as ${made.length} proposals (one message holds at most 10 comments). The owner decides each with its buttons. Reply with at most one short sentence, or nothing.` : "The owner decides with the buttons. Reply with at most one short sentence, or nothing.",
        };
      }),
  });

  return [setMode, list, reply];
}
