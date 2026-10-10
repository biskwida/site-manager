// src/server/tick.ts
import type { Messenger } from "../bot/messenger";
import type { SyncDeps } from "../destinations/sync";
import type { Store } from "../store/types";
import { runTick } from "../tick";

/** Auth: x-tick-secret header, Authorization: Bearer <TICK_SECRET> (Vercel Cron with CRON_SECRET), or ?key=<admin token> (one venue). */
export async function handleTickRequest(req: Request, deps: { config: { tickSecret: string }; store: Store; messenger: Messenger; sync?: SyncDeps | null }, now = new Date()): Promise<Response> {
  const url = new URL(req.url);
  const secret = deps.config.tickSecret;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const global = !!secret && (req.headers.get("x-tick-secret") === secret || bearer === secret);
  let venueId: string | undefined;
  if (!global) {
    const key = url.searchParams.get("key");
    const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
    if (!venue) return new Response("unauthorized", { status: 401 });
    venueId = venue.id;
  }
  const report = await runTick({ store: deps.store, messenger: deps.messenger, now, venueId, sync: deps.sync ?? null });
  return Response.json({ ok: true, at: now.toISOString(), ...report });
}
