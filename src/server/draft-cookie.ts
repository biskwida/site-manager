// src/server/draft-cookie.ts
// Server-only. The draft cookie is the only place the wizard's draft token lives: "<venueId>.<token>", httpOnly,
// sameSite lax, 7 days (set by POST /api/new). Only sha256(token) is stored. Never log the cookie value.
import type { Venue } from "../domain/types";
import type { Store } from "../store/types";
import { sha256Hex } from "./hash";

export const DRAFT_COOKIE = "sm_draft";
/** Same value as DRAFT_COOKIE (both names are part of the contract). */
export const COOKIE_NAME = DRAFT_COOKIE;
export const DRAFT_COOKIE_MAX_AGE = 7 * 24 * 3600; // seconds

export function draftCookieValue(id: string, token: string): string {
  return `${id}.${token}`;
}

/** `<venueId>.<token>`; ids are UUIDs and tokens hex, so the first dot splits them. Null when malformed. */
export function parseDraftCookie(value: string | null | undefined): { id: string; token: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const id = value.slice(0, dot);
  const token = value.slice(dot + 1);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id) || !/^[0-9a-f]{32,128}$/.test(token)) return null;
  return { id, token };
}

export function serializeDraftCookie(id: string, token: string, opts: { secure: boolean }): string {
  return `${COOKIE_NAME}=${draftCookieValue(id, token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DRAFT_COOKIE_MAX_AGE}${opts.secure ? "; Secure" : ""}`;
}

/** One cookie's value from a raw `Cookie` request header. */
export function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null; // malformed percent-encoding
    }
  }
  return null;
}

/** For server components: `readDraftFromCookies(await cookies())`. */
export function readDraftFromCookies(cookieStore: { get(name: string): { value: string } | undefined }): { id: string; token: string } | null {
  return parseDraftCookie(cookieStore.get(COOKIE_NAME)?.value);
}

/** For route handlers. */
export function readDraftFromRequest(req: Request): { id: string; token: string } | null {
  return parseDraftCookie(cookieFromHeader(req.headers.get("cookie"), COOKIE_NAME));
}

/** The venue this cookie proves ownership of (draft or live); null when malformed, unknown, or not the venue in the path. */
export async function venueFromDraftCookie(store: Store, value: string | null | undefined, pathId?: string | null): Promise<Venue | null> {
  const c = parseDraftCookie(value);
  if (!c) return null;
  if (pathId != null && c.id !== pathId) return null;
  const venue = await store.findVenueByDraftToken(sha256Hex(c.token));
  return venue && venue.id === c.id ? venue : null;
}
