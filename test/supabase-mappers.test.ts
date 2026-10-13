// test/supabase-mappers.test.ts
import { describe, expect, it } from "vitest";
import { legacyColumns, toChangeSet, toItem, toMember, toVenue } from "@/src/store/supabase";

describe("supabase row mappers", () => {
  it("coerces numerics and nulls", () => {
    const item = toItem({ id: "i", venue_id: "v", category_id: "c", name_bg: "Б", name_en: "B", desc_bg: null, desc_en: null, price_eur: "2.90", allergens: [7], image_media_id: null, sold_out_until: null, is_special: false, special_expires_at: null, position: 1, active: true, created_at: "2026-10-09T09:00:00+00:00", updated_at: "2026-10-09T09:00:00+00:00" });
    expect(item.price_eur).toBe(2.9);
    expect(item.desc_bg).toBe("");
    expect(item.created_at).toBe("2026-10-09T09:00:00.000Z");
  });
  it("maps a venue with jsonb hours and theme", () => {
    const v = toVenue({ id: "v", slug: "s", name: "n", hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, theme: { accent: "#000000" }, tz: "Europe/Sofia", default_lang: "en", created_at: "2026-10-09T09:00:00Z" });
    expect(v).toMatchObject({ tagline_bg: "", cover_media_id: null, default_lang: "en", theme: { accent: "#000000" }, instagram_import: null, site_url: null });
    expect(toVenue({ id: "v", slug: "s", name: "n", site_url: "https://own.example", created_at: "2026-10-09T09:00:00Z" }).site_url).toBe("https://own.example");
  });
  it("maps a change set with nested changes", () => {
    const cs = toChangeSet({ id: "c", venue_id: "v", chat_ref: "tg:1001", chat_id: "1001", summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", apply_at: null, reminded_at: null, decided_at: null, applied_at: null, reverted_by: null, undoes_id: null, message_ref: "55", tg_message_id: "55", created_at: "2026-10-09T09:00:00Z", changes: [{ id: "x", position: 0, op: "set_price", entity: "item", entity_id: "i", before: { price_eur: 1 }, after: { price_eur: 2 } }] });
    expect(cs.chat_ref).toBe("tg:1001");
    expect(cs.message_ref).toBe("55");
    expect(cs.changes[0]).toEqual({ position: 0, op: "set_price", entity: "item", entity_id: "i", before: { price_eur: 1 }, after: { price_eur: 2 } });
  });
  it("writes legacy bigint columns only for Telegram refs (Review Focus 2)", () => {
    expect(legacyColumns("tg:-100123", "55")).toEqual({ chat_id: -100123, tg_message_id: 55 });
    expect(legacyColumns("fb:123", "123456789")).toEqual({ chat_id: null, tg_message_id: null });
    expect(legacyColumns(null, null)).toEqual({ chat_id: null, tg_message_id: null });
    expect(toMember({ venue_id: "v", chat_ref: "fb:9", tg_chat_id: null, role: "owner", lang: "en", last_seen_at: "2026-10-09T09:00:00Z", created_at: "2026-10-09T09:00:00Z" })).toMatchObject({ chat_ref: "fb:9", last_seen_at: "2026-10-09T09:00:00.000Z" });
  });
});
