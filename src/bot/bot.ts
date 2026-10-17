// src/bot/bot.ts
import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ImageInput } from "../agent/run";
import { makeRef } from "../channels/ref";
import { languageName } from "../domain/format";
import { isChatLang, type ChatLang, type Member } from "../domain/types";
import type { ConnectResult } from "../destinations/connect";
import type { Store } from "../store/types";
import { copy, langFromCode } from "./copy";
import { handleInbound, type InboundMedia } from "./inbound";
import type { LangClassifier } from "./lang-classify";
import type { Messenger } from "./messenger";
import type { Transcriber } from "./voice";

export interface RunRequest {
  venueId: string;
  chatRef: string;
  member: Member;
  text: string;
  source: "text" | "voice" | "photo";
  image?: ImageInput;
  mediaId?: string;
  /** The owner's inbound message id, for channels whose typing indicator needs it (WhatsApp). */
  replyTo?: string;
}

export interface BotDeps {
  token: string;
  store: Store;
  messenger: Messenger;
  baseUrl: string;
  now: () => Date;
  /** Schedules the agent turn (after() on Vercel, a floating promise in dev-bot). Must not throw. */
  startRun: (r: RunRequest) => void;
  /** null when STT is not configured. */
  transcribe: Transcriber | null;
  /**
   * Names the language of the owner's words when their letters cannot (src/bot/lang-classify.ts, asked from src/bot/inbound.ts): Latin
   * text of four words or more, and Cyrillic without a marker letter of four words or more from a member not stored as Bulgarian.
   * Absent or null = never asked. (src/server/deps.ts gives the same classifier to the reply drafts, which ask it about a customer's
   * comment: src/social/comments-draft.ts.)
   */
  classifyLang?: LangClassifier | null;
  /** Downloads a Telegram file by file_path; the URL (with the bot token) stays inside. */
  download: (filePath: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  /** Tests pass this to skip getMe. */
  botInfo?: UserFromGetMe;
  /** Connects the venue to its WordPress site (src/destinations/connect.ts); undefined = the feature is off. */
  connect?: (venueId: string, siteUrl: string, code: string) => Promise<ConnectResult>;
  /** Called after a successful owner redeem; deps wire it to startDeploy (which is a no-op when a site already exists). Must not throw. */
  onOwnerJoined?: (venueId: string) => void;
}

export { adminUrl, INVITE_TTL_MS, publicUrl } from "./links";

/** Telegram's language_code ("pt-BR", "zh-hans", "en") as a conversation language: its two-letter language, lower case ("pt"); English when it has none ("fil" has no two-letter code). */
export function telegramLang(code?: string): ChatLang {
  const lang = (code ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return isChatLang(lang) && languageName(lang) !== lang ? lang : "en"; // a code that names no language ("xx") is English, as for the classifier and Whisper
}

export function createBot(d: BotDeps): Bot {
  const bot = new Bot(d.token, d.botInfo ? { botInfo: d.botInfo } : undefined);
  // Translates Bot API updates into InboundMessage; every behaviour lives in handleInbound.
  const ref = (ctx: Context) => makeRef("tg", ctx.chat!.id);
  const hint = (ctx: Context) => telegramLang(ctx.from?.language_code);
  const tgMedia = (ctx: Context, fileId: string): InboundMedia => ({
    download: async () => {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("no file_path");
      const dl = await d.download(file.file_path);
      return { ...dl, name: file.file_path };
    },
  });

  const forwarded = (ctx: Context) => ctx.message?.forward_origin !== undefined;

  bot.on("message:text", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "text", text: ctx.message.text, langHint: hint(ctx), forwarded: forwarded(ctx), messageRef: String(ctx.message.message_id) }));
  bot.on("message:photo", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "photo", text: ctx.message.caption, langHint: hint(ctx), forwarded: forwarded(ctx), media: tgMedia(ctx, ctx.message.photo.at(-1)!.file_id) }));
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("image/")) return;
    await handleInbound(d, { chatRef: ref(ctx), kind: "photo", text: ctx.message.caption, langHint: hint(ctx), forwarded: forwarded(ctx), media: tgMedia(ctx, doc.file_id) });
  });
  bot.on("message:voice", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "voice", langHint: hint(ctx), media: tgMedia(ctx, ctx.message.voice.file_id) }));
  bot.on("message:audio", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "voice", langHint: hint(ctx), media: tgMedia(ctx, ctx.message.audio.file_id) }));
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined); // stop the client's spinner first
    if (ctx.chat === undefined) return;
    const messageId = ctx.callbackQuery.message?.message_id;
    await handleInbound(d, { chatRef: ref(ctx), kind: "button", text: ctx.callbackQuery.data, langHint: hint(ctx), messageRef: messageId !== undefined ? String(messageId) : undefined });
  });

  bot.catch(async (err) => {
    console.error("bot error:", err.error instanceof Error ? err.error.message : err.error);
    const lang = langFromCode(err.ctx.from?.language_code);
    // Through the messenger like every other line to an owner (translated for a member in another language); it never throws.
    if (err.ctx.chat) await d.messenger.send(makeRef("tg", err.ctx.chat.id), copy(lang).error);
  });
  return bot;
}
