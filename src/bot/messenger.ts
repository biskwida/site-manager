// src/bot/messenger.ts
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { parseRef } from "../channels/ref";
import type { Lang } from "../domain/types";

export interface Messenger {
  /** Plain message; returns the message ref or null if sending failed (never throws). */
  send(chatRef: string, text: string): Promise<string | null>;
  /** Preview with ✅ / ✏️ / ❌ buttons. */
  sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null>;
  /** Replaces the text and removes the buttons; best-effort. */
  edit(chatRef: string, messageRef: string, text: string): Promise<void>;
}

export function proposalKeyboard(setId: string, lang: Lang): InlineKeyboard {
  const bg = lang === "bg";
  return new InlineKeyboard()
    .text(bg ? "✅ Приложи" : "✅ Apply", `cs:apply:${setId}`)
    .text(bg ? "✏️ Промени" : "✏️ Change", `cs:change:${setId}`)
    .text(bg ? "❌ Откажи" : "❌ Cancel", `cs:cancel:${setId}`);
}

/** The numeric Telegram chat id inside a "tg:" ref. */
function telegramChat(chatRef: string): number {
  return Number(parseRef(chatRef).id);
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
  async edit(chatRef: string, messageRef: string, text: string) {
    try {
      await this.api.editMessageText(telegramChat(chatRef), Number(messageRef), text, { reply_markup: { inline_keyboard: [] } });
    } catch (e) {
      console.error("[messenger] edit failed:", e instanceof Error ? e.message : e);
    }
  }
}
