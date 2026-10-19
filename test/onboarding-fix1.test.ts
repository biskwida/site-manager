// test/onboarding-fix1.test.ts — Task 5 fix round 1: self-serve own sites never redirect, an atomic website add-on, private hosts refused,
// the account link after a wizard publish, and the smaller review items.
import { beforeEach, describe, expect, it, vi } from "vitest";

const afterCreated = vi.fn(async (venue: unknown) => void venue);
vi.mock("@/src/server/after-venue-created", () => ({ afterVenueCreated: (v: unknown) => afterCreated(v) }));

import { parseSecretKey } from "@/src/destinations/secrets";
import { createOwnVenue, parseOwnVenueInput, type OwnVenueInput } from "@/src/server/onboarding";
import { loadSite, ownSiteLink, ownSiteRedirect, publicSiteState } from "@/src/server/site";
import {
  claimVenueForSession, createDraft, DRAFT_ACCOUNT_COOKIE, handleMedia, handleNewDraft, handlePutDraft, MAX_DRAFT_MEDIA, publishDraft, startDraftForVenue, updateDraft, type WizardDeps,
} from "@/src/server/wizard";
import { cleanupDrafts } from "@/src/tick";
import { InMemoryStore } from "@/src/store/memory";
import { SlugTakenError } from "@/src/store/types";
import { emptyDraft, type WizardDraft } from "@/src/wizard/schema";

const T0 = new Date("2026-10-19T09:00:00.000Z");
const owner = { id: "u-owner", email: "o@example.com" };
const other = { id: "u-other", email: "x@example.com" };
const ownInput: OwnVenueInput = { path: "own", name: "Coffique", site_url: "https://coffique.bg", platform: "wordpress", address: "ул. Кракра 24", city: "София", lang: "bg" };
const noneInput: OwnVenueInput = { path: "none", name: "Ъгъла", address: "ул. Раковски 5", city: "Пловдив", lang: "bg" };
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);

beforeEach(() => afterCreated.mockReset().mockImplementation(async (venue: unknown) => void venue));

const filled = (slug: string): Partial<WizardDraft> => ({
  name: "Coffique", slug, default_lang: "bg", address: "ул. Кракра 24, София", phone: "+359 2 222 2222", instagram: "", maps_url: "",
  hours: emptyDraft("classic").hours, theme: { accent: "#2f6b4f" },
  tagline_bg: "Кафе", tagline_en: "Coffee", about_bg: "За нас", about_en: "About us",
  texts: { welcome: { bg: "Здравейте", en: "Hello" }, footer_note: { bg: "", en: "" } },
  logo_media_id: null, cover_media_id: null, gallery_media_ids: [],
  categories: [{ key: "c", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "e", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }],
  step: "review",
});

async function addon(input: OwnVenueInput = ownInput) {
  const store = new InMemoryStore();
  const { slug } = await createOwnVenue({ store }, owner, input);
  const venue = (await store.getVenueBySlug(slug))!;
  return { store, venue, slug };
}
async function withMenu(store: InMemoryStore, venueId: string) {
  const cat = await store.insertCategory({ venue_id: venueId, name_bg: "Кафе", name_en: "Coffee", position: 0 });
  const hiddenCat = await store.insertCategory({ venue_id: venueId, name_bg: "Скрито", name_en: "Hidden", position: 1, active: false });
  const shown = await store.insertItem({ venue_id: venueId, category_id: cat.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
  const hidden = await store.insertItem({ venue_id: venueId, category_id: cat.id, name_bg: "Лате", name_en: "Latte", desc_bg: "", desc_en: "", price_eur: 3.2, allergens: [7], position: 1, active: false });
  await store.insertItem({ venue_id: venueId, category_id: hiddenCat.id, name_bg: "Тайно", name_en: "Secret", desc_bg: "", desc_en: "", price_eur: 5, allergens: [], position: 0 });
  return { cat, hiddenCat, shown, hidden };
}

describe("3. self-serve own sites do not redirect off our domain", () => {
  it("created_via: /start sets start, the wizard sets wizard, anything else is operator", async () => {
    const { store, venue } = await addon();
    expect(venue.created_via).toBe("start");
    const d = await createDraft(store, "classic", T0);
    expect(d.venue.created_via).toBe("operator"); // a draft is not published yet
    await updateDraft(store, d.venue, filled("by-wizard"));
    expect((await publishDraft(store, await store.getVenue(d.venue.id), T0)).venue.created_via).toBe("wizard");
    expect((await store.createVenue({ slug: "by-script", name: "S" })).created_via).toBe("operator");
  });
  it("a website add-on keeps how the venue was first made", async () => {
    const { store, venue } = await addon();
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, filled("whatever"));
    expect((await publishDraft(store, await store.getVenue(venue.id), T0)).venue.created_via).toBe("start");
  });
  it("ownSiteRedirect redirects only operator-made own sites; ownSiteLink is the visit link for the others", async () => {
    const store = new InMemoryStore();
    const operator = await store.createVenue({ slug: "op", name: "Op", site_mode: "own", site_url: "https://op.example" });
    const start = await store.createVenue({ slug: "st", name: "St", site_mode: "own", site_url: "https://st.example", created_via: "start" });
    const none = await store.createVenue({ slug: "nn", name: "Nn", site_mode: "none", created_via: "start" });
    const load = async (slug: string) => (await loadSite(store, slug))!;
    expect(ownSiteRedirect(await load(operator.slug))).toBe("https://op.example");
    expect(ownSiteLink(await load(operator.slug))).toBeNull();
    expect(ownSiteRedirect(await load(start.slug))).toBeNull();
    expect(ownSiteLink(await load(start.slug))).toBe("https://st.example");
    expect(ownSiteLink(await load(none.slug))).toBeNull();
    expect(ownSiteLink({ ...(await load(start.slug)), draft: { id: "d" } as never })).toBeNull(); // a preview shows nothing extra
  });
});

describe("5. the website address must be public", () => {
  const parse = (site_url: string) => parseOwnVenueInput({ ...ownInput, site_url });
  it("refuses private, local and numeric-IP hosts", () => {
    for (const bad of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "foo.localhost", "2130706433", "0x7f.1", "192.168.1.10", "https://[::1]/", "https://[::ffff:10.0.0.1]/"]) {
      const r = parse(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.path), bad).toEqual(["site_url"]);
    }
  });
  it("still accepts a public site", () => {
    expect(parse("coffique.bg")).toMatchObject({ ok: true, input: { site_url: "https://coffique.bg" } });
    expect(parse("https://www.coffique.bg/menu/")).toMatchObject({ ok: true, input: { site_url: "https://www.coffique.bg/menu" } });
  });
});

describe("2. the add-on keeps hidden dishes and categories", () => {
  it("prefills them with their hidden flags", async () => {
    const { store, venue } = await addon();
    await withMenu(store, venue.id);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const cats = v.wizard_draft!.categories;
    expect(cats.map((c) => [c.name_en, c.active ?? true])).toEqual([["Coffee", true], ["Hidden", false]]);
    expect(cats[0].items.map((i) => [i.name_en, i.active ?? true])).toEqual([["Espresso", true], ["Latte", false]]);
  });
  it("publishing a changed menu keeps them hidden", async () => {
    const { store, venue } = await addon();
    await withMenu(store, venue.id);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const cats = structuredClone(v.wizard_draft!.categories);
    cats[0].items.push({ key: "n", name_bg: "Нов", name_en: "New", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null });
    await updateDraft(store, v, { ...filled("x-y"), categories: cats });
    await publishDraft(store, await store.getVenue(venue.id), T0);
    const site = await store.getSite(venue.id);
    expect(site.items.map((i) => [i.name_en, i.active]).sort()).toEqual([["Espresso", true], ["Latte", false], ["New", true], ["Secret", true]].sort());
    expect(site.categories.map((c) => [c.name_en, c.active])).toEqual([["Coffee", true], ["Hidden", false]]);
  });
  it("an unchanged menu is not rewritten at all: the same rows, ids and sold-out marks stay", async () => {
    const { store, venue } = await addon();
    const { shown } = await withMenu(store, venue.id);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, { tagline_en: "Fresh" });
    await publishDraft(store, await store.getVenue(venue.id), T0);
    const after = (await store.getSite(venue.id)).items.find((i) => i.name_en === "Espresso");
    expect(after?.id).toBe(shown.id);
  });
});

describe("4. the add-on publishes atomically", () => {
  async function ready() {
    const s = await addon();
    await withMenu(s.store, s.venue.id);
    const { venue: v } = await startDraftForVenue(s.store, s.venue.id, owner);
    await updateDraft(s.store, v, { ...filled("ignored"), name: "New name", categories: [{ key: "n", name_bg: "Нова", name_en: "Fresh", items: [{ key: "k", name_bg: "Чай", name_en: "Tea", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] });
    return s;
  }
  const names = async (store: InMemoryStore, id: string) => (await store.getSite(id)).items.map((i) => [i.name_en, i.active]).sort();

  it("a failure while the new menu is written leaves the venue own, its fields and its old menu as they were", async () => {
    const { store, venue } = await ready();
    const before = await names(store, venue.id);
    const failing = Object.create(store) as InMemoryStore;
    let once = true;
    failing.insertItem = async (i) => {
      if (once) {
        once = false;
        throw new Error("boom");
      }
      return store.insertItem(i);
    };
    await expect(publishDraft(failing, await store.getVenue(venue.id), T0, { userId: owner.id })).rejects.toThrow("boom");
    const v = await store.getVenue(venue.id);
    expect(v).toMatchObject({ site_mode: "own", site_url: "https://coffique.bg", site_platform: "wordpress", name: "Coffique", status: "live" });
    expect(v.wizard_draft).not.toBeNull(); // still an open draft, publish again works
    expect(await names(store, venue.id)).toEqual(before);
    expect((await store.getSite(venue.id)).categories.map((c) => [c.name_en, c.active])).toEqual([["Coffee", true], ["Hidden", false]]);
    // and the retry succeeds
    const done = await publishDraft(store, await store.getVenue(venue.id), T0);
    expect(done.venue).toMatchObject({ site_mode: "claudia", name: "New name", site_url: null, wizard_draft: null });
    expect(await names(store, venue.id)).toEqual([["Tea", true]]);
  });
  it("a failure on the final write leaves the old mode and menu too", async () => {
    const { store, venue } = await ready();
    const before = await names(store, venue.id);
    const failing = Object.create(store) as InMemoryStore;
    failing.updateVenue = async (id, patch) => {
      if (patch.status === "live") throw new Error("final write failed");
      return store.updateVenue(id, patch);
    };
    await expect(publishDraft(failing, await store.getVenue(venue.id), T0)).rejects.toThrow("final write failed");
    expect(await store.getVenue(venue.id)).toMatchObject({ site_mode: "own", name: "Coffique" });
    expect(await names(store, venue.id)).toEqual(before);
  });
  it("the venue's fields, mode and site address change only in the final write", async () => {
    const { store, venue } = await ready();
    const writes: Record<string, unknown>[] = [];
    const spy = Object.create(store) as InMemoryStore;
    spy.updateVenue = async (id, patch) => {
      writes.push(patch as Record<string, unknown>);
      return store.updateVenue(id, patch);
    };
    await publishDraft(spy, await store.getVenue(venue.id), T0);
    const changing = writes.filter((w) => "site_mode" in w || "name" in w);
    expect(changing).toHaveLength(1);
    expect(changing[0]).toMatchObject({ site_mode: "claudia", site_url: null, site_platform: null, name: "New name", status: "live", wizard_draft: null });
  });
});

describe("7 and 8. who gets linked, and a failing hook", () => {
  it("an add-on publish links nobody new", async () => {
    const { store, venue } = await addon();
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, filled("x-y"));
    await publishDraft(store, await store.getVenue(venue.id), T0, { userId: other.id });
    expect(await store.isVenueOwner(venue.id, other.id)).toBe(false);
    expect(await store.isVenueOwner(venue.id, owner.id)).toBe(true);
  });
  it("a failing afterVenueCreated does not fail the wizard publish", async () => {
    const store = new InMemoryStore();
    afterCreated.mockRejectedValueOnce(new Error("billing down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await createDraft(store, "classic", T0);
    await updateDraft(store, d.venue, filled("hook-fails"));
    const done = await publishDraft(store, await store.getVenue(d.venue.id), T0, { userId: owner.id });
    expect(done.venue.status).toBe("live");
    expect(await store.isVenueOwner(done.venue.id, owner.id)).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("9. an open invite is reused", () => {
  it("publish does not add a second owner code when one is open", async () => {
    const store = new InMemoryStore();
    const d = await createDraft(store, "classic", T0);
    const open = await store.createInvite(d.venue.id, "owner", new Date(T0.getTime() + 86_400_000).toISOString());
    await updateDraft(store, d.venue, filled("one-code"));
    const done = await publishDraft(store, await store.getVenue(d.venue.id), T0);
    expect(done.inviteCode).toBe(open);
    expect(await store.listInvites(d.venue.id, T0.toISOString())).toHaveLength(1);
  });
});

describe("10. drafts on live venues stay private and are not cleaned up", () => {
  it("cleanupDrafts keeps a live venue that carries a wizard draft", async () => {
    const { store, venue } = await addon();
    await startDraftForVenue(store, venue.id, owner);
    expect(await cleanupDrafts({ store, now: new Date(Date.now() + 400 * 86_400_000) })).toEqual([]); // far past DRAFT_TTL_MS
    expect(await store.getVenue(venue.id)).toMatchObject({ status: "live" });
  });
  it("the public feed and the hosted page state never carry the wizard draft", async () => {
    const { store, venue } = await addon(noneInput);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, { tagline_en: "SECRET-DRAFT-LINE" });
    const site = (await loadSite(store, venue.slug))!;
    const feed = publicSiteState(site.state);
    expect("wizard_draft" in feed.venue).toBe(false);
    expect("created_via" in feed.venue).toBe(false);
    expect(JSON.stringify(feed)).not.toContain("SECRET-DRAFT-LINE");
  });
});

describe("11. add-on edits stay in the draft until publish", () => {
  it("template and business_type are not written to the live row", async () => {
    const { store, venue } = await addon();
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const draft = await updateDraft(store, v, { template: "nocturne", business_type: "bar" });
    expect(draft).toMatchObject({ template: "nocturne", business_type: "bar" });
    expect(await store.getVenue(venue.id)).toMatchObject({ template: "classic", business_type: "cafe" });
    await updateDraft(store, await store.getVenue(venue.id), filled("x-y"));
    await publishDraft(store, await store.getVenue(venue.id), T0);
    expect(await store.getVenue(venue.id)).toMatchObject({ template: "nocturne", business_type: "bar" });
  });
  it("a draft that is still a draft row keeps writing them through as before", async () => {
    const store = new InMemoryStore();
    const d = await createDraft(store, "classic", T0);
    await updateDraft(store, d.venue, { template: "lumen", business_type: "bar" });
    expect(await store.getVenue(d.venue.id)).toMatchObject({ template: "lumen", business_type: "bar" });
  });
});

describe("12. the upload cap counts the draft's own uploads", () => {
  const deps = (store: InMemoryStore): WizardDeps => ({ store, config: { publicBaseUrl: "https://getclaudia.app", rateSalt: "s", maxSitesPerDay: 9, telegramBotUsername: "b" }, now: () => T0 });
  const upload = (id: string) => {
    const f = new FormData();
    f.append("file", new File([PNG], "a.png", { type: "image/png" }));
    return new Request(`https://getclaudia.app/api/new/${id}/media`, { method: "POST", body: f });
  };
  it("a venue that already has many images can still add its first ones, and stops MAX_DRAFT_MEDIA after the start", async () => {
    const { store, venue } = await addon();
    for (let i = 0; i < MAX_DRAFT_MEDIA + 5; i++) await store.saveMedia(venue.id, PNG, "image/png");
    const { venue: v, token } = await startDraftForVenue(store, venue.id, owner);
    expect(token).toBeTruthy();
    expect(v.wizard_draft?.media_base).toBe(MAX_DRAFT_MEDIA + 5);
    for (let i = 0; i < MAX_DRAFT_MEDIA; i++) expect((await handleMedia(upload(venue.id), deps(store), await store.getVenue(venue.id))).status).toBe(201);
    const over = await handleMedia(upload(venue.id), deps(store), await store.getVenue(venue.id));
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ error: { code: "too_many" } });
  });
  it("the PUT cannot set media_base", async () => {
    const { store, venue } = await addon();
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const res = await handlePutDraft(new Request("https://getclaudia.app/x", { method: "PUT", body: JSON.stringify({ media_base: 0, tagline_en: "ok" }) }), deps(store), v);
    expect(res.status).toBe(200);
    expect((await store.getVenue(venue.id)).wizard_draft).toMatchObject({ media_base: 0, tagline_en: "ok" });
    const fresh = await addon();
    for (let i = 0; i < 3; i++) await fresh.store.saveMedia(fresh.venue.id, PNG, "image/png");
    const { venue: v2 } = await startDraftForVenue(fresh.store, fresh.venue.id, owner);
    await handlePutDraft(new Request("https://getclaudia.app/x", { method: "PUT", body: JSON.stringify({ media_base: 0 }) }), deps(fresh.store), v2);
    expect((await fresh.store.getVenue(fresh.venue.id)).wizard_draft?.media_base).toBe(3);
  });
});

describe("13. slug races are detected by type", () => {
  it("the memory store throws SlugTakenError on create and on update", async () => {
    const store = new InMemoryStore();
    const a = await store.createVenue({ slug: "taken", name: "A" });
    await expect(store.createVenue({ slug: "taken", name: "B" })).rejects.toBeInstanceOf(SlugTakenError);
    const b = await store.createVenue({ slug: "free", name: "B" });
    await expect(store.updateVenue(b.id, { slug: "taken" })).rejects.toBeInstanceOf(SlugTakenError);
    expect(a.slug).toBe("taken");
  });
  it("createOwnVenue takes the next address after a SlugTakenError, but does not swallow other errors that mention a slug", async () => {
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
    expect((await createOwnVenue({ store: racing }, owner, ownInput)).slug).toBe("coffique-2");
    const confused = Object.create(store) as InMemoryStore;
    confused.createVenue = async () => {
      throw new Error("could not parse slug column");
    };
    await expect(createOwnVenue({ store: confused }, owner, ownInput)).rejects.toThrow("could not parse slug column");
  });
});

describe("14. the add-on disconnects the old WordPress site", () => {
  it("marks the WordPress destination disconnected when the Claudia site goes live", async () => {
    const { store, venue } = await addon();
    const dest = await store.upsertDestination({ venue_id: venue.id, kind: "wordpress", config: { site_url: "https://coffique.bg" }, secrets: parseSecretKey("ab".repeat(32)).toString("hex") });
    await store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: {}, secrets: "x" });
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await updateDraft(store, v, filled("x-y"));
    expect((await store.getDestination(venue.id, "wordpress"))?.status).toBe("connected"); // until publish
    await publishDraft(store, await store.getVenue(venue.id), T0);
    expect((await store.getDestination(venue.id, "wordpress"))).toMatchObject({ id: dest.id, status: "disconnected" });
    expect((await store.getDestination(venue.id, "instagram"))?.status).toBe("connected");
  });
});

describe("6. the account link after a wizard publish without a session", () => {
  const config = { publicBaseUrl: "https://getclaudia.app", rateSalt: "s", maxSitesPerDay: 99, telegramBotUsername: "b" };
  const post = () => new Request("https://getclaudia.app/api/new", { method: "POST", body: JSON.stringify({ template: "classic" }), headers: { "x-forwarded-for": "1.1.1.1" } });

  it("a draft started with a session gets a second, venue-bound cookie; without one, none", async () => {
    const store = new InMemoryStore();
    const withUser = await handleNewDraft(post(), { store, config, now: () => T0 }, { userId: owner.id });
    const { id } = (await withUser.json()) as { id: string };
    const cookies = withUser.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.find((c) => c.startsWith(`${DRAFT_ACCOUNT_COOKIE}=`))).toMatch(new RegExp(`^${DRAFT_ACCOUNT_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`));
    const without = await handleNewDraft(post(), { store, config, now: () => T0 });
    expect(without.headers.getSetCookie()).toHaveLength(1);
  });
  it("claimVenueForSession links a live venue that has no owner account", async () => {
    const store = new InMemoryStore();
    const d = await createDraft(store, "classic", T0);
    await updateDraft(store, d.venue, filled("save-me"));
    const live = (await publishDraft(store, await store.getVenue(d.venue.id), T0)).venue;
    expect(await claimVenueForSession(store, live, owner)).toBe(true);
    expect(await store.isVenueOwner(live.id, owner.id)).toBe(true);
    expect(afterCreated).toHaveBeenCalledTimes(1);
  });
  it("refuses a venue that already has an owner account, another account's second claim, a draft and an add-on draft", async () => {
    const store = new InMemoryStore();
    const d = await createDraft(store, "classic", T0);
    expect(await claimVenueForSession(store, d.venue, owner)).toBe(false); // not live
    await updateDraft(store, d.venue, filled("save-me"));
    const live = (await publishDraft(store, await store.getVenue(d.venue.id), T0)).venue;
    expect(await claimVenueForSession(store, live, owner)).toBe(true);
    expect(await claimVenueForSession(store, live, other)).toBe(false);
    expect(await store.isVenueOwner(live.id, other.id)).toBe(false);
    const a = await addon();
    const { venue: openAddon } = await startDraftForVenue(a.store, a.venue.id, owner);
    const stranger = { id: "stranger", email: "s@example.com" };
    await a.store.linkVenueUser(a.venue.id, "x", "staff");
    expect(await claimVenueForSession(a.store, openAddon, stranger)).toBe(false); // wizard_draft present
  });
  it("a hook failure while claiming does not undo the link", async () => {
    const store = new InMemoryStore();
    const d = await createDraft(store, "classic", T0);
    await updateDraft(store, d.venue, filled("save-me"));
    const live = (await publishDraft(store, await store.getVenue(d.venue.id), T0)).venue;
    afterCreated.mockRejectedValueOnce(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await claimVenueForSession(store, live, owner)).toBe(true);
    spy.mockRestore();
  });
});

/** What Postgres does to a jsonb object: keys come back sorted by length, then bytes. Applied to every object, recursively. */
function jsonbOrder<T>(v: T): T {
  if (Array.isArray(v)) return v.map(jsonbOrder) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, jsonbOrder(x)])) as T;
  return v;
}

const MARKS = { sold_out_until: "2031-01-01T00:00:00.000Z", is_special: true, special_expires_at: "2031-02-01T00:00:00.000Z" };
/** Sold-out and special marks have no Store setter (the chat sets them through change sets); the memory rows are edited in place. */
const setMarks = (store: InMemoryStore, venueId: string, itemId: string, marks: object) =>
  Object.assign((store as unknown as { sites: Map<string, { items: { id: string }[] }> }).sites.get(venueId)!.items.find((i) => i.id === itemId)!, marks);

describe("fix round 2: an unchanged menu is recognised whatever the key order", () => {
  it("a draft read back from jsonb (keys re-ordered) is still 'unchanged': no menu write, same ids and marks", async () => {
    const { store, venue } = await addon();
    const { shown } = await withMenu(store, venue.id);
    setMarks(store, venue.id, shown.id, MARKS);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    await store.updateVenue(venue.id, { wizard_draft: jsonbOrder(v.wizard_draft!) });
    expect(Object.keys((await store.getVenue(venue.id)).wizard_draft!)).not.toEqual(Object.keys(v.wizard_draft!)); // the order really differs
    const spy = Object.create(store) as InMemoryStore;
    const calls: string[] = [];
    for (const m of ["clearMenu", "insertCategory", "insertItem"] as const) (spy as unknown as Record<string, unknown>)[m] = async (...a: unknown[]) => {
      calls.push(m);
      return (store as unknown as Record<string, (...x: unknown[]) => unknown>)[m](...a);
    };
    await publishDraft(spy, await store.getVenue(venue.id), T0);
    expect(calls).toEqual([]);
    const after = (await store.getSite(venue.id)).items.find((i) => i.name_en === "Espresso");
    expect(after).toMatchObject({ id: shown.id, sold_out_until: "2031-01-01T00:00:00.000Z", is_special: true, special_expires_at: "2031-02-01T00:00:00.000Z" });
  });
  it("a really changed menu is still rewritten when the keys are re-ordered", async () => {
    const { store, venue } = await addon();
    await withMenu(store, venue.id);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const draft = structuredClone(v.wizard_draft!);
    draft.categories[0].items[0].price_eur = 9.9;
    await store.updateVenue(venue.id, { wizard_draft: jsonbOrder(draft) });
    await publishDraft(store, await store.getVenue(venue.id), T0);
    expect((await store.getSite(venue.id)).items.find((i) => i.name_en === "Espresso")?.price_eur).toBe(9.9);
  });
});

describe("fix round 2: a rewrite keeps the marks of the items that are still there", () => {
  it("matches by the draft item's key (the original item id) first", async () => {
    const { store, venue } = await addon();
    const { shown } = await withMenu(store, venue.id);
    setMarks(store, venue.id, shown.id, MARKS);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const draft = structuredClone(v.wizard_draft!);
    draft.categories[0].items[0].name_en = "Double espresso"; // renamed, same key
    draft.categories[0].items[0].price_eur = 2.2;
    draft.categories[0].items.push({ key: "brand-new", name_bg: "Нов", name_en: "New", desc_bg: "", desc_en: "", price_eur: 3, allergens: [], image_media_id: null });
    await updateDraft(store, v, draft);
    await publishDraft(store, await store.getVenue(venue.id), T0);
    const items = (await store.getSite(venue.id)).items;
    expect(items.find((i) => i.name_en === "Double espresso")).toMatchObject({ ...MARKS, price_eur: 2.2 });
    expect(items.find((i) => i.name_en === "New")).toMatchObject({ sold_out_until: null, is_special: false, special_expires_at: null });
  });
  it("falls back to the same category and name when the key is new", async () => {
    const { store, venue } = await addon();
    const { shown } = await withMenu(store, venue.id);
    setMarks(store, venue.id, shown.id, MARKS);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const draft = structuredClone(v.wizard_draft!);
    draft.categories[0].items[0].key = "re-keyed"; // the client re-keyed it
    draft.categories[0].items[0].desc_en = "now with a description";
    await updateDraft(store, v, draft);
    await publishDraft(store, await store.getVenue(venue.id), T0);
    expect((await store.getSite(venue.id)).items.find((i) => i.name_en === "Espresso")).toMatchObject({ ...MARKS, desc_en: "now with a description" });
  });
  it("gives a dish that is renamed AND re-keyed, a removed dish, and a dish in another category no marks; one old item's marks go to one new item only", async () => {
    const { store, venue } = await addon();
    const { shown, hidden } = await withMenu(store, venue.id);
    setMarks(store, venue.id, shown.id, MARKS);
    setMarks(store, venue.id, hidden.id, MARKS);
    const { venue: v } = await startDraftForVenue(store, venue.id, owner);
    const draft = structuredClone(v.wizard_draft!);
    const [esp, latte] = draft.categories[0].items;
    esp.key = "k1";
    esp.name_bg = "Друго";
    esp.name_en = "Other"; // renamed + re-keyed: a new dish
    draft.categories[0].items = [esp, { ...latte, key: "dup-a" }, { ...latte, key: "dup-b" }]; // two copies of the hidden Latte under new keys
    await updateDraft(store, v, draft);
    await publishDraft(store, await store.getVenue(venue.id), T0);
    const items = (await store.getSite(venue.id)).items;
    expect(items.find((i) => i.name_en === "Other")).toMatchObject({ sold_out_until: null, is_special: false });
    const lattes = items.filter((i) => i.name_en === "Latte");
    expect(lattes).toHaveLength(2);
    expect(lattes.filter((i) => i.is_special)).toHaveLength(1); // the marks went to one of them, not both
  });
});
