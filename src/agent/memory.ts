// src/agent/memory.ts
import type { Conversation, ConversationTurn } from "../domain/types";
import type { Store } from "../store/types";

export const MEMORY_TURNS = 8;
export const MEMORY_TTL_MS = 30 * 60_000;

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

/** Plain-text memory for the next user message, plus the photos held for it. Expired memory is dropped (and cleared in the store). */
export async function loadMemory(store: Store, venueId: string, chatRef: string, now: Date): Promise<{ text: string; correctionFor: string | null; waiting: string[] }> {
  const c = await store.getConversation(venueId, chatRef);
  if (!c) return { text: "", correctionFor: null, waiting: [] };
  if (now.getTime() - Date.parse(c.updated_at) > MEMORY_TTL_MS) {
    await store.setConversation(venueId, chatRef, { turns: [], correction_for: null, updated_at: now.toISOString() });
    return { text: "", correctionFor: null, waiting: [] };
  }
  return { text: renderMemory(c.turns), correctionFor: c.correction_for, waiting: waitingMediaIds(c.turns) };
}

const freshTurns = (c: Conversation | null, now: Date) => (c && now.getTime() - Date.parse(c.updated_at) <= MEMORY_TTL_MS ? c.turns : []);
export const heldPhotoLine = (ids: string[]) => `[photo media_id: ${ids.join(", ")}] (no instructions yet)`;

/** Releases the held photos a turn used. A held group that gained a photo while the turn ran keeps only the unused ones. */
function release(t: ConversationTurn, claimed: string[]): ConversationTurn {
  if (!t.waiting || claimed.length === 0) return t;
  const left = (t.media_ids ?? []).filter((id) => !claimed.includes(id));
  if (left.length === (t.media_ids ?? []).length) return t;
  if (left.length) return { ...t, media_ids: left, owner: heldPhotoLine(left) };
  const rest = { ...t };
  delete rest.waiting;
  return rest;
}

/** `claimed` = the held photos this turn was given; they stop being held. */
export async function appendMemory(store: Store, venueId: string, chatRef: string, turn: ConversationTurn, now: Date, claimed: string[] = []): Promise<void> {
  const c = await store.getConversation(venueId, chatRef);
  const turns = [...freshTurns(c, now).map((t) => release(t, claimed)), turn].slice(-MEMORY_TURNS);
  await store.setConversation(venueId, chatRef, { turns, correction_for: null, updated_at: now.toISOString() });
}

/**
 * A photo without a caption waits for the owner's next message instead of starting a turn of its own. Photos sent one after
 * another (an album arrives as separate messages) join the same held group. Returns true for the first photo of a group, the
 * one that gets the "what should I do with it?" reply (`ack`).
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
