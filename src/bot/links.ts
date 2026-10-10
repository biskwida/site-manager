// src/bot/links.ts
// URL helpers and the invite lifetime, shared by bot.ts, inbound.ts and the scripts. Kept apart so inbound.ts does not import bot.ts (which imports inbound.ts).
export const INVITE_TTL_MS = 7 * 24 * 3_600_000;

export function adminUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl}/admin/${slug}?key=${token}`;
}
export function publicUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/${slug}`;
}
