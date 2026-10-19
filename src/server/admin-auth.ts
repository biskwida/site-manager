// src/server/admin-auth.ts
// Server-only. The one authorization for the dashboard's admin API (every route under app/api/admin/[slug]) and its pages:
// - a legacy `?key=` admin token that belongs to this slug (today's owners, unchanged), or
// - a signed-in account (Supabase session) linked to the venue as owner in venue_users.
// Authorization is by user id and venue_users only, never by email.
import type { Venue } from "../domain/types";
import type { Store } from "../store/types";
import { getSessionUser, type SessionUser } from "./session";

export interface AdminAuthDeps {
  store: Store;
  /** The signed-in account of this request; defaults to the Supabase session cookies. Tests inject one. */
  sessionUser?: () => Promise<SessionUser | null>;
}

export type AdminAuth = { venue: Venue; via: "key"; key: string } | { venue: Venue; via: "session"; key?: undefined };

/**
 * Key first: when a key is given it must match this slug, or the answer is null (a wrong key never falls back to a session).
 * Without a key, the session user must be an owner of the venue. Null for everything else.
 */
export async function authorizeAdminAccess(key: string | null | undefined, slug: string, deps: AdminAuthDeps): Promise<AdminAuth | null> {
  if (key) {
    const venue = await deps.store.findVenueByAdminToken(key);
    return venue && venue.slug === slug ? { venue, via: "key", key } : null;
  }
  const user = await (deps.sessionUser ?? getSessionUser)();
  if (!user) return null;
  const venue = await deps.store.getVenueBySlug(slug);
  if (!venue || !(await deps.store.isVenueOwner(venue.id, user.id))) return null;
  return { venue, via: "session" };
}

/** authorizeAdminAccess with the key read from the request's `?key=`. */
export function authorizeAdmin(req: Request, slug: string, deps: AdminAuthDeps): Promise<AdminAuth | null> {
  return authorizeAdminAccess(new URL(req.url).searchParams.get("key"), slug, deps);
}
