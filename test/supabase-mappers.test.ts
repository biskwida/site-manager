// test/supabase-mappers.test.ts
import { describe, expect, it } from "vitest";
import { toChangeSet, toItem, toVenue } from "@/src/store/supabase";

describe("supabase row mappers", () => {
  it("coerces numerics and nulls", () => {
    const item = toItem({ id: "i", venue_id: "v", category_id: "c", name_bg: "Б", name_en: "B", desc_bg: null, desc_en: null, price_eur: "2.90", allergens: [7], image_media_id: null, sold_out_until: null, is_special: false, special_expires_at: null, position: 1, active: true, created_at: "2026-10-09T09:00:00+00:00", updated_at: "2026-10-09T09:00:00+00:00" });
    expect(item.price_eur).toBe(2.9);
    expect(item.desc_bg).toBe("");
    expect(item.created_at).toBe("2026-10-09T09:00:00.000Z");
  });
  it("maps a venue with jsonb hours and theme", () => {
    const v = toVenue({ id: "v", slug: "s", name: "n", hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, theme: { accent: "#000000" }, tz: "Europe/Sofia", default_lang: "en", created_at: "2026-10-09T09:00:00Z" });
    expect(v).toMatchObject({ tagline_bg: "", cover_media_id: null, default_lang: "en", theme: { accent: "#000000" } });
  });
  it("maps a change set with nested changes", () => {
    const cs = toChangeSet({ id: "c", venue_id: "v", chat_id: "1001", summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", apply_at: null, reminded_at: null, decided_at: null, applied_at: null, reverted_by: null, undoes_id: null, tg_message_id: "55", created_at: "2026-10-09T09:00:00Z", changes: [{ id: "x", position: 0, op: "set_price", entity: "item", entity_id: "i", before: { price_eur: 1 }, after: { price_eur: 2 } }] });
    expect(cs.chat_id).toBe(1001);
    expect(cs.tg_message_id).toBe(55);
    expect(cs.changes[0]).toEqual({ position: 0, op: "set_price", entity: "item", entity_id: "i", before: { price_eur: 1 }, after: { price_eur: 2 } });
  });
});
