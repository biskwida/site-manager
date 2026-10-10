// src/bot/bot.ts
import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ImageInput } from "../agent/run";
import { detectLang } from "../domain/format";
import type { Lang, Member } from "../domain/types";
import type { Store } from "../store/types";
import { handleDecision, parseCallback } from "./approvals";
import { copy, langFromCode } from "./copy";
import { registerMediaHandlers } from "./media";
import { type Messenger, TelegramMessenger } from "./messenger";

export interface RunRequest {
  venueId: string;
  chatId: number;
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
  transcribe: ((bytes: Uint8Array, lang: Lang) => Promise<string>) | null;
  /** Downloads a Telegram file by file_path; the URL (with the bot token) stays inside. */
  download: (filePath: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  /** Tests pass this to skip getMe. */
  botInfo?: UserFromGetMe;
  /** Called after a successful owner redeem; deps wire it to startDeploy (which is a no-op when a site already exists). Must not throw. */
  onOwnerJoined?: (venueId: string) => void;
}

const INVITE_TTL_MS = 7 * 24 * 3_600_000;
export { INVITE_TTL_MS };

export function adminUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl}/admin/${slug}?key=${token}`;
}
export function publicUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/${slug}`;
}

/** Resolves the member for a chat, or replies with the no-access hint and returns null. */
export async function requireMember(d: BotDeps, ctx: Context): Promise<Member | null> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return null;
  const member = await d.store.findMember(chatId);
  if (member) return member;
  await ctx.reply(copy(langFromCode(ctx.from?.language_code)).noAccess);
  return null;
}

export function createBot(d: BotDeps): Bot {
  const bot = new Bot(d.token, d.botInfo ? { botInfo: d.botInfo } : undefined);

  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    const uiLang = langFromCode(ctx.from?.language_code);
    const existing = await d.store.findMember(chatId);
    if (existing) {
      const venue = await d.store.getVenue(existing.venue_id);
      const c = copy(existing.lang);
      if (existing.role === "owner") await ctx.reply(c.welcomeBack(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id))));
      else await ctx.reply(c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
      return;
    }
    const code = (ctx.match ?? "").trim().toUpperCase();
    if (!code) {
      await ctx.reply(copy(uiLang).noAccess);
      return;
    }
    const member = await d.store.redeemInvite(code, chatId, uiLang, d.now().toISOString());
    if (!member) {
      await ctx.reply(copy(uiLang).badCode);
      return;
    }
    const venue = await d.store.getVenue(member.venue_id);
    const c = copy(member.lang);
    if (member.role === "owner") {
      await ctx.reply(c.welcome(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)), publicUrl(d.baseUrl, venue.slug)));
      if (d.onOwnerJoined) {
        // The first owner join is the human check that publishes the site; startDeploy ignores venues that already have one.
        if (venue.status === "live" && venue.deploy === null) await ctx.reply(c.publishing);
        try {
          d.onOwnerJoined(venue.id);
        } catch (e) {
          console.error("[bot] onOwnerJoined failed:", e instanceof Error ? e.message : e);
        }
      }
    } else await ctx.reply(c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
  });

  bot.command("lang", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const arg = (ctx.match ?? "").trim().toLowerCase();
    if (arg !== "bg" && arg !== "en") {
      await ctx.reply(copy(member.lang).langUsage);
      return;
    }
    await d.store.setMemberLang(member.venue_id, member.tg_chat_id, arg);
    await ctx.reply(copy(arg).langSet);
  });

  bot.command("help", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (member) await ctx.reply(copy(member.lang).help);
  });

  bot.command("menu", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const venue = await d.store.getVenue(member.venue_id);
    const admin = member.role === "owner" ? adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)) : null;
    await ctx.reply(copy(member.lang).menu(publicUrl(d.baseUrl, venue.slug), admin));
  });

  bot.command("undo", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const lang = detectLang(ctx.message?.text ?? "") ?? member.lang;
    d.startRun({ venueId: member.venue_id, chatId: member.tg_chat_id, member: { ...member, lang }, text: "Undo the last change.", source: "text" });
    await ctx.replyWithChatAction("typing").catch(() => undefined);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return; // unknown command
    const member = await requireMember(d, ctx);
    if (!member) return;
    // Start first: a failed acknowledgement must not lose the message.
    const lang = detectLang(ctx.message.text) ?? member.lang;
    d.startRun({ venueId: member.venue_id, chatId: member.tg_chat_id, member: { ...member, lang }, text: ctx.message.text, source: "text" });
    await ctx.replyWithChatAction("typing").catch(() => undefined);
  });

  bot.on("callback_query:data", async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    const chatId = ctx.chat?.id;
    if (!parsed || chatId === undefined) {
      await ctx.answerCallbackQuery().catch(() => undefined);
      return;
    }
    // Answer first so the client stops spinning, then do the work, then edit the message.
    await ctx.answerCallbackQuery().catch(() => undefined);
    const r = await handleDecision({ store: d.store, messenger: d.messenger, now: d.now }, chatId, parsed.decision, parsed.setId);
    const messageId = ctx.callbackQuery.message?.message_id;
    // Edit through this update's API (removes the buttons); best-effort, never throws.
    if (r.edit && messageId !== undefined) await new TelegramMessenger(ctx.api).edit(chatId, messageId, r.edit);
    if (r.reply) await ctx.reply(r.reply);
  });

  registerMediaHandlers(bot, d);

  bot.catch(async (err) => {
    console.error("bot error:", err.error instanceof Error ? err.error.message : err.error);
    const lang = langFromCode(err.ctx.from?.language_code);
    await err.ctx.reply(copy(lang).error).catch(() => undefined);
  });
  return bot;
}
