// test/destinations-sync.test.ts
import { describe, expect, it } from "vitest";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { BACKOFF_MS, enqueueForChangeSet, runDestinationQueue, runPendingSyncs, syncLines } from "@/src/destinations/sync";
import { invertChanges, planChanges } from "@/src/domain/changes";
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
    expect((await store.listSyncs({ changeSetId: cs.id }))[0]).toMatchObject({ status: "failed", attempts: 1, last_error: "sm_not_found: No such page." });
    expect(await syncLines(store, cs.id, "en")).toEqual(["WordPress: error: No such page."]);
  });
});

const ORIGINAL = "<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->";
const A_CONTENT = "<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->";
const B_CONTENT = "<!-- wp:paragraph --><p>We bake banitsa, kozunak and pogacha every morning.</p><!-- /wp:paragraph -->";
const editB: Change = {
  ...edit,
  before: { ...edit.after!, replacements: undefined, preview_url: undefined },
  after: { ...edit.after!, content: B_CONTENT, replacements: [{ find: "banitsa and kozunak", replace: "banitsa, kozunak and pogacha" }] },
};

describe("per-destination queue", () => {
  const propose = (demo: Awaited<ReturnType<typeof connected>>, changes: Change[], extra: Record<string, unknown> = {}) =>
    demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes, ...extra });

  it("pushes an earlier failed set before a newer set on the same page, so the newer content wins", async () => {
    const demo = await connected();
    let now = T0;
    const store = withDestinationSync(demo.store, demo.d, () => now);
    demo.wp.unreachable = true;
    const a = await propose(demo, [edit]);
    expect(await store.applyChangeSet(a.id, now.toISOString())).toBe("applied");
    const [rowA] = await store.listSyncs({ changeSetId: a.id });
    expect(rowA).toMatchObject({ status: "pending", attempts: 1 });
    demo.wp.unreachable = false;
    now = at(10_000); // before A's backoff is over: the hook's forced run still pushes A first
    const b = await propose(demo, [editB]);
    expect(await store.applyChangeSet(b.id, now.toISOString())).toBe("applied");
    expect((await store.getSync(rowA.id)).status).toBe("done");
    expect((await store.listSyncs({ changeSetId: b.id }))[0]).toMatchObject({ status: "done", attempts: 1 });
    const applies = demo.wp.calls.filter((c) => c.path === "/page/2/apply").map((c) => (c.body as { content: string }).content);
    expect(applies).toEqual([A_CONTENT, B_CONTENT]);
    expect(demo.wp.pages.get(2)?.content).toBe(B_CONTENT);
  });

  it("an undo approved while the site is down waits behind the failed set, and the tick pushes both in order", async () => {
    const demo = await connected();
    let now = T0;
    const store = withDestinationSync(demo.store, demo.d, () => now);
    demo.wp.unreachable = true;
    const a = await propose(demo, [edit]);
    await store.applyChangeSet(a.id, now.toISOString());
    now = at(20_000);
    const undo = await propose(demo, invertChanges([edit]), { source: "undo", undoes_id: a.id });
    expect(await store.applyChangeSet(undo.id, now.toISOString())).toBe("applied");
    const rowA = (await store.listSyncs({ changeSetId: a.id }))[0];
    const rowU = (await store.listSyncs({ changeSetId: undo.id }))[0];
    expect(rowA).toMatchObject({ status: "pending", attempts: 2 });
    expect(rowU).toMatchObject({ status: "pending", attempts: 0, next_at: rowA.next_at });
    demo.wp.unreachable = false;
    const r = await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: new Date(rowA.next_at) });
    expect(r).toEqual({ done: [rowA.id, rowU.id], retry: [], failed: [] });
    const applies = demo.wp.calls.filter((c) => c.path === "/page/2/apply").map((c) => (c.body as { content: string }).content);
    expect(applies).toEqual([A_CONTENT, ORIGINAL]);
    expect(demo.wp.pages.get(2)?.content).toBe(ORIGINAL);
  });

  it("a failing head blocks the rows behind it: they stay pending with the head's next_at", async () => {
    const demo = await connected();
    let now = T0;
    const store = withDestinationSync(demo.store, demo.d, () => now);
    demo.wp.unreachable = true;
    const a = await propose(demo, [edit]);
    await store.applyChangeSet(a.id, now.toISOString());
    now = at(5_000);
    const b = await propose(demo, [editB]);
    await store.applyChangeSet(b.id, now.toISOString());
    const rowA = (await store.listSyncs({ changeSetId: a.id }))[0];
    const rowB = (await store.listSyncs({ changeSetId: b.id }))[0];
    expect(rowA).toMatchObject({ status: "pending", attempts: 2, next_at: at(5_000 + BACKOFF_MS[1]).toISOString() });
    expect(rowB).toMatchObject({ status: "pending", attempts: 0, next_at: rowA.next_at });
    // A tick before that instant touches nothing; a direct queue run without force neither.
    expect(await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(BACKOFF_MS[0] * 2) })).toEqual({ done: [], retry: [], failed: [] });
    expect(await runDestinationQueue(demo.d, rowA.destination_id, at(BACKOFF_MS[0] * 2), { force: false })).toEqual({ done: [], retry: [], failed: [] });
    expect(demo.wp.calls).toHaveLength(0);
  });
});

describe("lease on rows created by the hook", () => {
  it("after the hook's immediate push fails, next_at follows the backoff (not the lease)", async () => {
    const demo = await connected();
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    demo.wp.unreachable = true;
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect((await store.listSyncs({ changeSetId: cs.id }))[0].next_at).toBe(at(BACKOFF_MS[0]).toISOString());
  });

  it("a row whose immediate push is still in flight (leased) is not picked by the tick", async () => {
    const demo = await connected();
    const cs = await demo.set([edit]);
    const [row] = await enqueueForChangeSet(demo.d.store, cs, T0, { leaseMs: 5 * 60_000 });
    expect(row.next_at).toBe(at(5 * 60_000).toISOString());
    expect(await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: T0 })).toEqual({ done: [], retry: [], failed: [] });
    expect(demo.wp.calls).toHaveLength(0);
    expect((await demo.store.getSync(row.id)).status).toBe("pending");
  });
});

describe("concurrent approvals and permanently failed rows", () => {
  const propose = (demo: Awaited<ReturnType<typeof connected>>, changes: Change[]) =>
    demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
  const applies = (demo: Awaited<ReturnType<typeof connected>>) => demo.wp.calls.filter((c) => c.path === "/page/2/apply").map((c) => (c.body as { content: string }).content);

  it("a second approval leaves a row another approval is still pushing alone, and hands its own row back to the queue", async () => {
    const demo = await connected();
    const a = await propose(demo, [edit]);
    const b = await propose(demo, [editB]);
    // Approval 1 has enqueued A (leased) and is pushing it; approval 2 enqueues B and runs its own forced queue.
    const [rowA] = await enqueueForChangeSet(demo.d.store, a, T0, { leaseMs: 5 * 60_000 });
    const [rowB] = await enqueueForChangeSet(demo.d.store, b, at(1_000), { leaseMs: 5 * 60_000 });
    const second = await runDestinationQueue(demo.d, rowB.destination_id, at(1_000), { force: true, ownIds: [rowB.id] });
    expect(second).toEqual({ done: [], retry: [], failed: [] });
    expect(applies(demo)).toEqual([]); // A is not pushed twice, B does not overtake A
    expect(await demo.store.getSync(rowB.id)).toMatchObject({ status: "pending", attempts: 0, next_at: at(1_000).toISOString() }); // lease released
    // Approval 1 finishes A and then picks up B, which is due now.
    const first = await runDestinationQueue(demo.d, rowA.destination_id, at(2_000), { force: true, ownIds: [rowA.id] });
    expect(first).toEqual({ done: [rowA.id, rowB.id], retry: [], failed: [] });
    expect(applies(demo)).toEqual([A_CONTENT, B_CONTENT]);
    expect(demo.wp.pages.get(2)?.content).toBe(B_CONTENT);
  });

  it("a tick does not overtake a row an approval is still pushing, even when rows behind it were handed back", async () => {
    const demo = await connected();
    const a = await propose(demo, [edit]);
    const b = await propose(demo, [editB]);
    const [rowA] = await enqueueForChangeSet(demo.d.store, a, T0, { leaseMs: 5 * 60_000 });
    const [rowB] = await enqueueForChangeSet(demo.d.store, b, at(1_000), { leaseMs: 5 * 60_000 });
    await runDestinationQueue(demo.d, rowB.destination_id, at(1_000), { force: true, ownIds: [rowB.id] });
    expect(await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(2_000) })).toEqual({ done: [], retry: [], failed: [] });
    expect(applies(demo)).toEqual([]);
    expect((await demo.store.getSync(rowA.id)).status).toBe("pending");
  });

  it("a row that failed for good does not hold back the rows behind it", async () => {
    const demo = await connected();
    const bad = await propose(demo, [{ ...edit, entity_id: "999" }]);
    const good = await propose(demo, [edit]);
    const [rowBad] = await enqueueForChangeSet(demo.d.store, bad, T0);
    const [rowGood] = await enqueueForChangeSet(demo.d.store, good, T0);
    const r = await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: T0 });
    expect(r).toEqual({ done: [rowGood.id], retry: [], failed: [rowBad.id] });
    expect(await demo.store.getSync(rowBad.id)).toMatchObject({ status: "failed", attempts: 1 });
    expect(demo.wp.pages.get(2)?.content).toBe(A_CONTENT);
  });
});

describe("runSync error classes and owner-facing lines", () => {
  const propose = (demo: Awaited<ReturnType<typeof connected>>, changes: Change[]) =>
    demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });

  it("treats a transient store error as retryable", async () => {
    const demo = await connected();
    const cs = await propose(demo, [edit]);
    const [row] = await enqueueForChangeSet(demo.store, cs, T0);
    let failOnce = true;
    const flaky = new Proxy(demo.store, {
      get(target, prop, receiver) {
        if (prop === "getChangeSet" && failOnce) {
          return async () => {
            failOnce = false;
            throw new Error("connection reset by peer");
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const r = await runPendingSyncs({ ...demo.d, store: flaky }, { venueId: demo.venue.id, now: T0 });
    expect(r).toEqual({ done: [], retry: [row.id], failed: [] });
    expect(await demo.store.getSync(row.id)).toMatchObject({ status: "pending", attempts: 1, next_at: at(BACKOFF_MS[0]).toISOString(), last_error: "connection reset by peer" });
    expect(await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(BACKOFF_MS[0]) })).toEqual({ done: [row.id], retry: [], failed: [] });
  });

  it("fails at once when the secrets cannot be decrypted or the key is missing", async () => {
    const demo = await connected();
    const cs = await propose(demo, [edit]);
    const [row] = await enqueueForChangeSet(demo.store, cs, T0);
    await runPendingSyncs({ ...demo.d, secretKey: Buffer.alloc(32, 7) }, { venueId: demo.venue.id, now: T0 });
    expect(await demo.store.getSync(row.id)).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/Could not decrypt/) });
    const cs2 = await propose(demo, [edit]);
    const [row2] = await enqueueForChangeSet(demo.store, cs2, T0);
    await runPendingSyncs({ ...demo.d, secretKey: null }, { venueId: demo.venue.id, now: at(BACKOFF_MS[0]) });
    expect(await demo.store.getSync(row2.id)).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/DESTINATION_SECRET_KEY/) });
  });

  it("stores the plugin's error code and maps known codes to the owner's language", async () => {
    const demo = await connected();
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    demo.wp.failNext = { status: 401, code: "sm_unauthorized", message: "Missing or invalid plugin token." };
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect((await store.listSyncs({ changeSetId: cs.id }))[0]).toMatchObject({ status: "failed", last_error: "sm_unauthorized: Missing or invalid plugin token." });
    expect(await store.getDestination(demo.venue.id, "wordpress")).toMatchObject({ status: "error", last_error: "sm_unauthorized: Missing or invalid plugin token." });
    expect(await syncLines(store, cs.id, "bg")).toEqual(["WordPress: грешка: връзката с WordPress вече не е валидна; свържете сайта отново с /connect"]);
    expect(await syncLines(store, cs.id, "en")).toEqual(["WordPress: error: the WordPress connection is no longer valid; reconnect with /connect"]);
  });

  it("says the change was not sent when the venue has no WordPress connection", async () => {
    const demo = await makeDemo();
    const cs = await demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    expect(await syncLines(demo.store, cs.id, "bg")).toEqual(["WordPress: не е свързан, промяната не е изпратена"]);
    expect(await syncLines(demo.store, cs.id, "en")).toEqual(["WordPress: not connected, the change was not sent"]);
    const dest = await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "wordpress", config: { site_url: "https://cafe.example" }, secrets: "x" });
    await demo.store.updateDestination(dest.id, { status: "disconnected" });
    expect(await syncLines(demo.store, cs.id, "en")).toEqual(["WordPress: not connected, the change was not sent"]);
    const site = await demo.store.getSite(demo.venue.id);
    const plain = await demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: demo.items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
    expect(await syncLines(demo.store, plain.id, "bg")).toEqual([]); // nothing for WordPress in the set
  });
});
