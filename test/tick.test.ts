// test/tick.test.ts
import { describe, expect, it } from "vitest";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { FakeDeployer } from "@/src/deploy/fake";
import { startDeploy } from "@/src/deploy/run";
import { planChanges } from "@/src/domain/changes";
import { cleanupDrafts, DRAFT_TTL_MS, runTick } from "@/src/tick";
import { FakeWordPress } from "./fake-wordpress";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");
const ctx = { newId: () => crypto.randomUUID(), now: T0.toISOString() };

describe("runTick", () => {
  it("applies due scheduled sets, notifies the chat in its language, and leaves future ones", async () => {
    const { store, venue, items } = await makeDemo();
    const m = new FakeMessenger();
    const site = await store.getSite(venue.id);
    const due = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Нова цена на капучиното", summary_en: "New cappuccino price", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], ctx) });
    const future = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-20T08:00:00.000Z", changes: [] });
    const r = await runTick({ store, messenger: m, now: T0 });
    expect(r.applied).toEqual([due.id]);
    expect((await store.getChangeSet(due.id)).status).toBe("applied");
    expect((await store.getChangeSet(future.id)).status).toBe("scheduled");
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ chatId: 1001, text: "✅ Приложено по график: Нова цена на капучиното" });
  });

  it("writes auto sets once for elapsed sold-out and special timers", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "2026-10-09T08:30:00.000Z" }], { ...ctx, now: "2026-10-09T08:00:00.000Z" }) });
    await store.applyChangeSet(cs.id, "2026-10-09T08:00:00.000Z");
    const special = await store.insertItem({ venue_id: venue.id, category_id: items.Espresso.category_id, name_bg: "Супа", name_en: "Soup", desc_bg: "", desc_en: "", price_eur: 4, allergens: [], position: 9, is_special: true, special_expires_at: "2026-10-09T08:45:00.000Z" });
    const r1 = await runTick({ store, messenger: null, now: T0 });
    expect(r1.auto).toHaveLength(2);
    const after = await store.getSite(venue.id);
    expect(after.items.find((i) => i.id === items["Cheese banitsa"].id)?.sold_out_until).toBeNull();
    expect(after.items.find((i) => i.id === special.id)?.active).toBe(false);
    const autos = await store.listChangeSets(venue.id, { status: ["applied"] });
    expect(autos.filter((s) => s.source === "auto")).toHaveLength(2);
    expect(autos.find((s) => s.source === "auto" && s.changes[0].op === "set_sold_out")).toMatchObject({ summary_bg: "Баница със сирене отново в наличност", summary_en: "Cheese banitsa back in stock" });
    const r2 = await runTick({ store, messenger: null, now: new Date("2026-10-09T09:05:00.000Z") });
    expect(r2.auto).toEqual([]);
  });

  it("reminds once about sets due within 24 h", async () => {
    const { store, venue } = await makeDemo();
    const m = new FakeMessenger();
    const soon = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Коледно работно време", summary_en: "Christmas hours", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-10T06:00:00.000Z", changes: [] });
    const r1 = await runTick({ store, messenger: m, now: T0 });
    expect(r1.reminded).toEqual([soon.id]);
    expect(m.sent[0].text).toBe("⏰ Напомняне: на 10.10.2026, 09:00 ще се приложи: Коледно работно време");
    const r2 = await runTick({ store, messenger: m, now: new Date("2026-10-09T10:00:00.000Z") });
    expect(r2.reminded).toEqual([]);
    expect(m.sent).toHaveLength(1);
  });

  it("expires proposals older than 2 h and edits their message", async () => {
    const { store, venue } = await makeDemo();
    const m = new FakeMessenger();
    store.clock = () => "2026-10-09T06:00:00.000Z";
    const old = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Стара", summary_en: "Old", preview_bg: "превю", preview_en: "preview", source: "text", status: "proposed", tg_message_id: 42, changes: [] });
    store.clock = () => "2026-10-09T08:30:00.000Z";
    const fresh = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Нова", summary_en: "New", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [] });
    const r = await runTick({ store, messenger: m, now: T0 });
    expect(r.expired).toEqual([old.id]);
    expect((await store.getChangeSet(old.id)).status).toBe("expired");
    expect((await store.getChangeSet(fresh.id)).status).toBe("proposed");
    expect(m.edits[0]).toEqual({ chatId: 1001, messageId: 42, text: "превю\n\n⌛ Изтекло: предложението не беше потвърдено в рамките на 2 часа." });
  });

  it("limits itself to one venue when asked", async () => {
    const { store, venue } = await makeDemo();
    const other = await store.createVenue({ slug: "other", name: "Other" });
    const a = await store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const b = await store.createChangeSet({ venue_id: other.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const r = await runTick({ store, messenger: null, now: T0, venueId: other.id });
    expect(r.applied).toEqual([b.id]);
    expect((await store.getChangeSet(a.id)).status).toBe("scheduled");
  });
  it("retries due destination pushes when a sync dependency is given", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    const token = (wp.connected() as unknown as { o: { token: string } }).o.token;
    const key = parseSecretKey("ab".repeat(32));
    const dest = await store.upsertDestination({ venue_id: venue.id, kind: "wordpress", config: { site_url: wp.siteUrl }, secrets: encryptSecrets({ token }, key) });
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [{ position: 0, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "Smoke Café" }, after: { value: "Ъгъла" } }] });
    await store.applyChangeSet(cs.id, T0.toISOString());
    const sync = await store.createSync({ venue_id: venue.id, destination_id: dest.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: T0.toISOString() });
    const report = await runTick({ store, messenger: null, now: T0, sync: { store, secretKey: key, fetch: wp.fetch, log: () => undefined } });
    expect(report.pushed).toEqual([sync.id]);
    expect(wp.options.blogname).toBe("Ъгъла");
    const without = await runTick({ store, messenger: null, now: T0 });
    expect(without.pushed).toBeUndefined();
  });

  it("deletes drafts older than 48 h, keeps fresh drafts and old live venues, and polls deployments when a deployer is given", async () => {
    const { store, venue } = await makeDemo();
    store.clock = () => "2026-10-06T09:00:00.000Z";
    const old = await store.createVenue({ slug: "old-draft", name: "Old", status: "draft" });
    store.clock = () => "2026-10-01T09:00:00.000Z";
    await store.createVenue({ slug: "old-live", name: "Live" });
    store.clock = () => "2026-10-09T08:00:00.000Z";
    await store.createVenue({ slug: "fresh-draft", name: "Fresh", status: "draft" });
    const deployer = new FakeDeployer();
    const m = new FakeMessenger();
    await startDeploy({ store, deployer, feedUrlFor: (s) => `https://sm.example/api/site/${s}`, now: () => T0 }, venue.id);
    const r1 = await runTick({ store, messenger: m, now: T0, deployer });
    expect(r1.cleaned).toEqual([old.id]);
    expect(r1.deployed).toEqual([]);
    expect(r1.deployFailed).toEqual([]);
    expect(await store.getVenueBySlug("old-draft")).toBeNull();
    expect(await store.getVenueBySlug("old-live")).not.toBeNull();
    expect(await store.getVenueBySlug("fresh-draft")).not.toBeNull();
    const r2 = await runTick({ store, messenger: m, now: T0, deployer });
    expect(r2.deployed).toEqual([venue.id]);
    expect(r2.cleaned).toEqual([]);
    expect(m.sent.at(-1)).toMatchObject({ chatId: 1001, text: expect.stringContaining("https://agala.example.test") });
    const r3 = await runTick({ store, messenger: null, now: T0 }); // no deployer: nothing polled, report fields still present
    expect(r3).toMatchObject({ deployed: [], deployFailed: [], cleaned: [] });
  });

  it("cleanupDrafts never deletes a live venue, honours the exact TTL boundary and the venue filter", async () => {
    const { store } = await makeDemo();
    const cutoff = new Date(T0.getTime() - DRAFT_TTL_MS);
    store.clock = () => new Date(cutoff.getTime() - 1).toISOString();
    const stale = await store.createVenue({ slug: "stale", name: "Stale", status: "draft" });
    const staleLive = await store.createVenue({ slug: "stale-live", name: "Stale live" });
    store.clock = () => cutoff.toISOString();
    const boundary = await store.createVenue({ slug: "boundary", name: "Boundary", status: "draft" });
    expect(await cleanupDrafts({ store, now: T0, venueId: staleLive.id })).toEqual([]);
    expect(await cleanupDrafts({ store, now: T0, venueId: boundary.id })).toEqual([]);
    expect(await cleanupDrafts({ store, now: T0 })).toEqual([stale.id]);
    expect(await store.getVenueBySlug("stale")).toBeNull();
    expect(await store.getVenueBySlug("stale-live")).not.toBeNull();
    expect(await store.getVenueBySlug("boundary")).not.toBeNull();
    expect(await store.getVenueBySlug("agala")).not.toBeNull();
  });

  it("cleanupDrafts removes the draft's stored images, and does nothing on a per-venue tick", async () => {
    const { store } = await makeDemo();
    store.clock = () => new Date(T0.getTime() - DRAFT_TTL_MS - 1).toISOString();
    const stale = await store.createVenue({ slug: "stale", name: "Stale", status: "draft" });
    const m = await store.saveMedia(stale.id, new Uint8Array([1]), "image/png");
    store.clock = () => T0.toISOString();
    expect(await cleanupDrafts({ store, now: T0, venueId: stale.id })).toEqual([]); // per-webhook / per-key ticks skip cleanup
    expect(store.files.has(m.storage_path)).toBe(true);
    expect(await cleanupDrafts({ store, now: T0 })).toEqual([stale.id]);
    expect(store.files.has(m.storage_path)).toBe(false);
    expect(await store.getMedia(m.id)).toBeNull();
  });

  it("cleanupDrafts reads a draft again only when it is old enough", async () => {
    const { store } = await makeDemo();
    for (let i = 0; i < 3; i++) await store.createVenue({ slug: `fresh-${i}`, name: "F", status: "draft" });
    let reads = 0;
    const getVenue = store.getVenue.bind(store);
    store.getVenue = async (id: string) => {
      reads++;
      return getVenue(id);
    };
    expect(await cleanupDrafts({ store, now: T0 })).toEqual([]);
    expect(reads).toBe(0);
  });
});
