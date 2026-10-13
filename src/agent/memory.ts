// src/agent/memory.ts
import type { Conversation, ConversationTurn } from "../domain/types";
import type { Store } from "../store/types";

export const MEMORY_TURNS = 8;
export const MEMORY_TTL_MS = 30 * 60_000;
/** A photo without a caption sent this soon after the agent's reply is read as part of that conversation ("send me the photo"). */
export const PHOTO_FOLLOW_UP_MS = 15 * 60_000;
/** The agent text stored for a turn that sent nothing. */
export const NO_REPLY = "(no reply)";

export function renderMemory(turns: ConversationTurn[]): string {
  if (turns.length === 0) return "";
  const lines = ["Recent conversation (oldest first):"];
  for (const t of turns) {
    lines.push(`Owner: ${t.owner}`);
    lines.push(`Agent: ${t.agent}`);
    if (t.outcome) lines.push(`Outcome: ${t.outcome}`);
  }
  return lines.join("\n");
}

/** Media ids of photos still held for the owner's next message, oldest first. */
export function waitingMediaIds(turns: ConversationTurn[]): string[] {
  return turns.flatMap((t) => (t.waiting ? (t.media_ids ?? []) : []));
}

/**
 * Plain-text memory for the next user message, plus the photos held for it. Expired memory is dropped (and cleared in the store).
 * `own` = the photo this turn carries itself: it is not held for itself, and the silent hold made for it is not shown.
 */
export async function loadMemory(store: Store, venueId: string, chatRef: string, now: Date, own?: string): Promise<{ text: string; correctionFor: string | null; waiting: string[] }> {
  const c = await store.getConversation(venueId, chatRef);
  if (!c) return { text: "", correctionFor: null, waiting: [] };
  if (now.getTime() - Date.parse(c.updated_at) > MEMORY_TTL_MS) {
    await store.setConversation(venueId, chatRef, { turns: [], correction_for: null, updated_at: now.toISOString() });
    return { text: "", correctionFor: null, waiting: [] };
  }
  const mine = (t: ConversationTurn) => own !== undefined && !!t.waiting && (t.media_ids ?? []).includes(own);
  return { text: renderMemory(c.turns.filter((t) => !mine(t))), correctionFor: c.correction_for, waiting: waitingMediaIds(c.turns).filter((id) => id !== own) };
}

const freshTurns = (c: Conversation | null, now: Date) => (c && now.getTime() - Date.parse(c.updated_at) <= MEMORY_TTL_MS ? c.turns : []);
export const heldPhotoLine = (ids: string[]) => `[photo media_id: ${ids.join(", ")}] (no instructions yet)`;

/**
 * Releases the held photos a turn used. A held group that gained a photo while the turn ran keeps only the unused ones. A silent
 * hold (no agent text: a photo that started a turn of its own) is dropped once used up; that turn's own line names the photo.
 */
function release(t: ConversationTurn, claimed: string[]): ConversationTurn | null {
  if (!t.waiting || claimed.length === 0) return t;
  const left = (t.media_ids ?? []).filter((id) => !claimed.includes(id));
  if (left.length === (t.media_ids ?? []).length) return t;
  if (left.length) return { ...t, media_ids: left, owner: heldPhotoLine(left) };
  if (!t.agent) return null;
  const rest = { ...t };
  delete rest.waiting;
  return rest;
}

/** `claimed` = the held photos this turn was given; they stop being held. */
export async function appendMemory(store: Store, venueId: string, chatRef: string, turn: ConversationTurn, now: Date, claimed: string[] = []): Promise<void> {
  const c = await store.getConversation(venueId, chatRef);
  const turns = [...freshTurns(c, now).flatMap((t) => release(t, claimed) ?? []), turn].slice(-MEMORY_TURNS);
  await store.setConversation(venueId, chatRef, { turns, correction_for: null, updated_at: now.toISOString() });
}

/**
 * True when a photo without a caption follows the agent's fresh reply (within PHOTO_FOLLOW_UP_MS, the reply had text and was not
 * about a held photo): the photo likely answers it ("send me the photo"), so the agent sees it at once instead of holding it.
 */
export async function followsAgentReply(store: Store, venueId: string, chatRef: string, now: Date): Promise<boolean> {
  const last = freshTurns(await store.getConversation(venueId, chatRef), now).at(-1);
  return !!last && !last.waiting && !!last.agent && last.agent !== NO_REPLY && now.getTime() - Date.parse(last.at) <= PHOTO_FOLLOW_UP_MS;
}

/**
 * A photo without a caption waits for the owner's next message instead of starting a turn of its own. Photos sent one after
 * another (an album arrives as separate messages) join the same held group. Returns true for the first photo of a group, the
 * one that gets the "what should I do with it?" reply (`ack`). An empty `ack` is a silent hold: the photo starts a turn itself
 * (followsAgentReply) and the hold only gathers the rest of an album, so those photos do not each start a turn.
 */
export async function holdPhoto(store: Store, venueId: string, chatRef: string, mediaId: string, ack: string, now: Date): Promise<boolean> {
  const c = await store.getConversation(venueId, chatRef);
  const fresh = freshTurns(c, now);
  const last = fresh.at(-1);
  const correction_for = c?.correction_for ?? null;
  if (last?.waiting) {
    const ids = [...(last.media_ids ?? []), mediaId];
    await store.setConversation(venueId, chatRef, { turns: [...fresh.slice(0, -1), { ...last, media_ids: ids, owner: heldPhotoLine(ids) }], correction_for, updated_at: now.toISOString() });
    return false;
  }
  const turn: ConversationTurn = { at: now.toISOString(), owner: heldPhotoLine([mediaId]), agent: ack, media_ids: [mediaId], waiting: true };
  await store.setConversation(venueId, chatRef, { turns: [...fresh, turn].slice(-MEMORY_TURNS), correction_for, updated_at: now.toISOString() });
  return true;
}

export async function setCorrection(store: Store, venueId: string, chatRef: string, setId: string | null, now: Date): Promise<void> {
  const c = await store.getConversation(venueId, chatRef);
  await store.setConversation(venueId, chatRef, { turns: c?.turns ?? [], correction_for: setId, updated_at: now.toISOString() });
}
