// src/bot/messenger.ts
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Lang } from "../domain/types";

export interface Messenger {
  /** Plain message; returns the Telegram message id or null if sending failed (never throws). */
  send(chatId: number, text: string): Promise<number | null>;
  /** Preview with ✅ / ✏️ / ❌ buttons. */
  sendProposal(chatId: number, text: string, setId: string, lang: Lang): Promise<number | null>;
  /** Replaces the text and removes the buttons; best-effort. */
  edit(chatId: number, messageId: number, text: string): Promise<void>;
}

export function proposalKeyboard(setId: string, lang: Lang): InlineKeyboard {
  const bg = lang === "bg";
  return new InlineKeyboard()
    .text(bg ? "✅ Приложи" : "✅ Apply", `cs:apply:${setId}`)
    .text(bg ? "✏️ Промени" : "✏️ Change", `cs:change:${setId}`)
    .text(bg ? "❌ Откажи" : "❌ Cancel", `cs:cancel:${setId}`);
}

export class TelegramMessenger implements Messenger {
  constructor(private api: Api) {}
  async send(chatId: number, text: string) {
    try {
      const m = await this.api.sendMessage(chatId, text);
      return m.message_id;
    } catch (e) {
      console.error("[messenger] send failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  async sendProposal(chatId: number, text: string, setId: string, lang: Lang) {
    try {
      const m = await this.api.sendMessage(chatId, text, { reply_markup: proposalKeyboard(setId, lang) });
      return m.message_id;
    } catch (e) {
      console.error("[messenger] sendProposal failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  async edit(chatId: number, messageId: number, text: string) {
    try {
      await this.api.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: [] } });
    } catch (e) {
      console.error("[messenger] edit failed:", e instanceof Error ? e.message : e);
    }
  }
}
