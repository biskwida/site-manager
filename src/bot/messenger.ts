// src/bot/messenger.ts
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { parseRef } from "../channels/ref";
import type { Lang } from "../domain/types";

export interface SendOpts {
  /** Started by us, not a reply: the router enforces Meta's 24 h window. */
  proactive?: boolean;
}

export interface Messenger {
  /** Plain message; returns the message ref or null if sending failed (never throws). */
  send(chatRef: string, text: string, opts?: SendOpts): Promise<string | null>;
  /** Preview with ✅ / ✏️ / ❌ buttons. */
  sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null>;
  /** Telegram: edits the proposal message to `full` and removes the buttons. Meta channels: send `short` as a new message. Best-effort. */
  conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: SendOpts): Promise<void>;
  /** "typing…" indicator; `inReplyTo` is the inbound message ref (WhatsApp needs it). Best-effort. */
  typing(chatRef: string, inReplyTo?: string): Promise<void>;
}

/** The three proposal buttons, shared by every channel (labels ≤ 20 characters for Meta). */
export function proposalButtons(lang: Lang): { id: "apply" | "change" | "cancel"; label: string }[] {
  const bg = lang === "bg";
  return [
    { id: "apply", label: bg ? "✅ Приложи" : "✅ Apply" },
    { id: "change", label: bg ? "✏️ Промени" : "✏️ Change" },
    { id: "cancel", label: bg ? "❌ Откажи" : "❌ Cancel" },
  ];
}

export function proposalKeyboard(setId: string, lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const b of proposalButtons(lang)) kb.text(b.label, `cs:${b.id}:${setId}`);
  return kb;
}

/** The numeric Telegram chat id inside a "tg:" ref; throws for any other channel (callers catch and log). */
function telegramChat(chatRef: string): number {
  const { channel, id } = parseRef(chatRef);
  if (channel !== "tg") throw new Error(`not a Telegram ref: ${channel}`);
  return Number(id);
}

export class TelegramMessenger implements Messenger {
  constructor(private api: Api) {}
  async send(chatRef: string, text: string) {
    try {
      const m = await this.api.sendMessage(telegramChat(chatRef), text);
      return String(m.message_id);
    } catch (e) {
      console.error("[messenger] send failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang) {
    try {
      const m = await this.api.sendMessage(telegramChat(chatRef), text, { reply_markup: proposalKeyboard(setId, lang) });
      return String(m.message_id);
    } catch (e) {
      console.error("[messenger] sendProposal failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  async conclude(chatRef: string, messageRef: string | null, full: string, short: string) {
    if (messageRef === null) {
      await this.send(chatRef, short);
      return;
    }
    try {
      await this.api.editMessageText(telegramChat(chatRef), Number(messageRef), full, { reply_markup: { inline_keyboard: [] } });
    } catch (e) {
      console.error("[messenger] conclude failed:", e instanceof Error ? e.message : e);
    }
  }
  async typing(chatRef: string) {
    try {
      await this.api.sendChatAction(telegramChat(chatRef), "typing");
    } catch (e) {
      console.error("[messenger] typing failed:", e instanceof Error ? e.message : e);
    }
  }
}
