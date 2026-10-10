// src/bot/bot.ts
import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ImageInput } from "../agent/run";
import { makeRef } from "../channels/ref";
import type { Member } from "../domain/types";
import type { Store } from "../store/types";
import { copy, langFromCode } from "./copy";
import { handleInbound, type InboundMedia } from "./inbound";
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
  /** Downloads a Telegram file by file_path; the URL (with the bot token) stays inside. */
  download: (filePath: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  /** Tests pass this to skip getMe. */
  botInfo?: UserFromGetMe;
}

const INVITE_TTL_MS = 7 * 24 * 3_600_000;
export { INVITE_TTL_MS };

export function adminUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl}/admin/${slug}?key=${token}`;
}
export function publicUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/${slug}`;
}

export function createBot(d: BotDeps): Bot {
  const bot = new Bot(d.token, d.botInfo ? { botInfo: d.botInfo } : undefined);
  // Translates Bot API updates into InboundMessage; every behaviour lives in handleInbound.
  const ref = (ctx: Context) => makeRef("tg", ctx.chat!.id);
  const hint = (ctx: Context) => langFromCode(ctx.from?.language_code);
  const tgMedia = (ctx: Context, fileId: string): InboundMedia => ({
    download: async () => {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("no file_path");
      const dl = await d.download(file.file_path);
      return { ...dl, name: file.file_path };
    },
  });

  bot.on("message:text", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "text", text: ctx.message.text, langHint: hint(ctx), messageRef: String(ctx.message.message_id) }));
  bot.on("message:photo", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "photo", text: ctx.message.caption, langHint: hint(ctx), media: tgMedia(ctx, ctx.message.photo.at(-1)!.file_id) }));
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("image/")) return;
    await handleInbound(d, { chatRef: ref(ctx), kind: "photo", text: ctx.message.caption, langHint: hint(ctx), media: tgMedia(ctx, doc.file_id) });
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
    await err.ctx.reply(copy(lang).error).catch(() => undefined);
  });
  return bot;
}
