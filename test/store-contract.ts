// test/store-contract.ts
import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import type { Store } from "@/src/store/types";
import { NOW } from "./fixtures";

const LATER = "2026-10-09T10:00:00.000Z";
const ctx = { newId: () => crypto.randomUUID(), now: NOW };
/** Ids from a store-wide listing, narrowed to the venues one test created (a live store holds other venues too), in listing order. */
const only = (venues: { id: string }[], ...ids: string[]) => venues.map((v) => v.id).filter((id) => ids.includes(id));

/**
 * Behaviour every Store must have. Call with a factory that yields an empty store, and a probe that says whether a storage
 * object exists at a media row's storage_path in that store (used by the draft-cleanup storage test).
 */
export function storeContract(name: string, make: () => Promise<Store>, storageHas: (s: Store, path: string) => Promise<boolean>) {
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
      expect(await s.redeemInvite("WRONGCOD", "tg:10", "bg", NOW)).toBeNull();
      const m = await s.redeemInvite(code, "tg:10", "en", NOW);
      expect(m).toMatchObject({ venue_id: v.id, chat_ref: "tg:10", role: "owner", lang: "en" });
      expect(await s.redeemInvite(code, "tg:11", "bg", NOW)).toBeNull(); // used
      const expired = await s.createInvite(v.id, "staff", NOW);
      expect(await s.redeemInvite(expired, "tg:12", "bg", LATER)).toBeNull();
      expect(await s.findMember("tg:10")).toMatchObject({ role: "owner", lang: "en" });
      await s.setMemberLang(v.id, "tg:10", "bg");
      expect((await s.findMember("tg:10"))?.lang).toBe("bg");
      expect(await s.findMember("tg:99")).toBeNull();
      const token = await s.getAdminToken(v.id);
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(await s.getAdminToken(v.id)).toBe(token);
      expect((await s.findVenueByAdminToken(token))?.id).toBe(v.id);
      expect(await s.findVenueByAdminToken("x".repeat(32))).toBeNull();
      expect((await s.findMember("tg:10"))?.last_seen_at).toBeNull();
      await s.touchMember("tg:10", LATER);
      expect((await s.findMember("tg:10"))?.last_seen_at).toBe(LATER);
      await s.touchMember("fb:nobody", LATER); // unknown ref: no throw
    });

    it("creates, lists, applies and skips change sets", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t4", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      const site = await s.getSite(v.id);
      const changes = planChanges(site, [{ op: "set_price", item_id: i.id, price_eur: 2 }], ctx);
      const cs = await s.createChangeSet({ venue_id: v.id, chat_ref: "tg:10", summary_bg: "Цена", summary_en: "Price", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
      expect(cs).toMatchObject({ status: "proposed", source: "text", chat_ref: "tg:10", apply_at: null, undoes_id: null });
      expect(cs.changes).toHaveLength(1);
      expect(cs.changes[0]).toMatchObject({ op: "set_price", entity: "item", entity_id: i.id, before: { price_eur: 1.8 }, after: { price_eur: 2 } });
      expect((await s.findProposed(v.id, "tg:10"))?.id).toBe(cs.id);
      expect(await s.findProposed(v.id, "tg:11")).toBeNull();

      expect(await s.applyChangeSet(cs.id, LATER)).toBe("applied");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(2);
      const after = await s.getChangeSet(cs.id);
      expect(after).toMatchObject({ status: "applied", applied_at: LATER });
      expect(await s.applyChangeSet(cs.id, LATER)).toBe("skipped");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(2);
      expect(await s.findProposed(v.id, "tg:10")).toBeNull();
      expect((await s.listChangeSets(v.id, { status: ["applied"] })).map((x) => x.id)).toEqual([cs.id]);
      expect(await s.listChangeSets(v.id, { status: ["proposed"] })).toEqual([]);
    });

    it("applies an undo set and marks the target reverted", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t5", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      const changes = planChanges(await s.getSite(v.id), [{ op: "set_price", item_id: i.id, price_eur: 2 }], ctx);
      const cs = await s.createChangeSet({ venue_id: v.id, chat_ref: "tg:10", summary_bg: "Цена", summary_en: "Price", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
      await s.applyChangeSet(cs.id, NOW);
      const undo = await s.createChangeSet({ venue_id: v.id, chat_ref: "tg:10", summary_bg: "Отмяна", summary_en: "Undo", preview_bg: "u", preview_en: "u", source: "undo", status: "proposed", undoes_id: cs.id, changes: [{ ...changes[0], before: changes[0].after, after: changes[0].before }] });
      expect(await s.applyChangeSet(undo.id, LATER)).toBe("applied");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(1.8);
      expect(await s.getChangeSet(cs.id)).toMatchObject({ status: "reverted", reverted_by: undo.id });
    });

    it("finds due, upcoming and stale sets", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t6", name: "Test" });
      const base = { venue_id: v.id, chat_ref: "tg:10", summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", source: "text" as const, changes: [] };
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
      const base = { venue_id: v.id, chat_ref: "tg:10", summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", source: "text" as const, changes: [] };
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
      await s.createChangeSet({ venue_id: v.id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [{ position: 0, op: "set_sold_out", entity: "item", entity_id: a.id, before: { sold_out_until: null }, after: { sold_out_until: "2026-10-09T09:30:00.000Z" } }] }).then((cs) => s.applyChangeSet(cs.id, NOW));
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
      const base = { venue_id: v.id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text" as const, status: "proposed" as const };
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
      expect(await s.getConversation(v.id, "tg:10")).toBeNull();
      const conv = { turns: [{ at: NOW, owner: "hi", agent: "hello" }], correction_for: null, updated_at: NOW };
      await s.setConversation(v.id, "tg:10", conv);
      expect(await s.getConversation(v.id, "tg:10")).toEqual(conv);
    });

    it("clears venue content but keeps members", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t9", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0 });
      await s.upsertMember({ venue_id: v.id, chat_ref: "tg:10", role: "owner", lang: "bg" });
      await s.clearVenueContent(v.id);
      const site = await s.getSite(v.id);
      expect(site.items).toEqual([]);
      expect(site.categories).toEqual([]);
      expect(await s.findMember("tg:10")).not.toBeNull();
    });

    it("clears only the menu and texts (media, venue fields and members stay)", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t9m", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0 });
      await s.setSiteText(v.id, "welcome", "Здравейте", "Hello");
      const m = await s.saveMedia(v.id, new Uint8Array([1]), "image/png");
      await s.upsertMember({ venue_id: v.id, chat_ref: "tg:11", role: "owner", lang: "bg" });
      await s.clearMenu(v.id);
      const site = await s.getSite(v.id);
      expect(site.items).toEqual([]);
      expect(site.categories).toEqual([]);
      expect(site.texts).toEqual([]);
      expect(site.media.map((x) => x.id)).toEqual([m.id]);
      expect(site.venue.name).toBe("Test");
      expect(await s.findMember("tg:11")).not.toBeNull();
    });

    it("gives new venues the classic template, café type and live status, and accepts overrides", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t10", name: "Test" });
      const d = await s.createVenue({ slug: "t10d", name: "Draft", template: "nocturne", business_type: "bar", status: "draft" });
      try {
        expect(v).toMatchObject({ template: "classic", business_type: "cafe", status: "live", deploy: null, wizard_draft: null, instagram_import: null, site_url: null });
        expect(d).toMatchObject({ template: "nocturne", business_type: "bar", status: "draft" });
        expect(only(await s.listVenues(), v.id, d.id)).toEqual([v.id, d.id]); // oldest first
        expect(only(await s.listVenues({ status: "draft" }), v.id, d.id)).toEqual([d.id]);
        expect(only(await s.listVenues({ status: "live" }), v.id, d.id)).toEqual([v.id]);
      } finally {
        await s.deleteVenue(v.id);
        await s.deleteVenue(d.id);
      }
    });

    it("updates venue fields and refuses a taken slug", async () => {
      const s = await make();
      const a = await s.createVenue({ slug: "t11a", name: "A" });
      const b = await s.createVenue({ slug: "t11b", name: "B" });
      try {
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
      } finally {
        await s.deleteVenue(a.id);
        await s.deleteVenue(b.id);
      }
    });

    it("stores the venue's own site URL on create and update, and clears it", async () => {
      const s = await make();
      const a = await s.createVenue({ slug: "t13a", name: "A" });
      const b = await s.createVenue({ slug: "t13b", name: "B", site_url: "https://own.example" });
      try {
        expect(a.site_url).toBeNull();
        expect(b.site_url).toBe("https://own.example");
        expect((await s.getVenue(b.id)).site_url).toBe("https://own.example");
        expect((await s.updateVenue(a.id, { site_url: "https://a.example" })).site_url).toBe("https://a.example");
        expect((await s.getVenueBySlug("t13a"))?.site_url).toBe("https://a.example");
        expect((await s.updateVenue(a.id, { name: "A2" })).site_url).toBe("https://a.example"); // untouched by other patches
        expect((await s.updateVenue(a.id, { site_url: null })).site_url).toBeNull();
      } finally {
        await s.deleteVenue(a.id);
        await s.deleteVenue(b.id);
      }
    });

    it("stores the wizard draft JSON and clears it", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t12", name: "Test", status: "draft" });
      try {
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
      } finally {
        await s.deleteVenue(v.id);
      }
    });

    it("stores the Instagram import list JSON and clears it", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t12i", name: "Test", status: "draft" });
      try {
        expect(v.instagram_import).toBeNull();
        const list = { fetched_at: "2026-10-09T09:00:00.000Z", username: "agala.cafe", items: [{ id: "179", url: "https://scontent-sof1-1.cdninstagram.com/a.jpg", thumb: "https://scontent-sof1-1.cdninstagram.com/a.jpg", caption: "Кафе „Ъгъла“", permalink: "https://www.instagram.com/p/abc/", taken_at: "2026-10-01T08:00:00.000Z" }] };
        await s.updateVenue(v.id, { instagram_import: list });
        expect((await s.getVenue(v.id)).instagram_import).toEqual(list);
        await s.updateVenue(v.id, { name: "Other" }); // an unrelated write keeps it
        expect((await s.getVenue(v.id)).instagram_import).toEqual(list);
        await s.updateVenue(v.id, { instagram_import: null });
        expect((await s.getVenue(v.id)).instagram_import).toBeNull();
      } finally {
        await s.deleteVenue(v.id);
      }
    });

    it("tracks deployments and lists the ones in flight", async () => {
      const s = await make();
      const a = await s.createVenue({ slug: "t13a", name: "A" });
      const b = await s.createVenue({ slug: "t13b", name: "B" });
      const c = await s.createVenue({ slug: "t13c", name: "C" });
      try {
        const base = { provider: "fake" as const, project_id: "p", deployment_id: "d", url: null, error: null, template: "classic" as const, updated_at: NOW };
        await s.setDeploy(a.id, { ...base, status: "pending" });
        await s.setDeploy(b.id, { ...base, status: "building" });
        await s.setDeploy(c.id, { ...base, status: "ready", url: "https://c.example.test" });
        expect((await s.getVenue(a.id)).deploy).toEqual({ ...base, status: "pending" });
        expect(only(await s.listVenues({ deploying: true }), a.id, b.id, c.id)).toEqual([a.id, b.id]);
        await s.setDeploy(a.id, { ...base, status: "error", error: "boom" });
        expect(only(await s.listVenues({ deploying: true }), a.id, b.id, c.id)).toEqual([b.id]);
        await s.setDeploy(b.id, null);
        expect(only(await s.listVenues({ deploying: true }), a.id, b.id, c.id)).toEqual([]);
        expect((await s.getVenue(b.id)).deploy).toBeNull();
      } finally {
        for (const x of [a, b, c]) await s.deleteVenue(x.id);
      }
    });

    it("claims a deploy only from the statuses the caller names (one winner)", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t13d", name: "D" });
      try {
        const base = { provider: "fake" as const, project_id: "p", deployment_id: "", url: null, error: null, template: "classic" as const, updated_at: NOW };
        const pending = { ...base, status: "pending" as const };
        expect(await s.claimDeploy(v.id, pending, { whenStatusIn: ["error"] })).toBe(false); // no deploy yet, null not allowed
        expect((await s.getVenue(v.id)).deploy).toBeNull();
        expect(await s.claimDeploy(v.id, pending, { whenStatusIn: [null, "error"] })).toBe(true);
        expect((await s.getVenue(v.id)).deploy).toEqual(pending);
        expect(await s.claimDeploy(v.id, pending, { whenStatusIn: [null, "error"] })).toBe(false); // already pending: the other caller lost
        const building = { ...base, deployment_id: "d1", status: "building" as const, template: "lumen" as const };
        expect(await s.claimDeploy(v.id, building, { whenStatusIn: ["ready", "error"] })).toBe(false);
        expect(await s.claimDeploy(v.id, building, { whenStatusIn: ["pending"] })).toBe(true);
        expect((await s.getVenue(v.id)).deploy).toEqual(building);
        expect(await s.claimDeploy(v.id, building, { whenStatusIn: [] })).toBe(false);
        expect(await s.claimDeploy("00000000-0000-0000-0000-000000000000", pending, { whenStatusIn: [null] })).toBe(false);
        // whenDeploymentId: a poll result for deployment d1 must not land on a newer deployment (a template switch started d2)
        const ready = { ...building, status: "ready" as const, url: "https://x.example.test" };
        expect(await s.claimDeploy(v.id, ready, { whenStatusIn: ["pending", "building"], whenDeploymentId: "d0" })).toBe(false);
        expect((await s.getVenue(v.id)).deploy).toEqual(building);
        expect(await s.claimDeploy(v.id, ready, { whenStatusIn: ["pending", "building"], whenDeploymentId: "d1" })).toBe(true);
        expect((await s.getVenue(v.id)).deploy).toEqual(ready);
        expect(await s.claimDeploy(v.id, ready, { whenStatusIn: ["pending", "building"], whenDeploymentId: "d1" })).toBe(false); // already ready: a second poller loses
        const switching = { ...ready, deployment_id: "", status: "building" as const };
        expect(await s.claimDeploy(v.id, switching, { whenStatusIn: ["ready"] })).toBe(true);
        expect(await s.claimDeploy(v.id, { ...switching, status: "error" as const }, { whenStatusIn: ["building"], whenDeploymentId: "" })).toBe(true); // empty id matches a create still in flight
      } finally {
        await s.deleteVenue(v.id);
      }
    });

    it("deleteVenue with storage removes the venue's stored files too, and only that venue's", async () => {
      const s = await make();
      const a = await s.createVenue({ slug: "t14a", name: "A", status: "draft" });
      const b = await s.createVenue({ slug: "t14b", name: "B", status: "draft" });
      const ma = [await s.saveMedia(a.id, new Uint8Array([1]), "image/png"), await s.saveMedia(a.id, new Uint8Array([2]), "image/jpeg")];
      const mb = await s.saveMedia(b.id, new Uint8Array([3]), "image/png");
      try {
        expect(await storageHas(s, ma[0].storage_path)).toBe(true);
        await s.deleteVenue(a.id, { withStorage: true });
        await expect(s.getVenue(a.id)).rejects.toThrow();
        for (const m of ma) {
          expect(await s.getMedia(m.id)).toBeNull();
          expect(await storageHas(s, m.storage_path)).toBe(false);
        }
        expect(await storageHas(s, mb.storage_path)).toBe(true);
        expect(await s.getMedia(mb.id)).not.toBeNull();
      } finally {
        await s.deleteVenue(a.id, { withStorage: true });
        await s.deleteVenue(b.id, { withStorage: true });
      }
      expect(await storageHas(s, mb.storage_path)).toBe(false);
    });

    it("finds the newest open invite for a venue and role (unused, unexpired), or null", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t15a", name: "A" });
      const other = await s.createVenue({ slug: "t15b", name: "B" });
      try {
        expect(await s.findOpenInvite(v.id, "owner", NOW)).toBeNull();
        await s.createInvite(v.id, "owner", "2026-10-09T08:00:00.000Z"); // expired at NOW
        await s.createInvite(v.id, "staff", "2026-10-20T00:00:00.000Z"); // other role
        await s.createInvite(other.id, "owner", "2026-10-20T00:00:00.000Z"); // other venue
        expect(await s.findOpenInvite(v.id, "owner", NOW)).toBeNull();
        const older = await s.createInvite(v.id, "owner", "2026-10-12T00:00:00.000Z");
        const newer = await s.createInvite(v.id, "owner", "2026-10-15T00:00:00.000Z");
        expect(await s.findOpenInvite(v.id, "owner", NOW)).toBe(newer);
        expect(await s.redeemInvite(newer, "tg:7101", "bg", NOW)).not.toBeNull();
        expect(await s.findOpenInvite(v.id, "owner", NOW)).toBe(older); // used codes are skipped
        expect(await s.findOpenInvite(v.id, "owner", "2026-10-13T00:00:00.000Z")).toBeNull();
      } finally {
        await s.deleteVenue(v.id);
        await s.deleteVenue(other.id);
      }
    });

    it("lets one publish claim a draft; the claim expires so a crashed publish does not block a retry", async () => {
      const s = await make();
      const draft = await s.createVenue({ slug: "t13e", name: "E", status: "draft" });
      const live = await s.createVenue({ slug: "t13f", name: "F" });
      try {
        expect(await s.claimPublish(live.id, NOW)).toBe(false); // only drafts publish
        expect(await s.claimPublish("00000000-0000-0000-0000-000000000000", NOW)).toBe(false);
        expect(await s.claimPublish(draft.id, NOW)).toBe(true);
        expect(await s.claimPublish(draft.id, NOW)).toBe(false); // held
        await s.releasePublish(draft.id);
        expect(await s.claimPublish(draft.id, NOW)).toBe(true); // released → claimable again
        expect(await s.claimPublish(draft.id, NOW)).toBe(false);
        expect(await s.claimPublish(draft.id, "2026-10-09T09:04:00.000Z")).toBe(false); // 4 min later: still held
        expect(await s.claimPublish(draft.id, "2026-10-09T09:06:00.000Z")).toBe(true); // past PUBLISH_CLAIM_TTL_MS: stale claim is taken over
        await s.updateVenue(draft.id, { status: "live" });
        expect(await s.claimPublish(draft.id, "2026-10-09T10:00:00.000Z")).toBe(false); // published: never again
      } finally {
        await s.deleteVenue(draft.id);
        await s.deleteVenue(live.id);
      }
    });

    it("finds a draft by its token hash and lists members", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t14", name: "Test", status: "draft" });
      try {
        expect(await s.findVenueByDraftToken("a".repeat(64))).toBeNull();
        await s.setDraftToken(v.id, "a".repeat(64));
        expect((await s.findVenueByDraftToken("a".repeat(64)))?.id).toBe(v.id);
        await s.setDraftToken(v.id, null);
        expect(await s.findVenueByDraftToken("a".repeat(64))).toBeNull();
        await s.upsertMember({ venue_id: v.id, chat_ref: "tg:21", role: "owner", lang: "bg" });
        await s.upsertMember({ venue_id: v.id, chat_ref: "tg:22", role: "staff", lang: "en" });
        const members = await s.listMembers(v.id);
        expect(members.map((m) => [m.chat_ref, m.role]).sort()).toEqual([["tg:21", "owner"], ["tg:22", "staff"]]);
        expect(await s.listMembers("00000000-0000-0000-0000-000000000000")).toEqual([]);
      } finally {
        await s.deleteVenue(v.id);
      }
    });

    it("removes a member of one venue only, and the chat is unknown afterwards", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t16a", name: "A" });
      const other = await s.createVenue({ slug: "t16b", name: "B" });
      try {
        await s.upsertMember({ venue_id: v.id, chat_ref: "tg:7161", role: "owner", lang: "bg" });
        await s.upsertMember({ venue_id: v.id, chat_ref: "fb:7162", role: "staff", lang: "en" });
        await s.upsertMember({ venue_id: other.id, chat_ref: "tg:7163", role: "owner", lang: "bg" });
        expect(await s.removeMember(other.id, "tg:7161")).toBe(false); // not that venue's member
        expect(await s.findMember("tg:7161")).not.toBeNull();
        expect(await s.removeMember(v.id, "tg:7161")).toBe(true);
        expect(await s.findMember("tg:7161")).toBeNull();
        expect((await s.listMembers(v.id)).map((m) => m.chat_ref)).toEqual(["fb:7162"]);
        expect(await s.removeMember(v.id, "tg:7161")).toBe(false); // already gone
        expect(await s.removeMember("00000000-0000-0000-0000-000000000000", "fb:7162")).toBe(false);
        expect(await s.findMember("tg:7163")).not.toBeNull();
      } finally {
        await s.deleteVenue(v.id);
        await s.deleteVenue(other.id);
      }
    });

    it("lists unexpired invites with a 4-character hint, and cancels unused ones by role", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t17a", name: "A" });
      const other = await s.createVenue({ slug: "t17b", name: "B" });
      try {
        expect(await s.listInvites(v.id, NOW)).toEqual([]);
        await s.createInvite(v.id, "owner", "2026-10-09T08:00:00.000Z"); // expired at NOW
        const owner = await s.createInvite(v.id, "owner", "2026-10-15T00:00:00.000Z");
        const staff = await s.createInvite(v.id, "staff", "2026-10-12T00:00:00.000Z");
        const used = await s.createInvite(v.id, "staff", "2026-10-14T00:00:00.000Z");
        await s.redeemInvite(used, "tg:7171", "bg", NOW);
        const foreign = await s.createInvite(other.id, "owner", "2026-10-15T00:00:00.000Z");
        const list = await s.listInvites(v.id, NOW);
        expect(list).toEqual([
          { role: "staff", code_hint: staff.slice(-4), expires_at: "2026-10-12T00:00:00.000Z", used: false },
          { role: "staff", code_hint: used.slice(-4), expires_at: "2026-10-14T00:00:00.000Z", used: true },
          { role: "owner", code_hint: owner.slice(-4), expires_at: "2026-10-15T00:00:00.000Z", used: false },
        ]);
        expect(JSON.stringify(list)).not.toContain(owner); // never the whole code
        expect(await s.listInvites("00000000-0000-0000-0000-000000000000", NOW)).toEqual([]);

        expect(await s.cancelInvites(v.id, "staff")).toBe(1); // the used staff code stays (it is history, not access)
        expect(await s.redeemInvite(staff, "tg:7172", "bg", NOW)).toBeNull();
        expect(await s.findOpenInvite(v.id, "owner", NOW)).toBe(owner);
        expect(await s.cancelInvites(v.id)).toBe(2); // the open owner code and the expired one
        expect(await s.findOpenInvite(v.id, "owner", NOW)).toBeNull();
        expect(await s.redeemInvite(owner, "tg:7173", "bg", NOW)).toBeNull();
        expect(await s.cancelInvites(v.id)).toBe(0);
        expect(await s.listInvites(v.id, NOW)).toEqual([{ role: "staff", code_hint: used.slice(-4), expires_at: "2026-10-14T00:00:00.000Z", used: true }]);
        expect(await s.findOpenInvite(other.id, "owner", NOW)).toBe(foreign); // other venues untouched
        expect(await s.findMember("tg:7171")).not.toBeNull(); // cancelling codes never unlinks members
      } finally {
        await s.deleteVenue(v.id);
        await s.deleteVenue(other.id);
      }
    });

    it("rotates the admin token: the old key stops working, the new one opens the venue", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t18a", name: "A" });
      const fresh = await s.createVenue({ slug: "t18b", name: "B" });
      try {
        const old = await s.getAdminToken(v.id);
        const next = await s.rotateAdminToken(v.id);
        expect(next).not.toBe(old);
        expect(next.length).toBeGreaterThanOrEqual(32);
        expect(await s.findVenueByAdminToken(old)).toBeNull();
        expect((await s.findVenueByAdminToken(next))?.id).toBe(v.id);
        expect(await s.getAdminToken(v.id)).toBe(next);
        const first = await s.rotateAdminToken(fresh.id); // a venue that never had a token gets one
        expect(await s.getAdminToken(fresh.id)).toBe(first);
        await expect(s.rotateAdminToken("00000000-0000-0000-0000-000000000000")).rejects.toThrow();
      } finally {
        await s.deleteVenue(v.id);
        await s.deleteVenue(fresh.id);
      }
    });

    it("deletes a venue with everything attached", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t15", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0 });
      await s.upsertMember({ venue_id: v.id, chat_ref: "tg:31", role: "owner", lang: "bg" });
      const code = await s.createInvite(v.id, "staff", LATER);
      const token = await s.getAdminToken(v.id);
      await s.setDraftToken(v.id, "b".repeat(64));
      await s.createChangeSet({ venue_id: v.id, chat_ref: "tg:31", summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [] });
      await s.deleteVenue(v.id);
      expect(await s.getVenueBySlug("t15")).toBeNull();
      await expect(s.getVenue(v.id)).rejects.toThrow();
      expect(await s.findMember("tg:31")).toBeNull();
      expect(await s.redeemInvite(code, "tg:32", "bg", NOW)).toBeNull();
      expect(await s.findVenueByAdminToken(token)).toBeNull();
      expect(await s.findVenueByDraftToken("b".repeat(64))).toBeNull();
      expect(await s.listProposedBefore("2027-01-01T00:00:00.000Z", v.id)).toEqual([]);
      await expect(s.deleteVenue(v.id)).resolves.toBeUndefined(); // idempotent
    });

    it("counts rate limits in a fixed window", async () => {
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

    it("stores one destination per kind with secrets kept apart, and syncs with due ordering", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t-dest", name: "Dest" });
      const d1 = await s.upsertDestination({ venue_id: v.id, kind: "wordpress", config: { site_url: "https://a.example" }, secrets: "enc-1" });
      expect(d1).toMatchObject({ venue_id: v.id, kind: "wordpress", status: "connected", last_error: null, config: { site_url: "https://a.example" } });
      expect(d1).not.toHaveProperty("secrets");
      const d2 = await s.upsertDestination({ venue_id: v.id, kind: "wordpress", config: { site_url: "https://b.example" }, secrets: "enc-2" });
      expect(d2.id).toBe(d1.id);
      expect(await s.getDestination(v.id, "wordpress")).toMatchObject({ id: d1.id, secrets: "enc-2", config: { site_url: "https://b.example" }, status: "connected" });
      expect(await s.getDestination(v.id, "google")).toBeNull();
      const listed = await s.listDestinations(v.id);
      expect(listed.map((d) => d.kind)).toEqual(["wordpress"]);
      expect(listed[0]).not.toHaveProperty("secrets");
      await s.updateDestination(d1.id, { status: "error", last_error: "boom" });
      expect(await s.getDestination(v.id, "wordpress")).toMatchObject({ status: "error", last_error: "boom" });

      const cs = await s.createChangeSet({ venue_id: v.id, chat_ref: null, summary_bg: "x", summary_en: "x", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [{ position: 0, op: "wp_edit_page", entity: "wp_page", entity_id: "7", before: { title: "a" }, after: { title: "b" } }] });
      expect(await s.applyChangeSet(cs.id, NOW)).toBe("applied"); // wp_* rows are no-ops for the store
      expect((await s.getChangeSet(cs.id)).changes[0]).toMatchObject({ entity: "wp_page", op: "wp_edit_page", after: { title: "b" } });

      const y1 = await s.createSync({ venue_id: v.id, destination_id: d1.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: "2026-10-09T09:05:00.000Z" });
      const y2 = await s.createSync({ venue_id: v.id, destination_id: d1.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: "2026-10-09T09:00:00.000Z" });
      expect(y1).toMatchObject({ status: "pending", attempts: 0, last_error: null, result: null, payload: { kind: "wordpress" } });
      expect((await s.listSyncs({ venueId: v.id, status: ["pending"], dueBefore: "2026-10-09T09:01:00.000Z" })).map((x) => x.id)).toEqual([y2.id]);
      expect((await s.listSyncs({ changeSetId: cs.id })).map((x) => x.id)).toEqual([y1.id, y2.id]);
      await s.updateSync(y2.id, { status: "done", attempts: 1, result: { pushed: 1 }, updated_at: LATER });
      expect(await s.getSync(y2.id)).toMatchObject({ status: "done", attempts: 1, result: { pushed: 1 }, updated_at: LATER });
      expect((await s.listSyncs({ venueId: v.id, status: ["pending"] })).map((x) => x.id)).toEqual([y1.id]);
      expect((await s.listSyncs({ venueId: v.id, limit: 1 })).map((x) => x.id)).toEqual([y1.id]);

      await s.deleteDestination(d1.id);
      expect(await s.getDestination(v.id, "wordpress")).toBeNull();
      expect(await s.listSyncs({ venueId: v.id })).toEqual([]);
    });

    it("claims a pending sync row for one run at a time (lease), and frees it again", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: `t-claim-${crypto.randomUUID().slice(0, 8)}`, name: "Claim" });
      const d = await s.upsertDestination({ venue_id: v.id, kind: "facebook", config: {}, secrets: "enc" });
      const cs = await s.createChangeSet({ venue_id: v.id, chat_ref: null, summary_bg: "x", summary_en: "x", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [] });
      const y = await s.createSync({ venue_id: v.id, destination_id: d.id, change_set_id: cs.id, payload: { kind: "facebook" }, next_at: NOW });
      expect(y.leased_until ?? null).toBeNull();
      const lease = "2026-10-09T09:05:00.000Z";
      expect(await s.claimSync(y.id, NOW, lease)).toBe(true);
      expect(await s.claimSync(y.id, NOW, lease)).toBe(false); // another run holds a fresh lease
      expect(await s.claimSync(y.id, "2026-10-09T09:04:59.000Z", lease)).toBe(false);
      expect((await s.getSync(y.id)).leased_until).toBe(lease);
      expect(await s.claimSync(y.id, lease, "2026-10-09T09:10:00.000Z")).toBe(true); // an expired lease (crashed run) can be taken over
      await s.updateSync(y.id, { leased_until: null, status: "done" });
      expect((await s.getSync(y.id)).leased_until).toBeNull();
      expect(await s.claimSync(y.id, LATER, "2026-10-09T11:00:00.000Z")).toBe(false); // only pending rows
    });

    // --- Monthly change limit (appended 2026-10-13) ---
    it("stores a venue's monthly change limit (null = unlimited)", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "tl1", name: "Test" });
      expect(v.change_limit).toBeNull();
      const w = await s.createVenue({ slug: "tl2", name: "Test", change_limit: 60 });
      expect(w.change_limit).toBe(60);
      expect((await s.getVenue(w.id)).change_limit).toBe(60);
      expect((await s.setChangeLimit(v.id, 40)).change_limit).toBe(40);
      expect((await s.getVenueBySlug("tl1"))?.change_limit).toBe(40);
      expect((await s.setChangeLimit(v.id, null)).change_limit).toBeNull();
      expect((await s.getVenue(v.id)).change_limit).toBeNull();
      await expect(s.setChangeLimit(crypto.randomUUID(), 5)).rejects.toThrow();
    });

    it("counts applied change sets in [from, to), including later reverted ones, without undo and automatic sets", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "tl3", name: "Test" });
      const other = await s.createVenue({ slug: "tl4", name: "Test" });
      const base = { chat_ref: null, summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", status: "proposed" as const, changes: [] };
      const applied = async (source: "text" | "voice" | "dashboard" | "auto" | "undo", at: string, extra: { venue_id?: string; undoes_id?: string } = {}) => {
        const cs = await s.createChangeSet({ ...base, venue_id: v.id, source, ...extra });
        expect(await s.applyChangeSet(cs.id, at)).toBe("applied");
        return cs;
      };
      const FROM = "2026-09-30T21:00:00.000Z";
      const TO = "2026-10-31T22:00:00.000Z";
      await applied("text", FROM); // the first instant of the window counts
      const voice = await applied("voice", "2026-10-20T10:00:00.000Z");
      await applied("undo", "2026-10-21T10:00:00.000Z", { undoes_id: voice.id }); // voice is now reverted: it still counts, the undo does not
      await applied("auto", "2026-10-06T10:00:00.000Z");
      await applied("dashboard", "2026-10-07T10:00:00.000Z");
      await applied("text", TO); // the window's end is exclusive
      await applied("text", "2026-09-30T20:59:59.000Z"); // the month before
      await applied("text", "2026-10-08T10:00:00.000Z", { venue_id: other.id });
      await s.createChangeSet({ ...base, venue_id: v.id, source: "text" }); // proposed only
      const rejected = await s.createChangeSet({ ...base, venue_id: v.id, source: "text" });
      await s.updateChangeSet(rejected.id, { status: "rejected", decided_at: "2026-10-09T10:00:00.000Z" });
      expect((await s.getChangeSet(voice.id)).status).toBe("reverted");
      expect(await s.countAppliedChangeSets(v.id, FROM, TO)).toBe(3);
      expect(await s.countAppliedChangeSets(other.id, FROM, TO)).toBe(1);
      expect(await s.countAppliedChangeSets(v.id, TO, "2026-11-30T22:00:00.000Z")).toBe(1);
    });

    it("refuses to apply a counted set once the month's limit is reached: the set is cancelled, nothing is written", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "tl5", name: "Test", change_limit: 2 });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      const price = async (eur: number) => planChanges(await s.getSite(v.id), [{ op: "set_price", item_id: i.id, price_eur: eur }], ctx);
      const base = { venue_id: v.id, chat_ref: "tg:10", summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x" };
      const first = await s.createChangeSet({ ...base, source: "text", status: "proposed", changes: await price(2) });
      expect(await s.applyChangeSet(first.id, NOW)).toBe("applied");
      const second = await s.createChangeSet({ ...base, source: "voice", status: "proposed", changes: await price(2.1) });
      expect(await s.applyChangeSet(second.id, NOW)).toBe("applied");
      // 2/2: a scheduled set that comes due is refused and cancelled.
      const due = await s.createChangeSet({ ...base, source: "text", status: "scheduled", apply_at: LATER, changes: await price(9) });
      expect(await s.applyChangeSet(due.id, LATER)).toBe("limited");
      expect(await s.getChangeSet(due.id)).toMatchObject({ status: "cancelled", applied_at: null, decided_at: LATER });
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(2.1);
      expect(await s.applyChangeSet(due.id, LATER)).toBe("skipped"); // decided now
      expect(await s.listDue(LATER, v.id)).toEqual([]);
      // Undo is a safety feature and never limited; it does not use up a change either.
      const undo = await s.createChangeSet({ ...base, source: "undo", status: "proposed", undoes_id: second.id, changes: [{ ...second.changes[0], before: second.changes[0].after, after: second.changes[0].before }] });
      expect(await s.applyChangeSet(undo.id, LATER)).toBe("applied");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(2);
      const auto = await s.createChangeSet({ ...base, chat_ref: null, source: "auto", status: "proposed", changes: [] });
      expect(await s.applyChangeSet(auto.id, LATER)).toBe("applied");
      // The next calendar month in the venue's zone (1 Nov 2026 00:00 Sofia = 31 Oct 22:00 UTC) starts from zero.
      const november = await s.createChangeSet({ ...base, source: "text", status: "proposed", changes: await price(3) });
      expect(await s.applyChangeSet(november.id, "2026-10-31T22:00:00.000Z")).toBe("applied");
      // No limit: never refused.
      await s.setChangeLimit(v.id, null);
      const free = await s.createChangeSet({ ...base, source: "text", status: "proposed", changes: [] });
      expect(await s.applyChangeSet(free.id, "2026-10-31T22:00:01.000Z")).toBe("applied");
      await s.setChangeLimit(v.id, 0);
      const none = await s.createChangeSet({ ...base, source: "dashboard", status: "proposed", changes: [] });
      expect(await s.applyChangeSet(none.id, "2026-10-31T22:00:02.000Z")).toBe("limited");
    });
  });
}
