// src/server/connect-apps.ts
// Server-only. Which messaging apps an owner can connect, and the deep link that hands each app the owner's invite code.
// Links come from src/channels/links.ts (startLinks); a member's app comes from its chat_ref (src/channels/ref.ts).
import { INVITE_TTL_MS } from "../bot/bot";
import { startLinks } from "../channels/links";
import { channelOf } from "../channels/ref";
import type { Config } from "../config";
import type { Member, Venue } from "../domain/types";
import type { Store } from "../store/types";

export type AppChannel = "telegram" | "whatsapp" | "messenger" | "instagram";
/** Display and link order. */
export const APP_ORDER: readonly AppChannel[] = ["telegram", "whatsapp", "messenger", "instagram"];

export type AppsConfig = Pick<Config, "telegramBotUsername" | "messengerPageHandle" | "instagramUsername" | "whatsappNumber" | "channelsEnabled" | "metaPageToken" | "whatsappToken">;

/**
 * Telegram when TELEGRAM_BOT_USERNAME is set. WhatsApp, Messenger and Instagram when CHANNELS_ENABLED is true, their link
 * handle is set AND the channel's token is configured (WHATSAPP_TOKEN; META_PAGE_TOKEN for Messenger and Instagram), so an
 * owner is never sent to an app this deployment does not answer.
 */
export function enabledApps(config: AppsConfig): AppChannel[] {
  const on: Record<AppChannel, boolean> = {
    telegram: !!config.telegramBotUsername,
    whatsapp: config.channelsEnabled && !!config.whatsappToken && !!config.whatsappNumber,
    messenger: config.channelsEnabled && !!config.metaPageToken && !!config.messengerPageHandle,
    instagram: config.channelsEnabled && !!config.metaPageToken && !!config.instagramUsername,
  };
  return APP_ORDER.filter((a) => on[a]);
}

/**
 * An owner link: `url` carries the code; `dest` names where it goes (written out for an owner whose link does not open);
 * `chat` opens that chat without the code, for an owner who pastes the code by hand.
 */
export type ConnectLink = { app: AppChannel; url: string; dest: string; chat: string };

/** What the owner looks for in each app: the bot's username, the WhatsApp number, the Page link, the Instagram account. */
function destOf(config: AppsConfig, app: AppChannel): { dest: string; chat: string } {
  const h = (v: string | null) => encodeURIComponent(v ?? "");
  if (app === "telegram") return { dest: `@${config.telegramBotUsername}`, chat: `https://t.me/${h(config.telegramBotUsername)}` };
  if (app === "whatsapp") return { dest: `+${config.whatsappNumber}`, chat: `https://wa.me/${h(config.whatsappNumber)}` };
  if (app === "messenger") return { dest: `m.me/${config.messengerPageHandle}`, chat: `https://m.me/${h(config.messengerPageHandle)}` };
  return { dest: `@${config.instagramUsername}`, chat: `https://ig.me/m/${h(config.instagramUsername)}` };
}

/** One owner link per enabled app (startLinks URL-encodes the code). */
export function connectLinks(config: AppsConfig, code: string): ConnectLink[] {
  const all = startLinks(config, code);
  return enabledApps(config).flatMap((app) => (all[app] ? [{ app, url: all[app], ...destOf(config, app) }] : []));
}

const BY_CHANNEL = { tg: "telegram", wa: "whatsapp", fb: "messenger", ig: "instagram" } as const;
/** The app a member is linked through, from its chat_ref ("tg:" | "wa:" | "fb:" | "ig:" + id). */
export function memberApp(member: Member): AppChannel {
  return BY_CHANNEL[channelOf(member.chat_ref)];
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

/** Fresh owner codes per venue per hour, shared by the wizard's POST /api/new/[id]/invite and the dashboard's new_owner_code. */
export const INVITES_PER_HOUR = 10;
const HOUR_MS = 3_600_000;
export const inviteRateKey = (venueId: string) => `invite:${venueId}`;

export interface OwnerCode {
  code: string;
  links: ConnectLink[];
  expires_at: string;
}
export type OwnerCodeResult =
  | ({ ok: true } & OwnerCode)
  | { ok: false; error: "not_live" | "rate_limited"; bg: string; en: string };

export const NOT_LIVE = { ok: false, error: "not_live", bg: "Първо публикувайте сайта.", en: "Publish the site first." } as const;
export const TOO_MANY_CODES = { ok: false, error: "rate_limited", bg: "Твърде много нови кодове за час. Опитайте по-късно.", en: "Too many new codes this hour. Try again later." } as const;

/**
 * A new single-use owner invite (INVITE_TTL_MS) for connecting one more app, with its links. Each app links with its own
 * code, so "connect another app" always needs a fresh one. Live venues only; INVITES_PER_HOUR per venue.
 */
export async function newOwnerCode(store: Store, config: AppsConfig, venue: Venue, now: Date): Promise<OwnerCodeResult> {
  if (venue.status !== "live") return NOT_LIVE;
  if (!(await store.bumpRateLimit(inviteRateKey(venue.id), HOUR_MS, INVITES_PER_HOUR, now.toISOString()))) return TOO_MANY_CODES;
  const expires_at = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  const code = await store.createInvite(venue.id, "owner", expires_at);
  return { ok: true, code, links: connectLinks(config, code), expires_at };
}
