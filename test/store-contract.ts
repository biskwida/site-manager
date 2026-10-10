// test/store-contract.ts
import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import type { Store } from "@/src/store/types";
import { NOW } from "./fixtures";

const LATER = "2026-10-09T10:00:00.000Z";
const ctx = { newId: () => crypto.randomUUID(), now: NOW };

/** Behaviour every Store must have. Call with a factory that yields an empty store. */
export function storeContract(name: string, make: () => Promise<Store>) {
  describe(`${name} store`, () => {
    it("creates a venue with defaults and reads it back by id and slug", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t1", name: "Test" });
      expect(v).toMatchObject({ slug: "t1", name: "Test", tz: "Europe/Sofia", default_lang: "bg", theme: { accent: "#2f6b4f" } });
      expect(v.hours.mon).toEqual({ open: "08:00", close: "18:00" });
      expect(await s.getVenueBySlug("t1")).toEqual(v);
      expect(await s.getVenueBySlug("nope")).toBeNull();
      expect((await s.listVenues()).map((x) => x.id)).toContain(v.id);
    });

    it("seeds categories, items and texts into the site state", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t2", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      await s.setSiteText(v.id, "welcome", "Добре дошли", "Welcome");
      await s.setSiteText(v.id, "welcome", "Здравейте", "Hello");
      const site = await s.getSite(v.id);
      expect(site.categories).toEqual([c]);
      expect(site.items).toEqual([i]);
      expect(site.texts).toEqual([{ venue_id: v.id, key: "welcome", text_bg: "Здравейте", text_en: "Hello" }]);
      expect(i).toMatchObject({ active: true, sold_out_until: null, is_special: false, price_eur: 1.8 });
    });

    it("links members through invites and tokens", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t3", name: "Test" });
      const code = await s.createInvite(v.id, "owner", LATER);
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(await s.redeemInvite("WRONGCOD", 10, "bg", NOW)).toBeNull();
      const m = await s.redeemInvite(code, 10, "en", NOW);
      expect(m).toMatchObject({ venue_id: v.id, tg_chat_id: 10, role: "owner", lang: "en" });
      expect(await s.redeemInvite(code, 11, "bg", NOW)).toBeNull(); // used
      const expired = await s.createInvite(v.id, "staff", NOW);
      expect(await s.redeemInvite(expired, 12, "bg", LATER)).toBeNull();
      expect(await s.findMember(10)).toMatchObject({ role: "owner", lang: "en" });
      await s.setMemberLang(v.id, 10, "bg");
      expect((await s.findMember(10))?.lang).toBe("bg");
      expect(await s.findMember(99)).toBeNull();
      const token = await s.getAdminToken(v.id);
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(await s.getAdminToken(v.id)).toBe(token);
      expect((await s.findVenueByAdminToken(token))?.id).toBe(v.id);
      expect(await s.findVenueByAdminToken("x".repeat(32))).toBeNull();
    });

    it("creates, lists, applies and skips change sets", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t4", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      const site = await s.getSite(v.id);
      const changes = planChanges(site, [{ op: "set_price", item_id: i.id, price_eur: 2 }], ctx);
      const cs = await s.createChangeSet({ venue_id: v.id, chat_id: 10, summary_bg: "Цена", summary_en: "Price", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
      expect(cs).toMatchObject({ status: "proposed", source: "text", chat_id: 10, apply_at: null, undoes_id: null });
      expect(cs.changes).toHaveLength(1);
      expect(cs.changes[0]).toMatchObject({ op: "set_price", entity: "item", entity_id: i.id, before: { price_eur: 1.8 }, after: { price_eur: 2 } });
      expect((await s.findProposed(v.id, 10))?.id).toBe(cs.id);
      expect(await s.findProposed(v.id, 11)).toBeNull();

      expect(await s.applyChangeSet(cs.id, LATER)).toBe("applied");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(2);
      const after = await s.getChangeSet(cs.id);
      expect(after).toMatchObject({ status: "applied", applied_at: LATER });
      expect(await s.applyChangeSet(cs.id, LATER)).toBe("skipped");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(2);
      expect(await s.findProposed(v.id, 10)).toBeNull();
      expect((await s.listChangeSets(v.id, { status: ["applied"] })).map((x) => x.id)).toEqual([cs.id]);
      expect(await s.listChangeSets(v.id, { status: ["proposed"] })).toEqual([]);
    });

    it("applies an undo set and marks the target reverted", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t5", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      const changes = planChanges(await s.getSite(v.id), [{ op: "set_price", item_id: i.id, price_eur: 2 }], ctx);
      const cs = await s.createChangeSet({ venue_id: v.id, chat_id: 10, summary_bg: "Цена", summary_en: "Price", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
      await s.applyChangeSet(cs.id, NOW);
      const undo = await s.createChangeSet({ venue_id: v.id, chat_id: 10, summary_bg: "Отмяна", summary_en: "Undo", preview_bg: "u", preview_en: "u", source: "undo", status: "proposed", undoes_id: cs.id, changes: [{ ...changes[0], before: changes[0].after, after: changes[0].before }] });
      expect(await s.applyChangeSet(undo.id, LATER)).toBe("applied");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(1.8);
      expect(await s.getChangeSet(cs.id)).toMatchObject({ status: "reverted", reverted_by: undo.id });
    });

    it("finds due, upcoming and stale sets", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t6", name: "Test" });
      const base = { venue_id: v.id, chat_id: 10, summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", source: "text" as const, changes: [] };
      const due = await s.createChangeSet({ ...base, status: "scheduled", apply_at: "2026-10-09T09:30:00.000Z" });
      const soon = await s.createChangeSet({ ...base, status: "scheduled", apply_at: "2026-10-10T08:00:00.000Z" });
      const far = await s.createChangeSet({ ...base, status: "scheduled", apply_at: "2026-10-20T08:00:00.000Z" });
      const proposed = await s.createChangeSet({ ...base, status: "proposed" });
      expect((await s.listDue(LATER)).map((x) => x.id)).toEqual([due.id]);
      expect((await s.listDue(LATER, "other-venue"))).toEqual([]);
      expect((await s.listUpcoming(LATER, "2026-10-10T10:00:00.000Z")).map((x) => x.id)).toEqual([soon.id]);
      await s.updateChangeSet(soon.id, { reminded_at: LATER });
      expect(await s.listUpcoming(LATER, "2026-10-10T10:00:00.000Z")).toEqual([]);
      expect(far.status).toBe("scheduled");
      expect((await s.listProposedBefore("2027-01-01T00:00:00.000Z")).map((x) => x.id)).toEqual([proposed.id]);
      expect(await s.listProposedBefore("2020-01-01T00:00:00.000Z")).toEqual([]);
    });

    it("lists expired sold-out and special timers", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t7", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const mk = (name: string, extra: Partial<Parameters<Store["insertItem"]>[0]>) =>
        s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: name, name_en: name, desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0, ...extra });
      const a = await mk("a", {});
      await s.createChangeSet({ venue_id: v.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [{ position: 0, op: "set_sold_out", entity: "item", entity_id: a.id, before: { sold_out_until: null }, after: { sold_out_until: "2026-10-09T09:30:00.000Z" } }] }).then((cs) => s.applyChangeSet(cs.id, NOW));
      const sp = await mk("special", { is_special: true, special_expires_at: "2026-10-09T09:45:00.000Z" });
      await mk("live special", { is_special: true, special_expires_at: "2026-10-09T15:00:00.000Z" });
      const timers = await s.listExpiredTimers(LATER);
      expect(timers.map((t) => [t.item.id, t.kind])).toEqual(expect.arrayContaining([[a.id, "sold_out"], [sp.id, "special"]]));
      expect(timers).toHaveLength(2);
      expect(await s.listExpiredTimers(NOW)).toEqual([]);
    });

    it("stores media and conversations", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t8", name: "Test" });
      const m = await s.saveMedia(v.id, new Uint8Array([1, 2, 3]), "image/jpeg");
      expect(m).toMatchObject({ venue_id: v.id, is_gallery: false });
      expect(m.storage_path).toMatch(new RegExp(`^${v.id}/[0-9a-f-]{36}\\.jpg$`));
      expect(m.public_url).toContain(m.storage_path);
      expect(await s.getMedia(m.id)).toEqual(m);
      expect((await s.getSite(v.id)).media).toEqual([m]);
      expect(await s.getConversation(v.id, 10)).toBeNull();
      const conv = { turns: [{ at: NOW, owner: "hi", agent: "hello" }], correction_for: null, updated_at: NOW };
      await s.setConversation(v.id, 10, conv);
      expect(await s.getConversation(v.id, 10)).toEqual(conv);
    });

    it("clears venue content but keeps members", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t9", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0 });
      await s.upsertMember({ venue_id: v.id, tg_chat_id: 10, role: "owner", lang: "bg" });
      await s.clearVenueContent(v.id);
      const site = await s.getSite(v.id);
      expect(site.items).toEqual([]);
      expect(site.categories).toEqual([]);
      expect(await s.findMember(10)).not.toBeNull();
    });
  });
}
