// src/destinations/store-hook.ts
// Wraps a Store so that every successful applyChangeSet (bot button, dashboard, tick, agent) also pushes the
// set to the venue's destinations and records the outcome. Everything else passes through untouched.
import type { Store } from "../store/types";
import { enqueueForChangeSet, HOOK_LEASE_MS, runDestinationQueue, type SyncDeps } from "./sync";

export function withDestinationSync(store: Store, d: SyncDeps, now: () => Date = () => new Date()): Store {
  const log = d.log ?? ((s: string) => console.log(s));
  const applyChangeSet: Store["applyChangeSet"] = async (id, nowIso) => {
    const r = await store.applyChangeSet(id, nowIso);
    if (r !== "applied") return r;
    try {
      const cs = await store.getChangeSet(id);
      // The new rows carry a lease so a concurrent tick leaves them alone; the forced run below ignores next_at and
      // pushes each destination's queue in order (an earlier failed set first, then this one), leaving alone a row another
      // approval is still pushing.
      const rows = await enqueueForChangeSet(store, cs, now(), { leaseMs: HOOK_LEASE_MS });
      for (const destinationId of new Set(rows.map((r) => r.destination_id))) {
        const ownIds = rows.filter((r) => r.destination_id === destinationId).map((r) => r.id);
        await runDestinationQueue(d, destinationId, now(), { force: true, venueId: cs.venue_id, ownIds });
      }
    } catch (e) {
      log(`[destinations] push after apply ${id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return r;
  };
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "applyChangeSet") return applyChangeSet;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
