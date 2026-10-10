// src/bot/approvals.ts
import { setCorrection } from "../agent/memory";
import type { Lang } from "../domain/types";
import type { Store } from "../store/types";
import { formatDateTime } from "../time";
import { copy } from "./copy";
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
  /** New text for the proposal message (buttons removed). */
  edit?: string;
  /** A fresh message to send. */
  reply?: string;
  /** Short callback-query answer. */
  toast?: string;
}

/** Answer the callback first (the caller does), then run this, then edit the message with `edit`. */
export async function handleDecision(d: DecisionDeps, chatId: number, decision: Decision, setId: string): Promise<DecisionResult> {
  const member = await d.store.findMember(chatId);
  const lang: Lang = member?.lang ?? "bg";
  const c = copy(lang);
  let cs;
  try {
    cs = await d.store.getChangeSet(setId);
  } catch {
    return { toast: c.notYours };
  }
  if (cs.chat_id !== chatId || !member || member.venue_id !== cs.venue_id) return { toast: c.notYours };
  const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
  const venue = await d.store.getVenue(cs.venue_id);
  const now = d.now();

  if (cs.status !== "proposed") return { edit: `${preview}\n\n${c.status[cs.status]}`, toast: c.status[cs.status] };

  if (decision === "change") {
    await setCorrection(d.store, cs.venue_id, chatId, cs.id, now);
    return { reply: c.changePrompt, toast: "✏️" };
  }
  if (decision === "cancel") {
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: now.toISOString() });
    return { edit: `${preview}\n\n${c.cancelled}`, toast: c.cancelled };
  }
  if (cs.apply_at && Date.parse(cs.apply_at) > now.getTime()) {
    await d.store.updateChangeSet(cs.id, { status: "scheduled", decided_at: now.toISOString() });
    const line = c.scheduled(formatDateTime(cs.apply_at, lang, venue.tz));
    return { edit: `${preview}\n\n${line}`, toast: line };
  }
  const result = await d.store.applyChangeSet(cs.id, now.toISOString());
  if (result === "skipped") {
    const fresh = await d.store.getChangeSet(cs.id);
    return { edit: `${preview}\n\n${c.status[fresh.status]}`, toast: c.status[fresh.status] };
  }
  return { edit: `${preview}\n\n${c.applied}`, toast: c.applied };
}
