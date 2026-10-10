import type { Config } from "../config";

export type LinkConfig = Pick<Config, "telegramBotUsername" | "messengerPageHandle" | "instagramUsername" | "whatsappNumber">;

/** Deep links that open a chat with our bot and hand over the invite code (handleInbound reads it as text or referral). */
export function startLinks(cfg: LinkConfig, code: string): { telegram?: string; messenger?: string; instagram?: string; whatsapp?: string } {
  const c = encodeURIComponent(code);
  return {
    ...(cfg.telegramBotUsername ? { telegram: `https://t.me/${cfg.telegramBotUsername}?start=${c}` } : {}),
    ...(cfg.messengerPageHandle ? { messenger: `https://m.me/${cfg.messengerPageHandle}?ref=${c}` } : {}),
    ...(cfg.instagramUsername ? { instagram: `https://ig.me/m/${cfg.instagramUsername}?ref=${c}` } : {}),
    ...(cfg.whatsappNumber ? { whatsapp: `https://wa.me/${cfg.whatsappNumber}?text=${c}` } : {}),
  };
}
