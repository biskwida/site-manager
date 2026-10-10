// src/destinations/sync.ts
// Server-only. Queues one sync row per (change set, destination) and pushes it; failures retry with backoff from the tick.
import type { ChangeSet, Lang } from "../domain/types";
import type { DestinationSync, Store } from "../store/types";
import { adapterFor } from "./registry";
import { decryptSecrets } from "./secrets";
import type { PushResult } from "./types";

export interface SyncDeps {
  store: Store;
  secretKey: Buffer | null;
  fetch?: typeof fetch;
  log?: (s: string) => void;
}
export const BACKOFF_MS = [60_000, 300_000, 1_500_000, 7_200_000, 36_000_000] as const;
export const MAX_ATTEMPTS = 5;

/** One pending row per destination that has something to push for this set. */
export async function enqueueForChangeSet(store: Store, cs: ChangeSet, now: Date): Promise<DestinationSync[]> {
  const out: DestinationSync[] = [];
  for (const dest of await store.listDestinations(cs.venue_id)) {
    if (dest.status === "disconnected") continue;
    const adapter = adapterFor(dest.kind);
    if (!adapter) continue;
    const relevant = adapter.relevant(cs.changes);
    if (relevant.length === 0) continue;
    out.push(await store.createSync({ venue_id: cs.venue_id, destination_id: dest.id, change_set_id: cs.id, payload: { kind: dest.kind, changes: relevant.length }, next_at: now.toISOString() }));
  }
  return out;
}

/** Runs one attempt; returns null when the row is not pending or its destination is gone. */
export async function runSync(d: SyncDeps, sync: DestinationSync, now: Date): Promise<PushResult | null> {
  const log = d.log ?? ((s: string) => console.log(s));
  if (sync.status !== "pending") return null;
  const venue = await d.store.getVenue(sync.venue_id);
  const dest = (await d.store.listDestinations(sync.venue_id)).find((x) => x.id === sync.destination_id);
  const withSecrets = dest ? await d.store.getDestination(sync.venue_id, dest.kind) : null;
  const adapter = dest ? adapterFor(dest.kind) : null;
  if (!dest || !withSecrets || !adapter) {
    await d.store.updateSync(sync.id, { status: "failed", attempts: sync.attempts + 1, last_error: "destination not found", updated_at: now.toISOString() });
    return null;
  }
  const attempts = sync.attempts + 1;
  let result: PushResult;
  try {
    if (!d.secretKey) throw new Error("DESTINATION_SECRET_KEY is not set");
    const secrets = decryptSecrets(withSecrets.secrets, d.secretKey);
    const cs = await d.store.getChangeSet(sync.change_set_id);
    result = await adapter.push({ venue, destination: dest, secrets, changeSet: cs, changes: adapter.relevant(cs.changes), fetch: d.fetch, now });
  } catch (e) {
    result = { ok: false, retry: false, error: e instanceof Error ? e.message : String(e), line: { bg: "WordPress: грешка при свързването", en: "WordPress: connection error" } };
  }
  if (result.ok) {
    await d.store.updateSync(sync.id, { status: "done", attempts, last_error: null, result: result.result, updated_at: now.toISOString() });
    if (dest.status === "error") await d.store.updateDestination(dest.id, { status: "connected", last_error: null });
    return result;
  }
  const giveUp = !result.retry || attempts >= MAX_ATTEMPTS;
  // Attempt n waits BACKOFF_MS[n-1]; attempts past the table reuse its last entry.
  const nextAt = new Date(now.getTime() + (BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1])).toISOString();
  await d.store.updateSync(sync.id, { status: giveUp ? "failed" : "pending", attempts, next_at: nextAt, last_error: result.error, updated_at: now.toISOString() });
  if (giveUp) await d.store.updateDestination(dest.id, { status: "error", last_error: result.error });
  log(`[destinations] ${dest.kind} push for set ${sync.change_set_id} failed (attempt ${attempts}${giveUp ? ", giving up" : `, next at ${nextAt}`}): ${result.error}`);
  return result;
}

/** Pushes every pending row that is due; called from the tick (and right after an apply by the store hook). */
export async function runPendingSyncs(d: SyncDeps, opts: { venueId?: string; now: Date }): Promise<{ done: string[]; retry: string[]; failed: string[] }> {
  const report = { done: [] as string[], retry: [] as string[], failed: [] as string[] };
  for (const sync of await d.store.listSyncs({ venueId: opts.venueId, status: ["pending"], dueBefore: opts.now.toISOString(), limit: 50 })) {
    const r = await runSync(d, sync, opts.now);
    if (!r) {
      report.failed.push(sync.id);
      continue;
    }
    const fresh = await d.store.getSync(sync.id);
    (fresh.status === "done" ? report.done : fresh.status === "failed" ? report.failed : report.retry).push(sync.id);
  }
  return report;
}

/** One line per destination for the owner's confirmation ("WordPress: updated ✅"), from the sync rows of the set. */
export async function syncLines(store: Store, changeSetId: string, lang: Lang): Promise<string[]> {
  const rows = await store.listSyncs({ changeSetId });
  return rows.map((s) => {
    const name = String(s.payload.kind ?? "destination") === "wordpress" ? "WordPress" : String(s.payload.kind);
    if (s.status === "done") return lang === "bg" ? `${name}: обновено ✅` : `${name}: updated ✅`;
    if (s.status === "pending") return lang === "bg" ? `${name}: не успях да обновя, ще опитам пак` : `${name}: update failed, will retry`;
    return lang === "bg" ? `${name}: грешка: ${s.last_error ?? ""}` : `${name}: error: ${s.last_error ?? ""}`;
  });
}
