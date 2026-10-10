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
      expect((await s.listDue(LATER, v.id)).map((x) => x.id)).toEqual([due.id]);
      expect((await s.listDue(LATER, "other-venue"))).toEqual([]);
      expect((await s.listUpcoming(LATER, "2026-10-10T10:00:00.000Z", v.id)).map((x) => x.id)).toEqual([soon.id]);
      await s.updateChangeSet(soon.id, { reminded_at: LATER });
      expect(await s.listUpcoming(LATER, "2026-10-10T10:00:00.000Z", v.id)).toEqual([]);
      expect(far.status).toBe("scheduled");
      expect((await s.listProposedBefore("2027-01-01T00:00:00.000Z", v.id)).map((x) => x.id)).toEqual([proposed.id]);
      expect(await s.listProposedBefore("2020-01-01T00:00:00.000Z", v.id)).toEqual([]);
    });

    it("expires only a still-proposed set", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t6b", name: "Test" });
      const base = { venue_id: v.id, chat_id: 10, summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", source: "text" as const, changes: [] };
      const proposed = await s.createChangeSet({ ...base, status: "proposed" });
      expect(await s.expireChangeSet(proposed.id, LATER)).toBe("expired");
      expect(await s.getChangeSet(proposed.id)).toMatchObject({ status: "expired", decided_at: LATER });
      expect(await s.expireChangeSet(proposed.id, LATER)).toBe("skipped");
      const applied = await s.createChangeSet({ ...base, status: "proposed" });
      expect(await s.applyChangeSet(applied.id, NOW)).toBe("applied");
      expect(await s.expireChangeSet(applied.id, LATER)).toBe("skipped");
      expect(await s.getChangeSet(applied.id)).toMatchObject({ status: "applied", decided_at: NOW });
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
      const timers = await s.listExpiredTimers(LATER, v.id);
      expect(timers.map((t) => [t.item.id, t.kind])).toEqual(expect.arrayContaining([[a.id, "sold_out"], [sp.id, "special"]]));
      expect(timers).toHaveLength(2);
      expect(await s.listExpiredTimers(NOW, v.id)).toEqual([]);
    });

    it("ignores the sold-out timer of a removed item", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t7b", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "a", name_en: "a", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0 });
      const base = { venue_id: v.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text" as const, status: "proposed" as const };
      const soldOut = await s.createChangeSet({ ...base, changes: [{ position: 0, op: "set_sold_out", entity: "item", entity_id: i.id, before: { sold_out_until: null }, after: { sold_out_until: "2026-10-09T09:30:00.000Z" } }] });
      await s.applyChangeSet(soldOut.id, NOW);
      const removed = await s.createChangeSet({ ...base, changes: [{ position: 0, op: "remove_item", entity: "item", entity_id: i.id, before: { active: true }, after: { active: false } }] });
      await s.applyChangeSet(removed.id, NOW);
      expect((await s.getSite(v.id)).items[0]).toMatchObject({ active: false, sold_out_until: "2026-10-09T09:30:00.000Z" });
      expect(await s.listExpiredTimers(LATER, v.id)).toEqual([]);
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

    it("gives new venues the classic template, café type and live status, and accepts overrides", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t10", name: "Test" });
      expect(v).toMatchObject({ template: "classic", business_type: "cafe", status: "live", deploy: null, wizard_draft: null });
      const d = await s.createVenue({ slug: "t10d", name: "Draft", template: "nocturne", business_type: "bar", status: "draft" });
      expect(d).toMatchObject({ template: "nocturne", business_type: "bar", status: "draft" });
      expect((await s.listVenues()).map((x) => x.id)).toEqual(expect.arrayContaining([v.id, d.id]));
      expect((await s.listVenues({ status: "draft" })).map((x) => x.id)).toEqual([d.id]);
      expect((await s.listVenues({ status: "live" })).map((x) => x.id)).toContain(v.id);
      expect((await s.listVenues({ status: "live" })).map((x) => x.id)).not.toContain(d.id);
    });

    it("updates venue fields and refuses a taken slug", async () => {
      const s = await make();
      const a = await s.createVenue({ slug: "t11a", name: "A" });
      await s.createVenue({ slug: "t11b", name: "B" });
      const u = await s.updateVenue(a.id, { name: "A2", template: "lumen", status: "draft", theme: { accent: "#112233" }, tagline_en: undefined });
      expect(u).toMatchObject({ id: a.id, name: "A2", template: "lumen", status: "draft", theme: { accent: "#112233" }, tagline_en: "" });
      expect(await s.getVenue(a.id)).toEqual(u);
      const renamed = await s.updateVenue(a.id, { slug: "t11c" });
      expect(renamed.slug).toBe("t11c");
      expect((await s.getVenueBySlug("t11c"))?.id).toBe(a.id);
      expect(await s.getVenueBySlug("t11a")).toBeNull();
      await expect(s.updateVenue(a.id, { slug: "t11b" })).rejects.toThrow(/t11b/);
      await expect(s.updateVenue("00000000-0000-0000-0000-000000000000", { name: "x" })).rejects.toThrow();
      await expect(s.updateVenue(a.id, { slug: "t11c" })).resolves.toMatchObject({ slug: "t11c" }); // own slug is fine
    });

    it("stores the wizard draft JSON and clears it", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t12", name: "Test", status: "draft" });
      const draft = {
        template: "classic" as const, business_type: "cafe" as const, name: "X", slug: "t12", default_lang: "bg" as const,
        address: "", phone: "", instagram: "", maps_url: "", hours: v.hours, theme: { accent: "#2f6b4f" },
        tagline_bg: "", tagline_en: "", about_bg: "", about_en: "", texts: { welcome: { bg: "", en: "" }, footer_note: { bg: "", en: "" } },
        logo_media_id: null, cover_media_id: null, gallery_media_ids: [], categories: [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [] }], step: "menu" as const,
      };
      await s.updateVenue(v.id, { wizard_draft: draft });
      expect((await s.getVenue(v.id)).wizard_draft).toEqual(draft);
      await s.updateVenue(v.id, { wizard_draft: null, status: "live" });
      expect(await s.getVenue(v.id)).toMatchObject({ wizard_draft: null, status: "live" });
    });

    it("tracks deployments and lists the ones in flight", async () => {
      const s = await make();
      const a = await s.createVenue({ slug: "t13a", name: "A" });
      const b = await s.createVenue({ slug: "t13b", name: "B" });
      const c = await s.createVenue({ slug: "t13c", name: "C" });
      const base = { provider: "fake" as const, project_id: "p", deployment_id: "d", url: null, error: null, template: "classic" as const, updated_at: NOW };
      await s.setDeploy(a.id, { ...base, status: "pending" });
      await s.setDeploy(b.id, { ...base, status: "building" });
      await s.setDeploy(c.id, { ...base, status: "ready", url: "https://c.example.test" });
      expect((await s.getVenue(a.id)).deploy).toEqual({ ...base, status: "pending" });
      expect((await s.listVenues({ deploying: true })).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
      await s.setDeploy(a.id, { ...base, status: "error", error: "boom" });
      expect((await s.listVenues({ deploying: true })).map((x) => x.id)).toEqual([b.id]);
      await s.setDeploy(b.id, null);
      expect(await s.listVenues({ deploying: true })).toEqual([]);
      expect((await s.getVenue(b.id)).deploy).toBeNull();
    });

    it("finds a draft by its token hash and lists members", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t14", name: "Test", status: "draft" });
      expect(await s.findVenueByDraftToken("a".repeat(64))).toBeNull();
      await s.setDraftToken(v.id, "a".repeat(64));
      expect((await s.findVenueByDraftToken("a".repeat(64)))?.id).toBe(v.id);
      await s.setDraftToken(v.id, null);
      expect(await s.findVenueByDraftToken("a".repeat(64))).toBeNull();
      await s.upsertMember({ venue_id: v.id, tg_chat_id: 21, role: "owner", lang: "bg" });
      await s.upsertMember({ venue_id: v.id, tg_chat_id: 22, role: "staff", lang: "en" });
      const members = await s.listMembers(v.id);
      expect(members.map((m) => [m.tg_chat_id, m.role]).sort()).toEqual([[21, "owner"], [22, "staff"]]);
      expect(await s.listMembers("00000000-0000-0000-0000-000000000000")).toEqual([]);
    });

    it("deletes a venue with everything attached", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t15", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0 });
      await s.upsertMember({ venue_id: v.id, tg_chat_id: 31, role: "owner", lang: "bg" });
      const code = await s.createInvite(v.id, "staff", LATER);
      const token = await s.getAdminToken(v.id);
      await s.setDraftToken(v.id, "b".repeat(64));
      await s.createChangeSet({ venue_id: v.id, chat_id: 31, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [] });
      await s.deleteVenue(v.id);
      expect(await s.getVenueBySlug("t15")).toBeNull();
      await expect(s.getVenue(v.id)).rejects.toThrow();
      expect(await s.findMember(31)).toBeNull();
      expect(await s.redeemInvite(code, 32, "bg", NOW)).toBeNull();
      expect(await s.findVenueByAdminToken(token)).toBeNull();
      expect(await s.findVenueByDraftToken("b".repeat(64))).toBeNull();
      expect(await s.listProposedBefore("2027-01-01T00:00:00.000Z", v.id)).toEqual([]);
      await expect(s.deleteVenue(v.id)).resolves.toBeUndefined(); // idempotent
    });

    it("counts rate limits in a sliding window", async () => {
      const s = await make();
      const key = `rl-${crypto.randomUUID()}`;
      const hour = 3_600_000;
      expect(await s.bumpRateLimit(key, hour, 2, NOW)).toBe(true);
      expect(await s.bumpRateLimit(key, hour, 2, NOW)).toBe(true);
      expect(await s.bumpRateLimit(key, hour, 2, NOW)).toBe(false);
      expect(await s.bumpRateLimit(key, hour, 2, "2026-10-09T09:59:00.000Z")).toBe(false); // still inside the window
      expect(await s.bumpRateLimit(key, hour, 2, "2026-10-09T10:00:00.000Z")).toBe(true); // window elapsed: count restarts at 1
      expect(await s.bumpRateLimit(`${key}-other`, hour, 1, NOW)).toBe(true); // keys are independent
      expect(await s.bumpRateLimit(`${key}-other`, hour, 1, NOW)).toBe(false);
    });
  });
}
