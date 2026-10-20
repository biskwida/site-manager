// test/done-page.test.tsx — /new/[id]/done after a publish: the "Log in to save" offer and the account link (Task 5 fix round 1, item 6).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>(async () => null);
vi.mock("@/src/server/session", () => ({ getSessionUser: () => sessionUser() }));
let jar: Record<string, string> = {};
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n in jar ? { value: jar[n] } : undefined) }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: to });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
const afterCreated = vi.fn(async (venue: unknown) => void venue);
vi.mock("@/src/server/after-venue-created", () => ({ afterVenueCreated: (v: unknown) => afterCreated(v) }));
let store: InMemoryStore;
const config = { publicBaseUrl: "https://getclaudia.app", telegramBotUsername: "claudia_bot", messengerPageHandle: null, instagramUsername: null, whatsappNumber: null, channelsEnabled: false, metaPageToken: null, whatsappToken: null, metaAppId: null, metaAppSecret: null, instagramAppId: null, instagramAppSecret: null, metaLoginConfigId: null };
vi.mock("@/src/server/deps", () => ({ getServerDeps: async () => ({ store, config, deployer: null, destinationSecretKey: null }) }));

import DonePage from "@/app/new/[id]/done/page";
import { DRAFT_COOKIE, draftCookieValue } from "@/src/server/draft-cookie";
import { createDraft, DRAFT_ACCOUNT_COOKIE, publishDraft, updateDraft } from "@/src/server/wizard";
import { InMemoryStore } from "@/src/store/memory";
import { emptyDraft } from "@/src/wizard/schema";

const user = { id: "u1", email: "o@example.com" };
const T0 = new Date("2026-10-19T09:00:00.000Z");

async function published() {
  const d = await createDraft(store, "classic", T0);
  await updateDraft(store, d.venue, {
    name: "Coffique", slug: "coffique", default_lang: "bg", address: "A", phone: "1", instagram: "", maps_url: "", hours: emptyDraft("classic").hours, theme: { accent: "#2f6b4f" },
    tagline_bg: "x", tagline_en: "x", about_bg: "x", about_en: "x", texts: { welcome: { bg: "x", en: "x" }, footer_note: { bg: "", en: "" } },
    logo_media_id: null, cover_media_id: null, gallery_media_ids: [],
    categories: [{ key: "c", name_bg: "К", name_en: "C", items: [{ key: "e", name_bg: "Е", name_en: "E", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }],
    step: "review",
  });
  const live = (await publishDraft(store, await store.getVenue(d.venue.id), T0)).venue; // published without a session
  jar = { [DRAFT_COOKIE]: draftCookieValue(live.id, d.token) };
  return live;
}
const render = async (id: string) => renderToStaticMarkup((await DonePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as never)) as React.ReactElement);

beforeEach(() => {
  store = new InMemoryStore();
  jar = {};
  sessionUser.mockResolvedValue(null);
  afterCreated.mockClear();
});

describe("/new/[id]/done: saving the business to an account", () => {
  it("signed out, started signed in: offers to log in and come back here", async () => {
    const live = await published();
    jar[DRAFT_ACCOUNT_COOKIE] = live.id;
    const html = await render(live.id);
    expect(html).toContain("Влезте, за да запазите бизнеса в профила си");
    expect(html).toContain(`href="/login?next=${encodeURIComponent(`/new/${live.id}/done`)}"`);
    expect(await store.hasOwnerAccount(live.id)).toBe(false);
  });
  it("signed out, never started signed in: no offer, as before", async () => {
    const live = await published();
    expect(await render(live.id)).not.toContain("профила си");
  });
  it("a hint for another venue does not count", async () => {
    const live = await published();
    jar[DRAFT_ACCOUNT_COOKIE] = "some-other-venue-id";
    expect(await render(live.id)).not.toContain("Влезте, за да запазите");
  });
  it("back signed in: the venue is linked once and the checklist link appears", async () => {
    const live = await published();
    afterCreated.mockClear(); // the account-less publish already ran the hook; this counts the claim only
    jar[DRAFT_ACCOUNT_COOKIE] = live.id;
    sessionUser.mockResolvedValue(user);
    const html = await render(live.id);
    expect(await store.isVenueOwner(live.id, user.id)).toBe(true);
    expect(html).toContain(`href="/onboarding/coffique"`);
    expect(html).not.toContain("Влезте, за да запазите");
    expect(afterCreated).toHaveBeenCalledTimes(1);
    await render(live.id); // a reload links nothing again
    expect(afterCreated).toHaveBeenCalledTimes(1);
  });
  it("signed in without the hint (this browser began signed out): nothing is linked", async () => {
    const live = await published();
    sessionUser.mockResolvedValue(user);
    const html = await render(live.id);
    expect(await store.isVenueOwner(live.id, user.id)).toBe(false);
    expect(html).not.toContain("/onboarding/");
  });
  it("a venue that already has an owner account is never taken over, and no login offer is made for it", async () => {
    const live = await published();
    await store.linkVenueUser(live.id, "someone-else", "owner");
    jar[DRAFT_ACCOUNT_COOKIE] = live.id;
    sessionUser.mockResolvedValue(user);
    expect(await render(live.id)).not.toContain("/onboarding/");
    expect(await store.isVenueOwner(live.id, user.id)).toBe(false);
    sessionUser.mockResolvedValue(null);
    expect(await render(live.id)).not.toContain("Влезте, за да запазите");
  });
  it("without the draft cookie the page is not found, so nothing can be linked from outside", async () => {
    const live = await published();
    jar = { [DRAFT_ACCOUNT_COOKIE]: live.id };
    sessionUser.mockResolvedValue(user);
    await expect(render(live.id)).rejects.toMatchObject({ notFound: true });
    expect(await store.isVenueOwner(live.id, user.id)).toBe(false);
  });
});
