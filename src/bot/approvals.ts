// src/bot/approvals.ts
import { setCorrection } from "../agent/memory";
import { syncLines } from "../destinations/sync";
import type { Lang } from "../domain/types";
import type { Store } from "../store/types";
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

/** Answer the callback first (the caller does), then run this, then conclude the proposal with `edit`. */
export async function handleDecision(d: DecisionDeps, chatRef: string, decision: Decision, setId: string): Promise<DecisionResult> {
  const member = await d.store.findMember(chatRef);
  const lang: Lang = member?.lang ?? "bg";
  const c = copy(lang);
  let cs;
  try {
    cs = await d.store.getChangeSet(setId);
  } catch {
    return { toast: c.notYours };
  }
  if (cs.chat_ref !== chatRef || !member || member.venue_id !== cs.venue_id) return { toast: c.notYours };
  const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
  const venue = await d.store.getVenue(cs.venue_id);
  const now = d.now();

  if (cs.status !== "proposed") return { edit: { full: `${preview}\n\n${c.status[cs.status]}`, short: c.status[cs.status] }, toast: c.status[cs.status] };

  if (decision === "change") {
    await setCorrection(d.store, cs.venue_id, chatRef, cs.id, now);
    return { reply: c.changePrompt, toast: "✏️" };
  }
  if (decision === "cancel") {
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: now.toISOString() });
    return { edit: { full: `${preview}\n\n${c.cancelled}`, short: c.cancelled }, toast: c.cancelled };
  }
  if (cs.apply_at && Date.parse(cs.apply_at) > now.getTime()) {
    await d.store.updateChangeSet(cs.id, { status: "scheduled", decided_at: now.toISOString() });
    const line = c.scheduled(formatDateTime(cs.apply_at, lang, venue.tz));
    return { edit: { full: `${preview}\n\n${line}`, short: line }, toast: line };
  }
  const result = await d.store.applyChangeSet(cs.id, now.toISOString());
  if (result === "limited") {
    // The store refused it (monthly change limit) and cancelled the set.
    const line = await limitReachedLine(d.store, cs.venue_id, now, lang);
    return { edit: { full: `${preview}\n\n${line}`, short: line }, toast: line };
  }
  if (result === "skipped") {
    const fresh = await d.store.getChangeSet(cs.id);
    return { edit: { full: `${preview}\n\n${c.status[fresh.status]}`, short: c.status[fresh.status] }, toast: c.status[fresh.status] };
  }
  const lines = await syncLines(d.store, cs.id, lang);
  const usage = await usageLine(d.store, cs.venue_id, now, lang);
  if (usage) lines.push(usage);
  const tail = lines.length ? `\n${lines.join("\n")}` : "";
  return { edit: { full: `${preview}\n\n${c.applied}${tail}`, short: `${c.applied}${tail}` }, toast: c.applied };
}
