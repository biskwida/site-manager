// src/bot/links.ts
// URL helpers and the invite lifetime, shared by bot.ts, inbound.ts and the scripts. Kept apart so inbound.ts does not import bot.ts (which imports inbound.ts).
export const INVITE_TTL_MS = 7 * 24 * 3_600_000;

export function adminUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl}/admin/${slug}?key=${token}`;
}
export function publicUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/${slug}`;
}
/**
 * The owner's dashboard link in chat: `/dashboard/<slug>` (a signed-in account, no secret in the link) when the venue has an
 * owner account, else the legacy key link. `token` is only read in the second case.
 */
export function dashboardLink(baseUrl: string, venue: { slug: string }, token: string, hasAccount: boolean): string {
  return hasAccount ? `${baseUrl}/dashboard/${venue.slug}` : adminUrl(baseUrl, venue.slug, token);
}
