// test/tick.test.ts
import { describe, expect, it } from "vitest";
import type { BotDeps } from "@/src/bot/bot";
import { handleInbound } from "@/src/bot/inbound";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { FakeDeployer } from "@/src/deploy/fake";
import { startDeploy } from "@/src/deploy/run";
import { planChanges } from "@/src/domain/changes";
import type { InMemoryStore } from "@/src/store/memory";
import { cleanupDrafts, DRAFT_TTL_MS, runTick } from "@/src/tick";
import { GoogleClient, googleAccessToken, putReviewReply } from "@/src/destinations/google-api";
import { MAX_ATTEMPTS, runPendingSyncs } from "@/src/destinations/sync";
import { FakeWordPress } from "./fake-wordpress";
import { connectedGoogle, T0 as GT0 } from "./google-helpers";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");
const ctx = { newId: () => crypto.randomUUID(), now: T0.toISOString() };
/** What the owner's chat needs to receive a message; the agent never runs. */
const botDeps = (store: InMemoryStore, messenger: FakeMessenger): BotDeps => ({ token: "t", store, messenger, baseUrl: "https://sm.example", now: () => T0, startRun: () => undefined, transcribe: null, download: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }) });

describe("runTick", () => {
  it("applies due scheduled sets, notifies the chat in its language, and leaves future ones", async () => {
    const { store, venue, items } = await makeDemo();
    const m = new FakeMessenger();
    const site = await store.getSite(venue.id);
    const due = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Нова цена на капучиното", summary_en: "New cappuccino price", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], ctx) });
    const future = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-20T08:00:00.000Z", changes: [] });
    const r = await runTick({ store, messenger: m, now: T0 });
    expect(r.applied).toEqual([due.id]);
    expect((await store.getChangeSet(due.id)).status).toBe("applied");
    expect((await store.getChangeSet(future.id)).status).toBe("scheduled");
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ chatRef: "tg:1001", text: "✅ Приложено по график: Нова цена на капучиното", proactive: true });
  });

  it("writes auto sets once for elapsed sold-out and special timers", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "2026-10-09T08:30:00.000Z" }], { ...ctx, now: "2026-10-09T08:00:00.000Z" }) });
    await store.applyChangeSet(cs.id, "2026-10-09T08:00:00.000Z");
    const special = await store.insertItem({ venue_id: venue.id, category_id: items.Espresso.category_id, name_bg: "Супа", name_en: "Soup", desc_bg: "", desc_en: "", price_eur: 4, allergens: [], position: 9, is_special: true, special_expires_at: "2026-10-09T08:45:00.000Z" });
    const r1 = await runTick({ store, messenger: null, now: T0 });
    expect(r1.auto).toHaveLength(2);
    const after = await store.getSite(venue.id);
    expect(after.items.find((i) => i.id === items["Cheese banitsa"].id)?.sold_out_until).toBeNull();
    expect(after.items.find((i) => i.id === special.id)?.active).toBe(false);
    const autos = await store.listChangeSets(venue.id, { status: ["applied"] });
    expect(autos.filter((s) => s.source === "auto")).toHaveLength(2);
    // The dish name is kept like in every preview (it reaches a chat through an undo); the dashboard shows it without the markers.
    expect(autos.find((s) => s.source === "auto" && s.changes[0].op === "set_sold_out")).toMatchObject({ summary_bg: "⟦Баница със сирене⟧ отново в наличност", summary_en: "⟦Cheese banitsa⟧ back in stock", preview_en: "• ⟦Cheese banitsa⟧: back in stock" });
    expect(autos.find((s) => s.source === "auto" && s.changes[0].op === "remove_item")).toMatchObject({ summary_bg: "Специалното „⟦Супа⟧“ изтече", preview_bg: "• Премахва ⟦Супа⟧" });
    const r2 = await runTick({ store, messenger: null, now: new Date("2026-10-09T09:05:00.000Z") });
    expect(r2.auto).toEqual([]);
  });

  it("reminds once about sets due within 24 h", async () => {
    const { store, venue } = await makeDemo();
    const m = new FakeMessenger();
    const soon = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Коледно работно време", summary_en: "Christmas hours", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-10T06:00:00.000Z", changes: [] });
    const r1 = await runTick({ store, messenger: m, now: T0 });
    expect(r1.reminded).toEqual([soon.id]);
    expect(m.sent[0]).toMatchObject({ text: "⏰ Напомняне: на 10.10.2026, 09:00 ще се приложи: Коледно работно време", proactive: true });
    const r2 = await runTick({ store, messenger: m, now: new Date("2026-10-09T10:00:00.000Z") });
    expect(r2.reminded).toEqual([]);
    expect(m.sent).toHaveLength(1);
  });

  it("a reminder after the owner switched to English is in English", async () => {
    const { store, venue } = await makeDemo(); // the owner (tg:1001) is stored as bg
    const m = new FakeMessenger();
    const soon = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Коледно работно време", summary_en: "Christmas hours", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-10T06:00:00.000Z", changes: [] });
    // The owner writes English; the tick itself is told nothing about it.
    await handleInbound(botDeps(store, m), { chatRef: "tg:1001", kind: "text", text: "please change the price of the cappuccino to 4.20" });
    const r = await runTick({ store, messenger: m, now: T0 });
    expect(r.reminded).toEqual([soon.id]);
    expect(m.sent).toEqual([expect.objectContaining({ chatRef: "tg:1001", text: "⏰ Reminder: on 10 Oct 2026, 09:00 this will be applied: Christmas hours", proactive: true })]);
  });

  it("and after the owner writes Bulgarian again, the next reminder is in Bulgarian", async () => {
    const { store, venue } = await makeDemo();
    await store.setMemberLang(venue.id, "tg:1001", "en"); // e.g. /lang en, or an earlier English message
    const m = new FakeMessenger();
    const soon = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Коледно работно време", summary_en: "Christmas hours", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-10T06:00:00.000Z", changes: [] });
    await handleInbound(botDeps(store, m), { chatRef: "tg:1001", kind: "text", text: "Капучиното става 4,20" });
    const r = await runTick({ store, messenger: m, now: T0 });
    expect(r.reminded).toEqual([soon.id]);
    expect(m.sent).toEqual([expect.objectContaining({ chatRef: "tg:1001", text: "⏰ Напомняне: на 10.10.2026, 09:00 ще се приложи: Коледно работно време", proactive: true })]);
  });

  it("expires proposals older than 2 h and concludes their message", async () => {
    const { store, venue } = await makeDemo();
    const m = new FakeMessenger();
    store.clock = () => "2026-10-09T06:00:00.000Z";
    const old = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Стара", summary_en: "Old", preview_bg: "превю", preview_en: "preview", source: "text", status: "proposed", message_ref: "42", changes: [] });
    store.clock = () => "2026-10-09T08:30:00.000Z";
    const fresh = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Нова", summary_en: "New", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [] });
    const r = await runTick({ store, messenger: m, now: T0 });
    expect(r.expired).toEqual([old.id]);
    expect((await store.getChangeSet(old.id)).status).toBe("expired");
    expect((await store.getChangeSet(fresh.id)).status).toBe("proposed");
    expect(m.concluded[0]).toEqual({ chatRef: "tg:1001", messageRef: "42", full: "превю\n\n⌛ Изтекло: предложението не беше потвърдено в рамките на 2 часа.", short: "⌛ Изтекло: предложението не беше потвърдено в рамките на 2 часа.", proactive: true });
  });

  it("limits itself to one venue when asked", async () => {
    const { store, venue } = await makeDemo();
    const other = await store.createVenue({ slug: "other", name: "Other" });
    const a = await store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const b = await store.createChangeSet({ venue_id: other.id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
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
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [{ position: 0, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "Smoke Café" }, after: { value: "Ъгъла" } }] });
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
    expect(m.sent.at(-1)).toMatchObject({ chatRef: "tg:1001", text: expect.stringContaining("https://agala.example.test") });
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

describe("runTick: Google reviews and notices", () => {
  const MIN = 60_000;
  const DAY = 24 * 3_600_000;
  const BASE = "https://sm.example";
  const at = (ms: number) => new Date(GT0.getTime() + ms);
  const reviewLists = (g: Awaited<ReturnType<typeof connectedGoogle>>) => g.fake.calls.filter((c) => c.path.endsWith("/reviews")).length;
  const tick = (g: Awaited<ReturnType<typeof connectedGoogle>>, m: FakeMessenger, now: Date, extra: Partial<Parameters<typeof runTick>[0]> = {}) =>
    runTick({ store: g.store, messenger: m, now, sync: g.d, baseUrl: BASE, ...extra });

  it("the global tick polls reviews in modes each and digest, never in off nor on a per-venue tick", async () => {
    for (const mode of ["each", "digest", "off"] as const) {
      const g = await connectedGoogle();
      await g.store.updateVenue(g.venue.id, { comment_mode: mode });
      g.fake.addReview(g.loc.v4, { created: at(-MIN) });
      const m = new FakeMessenger();
      expect((await tick(g, m, GT0, { venueId: g.venue.id })).reviews_found).toBe(0);
      expect(reviewLists(g)).toBe(0);
      const r = await tick(g, m, GT0);
      expect([mode, r.reviews_found, reviewLists(g)]).toEqual(mode === "off" ? [mode, 0, 0] : [mode, 1, 1]);
    }
  });

  it("with billing on, a plan without comments reads no reviews", async () => {
    const g = await connectedGoogle();
    await g.store.updateVenue(g.venue.id, { plan: "admin", billing_status: "active" });
    g.fake.addReview(g.loc.v4, { created: at(-MIN) });
    const billing = { config: { billingEnabled: true, trialChangeLimit: 20, trialRequiresCard: false, publicBaseUrl: BASE }, ownerEmails: async () => [], sendEmail: async () => ({ ok: true as const, id: "e" }) };
    const r = await tick(g, new FakeMessenger(), GT0, { billing: billing as unknown as Parameters<typeof runTick>[0]["billing"] });
    expect(r.reviews_found).toBe(0);
    expect(reviewLists(g)).toBe(0);
  });

  it("an edited review waiting on a proposal cancels that set and concludes the owner's message", async () => {
    const g = await connectedGoogle();
    await g.store.upsertMember({ venue_id: g.venue.id, chat_ref: "tg:1001", role: "owner", lang: "en" });
    const rv = g.fake.addReview(g.loc.v4, { text: "good", created: at(-MIN) });
    const m = new FakeMessenger();
    await tick(g, m, GT0);
    const row = (await g.store.findComment(g.venue.id, rv.name))!;
    const cs = await g.store.createChangeSet({ venue_id: g.venue.id, chat_ref: "tg:1001", summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "comment", status: "proposed", changes: [] });
    await g.store.updateChangeSet(cs.id, { message_ref: "55", proposal_refs: { "tg:1001": "55" } });
    await g.store.updateComment(row.id, { status: "proposed", change_set_id: cs.id, draft_text: "Thanks!", draft_kind: "praise" });
    g.fake.editReview(rv.name, { text: "changed", updated: at(5 * MIN) });
    await tick(g, m, at(16 * MIN));
    expect((await g.store.getChangeSet(cs.id)).status).toBe("cancelled");
    expect(m.concluded.map((c) => [c.chatRef, c.messageRef, c.short])).toEqual([["tg:1001", "55", "✏️ The review was edited; a new proposal follows."]]);
    expect(await g.store.getComment(row.id)).toMatchObject({ status: "new", change_set_id: null, text: "changed" });
  });

  it("a review answered by hand on Google withdraws the waiting proposal with a line to the owner and is never proposed again", async () => {
    const g = await connectedGoogle();
    await g.store.upsertMember({ venue_id: g.venue.id, chat_ref: "tg:1001", role: "owner", lang: "en" });
    const rv = g.fake.addReview(g.loc.v4, { text: "good", created: at(-MIN) });
    const m = new FakeMessenger();
    await tick(g, m, GT0);
    const row = (await g.store.findComment(g.venue.id, rv.name))!;
    const cs = await g.store.createChangeSet({ venue_id: g.venue.id, chat_ref: "tg:1001", summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "comment", status: "proposed", changes: [] });
    await g.store.updateChangeSet(cs.id, { message_ref: "56", proposal_refs: { "tg:1001": "56" } });
    await g.store.updateComment(row.id, { status: "proposed", change_set_id: cs.id, draft_text: "Thanks!", draft_kind: "praise" });
    g.fake.now = () => at(5 * MIN);
    const c = new GoogleClient(await googleAccessToken(g.fake.fetch, g.d.google!, g.account.refresh_token), g.fake.fetch);
    await putReviewReply(c, rv.name, "Answered by hand");
    const putsBefore = g.fake.calls.filter((x) => x.method === "PUT").length;
    let drafted = 0;
    const comments = { draft: async () => (drafted++, { reply: "x", kind: "praise" as const, fallback: false }) };
    await tick(g, m, at(16 * MIN), { comments });
    expect((await g.store.getChangeSet(cs.id)).status).toBe("cancelled");
    expect(m.concluded.map((x) => [x.chatRef, x.messageRef, x.short])).toEqual([["tg:1001", "56", "Already answered on Google — I withdrew my draft."]]);
    expect(await g.store.getComment(row.id)).toMatchObject({ status: "replied", change_set_id: null });
    await tick(g, m, at(32 * MIN), { comments });
    expect(drafted).toBe(0);
    expect(m.sent.filter((x) => x.setId)).toEqual([]);
    expect(g.fake.calls.filter((x) => x.method === "PUT").length).toBe(putsBefore);
  });

  it("without a messenger an edited review's waiting set is still cancelled and its review freed", async () => {
    const g = await connectedGoogle();
    const rv = g.fake.addReview(g.loc.v4, { text: "good", created: at(-MIN) });
    await runTick({ store: g.store, messenger: null, now: GT0, sync: g.d });
    const row = (await g.store.findComment(g.venue.id, rv.name))!;
    const cs = await g.store.createChangeSet({ venue_id: g.venue.id, chat_ref: "tg:1001", summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "comment", status: "proposed", changes: [] });
    await g.store.updateComment(row.id, { status: "proposed", change_set_id: cs.id });
    g.fake.editReview(rv.name, { text: "changed", updated: at(5 * MIN) });
    await runTick({ store: g.store, messenger: null, now: at(16 * MIN), sync: g.d });
    expect((await g.store.getChangeSet(cs.id)).status).toBe("cancelled");
    expect(await g.store.getComment(row.id)).toMatchObject({ status: "new", change_set_id: null });
  });

  it("the purge blanks a Google row after 30 days and deletes it after 60", async () => {
    const g = await connectedGoogle();
    const row = (comment_id: string, days: number) => ({ network: "google" as const, post_ref: g.loc.v4, comment_id, parent_id: null, author_id: "", author_name: "Maria", text: "review text", created_at: at(-days * DAY).toISOString(), seen_at: GT0.toISOString(), status: "replied" as const, post_caption: "", rating: 5, review_updated_at: at(-days * DAY).toISOString() });
    await g.store.upsertComments(g.venue.id, [row("g31", 31), row("g61", 61)]);
    await tick(g, new FakeMessenger(), GT0);
    expect(await g.store.findComment(g.venue.id, "g31")).toMatchObject({ text: "", author_name: "" });
    expect(await g.store.findComment(g.venue.id, "g61")).toBeNull();
  });

  it("a Google hours push that fails for good tells the set's chat to edit the profile by hand", async () => {
    const g = await connectedGoogle();
    await g.store.upsertMember({ venue_id: g.venue.id, chat_ref: "tg:1001", role: "owner", lang: "en" });
    for (let i = 0; i < MAX_ATTEMPTS; i++) g.fake.failNext({ status: 503, match: (c) => c.method === "GET" && c.host === "mybusinessbusinessinformation.googleapis.com" });
    const cs = await g.applyOps([{ op: "add_holiday", date: "2026-12-24", note_bg: "Почивка", note_en: "Day off" }]);
    for (let i = 1; i < MAX_ATTEMPTS - 1; i++) await runPendingSyncs(g.d, { venueId: g.venue.id, now: new Date((await g.rows(cs.id))[0].next_at) });
    const m = new FakeMessenger();
    const due = new Date((await g.rows(cs.id))[0].next_at);
    g.setNow(due);
    await tick(g, m, due);
    expect((await g.rows(cs.id))[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    const sent = m.sent.filter((s) => s.text.includes("Open your profile to change it by hand"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatRef: "tg:1001", text: "Change\nGoogle listing: not updated. Open your profile to change it by hand: https://business.google.com/", proactive: true });
  });

  it("a broken Google connection is told once to the reachable owners, never while none is reachable", async () => {
    const g = await connectedGoogle();
    const dest = await g.dest();
    await g.store.updateDestination(dest.id, { status: "error", last_error: "sm_google_revoked: Google no longer accepts the connection." });
    await g.store.upsertMember({ venue_id: g.venue.id, chat_ref: "tg:1001", role: "staff", lang: "en" });
    const m = new FakeMessenger();
    await tick(g, m, GT0);
    expect(m.sent.filter((s) => s.text.includes("Google disconnected itself"))).toHaveLength(0);
    expect((await g.dest()).config.revoked_notified_at).toBeUndefined();
    await g.store.upsertMember({ venue_id: g.venue.id, chat_ref: "tg:1001", role: "owner", lang: "en" });
    for (let i = 1; i <= 3; i++) await tick(g, m, at(i * 20 * MIN));
    const sent = m.sent.filter((s) => s.text.includes("Google disconnected itself"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatRef: "tg:1001", text: `Google disconnected itself (the permission was removed). Connect Google again from the dashboard: ${BASE}/dashboard/${g.venue.slug}#google`, proactive: true });
    expect((await g.dest()).config.revoked_notified_at).toBe(at(20 * MIN).toISOString());
  });

  it("the per-venue tick also sends the broken-connection notice (in Bulgarian for a Bulgarian owner)", async () => {
    const g = await connectedGoogle();
    const dest = await g.dest();
    await g.store.updateDestination(dest.id, { status: "error", last_error: "sm_google_permission: The Google account no longer manages this listing." });
    const m = new FakeMessenger();
    await tick(g, m, GT0, { venueId: g.venue.id });
    expect(m.sent.map((s) => s.text)).toEqual([`Връзката с Google прекъсна (разрешението е премахнато). Свържете Google отново от таблото: ${BASE}/dashboard/${g.venue.slug}#google`]);
  });
});
