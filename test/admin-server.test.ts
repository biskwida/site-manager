import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
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

    expect(await adminAction(d, venue, "apply", p1.id)).toEqual({ ok: true, status: "applied", change_set_id: p1.id });
    expect(messenger.edits[0]).toMatchObject({ chatRef: "tg:1001", messageRef: "42" });
    expect(messenger.edits[0].text).toContain("✅");
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
  it("lists sold-out items with return times", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "2026-10-10T06:00:00.000Z" }], { newId: () => "n", now: T0.toISOString() }) });
    await store.applyChangeSet(cs.id, T0.toISOString());
    const o = await adminOverview(store, venue, T0);
    expect(o.sold_out).toEqual([{ id: items["Cheese banitsa"].id, name_bg: "Баница със сирене", name_en: "Cheese banitsa", sold_out_until: "2026-10-10T06:00:00.000Z" }]);
  });
});
