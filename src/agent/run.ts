// src/agent/run.ts
import Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "../config";
import { tr } from "../domain/format";
import type { ChangeSource } from "../domain/types";
import { copy } from "../bot/copy";
import { startProgress } from "../bot/progress";
import { nowText } from "../time";
import { appendMemory, loadMemory, NO_REPLY } from "./memory";
import { commentsOfSet } from "../social/comments-propose";
import { isCommentReplySet } from "./comment-tools";
import { PHOTO_NO_CAPTION, SYSTEM_PROMPT, userMessage, type CorrectionComment } from "./prompt";
import { makeTools, type AgentDeps } from "./tools";

export interface ImageInput {
  data: string; // base64
  media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}
export interface TurnInput {
  text: string;
  source: Extract<ChangeSource, "text" | "voice" | "photo">;
  image?: ImageInput;
  mediaId?: string;
  /** The owner's inbound message id (WhatsApp ties its typing indicator to it). */
  replyTo?: string;
}
export interface AgentConfig {
  model: string;
  effort: Effort;
  apiKey?: string;
}

/** Bulk and scheduling cues in BG/EN; image turns are always high. */
const HIGH_CUES = /всички|всичк|процент|%|вдигни|намали|увеличи|all the|every|bulk|raise|increase|lower|reduce|утре|tomorrow|от понеделник|от вторник|от сряда|от четвъртък|от петък|от събота|от неделя|from monday|from tuesday|from wednesday|from thursday|from friday|from saturday|from sunday|next week|следващата седмица|насрочи|schedule|в \d{1,2}[:.]\d{2}|at \d{1,2}(:\d{2})?\s?(am|pm)?\b.*(tomorrow|on )|декември|януари|december|january/i;

export function pickEffort(base: Effort, input: { hasImage: boolean; text: string }): Effort {
  if (base === "high" || input.hasImage) return "high";
  return HIGH_CUES.test(input.text) ? "high" : base;
}

/** One owner message → one agent turn. Never throws; tells the owner on refusal/error. Returns the final text, "refused" or "error". */
export async function runTurn(deps: AgentDeps, input: TurnInput, cfg: AgentConfig, client?: Anthropic): Promise<string> {
  const now = deps.now();
  const venue = await deps.store.getVenue(deps.venueId);
  const memory = await loadMemory(deps.store, deps.venueId, deps.chatRef, now, input.mediaId);
  const lang = deps.member.lang;
  const held = memory.waiting;
  const correctionComments = memory.correctionFor ? await correctionCommentsOf(deps, memory.correctionFor) : undefined;
  const text = userMessage({
    venueName: venue.name, slug: venue.slug, nowText: nowText(now, venue.tz), lang, role: deps.member.role,
    memory: memory.text, correctionFor: memory.correctionFor, correctionComments, mediaId: input.mediaId, heldMediaIds: held, text: input.text, source: input.source,
  });
  const content = [
    ...(await heldPhotoUrls(deps, held)).map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
    ...(input.image ? [{ type: "image" as const, source: { type: "base64" as const, media_type: input.image.media_type, data: input.image.data } }] : []),
    { type: "text" as const, text },
  ];
  const turnSets = new Set<string>();
  const notes: string[] = [];
  const progress = startProgress({ messenger: deps.messenger, chatRef: deps.chatRef, lang, hasImage: !!input.image || held.length > 0, inReplyTo: input.replyTo });
  // Each tool call updates the status line ("Reading the menu…").
  const tools = makeTools({ ...deps, correctionFor: memory.correctionFor, source: input.source, turnSets, notes }).map((t) => {
    const run = t.run as (...args: unknown[]) => ReturnType<typeof t.run>;
    return { ...t, run: ((...args: unknown[]) => { progress.step(t.name); return run(...args); }) as typeof t.run };
  });
  const tag = input.source === "voice" ? "[voice] " : input.source === "photo" ? `[photo media_id: ${input.mediaId ?? "?"}] ` : "";
  const about = held.length ? `[about the photos above: media_id ${held.join(", ")}] ` : "";
  const ownerLine = `${tag}${about}${input.text}`.trim();

  // A photo sent without a caption (src/bot/inbound.ts holds it silently first, so an album gathers instead of starting turns).
  const bare = input.source === "photo" && input.text === PHOTO_NO_CAPTION && !!input.mediaId;
  const claimed = input.mediaId ? [...held, input.mediaId] : held;

  const closeOut = async (reply: string, outcome?: string, answered = false) => {
    await progress.stop();
    // A caption-less photo the agent only asked about (no change set this turn) stays held for the owner's answer, like any held photo.
    const keep = bare && answered && turnSets.size === 0;
    if (keep && !reply) reply = copy(lang).photoWaiting; // the model said nothing: ask the usual question rather than stay silent
    if (reply) await deps.messenger.send(deps.chatRef, reply);
    const photos = keep ? { media_ids: [input.mediaId!, ...held], waiting: true } : {};
    const fullOutcome = [outcome, ...notes].filter(Boolean).join("; ") || undefined;
    await appendMemory(deps.store, deps.venueId, deps.chatRef, { at: now.toISOString(), owner: ownerLine, agent: reply || NO_REPLY, outcome: fullOutcome, ...photos }, now, claimed);
  };

  try {
    let final: { stop_reason: string | null; content: { type: string; text?: string }[] };
    try {
      const anthropic = client ?? new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : undefined);
      final = await anthropic.beta.messages.toolRunner({
        model: cfg.model,
        max_tokens: 16000,
        max_iterations: 30,
        output_config: { effort: pickEffort(cfg.effort, { hasImage: !!input.image || held.length > 0, text: input.text }) },
        // One tool call at a time: proposals must be sequential and the queue in makeTools expects it.
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        tools,
        messages: [{ role: "user", content }],
      });
    } catch (e) {
      console.error("[agent] turn failed:", e instanceof Error ? e.message : e);
      await closeOut(tr(lang, "Възникна грешка. Опитайте отново след малко.", "Something went wrong. Please try again in a moment."), "error");
      return "error";
    }

    if (final.stop_reason === "refusal") {
      await closeOut(tr(lang, "Не мога да изпълня това. Опитайте с друга формулировка.", "I can't do that one. Try putting it differently."), "refused");
      return "refused";
    }
    const reply = final.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("\n").trim();
    await closeOut(reply, await pendingOutcome(deps, turnSets), true);
    return reply;
  } finally {
    await progress.stop(); // also after an unexpected throw, so typing never outlives the turn
  }
}

/**
 * ✏️ on a comment reply set: its comments and the previous drafts, so the owner can type only what changes. Undefined for any
 * other set (menu changes, set_comment_mode) and for a set that is no longer waiting.
 */
async function correctionCommentsOf(deps: AgentDeps, setId: string): Promise<CorrectionComment[] | undefined> {
  const cs = await deps.store.getChangeSet(setId).catch(() => null);
  if (!cs || cs.venue_id !== deps.venueId || cs.status !== "proposed" || !isCommentReplySet(cs)) return undefined;
  const rows = await commentsOfSet(deps.store, cs);
  return cs.changes.flatMap((ch): CorrectionComment[] => {
    if (ch.op !== "social_reply" && ch.op !== "social_moderate") return [];
    const row = (ch.after ?? {}) as Record<string, unknown>;
    const stored = rows.find((r) => r.comment_id === ch.entity_id);
    const action = row.action === "hide" || row.action === "delete" ? row.action : null;
    return [{ id: stored?.id ?? ch.entity_id, network: String(row.network ?? ""), author: String(row.author_name ?? ""), text: String(row.comment_text ?? ""), draft: typeof row.reply_text === "string" ? row.reply_text : null, action }];
  });
}

/** Every proposal still waiting in this chat (earlier ones first, then this turn's in the order they were made), for the memory line. */
async function pendingOutcome(deps: AgentDeps, turnSets: Set<string>): Promise<string | undefined> {
  const proposed = (await deps.store.listChangeSets(deps.venueId, { status: ["proposed"], limit: 50 })).filter((cs) => cs.chat_ref === deps.chatRef);
  if (proposed.length === 0) return undefined;
  const order = [...turnSets];
  const rank = (id: string) => (turnSets.has(id) ? order.indexOf(id) : -1);
  proposed.sort((a, b) => rank(a.id) - rank(b.id) || a.created_at.localeCompare(b.created_at));
  const names = proposed.map((cs) => (deps.member.lang === "bg" ? cs.summary_bg : cs.summary_en)).join(" | ");
  return `proposed: ${names} (waiting for the owner's ${proposed.length === 1 ? "decision" : "decisions"})`;
}

/** Public https addresses of the held photos, for Claude to fetch. Photos without one (offline storage) are only named by id in the text. */
async function heldPhotoUrls(deps: AgentDeps, ids: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const id of ids) {
    const m = await deps.store.getMedia(id).catch(() => null);
    if (m && m.venue_id === deps.venueId && /^https:\/\//.test(m.public_url)) urls.push(m.public_url);
  }
  return urls;
}
