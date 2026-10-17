// src/bot/messenger.ts
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { parseRef } from "../channels/ref";
import type { Lang } from "../domain/types";

export interface SendOpts {
  /** Started by us, not a reply: the router enforces Meta's 24 h window. */
  proactive?: boolean;
  /** The agent's own reply, already in the owner's language: withTranslation (src/bot/translate.ts) only removes keep markers. */
  verbatim?: boolean;
}

export interface Messenger {
  /** Plain message; returns the message ref or null if sending failed (never throws). */
  send(chatRef: string, text: string, opts?: SendOpts): Promise<string | null>;
  /** Preview with ✅ / ✏️ / ❌ buttons; `labels` (another conversation language, from withTranslation) replace the Bulgarian or English ones. */
  sendProposal(chatRef: string, text: string, setId: string, lang: Lang, labels?: ProposalLabels): Promise<string | null>;
  /** A picture by public https URL, with an optional caption. Returns the message ref or null if sending failed (never throws). */
  sendPhoto(chatRef: string, url: string, caption?: string): Promise<string | null>;
  /** Telegram: edits the proposal message to `full` and removes the buttons. Meta channels: send `short` as a new message. Best-effort. */
  conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: SendOpts): Promise<void>;
  /** "typing…" indicator; `inReplyTo` is the inbound message ref (WhatsApp needs it). Best-effort. */
  typing(chatRef: string, inReplyTo?: string): Promise<void>;
  /** Replaces the text of a plain message (the "working on it" status). Telegram only; absent elsewhere. Best-effort. */
  edit?(chatRef: string, messageRef: string, text: string): Promise<void>;
  /** Deletes a plain message (the status, once the answer is ready). Telegram only; absent elsewhere. Best-effort. */
  remove?(chatRef: string, messageRef: string): Promise<void>;
}

export type ProposalButtonId = "apply" | "change" | "cancel";
/** Button labels in another conversation language (withTranslation): each at most PROPOSAL_LABEL_MAX characters. */
export type ProposalLabels = Record<ProposalButtonId, string>;
/** WhatsApp and Messenger cap a button title at 20 characters. */
export const PROPOSAL_LABEL_MAX = 20;

/** The three proposal buttons, shared by every channel (labels ≤ 20 characters for Meta): Bulgarian or English, or the given `labels`. */
export function proposalButtons(lang: Lang, labels?: ProposalLabels): { id: ProposalButtonId; label: string }[] {
  const bg = lang === "bg";
  return [
    { id: "apply", label: labels?.apply ?? (bg ? "✅ Приложи" : "✅ Apply") },
    { id: "change", label: labels?.change ?? (bg ? "✏️ Промени" : "✏️ Change") },
    { id: "cancel", label: labels?.cancel ?? (bg ? "❌ Откажи" : "❌ Cancel") },
  ];
}

export function proposalKeyboard(setId: string, lang: Lang, labels?: ProposalLabels): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const b of proposalButtons(lang, labels)) kb.text(b.label, `cs:${b.id}:${setId}`);
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
  async sendPhoto(chatRef: string, url: string, caption?: string) {
    try {
      const m = await this.api.sendPhoto(telegramChat(chatRef), url, caption ? { caption } : undefined);
      return String(m.message_id);
    } catch (e) {
      console.error("[messenger] sendPhoto failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang, labels?: ProposalLabels) {
    try {
      const m = await this.api.sendMessage(telegramChat(chatRef), text, { reply_markup: proposalKeyboard(setId, lang, labels) });
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
  async edit(chatRef: string, messageRef: string, text: string) {
    try {
      await this.api.editMessageText(telegramChat(chatRef), Number(messageRef), text);
    } catch (e) {
      console.error("[messenger] edit failed:", e instanceof Error ? e.message : e);
    }
  }
  async remove(chatRef: string, messageRef: string) {
    try {
      await this.api.deleteMessage(telegramChat(chatRef), Number(messageRef));
    } catch (e) {
      console.error("[messenger] remove failed:", e instanceof Error ? e.message : e);
    }
  }
}
