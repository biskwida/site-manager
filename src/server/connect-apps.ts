// src/server/connect-apps.ts
// Server-only. Which messaging apps an owner can connect, and the deep link that hands each app the owner's invite code.
// This is the seam to build/channels: today members are Telegram-only and the links are built here; after that branch
// merges, connectLinks delegates to src/channels/links.ts and memberApp parses chat_ref (see the "wire on merge" notes).
import type { Config } from "../config";
import type { Member } from "../domain/types";

export type AppChannel = "telegram" | "whatsapp" | "messenger" | "instagram";
/** Display and link order. */
export const APP_ORDER: readonly AppChannel[] = ["telegram", "whatsapp", "messenger", "instagram"];

export type AppsConfig = Pick<Config, "telegramBotUsername" | "messengerPageHandle" | "instagramUsername" | "whatsappNumber" | "channelsEnabled">;

/**
 * Telegram when TELEGRAM_BOT_USERNAME is set; WhatsApp, Messenger and Instagram when their handle is set AND CHANNELS_ENABLED
 * is true. The gate keeps the Meta apps hidden in production until the code that answers them is deployed.
 */
export function enabledApps(config: AppsConfig): AppChannel[] {
  const on: Record<AppChannel, boolean> = {
    telegram: !!config.telegramBotUsername,
    whatsapp: config.channelsEnabled && !!config.whatsappNumber,
    messenger: config.channelsEnabled && !!config.messengerPageHandle,
    instagram: config.channelsEnabled && !!config.instagramUsername,
  };
  return APP_ORDER.filter((a) => on[a]);
}

/**
 * One owner link per enabled app, the code URL-encoded. Same URL shapes as startLinks on build/channels.
 * Replace with src/channels/links.ts startLinks after build/channels merges.
 */
export function connectLinks(config: AppsConfig, code: string): { app: AppChannel; url: string }[] {
  const c = encodeURIComponent(code);
  const url: Record<AppChannel, () => string> = {
    telegram: () => `https://t.me/${config.telegramBotUsername}?start=${c}`,
    whatsapp: () => `https://wa.me/${config.whatsappNumber}?text=${c}`,
    messenger: () => `https://m.me/${config.messengerPageHandle}?ref=${c}`,
    instagram: () => `https://ig.me/m/${config.instagramUsername}?ref=${c}`,
  };
  return enabledApps(config).map((app) => ({ app, url: url[app]() }));
}

/**
 * The app a member is linked through. Today every member is a Telegram chat (tg_chat_id).
 * After build/channels merges, parse member.chat_ref ("tg:" | "wa:" | "fb:" | "ig:" + id) instead.
 */
export function memberApp(member: Member): AppChannel {
  void member;
  return "telegram";
}

export interface ConnectedApp {
  app: AppChannel;
  owners: number;
  staff: number;
}

/** Linked chats per app (owners and staff), in APP_ORDER; apps with no member are left out. */
export function connectedApps(members: Member[]): ConnectedApp[] {
  const by = new Map<AppChannel, ConnectedApp>();
  for (const m of members) {
    const app = memberApp(m);
    const row = by.get(app) ?? { app, owners: 0, staff: 0 };
    if (m.role === "owner") row.owners++;
    else row.staff++;
    by.set(app, row);
  }
  return APP_ORDER.flatMap((a) => by.get(a) ?? []);
}
