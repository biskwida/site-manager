// src/agent/memory.ts
import type { ConversationTurn } from "../domain/types";
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

/** Plain-text memory for the next user message. Expired memory is dropped (and cleared in the store). */
export async function loadMemory(store: Store, venueId: string, chatRef: string, now: Date): Promise<{ text: string; correctionFor: string | null }> {
  const c = await store.getConversation(venueId, chatRef);
  if (!c) return { text: "", correctionFor: null };
  if (now.getTime() - Date.parse(c.updated_at) > MEMORY_TTL_MS) {
    await store.setConversation(venueId, chatRef, { turns: [], correction_for: null, updated_at: now.toISOString() });
    return { text: "", correctionFor: null };
  }
  return { text: renderMemory(c.turns), correctionFor: c.correction_for };
}

export async function appendMemory(store: Store, venueId: string, chatRef: string, turn: ConversationTurn, now: Date): Promise<void> {
  const c = await store.getConversation(venueId, chatRef);
  const fresh = c && now.getTime() - Date.parse(c.updated_at) <= MEMORY_TTL_MS ? c.turns : [];
  await store.setConversation(venueId, chatRef, { turns: [...fresh, turn].slice(-MEMORY_TURNS), correction_for: null, updated_at: now.toISOString() });
}

export async function setCorrection(store: Store, venueId: string, chatRef: string, setId: string | null, now: Date): Promise<void> {
  const c = await store.getConversation(venueId, chatRef);
  await store.setConversation(venueId, chatRef, { turns: c?.turns ?? [], correction_for: setId, updated_at: now.toISOString() });
}
