// src/bot/approvals.ts
import { setCorrection } from "../agent/memory";
import { syncLines } from "../destinations/sync";
import { baseLang } from "../domain/format";
import { isBoostPlanSet, type ChangeSetStatus, type Lang } from "../domain/types";
import { cancelCommentSet, commentsOfSet, concludeCommentOwners, decidedLine, proposalTtlHours } from "../social/comments-propose";
import type { Store } from "../store/types";
import { commentUsage } from "../store/usage";
import { formatDateTime } from "../time";
import { copy } from "./copy";
import { limitReachedLine, usageLine } from "./limit";
import type { Messenger } from "./messenger";

export type Decision = "apply" | "change" | "cancel";

export function parseCallback(data: string): { decision: Decision; setId: string } | null {
  const m = /^cs:(apply|change|cancel):([A-Za-z0-9-]+)$/.exec(data);
  return m ? { decision: m[1] as Decision, setId: m[2] } : null;
}

export interface DecisionDeps {
  store: Store;
  messenger: Messenger;
  now: () => Date;
}
export interface DecisionResult {
  /** How to conclude the proposal: `full` replaces the message where editing works (buttons removed), `short` is the follow-up line elsewhere. */
  edit?: { full: string; short: string };
  /** A fresh message to send. */
  reply?: string;
  /** Short callback-query answer. */
  toast?: string;
}

/**
 * Answer the callback first (the caller does), then run this, then conclude the proposal with `edit`. A `comment` set may be
 * decided by any owner of its venue (it went to all of them): the first tap wins, the other owners' messages are concluded
 * with who decided where, and any later tap answers "already decided".
 */
export async function handleDecision(d: DecisionDeps, chatRef: string, decision: Decision, setId: string): Promise<DecisionResult> {
  const member = await d.store.findMember(chatRef);
  const lang: Lang = baseLang(member?.lang ?? "bg");
  const c = copy(lang);
  let cs;
  try {
    cs = await d.store.getChangeSet(setId);
  } catch {
    return { toast: c.notYours };
  }
  const isComment = cs.source === "comment";
  const anyOwner = isComment && member?.role === "owner";
  if (!member || member.venue_id !== cs.venue_id || (cs.chat_ref !== chatRef && !anyOwner)) return { toast: c.notYours };
  const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
  const venue = await d.store.getVenue(cs.venue_id);
  const now = d.now();
  const conclude = (line: string): DecisionResult => ({ edit: { full: `${preview}\n\n${line}`, short: line }, toast: line });
  const settled = (status: ChangeSetStatus) =>
    conclude(status === "expired" ? c.expiredAfter(proposalTtlHours(cs.source)) : isComment ? c.alreadyDecided : c.status[status]);

  if (cs.status !== "proposed") return settled(cs.status);

  if (decision === "change") {
    await setCorrection(d.store, cs.venue_id, chatRef, cs.id, now);
    return { reply: c.changePrompt, toast: "✏️" };
  }
  if (decision === "cancel") {
    if (isComment) {
      // Conditional: a ✅ from another owner that landed first keeps the set applied.
      const mark = { bg: decidedLine("bg", "cancel", chatRef), en: decidedLine("en", "cancel", chatRef) };
      if (!(await cancelCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, cs, mark, { except: chatRef, status: "ignored" }))) return settled((await d.store.getChangeSet(cs.id)).status);
    } else await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: now.toISOString() });
    return conclude(c.cancelled);
  }
  if (cs.apply_at && Date.parse(cs.apply_at) > now.getTime()) {
    await d.store.updateChangeSet(cs.id, { status: "scheduled", decided_at: now.toISOString() });
    return conclude(c.scheduled(formatDateTime(cs.apply_at, lang, venue.tz)));
  }
  const result = await d.store.applyChangeSet(cs.id, now.toISOString());
  if (result === "limited") {
    // The store refused it and cancelled the set: the monthly change limit, or for a comment set the comment limit.
    if (!isComment) return conclude(await limitReachedLine(d.store, cs.venue_id, now, lang));
    const line = async (l: Lang) => {
      const u = await commentUsage(d.store, venue, now);
      return copy(l).commentLimitReached(venue.comment_limit ?? u.used, u.used, u.resets_on);
    };
    const lines = { bg: await line("bg"), en: await line("en") };
    await concludeCommentOwners(d, cs, (l) => lines[l], { except: chatRef });
    for (const x of await commentsOfSet(d.store, cs)) await d.store.updateComment(x.id, { status: "new", change_set_id: null });
    return conclude(lines[lang]);
  }
  if (result === "skipped") return settled((await d.store.getChangeSet(cs.id)).status);
  if (isComment) await concludeCommentOwners(d, cs, (l) => decidedLine(l, "apply", chatRef), { except: chatRef });
  // A saved ad plan changed nothing and used no change: it says so, with no "applied" and no usage line.
  if (isBoostPlanSet(cs.changes)) return { edit: { full: `${preview}\n\n${c.planSaved}`, short: c.planSaved }, toast: c.planSaved };
  const lines = await syncLines(d.store, cs.id, lang);
  // Comment sets do not use up changes, so the change usage line would mislead there.
  const usage = isComment ? null : await usageLine(d.store, cs.venue_id, now, lang);
  if (usage) lines.push(usage);
  const tail = lines.length ? `\n${lines.join("\n")}` : "";
  return { edit: { full: `${preview}\n\n${c.applied}${tail}`, short: `${c.applied}${tail}` }, toast: c.applied };
}
