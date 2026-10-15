// src/bot/progress.ts
// Shows the owner that a long agent turn is still working. Typing is repeated for the whole turn (Telegram drops it after
// ~5 s, Meta after ~20 s). If there is no answer within 3 s, a status line appears; on Telegram it is edited to the current
// step and removed before the answer, on Messenger/Instagram/WhatsApp (no edits) it is sent once and left.
import { channelOf } from "../channels/ref";
import type { Lang } from "../domain/types";
import type { Messenger } from "./messenger";

export const STATUS_AFTER_MS = 3_000;
const TYPING_EVERY_MS = { tg: 4_000, other: 15_000 };

const PROPOSAL: [string, string] = ["📝 Подготвям предложението…", "📝 Preparing the proposal…"];
const SITE: [string, string] = ["🔎 Проверявам сайта…", "🔎 Checking the site…"];
const LABELS: Record<string, [string, string]> = {
  get_menu: ["📖 Чета менюто…", "📖 Reading the menu…"],
  get_site: SITE,
  list_changes: SITE,
  check_allergens: ["🥜 Проверявам алергените…", "🥜 Checking allergens…"],
  propose_changes: PROPOSAL,
  schedule_changes: PROPOSAL,
  propose_bulk_price_change: PROPOSAL,
  undo: PROPOSAL,
  cancel_change_set: PROPOSAL,
  social_post: ["📣 Подготвям публикацията…", "📣 Preparing the post…"],
  list_comments: ["💬 Чета коментарите…", "💬 Reading the comments…"],
  reply_to_comments: ["💬 Подготвям отговора…", "💬 Preparing the reply…"],
  set_comment_mode: ["💬 Подготвям предложението…", "💬 Preparing the proposal…"],
};
const WORDPRESS: [string, string] = ["🌐 Работя по WordPress сайта…", "🌐 Working on the WordPress site…"];

/** The status line for a tool step, or null for a tool without one (the status stays as it is). */
export function progressLabel(tool: string, lang: Lang): string | null {
  const pair = LABELS[tool] ?? (tool.startsWith("wp_") ? WORDPRESS : null);
  return pair ? pair[lang === "bg" ? 0 : 1] : null;
}

export interface Progress {
  /** A tool is about to run. */
  step(tool: string): void;
  /** The turn is over: stop typing and remove the Telegram status line. Call before sending the answer. Never throws. */
  stop(): Promise<void>;
}

export function startProgress(o: { messenger: Messenger; chatRef: string; lang: Lang; hasImage: boolean; inReplyTo?: string }): Progress {
  const tg = (() => {
    try {
      return channelOf(o.chatRef) === "tg";
    } catch {
      return false;
    }
  })();
  const bg = o.lang === "bg";
  let label = o.hasImage ? (bg ? "📸 Разглеждам снимката…" : "📸 Looking at the photo…") : bg ? "⏳ Работя по това…" : "⏳ Working on it…";
  let ref: string | null = null;
  let shown = "";
  let stopped = false;
  // Status sends and edits run one after another, so an edit never overtakes the send it belongs to.
  let chain: Promise<void> = Promise.resolve();
  const queue = (fn: () => Promise<void>) => {
    chain = chain.then(fn).catch((e) => console.error("[progress]", e instanceof Error ? e.message : e));
  };
  const typing = () => void o.messenger.typing(o.chatRef, o.inReplyTo).catch(() => undefined);

  typing();
  const beat = setInterval(() => !stopped && typing(), tg ? TYPING_EVERY_MS.tg : TYPING_EVERY_MS.other);
  const show = setTimeout(() => queue(async () => {
    if (stopped) return;
    ref = await o.messenger.send(o.chatRef, label);
    shown = label;
  }), STATUS_AFTER_MS);

  return {
    step(tool) {
      const next = progressLabel(tool, o.lang);
      if (!next || next === label) return;
      label = next;
      if (!tg) return;
      queue(async () => {
        if (stopped || ref === null || shown === label) return;
        await o.messenger.edit?.(o.chatRef, ref, label);
        shown = label;
      });
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(beat);
      clearTimeout(show);
      await chain;
      if (tg && ref !== null) await o.messenger.remove?.(o.chatRef, ref).catch(() => undefined);
    },
  };
}
