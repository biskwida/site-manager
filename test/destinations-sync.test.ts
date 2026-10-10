// test/destinations-sync.test.ts
import { describe, expect, it } from "vitest";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { BACKOFF_MS, enqueueForChangeSet, runPendingSyncs, syncLines } from "@/src/destinations/sync";
import { planChanges } from "@/src/domain/changes";
import type { Change } from "@/src/domain/types";
import { FakeWordPress } from "./fake-wordpress";
import { makeDemo } from "./helpers";

const KEY = parseSecretKey("ab".repeat(32));
const T0 = new Date("2026-10-09T09:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const edit: Change = {
  position: 0, op: "wp_edit_page", entity: "wp_page", entity_id: "2",
  before: { title: "About", content: "<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/" },
  after: { title: "About", content: "<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/", replacements: [{ find: "banitsa every morning", replace: "banitsa and kozunak every morning" }], preview_url: null },
};

async function connected() {
  const demo = await makeDemo();
  const wp = new FakeWordPress();
  const token = (wp.connected() as unknown as { o: { token: string } }).o.token;
  await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "wordpress", config: { site_url: wp.siteUrl, site_name: "Smoke Café" }, secrets: encryptSecrets({ token }, KEY) });
  const logs: string[] = [];
  const d = { store: demo.store, secretKey: KEY, fetch: wp.fetch, log: (s: string) => logs.push(s) };
  const set = (changes: Change[]) => demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
  return { ...demo, wp, d, logs, set };
}

describe("enqueueForChangeSet", () => {
  it("creates one pending row per destination with relevant changes, none for plain menu edits", async () => {
    const { store, venue, items, set, d } = await connected();
    const site = await store.getSite(venue.id);
    const plain = await set(planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }));
    expect(await enqueueForChangeSet(d.store, plain, T0)).toEqual([]);
    const wpSet = await set([edit]);
    const rows = await enqueueForChangeSet(d.store, wpSet, T0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 0, change_set_id: wpSet.id, payload: { kind: "wordpress", changes: 1 }, next_at: T0.toISOString() });
  });
});

describe("withDestinationSync", () => {
  it("pushes right after a successful apply and reports the line", async () => {
    const demo = await connected();
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("applied");
    expect(demo.wp.pages.get(2)?.content).toContain("kozunak");
    expect(await syncLines(store, cs.id, "bg")).toEqual(["WordPress: обновено ✅"]);
    expect(await syncLines(store, cs.id, "en")).toEqual(["WordPress: updated ✅"]);
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("skipped"); // no second push
    expect(await store.listSyncs({ changeSetId: cs.id })).toHaveLength(1);
    expect(await store.getVenueBySlug("agala")).toMatchObject({ id: demo.venue.id }); // passthrough still works
  });

  it("retries with backoff when the site is down, then succeeds from the tick runner", async () => {
    const demo = await connected();
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    demo.wp.unreachable = true;
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("applied");
    const [row] = await store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "pending", attempts: 1, next_at: at(BACKOFF_MS[0]).toISOString() });
    expect(row.last_error).toMatch(/unreachable/);
    expect(await syncLines(store, cs.id, "bg")).toEqual(["WordPress: не успях да обновя, ще опитам пак"]);
    expect(demo.logs.at(-1)).toMatch(/attempt 1/);
    expect(await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(30_000) })).toEqual({ done: [], retry: [], failed: [] }); // not due yet
    demo.wp.unreachable = false;
    expect(await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(BACKOFF_MS[0]) })).toEqual({ done: [row.id], retry: [], failed: [] });
    expect(demo.wp.pages.get(2)?.content).toContain("kozunak");
    expect(await syncLines(store, cs.id, "en")).toEqual(["WordPress: updated ✅"]);
  });

  it("gives up after five attempts and marks the destination", async () => {
    const demo = await connected();
    demo.wp.unreachable = true;
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    await store.applyChangeSet(cs.id, T0.toISOString());
    let clock = 0;
    for (let i = 1; i < 5; i++) {
      clock += BACKOFF_MS[i - 1];
      const r = await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(clock) });
      expect(r.done).toEqual([]);
      expect(i < 4 ? r.retry : r.failed).toHaveLength(1);
    }
    const [row] = await store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "failed", attempts: 5 });
    expect(await store.getDestination(demo.venue.id, "wordpress")).toMatchObject({ status: "error", last_error: expect.stringMatching(/unreachable/) });
    expect(await syncLines(store, cs.id, "en")).toEqual([expect.stringMatching(/^WordPress: error: WordPress unreachable/)]);
    demo.wp.unreachable = false;
    const again = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    await store.applyChangeSet(again.id, T0.toISOString());
    expect(await store.getDestination(demo.venue.id, "wordpress")).toMatchObject({ status: "connected", last_error: null }); // recovers
  });

  it("fails at once on a non-retryable error", async () => {
    const demo = await connected();
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [{ ...edit, entity_id: "999" }] });
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect((await store.listSyncs({ changeSetId: cs.id }))[0]).toMatchObject({ status: "failed", attempts: 1, last_error: "No such page." });
  });
});
