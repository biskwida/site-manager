// test/site-server.test.ts
import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import { loadSite } from "@/src/server/site";
import { makeDemo } from "./helpers";

describe("loadSite", () => {
  it("returns the live state, null for an unknown slug, and ignores draft without a valid key", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: "2026-10-09T09:00:00.000Z" }) });
    expect(await loadSite(store, "nope")).toBeNull();
    const live = await loadSite(store, "agala");
    expect(live?.draft).toBeNull();
    expect(live?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9);
    const noKey = await loadSite(store, "agala", { draftId: cs.id, key: "wrong" });
    expect(noKey?.draft).toBeNull();
    const key = await store.getAdminToken(venue.id);
    const draft = await loadSite(store, "agala", { draftId: cs.id, key });
    expect(draft?.draft).toMatchObject({ id: cs.id, status: "proposed", summary_en: "Cappuccino €3.20" });
    expect(draft?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    await store.applyChangeSet(cs.id, "2026-10-09T09:00:00.000Z");
    const applied = await loadSite(store, "agala", { draftId: cs.id, key });
    expect(applied?.draft).toMatchObject({ status: "applied" }); // banner says it is live now; state is not re-applied
    expect(applied?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
  });
});
