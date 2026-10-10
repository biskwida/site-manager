// test/wizard-server.test.ts
import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS } from "@/src/bot/bot";
import { sha256Hex } from "@/src/server/hash";
import { createDraft, publishDraft, rateLimitKeys, updateDraft, WizardError } from "@/src/server/wizard";
import { COOKIE_NAME, cookieFromHeader, DRAFT_COOKIE, draftCookieValue, parseDraftCookie, readDraftFromCookies, readDraftFromRequest, serializeDraftCookie, venueFromDraftCookie } from "@/src/server/draft-cookie";
import { emptyDraft } from "@/src/wizard/schema";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("draft cookie", () => {
  it("round-trips id and token and rejects junk", () => {
    const v = draftCookieValue("8d1b8f1e-1c5e-4a1b-9c6a-5f0f2b7a9e11", "ab".repeat(32));
    expect(parseDraftCookie(v)).toEqual({ id: "8d1b8f1e-1c5e-4a1b-9c6a-5f0f2b7a9e11", token: "ab".repeat(32) });
    expect(parseDraftCookie("")).toBeNull();
    expect(parseDraftCookie("nodot")).toBeNull();
    expect(parseDraftCookie(".abc")).toBeNull();
    expect(parseDraftCookie("id.")).toBeNull();
    expect(parseDraftCookie("id.NOT-HEX")).toBeNull();
    const header = serializeDraftCookie("id1", "ab".repeat(32), { secure: true });
    expect(header).toBe(`${COOKIE_NAME}=id1.${"ab".repeat(32)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`);
    expect(serializeDraftCookie("id1", "ab".repeat(32), { secure: false })).not.toContain("Secure");
    expect(cookieFromHeader(`a=1; ${COOKIE_NAME}=id1.${"ab".repeat(32)}; b=2`, COOKIE_NAME)).toBe(`id1.${"ab".repeat(32)}`);
    expect(cookieFromHeader(null, COOKIE_NAME)).toBeNull();
    expect(readDraftFromRequest(new Request("http://x/", { headers: { cookie: `${COOKIE_NAME}=id1.${"ab".repeat(32)}` } }))).toEqual({ id: "id1", token: "ab".repeat(32) });
    expect(readDraftFromCookies({ get: (n) => (n === COOKIE_NAME ? { value: `id1.${"ab".repeat(32)}` } : undefined) })).toEqual({ id: "id1", token: "ab".repeat(32) });
    expect(DRAFT_COOKIE).toBe("sm_draft");
    expect(COOKIE_NAME).toBe(DRAFT_COOKIE);
  });

  it("venueFromDraftCookie resolves the venue only for a matching token and path id", async () => {
    const { store } = await makeDemo();
    const { venue, token } = await createDraft(store, "classic", T0);
    const value = draftCookieValue(venue.id, token);
    expect((await venueFromDraftCookie(store, value, venue.id))?.id).toBe(venue.id);
    expect(await venueFromDraftCookie(store, value, "another-id")).toBeNull();
    expect(await venueFromDraftCookie(store, draftCookieValue(venue.id, "0".repeat(64)), venue.id)).toBeNull();
    expect(await venueFromDraftCookie(store, undefined, venue.id)).toBeNull();
    expect(await venueFromDraftCookie(store, "junk", venue.id)).toBeNull();
    // a valid token presented with another venue's id in the cookie is refused
    const other = await createDraft(store, "classic", T0);
    expect(await venueFromDraftCookie(store, draftCookieValue(other.venue.id, token), other.venue.id)).toBeNull();
  });
});

describe("rateLimitKeys", () => {
  it("builds the ip and global keys", () => {
    expect(rateLimitKeys("deadbeef")).toEqual({ ip: "new:ip:deadbeef", global: "new:global" });
  });
});

describe("publish claim (R24)", () => {
  it("refuses a second publisher while the claim is held, and retries after a failed publish", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    await updateDraft(store, venue, {
      name: "Claimed", slug: "claimed-cafe", default_lang: "bg", address: "ул. Пример 2", phone: "+359 2 222 2222", instagram: "", maps_url: "",
      hours: emptyDraft("classic").hours, theme: { accent: "#2f6b4f" },
      tagline_bg: "Кафе", tagline_en: "Coffee", about_bg: "За нас", about_en: "About us",
      texts: { welcome: { bg: "Здравейте", en: "Hello" }, footer_note: { bg: "", en: "" } },
      logo_media_id: null, cover_media_id: null, gallery_media_ids: [],
      categories: [{ key: "c", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "e", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }],
      step: "review",
    });
    const fresh = await store.getVenue(venue.id);
    expect(await store.claimPublish(fresh.id, T0.toISOString())).toBe(true); // someone else is publishing
    await expect(publishDraft(store, fresh, T0)).rejects.toMatchObject({ code: "publish_in_progress", status: 409 });
    await store.releasePublish(fresh.id);
    const failing = Object.create(store) as typeof store;
    let once = true;
    failing.insertItem = async (i) => {
      if (once) { once = false; throw new Error("boom"); }
      return store.insertItem(i);
    };
    await expect(publishDraft(failing, fresh, T0)).rejects.toThrow("boom");
    // the failed attempt released its claim, so the retry wins the claim and publishes
    const done = await publishDraft(store, await store.getVenue(venue.id), T0);
    expect(done.venue.status).toBe("live");
  });
});

describe("createDraft → updateDraft → publishDraft", () => {
  it("creates a draft venue with a placeholder slug and a hashed token", async () => {
    const { store } = await makeDemo();
    const { venue, token } = await createDraft(store, "nocturne", T0);
    expect(venue.status).toBe("draft");
    expect(venue.slug).toMatch(/^draft-[0-9a-f]{8}$/);
    expect(venue.template).toBe("nocturne");
    expect(venue.wizard_draft).toEqual(emptyDraft("nocturne"));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.findVenueByDraftToken(sha256Hex(token)))?.id).toBe(venue.id);
    expect(await store.findVenueByDraftToken(sha256Hex("wrong"))).toBeNull();
  });

  it("validates and merges patches, refusing taken and reserved slugs", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    const merged = await updateDraft(store, venue, { name: "Моето кафене", slug: "moeto-kafene" });
    expect(merged).toMatchObject({ name: "Моето кафене", slug: "moeto-kafene", template: "classic" });
    expect((await store.getVenue(venue.id)).wizard_draft).toEqual(merged);
    expect((await store.getVenue(venue.id)).slug).toMatch(/^draft-/); // the row keeps its placeholder until publish
    await expect(updateDraft(store, await store.getVenue(venue.id), { slug: "agala" })).rejects.toMatchObject({ code: "slug_taken", status: 409 });
    await expect(updateDraft(store, await store.getVenue(venue.id), { slug: "admin" })).rejects.toMatchObject({ code: "invalid", status: 400, errors: [{ path: "slug", en: "This address is reserved. Choose another." }] });
    await expect(updateDraft(store, await store.getVenue(venue.id), { slug: "My Cafe" })).rejects.toMatchObject({ code: "invalid", errors: [{ path: "slug", en: "The address must be 2–39 lowercase letters, digits and dashes." }] });
    await expect(updateDraft(store, await store.getVenue(venue.id), { slug: "draft-0a1b2c3d" })).rejects.toMatchObject({ code: "invalid", errors: [{ path: "slug", en: "This address is reserved. Choose another." }] });
    await expect(updateDraft(store, await store.getVenue(venue.id), { categories: [{ key: "c", name_bg: "x", name_en: "x", items: [{ key: "i", name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 0.01, allergens: [], image_media_id: null }] }] })).rejects.toBeInstanceOf(WizardError);
    // a second draft may still choose the same slug as an unpublished first draft (only published venues are taken)
    const other = await createDraft(store, "classic", T0);
    await expect(updateDraft(store, other.venue, { slug: "moeto-kafene" })).resolves.toMatchObject({ slug: "moeto-kafene" });
  });

  it("refuses to publish an incomplete draft with the validation errors", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    await expect(publishDraft(store, venue, T0)).rejects.toMatchObject({ code: "invalid", status: 400, errors: expect.arrayContaining([expect.objectContaining({ path: "name" }), expect.objectContaining({ path: "slug" }), expect.objectContaining({ path: "categories" })]) });
  });

  it("publishes: venue live with all fields, menu and texts inserted, images via one applied change set, invite redeemable, token still valid", async () => {
    const { store } = await makeDemo();
    const { venue, token } = await createDraft(store, "lumen", T0);
    const logo = await store.saveMedia(venue.id, new Uint8Array([1]), "image/png");
    const cover = await store.saveMedia(venue.id, new Uint8Array([2]), "image/jpeg");
    const g1 = await store.saveMedia(venue.id, new Uint8Array([3]), "image/jpeg");
    const g2 = await store.saveMedia(venue.id, new Uint8Array([4]), "image/jpeg");
    const dish = await store.saveMedia(venue.id, new Uint8Array([5]), "image/jpeg");
    const draft = await updateDraft(store, venue, {
      name: "Кафе „Светлина“", slug: "svetlina", default_lang: "en", address: "ул. Пример 1", phone: "+359 2 111 1111", instagram: "svetlina", maps_url: "https://maps.google.com/?q=1,2",
      hours: { ...emptyDraft("lumen").hours, sun: { open: "10:00", close: "14:00" } }, theme: { accent: "#AABBCC" },
      tagline_bg: "Светло кафе", tagline_en: "", about_bg: "", about_en: "A bright café.",
      texts: { welcome: { bg: "Добре дошли!", en: "Welcome!" }, footer_note: { bg: "", en: "" } },
      logo_media_id: logo.id, cover_media_id: cover.id, gallery_media_ids: [g2.id, g1.id, "not-ours"],
      categories: [
        { key: "coffee", name_bg: "Кафе", name_en: "Coffee", items: [
          { key: "esp", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: dish.id },
          { key: "cap", name_bg: "", name_en: "Cappuccino", desc_bg: "", desc_en: "Milky.", price_eur: 2.9, allergens: [7], image_media_id: "not-ours" },
        ] },
        { key: "empty", name_bg: "Празна", name_en: "Empty", items: [] },
      ],
      step: "review",
    });
    expect(draft.slug).toBe("svetlina");
    const r = await publishDraft(store, await store.getVenue(venue.id), T0);
    expect(r.venue).toMatchObject({ id: venue.id, slug: "svetlina", name: "Кафе „Светлина“", status: "live", template: "lumen", business_type: "cafe", default_lang: "en", wizard_draft: null, tagline_bg: "Светло кафе", tagline_en: "Светло кафе", about_bg: "A bright café.", about_en: "A bright café.", address: "ул. Пример 1", phone: "+359 2 111 1111", instagram: "svetlina", theme: { accent: "#aabbcc" }, logo_media_id: logo.id, cover_media_id: cover.id });
    expect(r.venue.hours.sun).toEqual({ open: "10:00", close: "14:00" });
    const site = await store.getSite(venue.id);
    expect(site.categories.map((c) => [c.name_en, c.position])).toEqual([["Coffee", 0], ["Empty", 1]]);
    expect(site.items.map((i) => [i.name_bg, i.name_en, i.price_eur, i.allergens, i.position, i.image_media_id])).toEqual([["Еспресо", "Espresso", 1.8, [], 0, dish.id], ["Cappuccino", "Cappuccino", 2.9, [7], 1, null]]);
    expect(site.texts).toEqual([{ venue_id: venue.id, key: "welcome", text_bg: "Добре дошли!", text_en: "Welcome!" }]);
    expect(site.media.filter((m) => m.is_gallery).sort((a, b) => a.position - b.position).map((m) => m.id)).toEqual([g2.id, g1.id]);
    const sets = await store.listChangeSets(venue.id);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ status: "applied", source: "dashboard", summary_bg: "Първоначални снимки", summary_en: "Initial photos", chat_id: null });
    expect(sets[0].changes.map((c) => c.op)).toEqual(["set_logo_image", "set_cover_image", "add_gallery_image", "add_gallery_image"]);
    expect(sets[0].preview_bg.length).toBeGreaterThan(0);
    // owner invite, 7 days
    const member = await store.redeemInvite(r.inviteCode, 5001, "bg", new Date(T0.getTime() + INVITE_TTL_MS - 1000).toISOString());
    expect(member).toMatchObject({ venue_id: venue.id, role: "owner", tg_chat_id: 5001 });
    expect((await store.findVenueByAdminToken(r.adminToken))?.id).toBe(venue.id);
    // the done page still authenticates with the cookie after publish
    expect((await store.findVenueByDraftToken(sha256Hex(token)))?.id).toBe(venue.id);
    expect((await store.getVenueBySlug("svetlina"))?.id).toBe(venue.id);
    await expect(publishDraft(store, await store.getVenue(venue.id), T0)).rejects.toMatchObject({ code: "already_published", status: 409 });
  });

  it("publishes without any image and writes no change set", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    await updateDraft(store, venue, { name: "A", slug: "a-cafe", categories: [{ key: "c", name_bg: "Кафе", name_en: "", items: [{ key: "i", name_bg: "Чай", name_en: "", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] });
    await publishDraft(store, await store.getVenue(venue.id), T0);
    expect(await store.listChangeSets(venue.id)).toEqual([]);
    expect((await store.getSite(venue.id)).items[0]).toMatchObject({ name_bg: "Чай", name_en: "Чай" });
  });

  it("keeps photos uploaded before the final slug was chosen (media rows key on the venue id)", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    // uploaded while the row still has its draft-xxxxxxxx slug and the draft slug is ""
    const cover = await store.saveMedia(venue.id, new Uint8Array([9]), "image/jpeg");
    const g = await store.saveMedia(venue.id, new Uint8Array([8]), "image/png");
    await updateDraft(store, venue, { cover_media_id: cover.id, gallery_media_ids: [g.id] });
    await updateDraft(store, await store.getVenue(venue.id), { name: "Ранни", slug: "ranni", categories: [{ key: "c", name_bg: "Кафе", name_en: "", items: [{ key: "i", name_bg: "Чай", name_en: "", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: g.id }] }] });
    await publishDraft(store, await store.getVenue(venue.id), T0);
    const live = await store.getVenueBySlug("ranni");
    expect(live?.id).toBe(venue.id);
    expect(live?.cover_media_id).toBe(cover.id);
    const site = await store.getSite(venue.id);
    expect(site.media.map((m) => m.id).sort()).toEqual([cover.id, g.id].sort());
    expect(site.media.every((m) => m.venue_id === venue.id)).toBe(true);
    expect(site.media.find((m) => m.id === g.id)?.is_gallery).toBe(true);
    expect(site.items[0].image_media_id).toBe(g.id);
    expect((await store.getMedia(cover.id))?.venue_id).toBe(venue.id);
  });

  it("publishing twice is idempotent: 409 with the same slug, no second invite, menu or change set", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    const logo = await store.saveMedia(venue.id, new Uint8Array([1]), "image/png");
    await updateDraft(store, venue, { name: "Два", slug: "dva", logo_media_id: logo.id, categories: [{ key: "c", name_bg: "Кафе", name_en: "", items: [{ key: "i", name_bg: "Чай", name_en: "", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] });
    await publishDraft(store, await store.getVenue(venue.id), T0);
    const invites = () => [...store.invites.values()].filter((i) => i.venue_id === venue.id).length;
    const before = { invites: invites(), sets: (await store.listChangeSets(venue.id)).length, items: (await store.getSite(venue.id)).items.length };
    expect(before).toEqual({ invites: 1, sets: 1, items: 1 });
    await expect(publishDraft(store, await store.getVenue(venue.id), T0)).rejects.toMatchObject({ code: "already_published", status: 409, slug: "dva" });
    expect({ invites: invites(), sets: (await store.listChangeSets(venue.id)).length, items: (await store.getSite(venue.id)).items.length }).toEqual(before);
    expect((await store.getVenue(venue.id)).deploy).toBeNull();
  });

  it("a failure while writing the menu leaves the draft intact, and a retry publishes exactly once", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    const g = await store.saveMedia(venue.id, new Uint8Array([7]), "image/png");
    const patch = { name: "Повтори", slug: "povtori", gallery_media_ids: [g.id], texts: { welcome: { bg: "Здравейте", en: "Hello" }, footer_note: { bg: "", en: "" } }, categories: [
      { key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }, { key: "i2", name_bg: "Лате", name_en: "Latte", desc_bg: "", desc_en: "", price_eur: 3, allergens: [7], image_media_id: null }] },
      { key: "c2", name_bg: "Чай", name_en: "Tea", items: [{ key: "i3", name_bg: "Мента", name_en: "Mint", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] },
    ] };
    const draft = await updateDraft(store, venue, patch);
    const realInsert = store.insertItem.bind(store);
    let calls = 0;
    store.insertItem = async (i) => {
      if (++calls === 2) throw new Error("network blip");
      return realInsert(i);
    };
    await expect(publishDraft(store, await store.getVenue(venue.id), T0)).rejects.toThrow("network blip");
    const failed = await store.getVenue(venue.id);
    expect(failed.status).toBe("draft");
    expect(failed.wizard_draft).toEqual(draft);
    expect(failed.slug).toBe("povtori"); // claimed transiently by step 1 (R20)
    expect([...store.invites.values()].filter((i) => i.venue_id === venue.id)).toEqual([]);
    expect(await store.listChangeSets(venue.id)).toEqual([]);

    const r = await publishDraft(store, failed, T0);
    expect(r.venue).toMatchObject({ status: "live", slug: "povtori", wizard_draft: null });
    const site = await store.getSite(venue.id);
    expect(site.categories.map((c) => [c.name_en, c.position])).toEqual([["Coffee", 0], ["Tea", 1]]);
    expect(site.items.map((i) => [i.name_en, i.category_id === site.categories[i.name_en === "Mint" ? 1 : 0].id, i.position])).toEqual([["Espresso", true, 0], ["Latte", true, 1], ["Mint", true, 0]]);
    expect(site.texts).toEqual([{ venue_id: venue.id, key: "welcome", text_bg: "Здравейте", text_en: "Hello" }]);
    expect(site.media.find((m) => m.id === g.id)?.is_gallery).toBe(true);
    expect(await store.listChangeSets(venue.id)).toHaveLength(1);
    expect([...store.invites.values()].filter((i) => i.venue_id === venue.id)).toHaveLength(1);
  });

  it("a failure after the photos were applied is retried without a second change set", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    const logo = await store.saveMedia(venue.id, new Uint8Array([1]), "image/png");
    const g1 = await store.saveMedia(venue.id, new Uint8Array([2]), "image/png");
    const g2 = await store.saveMedia(venue.id, new Uint8Array([3]), "image/png");
    await updateDraft(store, venue, { name: "Снимки", slug: "snimki", logo_media_id: logo.id, gallery_media_ids: [g2.id, g1.id], categories: [{ key: "c", name_bg: "Кафе", name_en: "", items: [{ key: "i", name_bg: "Чай", name_en: "", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] });
    const realUpdate = store.updateVenue.bind(store);
    let failOnce = true;
    store.updateVenue = async (id, patch) => {
      if (patch.status === "live" && failOnce) {
        failOnce = false;
        throw new Error("timeout");
      }
      return realUpdate(id, patch);
    };
    await expect(publishDraft(store, await store.getVenue(venue.id), T0)).rejects.toThrow("timeout");
    expect((await store.getVenue(venue.id)).status).toBe("draft");
    expect((await store.getVenue(venue.id)).logo_media_id).toBe(logo.id);
    await publishDraft(store, await store.getVenue(venue.id), T0);
    const site = await store.getSite(venue.id);
    expect(site.items).toHaveLength(1);
    expect(site.categories).toHaveLength(1);
    expect(site.media.filter((m) => m.is_gallery).sort((a, b) => a.position - b.position).map((m) => m.id)).toEqual([g2.id, g1.id]);
    const sets = await store.listChangeSets(venue.id);
    expect(sets.map((c) => c.status)).toEqual(["applied"]);
  });

  it("retries createVenue only on a slug collision", async () => {
    const { store } = await makeDemo();
    const real = store.createVenue.bind(store);
    let calls = 0;
    store.createVenue = async () => {
      calls++;
      throw new Error("connection refused");
    };
    await expect(createDraft(store, "classic", T0)).rejects.toThrow("connection refused");
    expect(calls).toBe(1);
    calls = 0;
    store.createVenue = async (v) => {
      if (++calls === 1) throw new Error(`slug ${v.slug} already exists`);
      return real(v);
    };
    await expect(createDraft(store, "classic", T0)).resolves.toMatchObject({ venue: { status: "draft" } });
    expect(calls).toBe(2);
  });

  it("refuses to publish when the slug was taken by a venue published in between", async () => {
    const { store } = await makeDemo();
    const a = await createDraft(store, "classic", T0);
    const b = await createDraft(store, "classic", T0);
    const menu = { categories: [{ key: "c", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i", name_bg: "Чай", name_en: "Tea", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] };
    await updateDraft(store, a.venue, { name: "A", slug: "same", ...menu });
    await updateDraft(store, b.venue, { name: "B", slug: "same", ...menu });
    await publishDraft(store, await store.getVenue(a.venue.id), T0);
    await expect(publishDraft(store, await store.getVenue(b.venue.id), T0)).rejects.toMatchObject({ code: "slug_taken", status: 409 });
  });
});
