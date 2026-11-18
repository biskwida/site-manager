// test/google-helpers.ts
// A demo venue with a Google listing connected to a FakeGoogle location, behind the destination-sync store hook (so every
// applied set pushes to Google), plus applyOps/applyChanges to apply sets directly. Shared by the Google test files.
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { GooglePeriod, GoogleSpecialPeriod } from "@/src/destinations/google-api";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import type { SyncDeps } from "@/src/destinations/sync";
import { planChanges } from "@/src/domain/changes";
import type { Change, ChangeOp } from "@/src/domain/types";
import { FakeGoogle } from "./fake-google";
import { makeDemo } from "./helpers";

export const KEY = parseSecretKey("ab".repeat(32));
export const T0 = new Date("2026-11-13T09:00:00.000Z");

export async function connectedGoogle(opts: { now?: Date; destination?: boolean; config?: Record<string, unknown>; regularHours?: GooglePeriod[]; specialHours?: GoogleSpecialPeriod[]; hasGoogleUpdated?: boolean; before?: ChangeOp[] } = {}) {
  const demo = await makeDemo();
  const fake = new FakeGoogle();
  const account = fake.addAccount("Кафе Агала");
  const loc = fake.addLocation(account.name, { regularHours: opts.regularHours, specialHours: opts.specialHours, hasGoogleUpdated: opts.hasGoogleUpdated });
  let now = opts.now ?? T0;
  const logs: string[] = [];
  const d: SyncDeps = { store: demo.store, secretKey: KEY, fetch: fake.fetch, log: (s: string) => logs.push(s), google: { clientId: fake.clientId, clientSecret: fake.clientSecret } };
  const store = withDestinationSync(demo.store, d, () => now);
  const applyOps = async (ops: ChangeOp[]) => {
    const changes = planChanges(await store.getSite(demo.venue.id), ops, { newId: randomUUID, now: now.toISOString() });
    return applyChanges(changes);
  };
  const applyChanges = async (changes: Change[], extra: { undoes_id?: string; source?: "text" | "undo" } = {}) => {
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_ref: "tg:1001", summary_bg: "Промяна", summary_en: "Change", preview_bg: "p", preview_en: "p", source: extra.source ?? "text", status: "proposed", changes, undoes_id: extra.undoes_id ?? null });
    expect(await store.applyChangeSet(cs.id, now.toISOString())).toBe("applied");
    return store.getChangeSet(cs.id);
  };
  if (opts.before) await applyOps(opts.before);
  if (opts.destination !== false) {
    await demo.store.upsertDestination({
      venue_id: demo.venue.id,
      kind: "google",
      config: { account_name: account.name, location_name: loc.name, location_v4: loc.v4, title: "Test Cafe", address: "1 Main St", connected_at: T0.toISOString(), google_account_name: "Owner", ...opts.config },
      secrets: encryptSecrets({ refresh_token: account.refresh_token }, KEY),
    });
  }
  fake.calls.length = 0;
  const dest = async () => (await demo.store.listDestinations(demo.venue.id)).find((x) => x.kind === "google")!;
  const rows = async (csId: string) => (await store.listSyncs({ changeSetId: csId })).filter((r) => r.payload.kind === "google");
  const setNow = (t: Date) => void (now = t);
  return { ...demo, store, fake, account, loc, d, logs, applyOps, applyChanges, dest, rows, setNow };
}
