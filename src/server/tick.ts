// src/server/tick.ts
import type { Messenger } from "../bot/messenger";
import type { TrialBilling } from "../billing/reminders";
import type { SyncDeps } from "../destinations/sync";
import type { Deployer } from "../deploy/types";
import type { DraftFn } from "../social/comments-draft";
import type { Store } from "../store/types";
import { runTick } from "../tick";
import { authorizeAdminAccess, sameOrigin } from "./admin-auth";
import type { SessionUser } from "./session";

/**
 * Auth: x-tick-secret header, Authorization: Bearer <TICK_SECRET> (Vercel Cron with CRON_SECRET), ?key=<admin token> (one venue), or
 * ?slug=<venue> with the signed-in owner's session (the account dashboard's deploy nudge; a POST then needs a same-host Origin/Referer).
 * A ?key= that does not match is refused even when a session exists.
 */
export async function handleTickRequest(req: Request, deps: { config: { tickSecret: string }; store: Store; messenger: Messenger; deployer?: Deployer | null; sync?: SyncDeps | null; comments?: { draft: DraftFn } | null; billing?: TrialBilling | null; sessionUser?: () => Promise<Pick<SessionUser, "id"> | null> }, now = new Date()): Promise<Response> {
  const url = new URL(req.url);
  const secret = deps.config.tickSecret;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const global = !!secret && (req.headers.get("x-tick-secret") === secret || bearer === secret);
  let venueId: string | undefined;
  if (!global) {
    const key = url.searchParams.get("key");
    const slug = url.searchParams.get("slug");
    let venue = null;
    if (key) venue = await deps.store.findVenueByAdminToken(key); // any key names its venue; a wrong key is never rescued by a session
    else if (slug) {
      const access = await authorizeAdminAccess(null, slug, { store: deps.store, sessionUser: deps.sessionUser ?? (async () => null) });
      if (access && req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) return new Response("forbidden", { status: 403 });
      venue = access?.venue ?? null;
    }
    if (!venue) return new Response("unauthorized", { status: 401 });
    venueId = venue.id;
  }
  const report = await runTick({ store: deps.store, messenger: deps.messenger, now, venueId, deployer: deps.deployer ?? null, sync: deps.sync ?? null, comments: deps.comments ?? null, billing: deps.billing ?? null });
  return Response.json({ ok: true, at: now.toISOString(), ...report });
}
