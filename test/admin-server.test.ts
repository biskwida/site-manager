import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import { renderPreview } from "@/src/domain/preview";
import { adminAction, adminOverview } from "@/src/server/admin";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("admin", () => {
  it("builds the overview and applies, rejects, cancels and undoes with the Telegram message edited", async () => {
    const { store, venue, items } = await makeDemo();
    const messenger = new FakeMessenger();
    const d = { store, messenger, now: () => T0, baseUrl: "https://site.example" };
    const site = await store.getSite(venue.id);
    const mk = (status: "proposed" | "scheduled", price: number, applyAt: string | null = null) =>
      store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: `Капучино ${price}`, summary_en: `Cappuccino ${price}`, preview_bg: "p", preview_en: "p", source: "text", status, apply_at: applyAt, message_ref: "42", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: price }], { newId: () => "n", now: T0.toISOString() }) });
    const p1 = await mk("proposed", 3.2);
    const p2 = await mk("proposed", 3.3);
    const s1 = await mk("scheduled", 3.4, "2026-12-01T08:00:00.000Z");
    const o = await adminOverview(store, venue, T0, "https://site.example");
    expect(o.public_url).toBe("https://site.example/agala");
    expect(o.pending.map((x) => x.id)).toEqual([p2.id, p1.id]);
    expect(o.scheduled.map((x) => x.id)).toEqual([s1.id]);
    expect(o.log).toEqual([]);
    expect(o.connected_apps).toEqual([{ app: "telegram", owners: 1, staff: 1 }]);

    expect(await adminAction(d, venue, "apply", p1.id)).toEqual({ ok: true, status: "applied", change_set_id: p1.id });
    expect(messenger.concluded[0]).toMatchObject({ chatRef: "tg:1001", messageRef: "42", proactive: true });
    expect(messenger.concluded[0].full).toContain("✅");
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    expect(await adminAction(d, venue, "reject", p2.id)).toEqual({ ok: true, status: "rejected", change_set_id: p2.id });
    expect(await adminAction(d, venue, "cancel", s1.id)).toEqual({ ok: true, status: "cancelled", change_set_id: s1.id });
    expect(await adminAction(d, venue, "apply", p2.id)).toEqual({ ok: false, error: 'Change set is "rejected".' });

    const u = await adminAction(d, venue, "undo", p1.id);
    expect(u.ok).toBe(true);
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9);
    expect((await store.getChangeSet(p1.id)).status).toBe("reverted");
    const after = await adminOverview(store, venue, T0, "https://site.example");
    expect(after.log.map((x) => x.status)).toEqual(["applied", "cancelled", "rejected", "reverted"]);
    expect(after.log[0]).toMatchObject({ source: "undo", undoes_id: p1.id });
  });
  it("shows no keep marker anywhere: pending, scheduled and logged sets, and the WordPress and social summaries (the chat keeps them, the dashboard never)", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const changes = planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() });
    // Stored previews keep their markers (they are chat texts); a summary may hold one too (the tick's automatic sets and their undo).
    const kept = { summary_bg: "Отмяна: ⟦Капучино⟧ отново в наличност", summary_en: "Undo: ⟦Cappuccino⟧ back in stock", preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz) };
    expect(kept.preview_en).toBe("• ⟦Cappuccino⟧: €2.90 → €3.20");
    const set = (status: "proposed" | "scheduled", applyAt: string | null = null) => store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", ...kept, source: "text", status, apply_at: applyAt, changes });
    await set("proposed");
    await set("scheduled", "2026-12-01T08:00:00.000Z");
    const applied = await set("proposed");
    await store.applyChangeSet(applied.id, T0.toISOString());
    for (const kind of ["wordpress", "facebook"] as const) {
      const dest = await store.upsertDestination({ venue_id: venue.id, kind, config: { site_url: "https://cafe.example", page_name: "Ъгъла" }, secrets: "x" });
      await store.createSync({ venue_id: venue.id, destination_id: dest.id, change_set_id: applied.id, payload: { kind }, next_at: T0.toISOString() });
    }
    const o = await adminOverview(store, venue, T0, "https://site.example");
    expect([o.pending.length, o.scheduled.length, o.log.length, o.wordpress?.syncs.length, o.social?.posts.length]).toEqual([1, 1, 1, 1, 1]);
    const json = JSON.stringify(o);
    expect(json).not.toMatch(/[⟦⟧]/);
    expect(o.pending[0]).toMatchObject({ summary_en: "Undo: Cappuccino back in stock", preview_bg: "• Капучино: 2,90 € → 3,20 €", preview_en: "• Cappuccino: €2.90 → €3.20" });
    expect(o.wordpress?.syncs[0]).toMatchObject({ summary_bg: "Отмяна: Капучино отново в наличност" });
    expect(o.social?.posts[0]).toMatchObject({ summary_en: "Undo: Cappuccino back in stock" });
    // The stored rows are untouched: the chat still reads its markers.
    expect((await store.getChangeSet(applied.id)).preview_en).toBe("• ⟦Cappuccino⟧: €2.90 → €3.20");
  });
  it("tells a member who chats in a language without hand-written texts about dashboard decisions in English, not Bulgarian", async () => {
    const { store, venue, items } = await makeDemo();
    await store.setMemberLang(venue.id, "tg:1001", "de");
    const messenger = new FakeMessenger();
    const d = { store, messenger, now: () => T0, baseUrl: "https://site.example" };
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Капучино 3,20", summary_en: "Cappuccino 3.20", preview_bg: "Преглед", preview_en: "Preview", source: "text", status: "proposed", message_ref: "42", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
    expect((await adminAction(d, venue, "apply", cs.id)).ok).toBe(true);
    expect(messenger.concluded[0].full).toMatch(/^Preview\n\n✅ Applied from the dashboard\./);
    expect((await adminAction(d, venue, "undo", cs.id)).ok).toBe(true);
    expect(messenger.sent.at(-1)?.text).toBe("↩️ Reverted from the dashboard: Cappuccino 3.20");
  });
  it("lists sold-out items with return times", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "2026-10-10T06:00:00.000Z" }], { newId: () => "n", now: T0.toISOString() }) });
    await store.applyChangeSet(cs.id, T0.toISOString());
    const o = await adminOverview(store, venue, T0);
    expect(o.sold_out).toEqual([{ id: items["Cheese banitsa"].id, name_bg: "Баница със сирене", name_en: "Cheese banitsa", sold_out_until: "2026-10-10T06:00:00.000Z" }]);
  });
});
