// src/destinations/store-hook.ts
// Wraps a Store so that every successful applyChangeSet (bot button, dashboard, tick, agent) also pushes the
// set to the venue's destinations and records the outcome. Everything else passes through untouched.
import type { Store } from "../store/types";
import { enqueueForChangeSet, runSync, type SyncDeps } from "./sync";

export function withDestinationSync(store: Store, d: SyncDeps, now: () => Date = () => new Date()): Store {
  const log = d.log ?? ((s: string) => console.log(s));
  const applyChangeSet: Store["applyChangeSet"] = async (id, nowIso) => {
    const r = await store.applyChangeSet(id, nowIso);
    if (r !== "applied") return r;
    try {
      const cs = await store.getChangeSet(id);
      for (const sync of await enqueueForChangeSet(store, cs, now())) await runSync(d, sync, now());
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
