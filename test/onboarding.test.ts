// test/onboarding.test.ts — /start's paths B and C, the checklist's status, the owner-only routes, and the wizard's link to the account
// (publish) and the website add-on (startDraftForVenue).
import { beforeEach, describe, expect, it, vi } from "vitest";

const afterCreated = vi.fn(async (venue: unknown) => void venue);
vi.mock("@/src/server/after-venue-created", () => ({ afterVenueCreated: (v: unknown) => afterCreated(v) }));

import { parseSecretKey } from "@/src/destinations/secrets";
import { parseTypedSiteUrl } from "@/src/domain/site-url";
import { sha256Hex } from "@/src/server/hash";
import {
  createOwnVenue,
  handleOnboardingInvite,
  handleOnboardingStatus,
  handleOnboardingWordPress,
  handleStartVenue,
  handleWebsiteDraft,
  onboardingStatus,
  ownerGate,
  parseInstagramHandle,
  parseOwnVenueInput,
  pickSlug,
  slugBase,
  type OwnVenueInput,
} from "@/src/server/onboarding";
import { createDraft, handlePublish, isOpenDraft, publishDraft, startDraftForVenue, updateDraft } from "@/src/server/wizard";
import { InMemoryStore } from "@/src/store/memory";
import { emptyDraft, type WizardDraft } from "@/src/wizard/schema";
import { FakeWordPress } from "./fake-wordpress";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-19T09:00:00.000Z");
const ORIGIN = "https://getclaudia.app";
const owner = { id: "u-owner", email: "o@example.com" };
const other = { id: "u-other", email: "x@example.com" };

const ownInput: OwnVenueInput = { path: "own", name: "Coffique", site_url: "https://coffique.bg", platform: "wordpress", address: "ул. Кракра 24", city: "София", instagram: "coffique", lang: "bg" };
const noneInput: OwnVenueInput = { path: "none", name: "Кафене „Ъгъла“", address: "ул. Раковски 5", city: "Пловдив", lang: "bg" };

beforeEach(() => afterCreated.mockClear());

describe("slugBase / pickSlug", () => {
  it("transliterates Cyrillic and keeps only letters, digits and single dashes", () => {
    expect(slugBase("Кафене „Ъгъла“")).toBe("kafene-agala");
    expect(slugBase("Щастие & Жълтица!")).toBe("shtastie-zhaltitsa");
    expect(slugBase("  Café  Münch  ")).toBe("cafe-munch");
    expect(slugBase("???")).toBe("");
    expect(slugBase("A".repeat(60)).length).toBeLessThanOrEqual(30);
  });
  it("skips reserved words and taken addresses, and falls back to biz for a name with no letters", async () => {
    const store = new InMemoryStore();
    expect(await pickSlug(store, "Start")).toBe("start-2"); // "start" is reserved
    expect(await pickSlug(store, "Dashboard")).toBe("dashboard-2");
    expect(await pickSlug(store, "!!!")).toBe("biz");
    await store.createVenue({ slug: "coffique", name: "x" });
    await store.createVenue({ slug: "coffique-2", name: "x" });
    expect(await pickSlug(store, "Coffique")).toBe("coffique-3");
    await store.createVenue({ slug: "draft-ab12cd34", name: "", status: "draft" });
    expect(await pickSlug(store, "Draft Ab12cd34")).not.toMatch(/^draft-/);
  });
});

describe("input", () => {
  it("reads an address without https as https, and refuses http, junk and a missing address", () => {
    expect(parseTypedSiteUrl("coffique.bg")).toBe("https://coffique.bg");
    expect(parseTypedSiteUrl(" https://coffique.bg/ ")).toBe("https://coffique.bg");
    expect(parseTypedSiteUrl("http://coffique.bg")).toBeNull();
    expect(parseTypedSiteUrl("javascript:alert(1)")).toBeNull();
    expect(parseTypedSiteUrl("localhost")).toBeNull();
    expect(parseTypedSiteUrl("")).toBeNull();
  });
  it("reads Instagram handles", () => {
    expect(parseInstagramHandle("@coffique")).toBe("coffique");
    expect(parseInstagramHandle("https://www.instagram.com/coffique/")).toBe("coffique");
    expect(parseInstagramHandle("not a handle!")).toBeNull();
  });
  it("accepts both paths and lists every wrong field in both languages", () => {
    expect(parseOwnVenueInput({ ...ownInput, site_url: "coffique.bg", instagram: "@coffique" })).toMatchObject({ ok: true, input: { path: "own", site_url: "https://coffique.bg", instagram: "coffique" } });
    const none = parseOwnVenueInput({ path: "none", name: "A", address: "B", city: "C", site_url: "https://ignored.example" });
    expect(none).toEqual({ ok: true, input: { path: "none", name: "A", address: "B", city: "C", lang: "bg" } });
    const bad = parseOwnVenueInput({ path: "own", name: " ", site_url: "http://x.bg", platform: "joomla", address: "", city: "", instagram: "no no" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.map((e) => e.path).sort()).toEqual(["address", "city", "instagram", "name", "platform", "site_url"]);
      for (const e of bad.errors) expect(e.bg && e.en).toBeTruthy();
    }
    expect(parseOwnVenueInput(null).ok).toBe(false);
    expect(parseOwnVenueInput({ ...ownInput, platform: undefined })).toMatchObject({ ok: true, input: { platform: "unknown" } });
  });
});

describe("createOwnVenue", () => {
  it("path B: a live own-site venue with its address and platform, no deploy, an owner link and an owner invite", async () => {
    const store = new InMemoryStore();
    const r = await createOwnVenue({ store }, owner, ownInput);
    expect(r.slug).toBe("coffique");
    const v = (await store.getVenueBySlug("coffique"))!;
    expect(v).toMatchObject({ status: "live", site_mode: "own", site_url: "https://coffique.bg", site_platform: "wordpress", name: "Coffique", instagram: "coffique", address: "ул. Кракра 24, София", default_lang: "bg", deploy: null, wizard_draft: null });
    expect(await store.isVenueOwner(v.id, owner.id)).toBe(true);
    expect(await store.findOpenInvite(v.id, "owner", T0.toISOString())).toBe(r.invite_code);
    expect(afterCreated).toHaveBeenCalledTimes(1);
  });
  it("path C: site_mode none, no site address or platform", async () => {
    const store = new InMemoryStore();
    const r = await createOwnVenue({ store }, owner, noneInput);
    expect(r.slug).toBe("kafene-agala");
    expect(await store.getVenueBySlug(r.slug)).toMatchObject({ site_mode: "none", site_url: null, site_platform: null, status: "live" });
  });
  it("the invite joins the venue as owner in the chat", async () => {
    const store = new InMemoryStore();
    const r = await createOwnVenue({ store }, owner, noneInput);
    const m = await store.redeemInvite(r.invite_code, "tg:777", "bg", T0.toISOString());
    expect(m).toMatchObject({ role: "owner" });
  });
  it("gives two businesses with the same name different addresses", async () => {
    const store = new InMemoryStore();
    const a = await createOwnVenue({ store }, owner, noneInput);
    const b = await createOwnVenue({ store }, other, noneInput);
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug).toBe("kafene-agala-2");
  });
  it("takes the next address when another request wins the one it picked", async () => {
    const store = new InMemoryStore();
    const racing = Object.create(store) as InMemoryStore;
    let first = true;
    racing.createVenue = async (v) => {
      if (first) {
        first = false;
        await store.createVenue({ slug: v.slug, name: "race" });
      }
      return store.createVenue(v);
    };
    const r = await createOwnVenue({ store: racing }, owner, ownInput);
    expect(r.slug).toBe("coffique-2");
  });
  it("removes the venue again when the account cannot be linked", async () => {
    const store = new InMemoryStore();
    const broken = Object.create(store) as InMemoryStore;
    broken.linkVenueUser = async () => {
      throw new Error("db down");
    };
    await expect(createOwnVenue({ store: broken }, owner, ownInput)).rejects.toThrow("db down");
    expect(await store.getVenueBySlug("coffique")).toBeNull();
    expect(afterCreated).not.toHaveBeenCalled();
  });
  it("a failing afterVenueCreated does not undo the venue", async () => {
    const store = new InMemoryStore();
    afterCreated.mockRejectedValueOnce(new Error("billing down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await createOwnVenue({ store }, owner, ownInput);
    expect((await store.getVenueBySlug(r.slug))?.status).toBe("live");
    spy.mockRestore();
  });
});

describe("POST /api/start/venue", () => {
  const config = { rateSalt: "salt", maxSitesPerDay: 100 };
  const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": "1.2.3.4" }) =>
    new Request(`${ORIGIN}/api/start/venue`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const deps = (store: InMemoryStore, user: typeof owner | null = owner, cfg = config) => ({ store, config: cfg, now: () => T0, sessionUser: async () => user });

  it("401 signed out", async () => {
    const store = new InMemoryStore();
    const res = await handleStartVenue(post(ownInput), deps(store, null));
    expect(res.status).toBe(401);
    expect(await store.listVenues()).toHaveLength(0);
  });
  it("403 without a same-host Origin", async () => {
    const store = new InMemoryStore();
    expect((await handleStartVenue(post(ownInput, { "x-forwarded-for": "1.2.3.4" }), deps(store))).status).toBe(403);
    expect((await handleStartVenue(post(ownInput, { origin: "https://evil.example" }), deps(store))).status).toBe(403);
    expect(await store.listVenues()).toHaveLength(0);
  });
  it("400 with the wrong fields, which does not use up the rate limit", async () => {
    const store = new InMemoryStore();
    for (let i = 0; i < 8; i++) expect((await handleStartVenue(post({ path: "own" }), deps(store))).status).toBe(400);
    const res = await handleStartVenue(post(ownInput), deps(store));
    expect(res.status).toBe(201);
  });
  it("201 with the slug, the code and the checklist address", async () => {
    const store = new InMemoryStore();
    const res = await handleStartVenue(post(ownInput), deps(store));
    expect(res.status).toBe(201);
    const j = (await res.json()) as { slug: string; invite_code: string; onboarding_url: string };
    expect(j).toMatchObject({ slug: "coffique", onboarding_url: "/onboarding/coffique" });
    expect(j.invite_code).toMatch(/^[A-Z2-9]{8}$/);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("is limited to 5 per IP per hour, like /api/new", async () => {
    const store = new InMemoryStore();
    for (let i = 0; i < 5; i++) expect((await handleStartVenue(post(noneInput), deps(store))).status).toBe(201);
    const res = await handleStartVenue(post(noneInput), deps(store));
    expect(res.status).toBe(429);
    expect((await handleStartVenue(post(noneInput, { origin: ORIGIN, "x-forwarded-for": "9.9.9.9" }), deps(store))).status).toBe(201);
  });
  it("is limited by the global daily cap", async () => {
    const store = new InMemoryStore();
    const cfg = { ...config, maxSitesPerDay: 2 };
    for (const ip of ["1.1.1.1", "2.2.2.2"]) expect((await handleStartVenue(post(noneInput, { origin: ORIGIN, "x-forwarded-for": ip }), deps(store, owner, cfg))).status).toBe(201);
    expect((await handleStartVenue(post(noneInput, { origin: ORIGIN, "x-forwarded-for": "3.3.3.3" }), deps(store, owner, cfg))).status).toBe(429);
  });
});

describe("onboardingStatus", () => {
  it("chat ticks once an owner has joined; staff do not count", async () => {
    const store = new InMemoryStore();
    const r = await createOwnVenue({ store }, owner, ownInput);
    const v = (await store.getVenueBySlug(r.slug))!;
    expect(await onboardingStatus(store, v)).toEqual({ chat: false, instagram: false, facebook: false, website: "todo", plan: { status: "none", trial_days_left: null, plan: null } });
    const staff = await store.createInvite(v.id, "staff", new Date(T0.getTime() + 86_400_000).toISOString());
    await store.redeemInvite(staff, "tg:5", "bg", T0.toISOString());
    expect((await onboardingStatus(store, v)).chat).toBe(false);
    await store.redeemInvite(r.invite_code, "tg:6", "bg", T0.toISOString());
    expect((await onboardingStatus(store, v)).chat).toBe(true);
  });
  it("website: n/a for a Claudia site or no website, connected once WordPress is", async () => {
    const store = new InMemoryStore();
    const none = (await store.getVenueBySlug((await createOwnVenue({ store }, owner, noneInput)).slug))!;
    expect((await onboardingStatus(store, none)).website).toBe("n/a");
    const { venue: demo } = await makeDemo();
    expect((await onboardingStatus(store, demo)).website).toBe("n/a"); // a Claudia site
    const own = (await store.getVenueBySlug((await createOwnVenue({ store }, owner, ownInput)).slug))!;
    await store.upsertDestination({ venue_id: own.id, kind: "wordpress", config: {}, secrets: "x" });
    await store.upsertDestination({ venue_id: own.id, kind: "instagram", config: {}, secrets: "x" });
    expect(await onboardingStatus(store, own)).toMatchObject({ website: "connected", instagram: true, facebook: false });
    const d = (await store.getDestination(own.id, "instagram"))!;
    await store.updateDestination(d.id, { status: "disconnected" });
    expect((await onboardingStatus(store, own)).instagram).toBe(false);
  });
});

describe("owner-only routes", () => {
  let store: InMemoryStore;
  let slug: string;
  beforeEach(async () => {
    store = new InMemoryStore();
    slug = (await createOwnVenue({ store }, owner, ownInput)).slug;
  });
  const req = (method: string, headers: Record<string, string> = { origin: ORIGIN }, body?: unknown) =>
    new Request(`${ORIGIN}/api/onboarding/${slug}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it("ownerGate: 401 signed out, 404 for another account and for an unknown slug, 403 for a write without Origin, ?key= ignored", async () => {
    const as = (u: typeof owner | null) => ({ store, sessionUser: async () => u });
    expect(((await ownerGate(req("GET"), slug, as(null))) as { response: Response }).response.status).toBe(401);
    expect(((await ownerGate(req("GET"), slug, as(other))) as { response: Response }).response.status).toBe(404);
    expect(((await ownerGate(req("GET"), "nope", as(owner))) as { response: Response }).response.status).toBe(404);
    expect(((await ownerGate(req("POST", {}), slug, as(owner))) as { response: Response }).response.status).toBe(403);
    const key = await store.getAdminToken((await store.getVenueBySlug(slug))!.id);
    const keyed = new Request(`${ORIGIN}/api/onboarding/${slug}?key=${key}`);
    expect(((await ownerGate(keyed, slug, as(null))) as { response: Response }).response.status).toBe(401);
    expect(await ownerGate(req("GET"), slug, as(owner))).toMatchObject({ user: { id: owner.id }, venue: { slug } });
  });
  it("status: the checklist facts for the owner", async () => {
    const res = await handleOnboardingStatus(req("GET"), slug, { store, sessionUser: async () => owner });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ chat: false, website: "todo" });
    expect((await handleOnboardingStatus(req("GET"), slug, { store, sessionUser: async () => other })).status).toBe(404);
  });
  it("invite: a fresh owner code with its links, for the owner only", async () => {
    const config = { telegramBotUsername: "claudia_bot", messengerPageHandle: null, instagramUsername: null, whatsappNumber: null, channelsEnabled: false, metaPageToken: null, whatsappToken: null } as never;
    const d = (u: typeof owner | null) => ({ store, config, now: () => T0, sessionUser: async () => u });
    const res = await handleOnboardingInvite(req("POST"), slug, d(owner));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { code: string; links: { app: string; url: string }[] };
    expect(j.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(j.links[0]).toMatchObject({ app: "telegram" });
    expect(j.links[0].url).toContain(j.code);
    expect((await handleOnboardingInvite(req("POST"), slug, d(other))).status).toBe(404);
    expect((await handleOnboardingInvite(req("POST", {}), slug, d(owner))).status).toBe(403);
  });
  it("wordpress: connects with the plugin's code, refuses a wrong code and a venue with no own site", async () => {
    const wp = new FakeWordPress();
    wp.slug = "coffique";
    const connect = { secretKey: parseSecretKey("ab".repeat(32)), fetch: wp.fetch, resolve: async () => ["93.184.216.34"] };
    const d = { store, sessionUser: async () => owner, connect, now: () => T0 };
    const bad = await handleOnboardingWordPress(req("POST", { origin: ORIGIN }, { code: "WRONG-CODE" }), slug, d);
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("connect_failed");
    expect((await handleOnboardingWordPress(req("POST", { origin: ORIGIN }, { code: "x" }), slug, d)).status).toBe(400);
    const ok = await handleOnboardingWordPress(req("POST", { origin: ORIGIN }, { code: `/connect https://coffique.bg/ ${wp.issueCode()}` }), slug, d); // the plugin's whole line
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ connected: true, site_name: "Smoke Café" });
    expect((await onboardingStatus(store, (await store.getVenueBySlug(slug))!)).website).toBe("connected");
    const noneSlug = (await createOwnVenue({ store }, owner, noneInput)).slug;
    const res = await handleOnboardingWordPress(new Request(`${ORIGIN}/x`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ code: wp.issueCode() }) }), noneSlug, d);
    expect(res.status).toBe(409);
  });
  it("wordpress: stops after 10 attempts an hour", async () => {
    const wp = new FakeWordPress();
    const d = { store, sessionUser: async () => owner, connect: { secretKey: parseSecretKey("ab".repeat(32)), fetch: wp.fetch, resolve: async () => ["93.184.216.34"] }, now: () => T0 };
    for (let i = 0; i < 10; i++) expect((await handleOnboardingWordPress(req("POST", { origin: ORIGIN }, { code: "WRONG-CODE" }), slug, d)).status).toBe(422);
    expect((await handleOnboardingWordPress(req("POST", { origin: ORIGIN }, { code: "WRONG-CODE" }), slug, d)).status).toBe(429);
  });
});

/** A draft with everything publish needs. */
const filled = (slug: string): Partial<WizardDraft> => ({
  name: "Coffique", slug, default_lang: "bg", address: "ул. Кракра 24, София", phone: "+359 2 222 2222", instagram: "", maps_url: "",
  hours: emptyDraft("classic").hours, theme: { accent: "#2f6b4f" },
  tagline_bg: "Кафе", tagline_en: "Coffee", about_bg: "За нас", about_en: "About us",
  texts: { welcome: { bg: "Здравейте", en: "Hello" }, footer_note: { bg: "", en: "" } },
  logo_media_id: null, cover_media_id: null, gallery_media_ids: [],
  categories: [{ key: "c", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "e", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }],
  step: "review",
});

describe("path A: publish with a session", () => {
  it("links the signed-in account as the owner; without a session nothing changes", async () => {
    const store = new InMemoryStore();
    const a = await createDraft(store, "classic", T0);
    await updateDraft(store, a.venue, filled("with-account"));
    const done = await publishDraft(store, await store.getVenue(a.venue.id), T0, { userId: owner.id });
    expect(done.venue.status).toBe("live");
    expect(await store.isVenueOwner(done.venue.id, owner.id)).toBe(true);
    expect(afterCreated).toHaveBeenCalledTimes(1);

    const b = await createDraft(store, "classic", T0);
    await updateDraft(store, b.venue, filled("no-account"));
    const done2 = await publishDraft(store, await store.getVenue(b.venue.id), T0);
    expect(done2.venue.status).toBe("live");
    expect(await store.listVenuesForUser(owner.id)).toHaveLength(1);
    expect(await store.hasOwnerAccount(done2.venue.id)).toBe(false);
    expect(afterCreated).toHaveBeenCalledTimes(1);
  });
  it("a failed link leaves a draft that publishes again", async () => {
    const store = new InMemoryStore();
    const a = await createDraft(store, "classic", T0);
    await updateDraft(store, a.venue, filled("retry-link"));
    const failing = Object.create(store) as InMemoryStore;
    let once = true;
    failing.linkVenueUser = async (...args) => {
      if (once) {
        once = false;
        throw new Error("boom");
      }
      return store.linkVenueUser(...args);
    };
    await expect(publishDraft(failing, await store.getVenue(a.venue.id), T0, { userId: owner.id })).rejects.toThrow("boom");
    expect((await store.getVenue(a.venue.id)).status).toBe("draft");
    const done = await publishDraft(failing, await store.getVenue(a.venue.id), T0, { userId: owner.id });
    expect(await store.isVenueOwner(done.venue.id, owner.id)).toBe(true);
  });
  it("the publish route handler passes the account through", async () => {
    const store = new InMemoryStore();
    const a = await createDraft(store, "classic", T0);
    await updateDraft(store, a.venue, filled("via-route"));
    const res = await handlePublish({ store, config: { publicBaseUrl: ORIGIN, rateSalt: "s", maxSitesPerDay: 9, telegramBotUsername: "bot" }, now: () => T0 }, await store.getVenue(a.venue.id), { userId: owner.id });
    expect(res.status).toBe(200);
    expect(await store.isVenueOwner(a.venue.id, owner.id)).toBe(true);
  });
});

describe("the website add-on (startDraftForVenue)", () => {
  async function setup(input: OwnVenueInput = ownInput) {
    const store = new InMemoryStore();
    const { slug, invite_code } = await createOwnVenue({ store }, owner, input);
    const venue = (await store.getVenueBySlug(slug))!;
    return { store, venue, slug, invite_code };
  }

  it("only the venue's session owner may start it", async () => {
    const { store, venue } = await setup();
    await expect(startDraftForVenue(store, venue.id, other)).rejects.toMatchObject({ code: "unauthorized", status: 403 });
    await expect(startDraftForVenue(store, "00000000-0000-0000-0000-000000000000", owner)).rejects.toMatchObject({ code: "unauthorized" });
    expect((await store.getVenue(venue.id)).wizard_draft).toBeNull();
    // the chat owner (a venue_member) is not the account owner
    await store.redeemInvite((await store.createInvite(venue.id, "owner", new Date(T0.getTime() + 1e6).toISOString())), "tg:1", "bg", T0.toISOString());
    await expect(startDraftForVenue(store, venue.id, { id: "tg:1" })).rejects.toMatchObject({ code: "unauthorized" });
  });
  it("refuses a Claudia site and a venue that is not live", async () => {
    const { store, venue } = await setup();
    await store.updateVenue(venue.id, { site_mode: "claudia", site_url: null });
    await expect(startDraftForVenue(store, venue.id, owner)).rejects.toMatchObject({ code: "already_published" });
    await store.updateVenue(venue.id, { site_mode: "none", status: "draft" });
    await expect(startDraftForVenue(store, venue.id, owner)).rejects.toMatchObject({ code: "not_live" });
  });
  it("puts a prefilled draft on the same row and keeps the venue live and its site mode until publish", async () => {
    const { store, venue } = await setup();
    const cat = await store.insertCategory({ venue_id: venue.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
    await store.insertItem({ venue_id: venue.id, category_id: cat.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
    await store.setSiteText(venue.id, "welcome", "Здравейте", "Hello");
    const { venue: v, token } = await startDraftForVenue(store, venue.id, owner);
    expect(token).toMatch(/^[0-9a-f]{32,128}$/);
    expect((await store.findVenueByDraftToken(sha256Hex(token)))?.id).toBe(venue.id);
    expect(v).toMatchObject({ id: venue.id, status: "live", site_mode: "own", site_url: "https://coffique.bg" });
    expect(isOpenDraft(v)).toBe(true);
    expect(v.wizard_draft).toMatchObject({ name: "Coffique", slug: "coffique", address: "ул. Кракра 24, София", instagram: "coffique", step: "template", texts: { welcome: { bg: "Здравейте", en: "Hello" } } });
    expect(v.wizard_draft?.categories).toHaveLength(1);
    expect(v.wizard_draft?.categories[0].items[0]).toMatchObject({ name_en: "Espresso", price_eur: 1.8 });
  });
  it("a draft already in progress is kept; a new call only issues a new token", async () => {
    const { store, venue } = await setup();
    const first = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, first.venue, { tagline_en: "My edit" });
    const second = await startDraftForVenue(store, venue.id, owner);
    expect(second.venue.wizard_draft?.tagline_en).toBe("My edit");
    expect(second.token).not.toBe(first.token);
    expect(await store.findVenueByDraftToken(sha256Hex(first.token))).toBeNull();
  });
  it("the slug cannot be changed while editing", async () => {
    const { store, venue } = await setup();
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const draft = await updateDraft(store, v, { slug: "something-else" });
    expect(draft.slug).toBe("coffique");
  });
  it("publishing keeps the slug, turns the venue into a Claudia site and clears the old address", async () => {
    const { store, venue } = await setup();
    await store.redeemInvite(await store.findOpenInvite(venue.id, "owner", T0.toISOString()) as string, "tg:1", "bg", T0.toISOString());
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, filled("whatever-slug"));
    const done = await publishDraft(store, await store.getVenue(venue.id), T0, { userId: owner.id });
    expect(done.venue).toMatchObject({ id: venue.id, slug: "coffique", status: "live", site_mode: "claudia", site_url: null, site_platform: null, wizard_draft: null });
    expect(done.inviteCode).toBe(""); // the owner is already in the chat
    expect((await store.getSite(venue.id)).items).toHaveLength(1);
    expect(await store.isVenueOwner(venue.id, owner.id)).toBe(true);
    expect(afterCreated).toHaveBeenCalledTimes(1); // only the creation, not the add-on
    expect(isOpenDraft(done.venue)).toBe(false);
  });
  it("publishing an add-on whose owner is not in the chat yet still issues a code", async () => {
    const { store, venue } = await setup(noneInput);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, filled("extra-slug"));
    const done = await publishDraft(store, await store.getVenue(venue.id), T0);
    expect(done.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
  });
  it("handlePublish starts the deploy for an add-on only", async () => {
    const { store, venue } = await setup();
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, filled("extra-slug"));
    const startDeploy = vi.fn();
    const cfg = { publicBaseUrl: ORIGIN, rateSalt: "s", maxSitesPerDay: 9, telegramBotUsername: "bot" };
    await handlePublish({ store, config: cfg, now: () => T0 }, await store.getVenue(venue.id), { userId: owner.id, startDeploy });
    expect(startDeploy).toHaveBeenCalledWith(venue.id);
    const d = await createDraft(store, "classic", T0);
    await updateDraft(store, d.venue, filled("brand-new"));
    await handlePublish({ store, config: cfg, now: () => T0 }, await store.getVenue(d.venue.id), { userId: owner.id, startDeploy });
    expect(startDeploy).toHaveBeenCalledTimes(1);
  });
  it("a second publish of the same add-on is refused", async () => {
    const { store, venue } = await setup();
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, filled("extra-slug"));
    await publishDraft(store, await store.getVenue(venue.id), T0);
    await expect(publishDraft(store, await store.getVenue(venue.id), T0)).rejects.toMatchObject({ code: "already_published" });
  });
  it("a live venue without an open draft is never editable by the wizard", async () => {
    const { store, venue } = await setup();
    await expect(updateDraft(store, venue, { name: "x" })).rejects.toMatchObject({ code: "already_published" });
    expect(await store.claimPublish(venue.id, T0.toISOString())).toBe(false);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    expect(await store.claimPublish(v.id, T0.toISOString())).toBe(true);
    expect(await store.claimPublish(v.id, T0.toISOString())).toBe(false);
  });

  it("POST /api/onboarding/[slug]/website: owner only, sets the wizard cookie, returns the wizard URL", async () => {
    const { store, venue, slug } = await setup();
    const req = (headers: Record<string, string> = { origin: ORIGIN }) => new Request(`${ORIGIN}/api/onboarding/${slug}/website`, { method: "POST", headers });
    const d = (u: typeof owner | null) => ({ store, config: { publicBaseUrl: ORIGIN }, sessionUser: async () => u });
    expect((await handleWebsiteDraft(req(), slug, d(null))).status).toBe(401);
    expect((await handleWebsiteDraft(req(), slug, d(other))).status).toBe(404);
    expect((await handleWebsiteDraft(req({}), slug, d(owner))).status).toBe(403);
    expect((await store.getVenue(venue.id)).wizard_draft).toBeNull();
    const res = await handleWebsiteDraft(req(), slug, d(owner));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `/new/${venue.id}` });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^sm_draft=${venue.id}\\.[0-9a-f]+; Path=/; HttpOnly; SameSite=Lax; .*Secure`));
    expect((await store.getVenue(venue.id)).wizard_draft).not.toBeNull();
  });
});
