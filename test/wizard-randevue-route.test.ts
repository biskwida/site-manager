// test/wizard-randevue-route.test.ts — POST /api/new/[id]/randevue (src/server/wizard-randevue.ts) with a fake fetch serving the
// saved pages, plus what publish does with the imported sold-out dates and product photos.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { POST as randevueRoute } from "@/app/api/new/[id]/randevue/route";
import type { ChangeSet } from "@/src/domain/types";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import { COOKIE_NAME, cookieFromHeader } from "@/src/server/draft-cookie";
import { importItemImages } from "@/src/server/item-images";
import { handleNewDraft, handlePublish, updateDraft, type WizardDeps } from "@/src/server/wizard";
import { handleRandevue, RANDEVUE_MAX_HTML_BYTES, RANDEVUE_PER_DRAFT_PER_HOUR, randevueRateLimitKey, type RandevueDeps, type RandevueImport } from "@/src/server/wizard-randevue";
import { makeDemo } from "./helpers";

const ID = "bf306c97-e37f-4354-ad87-75bb5d8415cd";
const T0 = new Date("2026-10-15T12:00:00.000Z");
const PAGE: Record<string, string> = {
  "bg-BG": readFileSync(new URL("./fixtures/randevue/43-12-cafe-sofia.bg-BG.html", import.meta.url), "utf8"),
  "en-GB": readFileSync(new URL("./fixtures/randevue/43-12-cafe-sofia.en-GB.html", import.meta.url), "utf8"),
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Serves the saved pages for the two locale urls; anything else gets `other` (default 404). Records every url. */
function fakeFetch(opts: { pages?: Partial<Record<string, string | null>>; other?: (url: string) => Response; status?: number } = {}) {
  const urls: string[] = [];
  const pages = { ...PAGE, ...(opts.pages ?? {}) };
  const f: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    const m = /^https:\/\/randevue\.app\/(bg-BG|en-GB)\/([0-9a-f-]{36})$/.exec(url);
    if (m && m[2] === ID) {
      const html = pages[m[1]];
      if (html === null) throw new TypeError("fetch failed");
      return new Response(html, { status: opts.status ?? 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return opts.other ? opts.other(url) : new Response("not found", { status: 404 });
  };
  return { f, urls };
}
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const URL_ = "https://site.example/api/new/v/randevue";
const errorOf = async (r: Response) => ((await r.json()) as { error: { code: string; bg: string; en: string } }).error;

async function draftVenue() {
  const { store } = await makeDemo();
  const wd: WizardDeps = { store, config: { publicBaseUrl: "https://site.example", rateSalt: "s", maxSitesPerDay: 50, telegramBotUsername: null }, now: () => T0 };
  const res = await handleNewDraft(post("https://site.example/api/new", { template: "classic" }), wd);
  const { id } = (await res.json()) as { id: string };
  return { store, wd, venue: await store.getVenue(id) };
}
async function deps(fake = fakeFetch()) {
  const { store, venue, wd } = await draftVenue();
  const d: RandevueDeps = { store, now: () => T0, fetch: fake.f };
  return { d, venue, store, wd, urls: fake.urls };
}

describe("handleRandevue", () => {
  it("fetches both locale pages and answers 200 with the reviewed menu and the venue details", async () => {
    const { d, venue, urls } = await deps();
    const res = await handleRandevue(post(URL_, { url: `https://randevue.app/bg-BG/${ID}` }), d, venue);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(urls.sort()).toEqual([`https://randevue.app/bg-BG/${ID}`, `https://randevue.app/en-GB/${ID}`]);
    const body = (await res.json()) as RandevueImport;
    expect(body.menu.categories).toHaveLength(10);
    expect(body.menu.categories.flatMap((c) => c.items)).toHaveLength(195);
    expect(body.menu.categories[0]).toMatchObject({ name_bg: "Храна", name_en: "Food" });
    // post-processed: trimmed names, EU allergens with the keyword suggestions merged in, prices in EUR
    const tomato = body.menu.categories[0].items.find((i) => i.name_bg.startsWith("Доматена"))!;
    expect(tomato).toMatchObject({ price_eur: 6.5, currency_seen: "EUR", sold_out_until: "2026-10-15T16:00:00+00:00" });
    expect(tomato.allergens).toContain(1);
    expect(tomato.allergens).toContain(7);
    expect(body.menu.categories[2].name_bg).toBe("Десерти"); // "Десерти " on Randevue
    expect(body.menu.notes_en).toContain("195 products");
    expect(body.venue).toEqual({
      name: "43.12 Café Sofia",
      table: "Маса 34",
      hours: { mon: { open: "08:00", close: "19:00" }, tue: { open: "08:00", close: "19:00" }, wed: { open: "08:00", close: "19:00" }, thu: { open: "08:00", close: "19:00" }, fri: { open: "08:00", close: "19:00" }, sat: { open: "08:00", close: "19:00" }, sun: { open: "08:00", close: "19:00" } },
      logo_url: body.venue.logo_url,
      cover_url: body.venue.cover_url,
    });
    expect(body.venue.logo_url).toMatch(/supabase\.co\/storage\/v1\/.*logo\.jpg/);
    expect(body.venue.cover_url).toMatch(/supabase\.co\/storage\/v1\/.*logo-and-cover\.png/);
  });

  it("still answers 200 when one locale page cannot be read, filling the missing language", async () => {
    const { d, venue } = await deps(fakeFetch({ pages: { "en-GB": null } }));
    const res = await handleRandevue(post(URL_, { url: `https://randevue.app/en-GB/${ID}` }), d, venue);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RandevueImport;
    expect(body.menu.categories[0]).toMatchObject({ name_bg: "Храна", name_en: "Храна" });
    expect(body.menu.categories.flatMap((c) => c.items)).toHaveLength(195);
  });

  it("answers 400 bad_request for a missing, non-Randevue or malformed link without fetching", async () => {
    const { d, venue, urls } = await deps();
    const status = async (body: unknown) => (await handleRandevue(post(URL_, body), d, venue)).status;
    expect(await status("{")).toBe(400);
    expect(await status({})).toBe(400);
    expect(await status({ url: 42 })).toBe(400);
    expect(await status({ url: "https://example.com/menu" })).toBe(400);
    expect(await status({ url: `http://randevue.app/bg-BG/${ID}` })).toBe(400);
    expect(await status({ url: `https://randevue.app.evil.com/bg-BG/${ID}` })).toBe(400);
    const r = await handleRandevue(post(URL_, { url: "https://randevue.app/bg-BG/menu" }), d, venue);
    expect(await errorOf(r)).toEqual({ code: "bad_request", bg: "Поставете линк от randevue.app, например https://randevue.app/bg-BG/…", en: "Paste a link from randevue.app, for example https://randevue.app/bg-BG/…" });
    expect(urls).toEqual([]);
  });

  it("answers 502 randevue_error, in both languages, when neither page has the menu (network error, another page, an error status, a huge page)", async () => {
    const check = async (fake: ReturnType<typeof fakeFetch>) => {
      const { d, venue } = await deps(fake);
      const res = await handleRandevue(post(URL_, { url: `https://randevue.app/bg-BG/${ID}` }), d, venue);
      expect(res.status).toBe(502);
      expect(await errorOf(res)).toEqual({ code: "randevue_error", bg: "Не успяхме да прочетем тази страница от Randevue. Качете снимки на менюто вместо това.", en: "Could not read this Randevue page. Use menu photos instead." });
    };
    await check(fakeFetch({ pages: { "bg-BG": null, "en-GB": null } }));
    await check(fakeFetch({ pages: { "bg-BG": "<html><body>404</body></html>", "en-GB": "<html></html>" } }));
    await check(fakeFetch({ status: 500 }));
    await check(fakeFetch({ pages: { "bg-BG": `<script>self.__next_f.push([1,"3c:${"x".repeat(RANDEVUE_MAX_HTML_BYTES)}"])</script>`, "en-GB": null } }));
  });

  it("never follows a redirect away from randevue.app", async () => {
    const fake = fakeFetch();
    const redirecting: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(init?.redirect).toBe("manual");
      fake.urls.push(url);
      return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    };
    const { d, venue, urls } = await deps({ f: redirecting, urls: fake.urls });
    const res = await handleRandevue(post(URL_, { url: `https://randevue.app/bg-BG/${ID}` }), d, venue);
    expect(res.status).toBe(502);
    expect(urls.every((u) => u.startsWith("https://randevue.app/"))).toBe(true);
  });

  it("answers 409 for a live venue and 429 after 20 imports per draft per hour, counting only requests that fetch", async () => {
    const { d, venue, store, urls } = await deps();
    const { venue: live } = await makeDemo();
    expect((await handleRandevue(post(URL_, { url: `https://randevue.app/bg-BG/${ID}` }), d, live)).status).toBe(409);
    expect(urls).toEqual([]);
    expect(RANDEVUE_PER_DRAFT_PER_HOUR).toBe(20);
    await handleRandevue(post(URL_, { url: "nope" }), d, venue); // not counted
    expect(store.rateLimits.has(randevueRateLimitKey(venue.id))).toBe(false);
    for (let i = 0; i < 20; i++) expect((await handleRandevue(post(URL_, { url: `https://randevue.app/bg-BG/${ID}` }), d, venue)).status).toBe(200);
    const limited = await handleRandevue(post(URL_, { url: `https://randevue.app/bg-BG/${ID}` }), d, venue);
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toEqual({ code: "rate_limited", bg: "Твърде много опити за внасяне. Опитайте след малко.", en: "Too many import attempts. Try again in a little while." });
    expect(urls).toHaveLength(40);
    const later = { ...d, now: () => new Date(T0.getTime() + 3_600_000 + 1) };
    expect((await handleRandevue(post(URL_, { url: `https://randevue.app/bg-BG/${ID}` }), later, venue)).status).toBe(200);
  });
});

describe("POST /api/new/[id]/randevue (route)", () => {
  const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
  afterEach(() => {
    g.__siteManagerDeps = undefined;
  });
  it("guards with the draft cookie, then serves the import with the server's outbound fetch", async () => {
    const fake = fakeFetch();
    const sd = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory" }, log: () => {}, fetch: fake.f });
    g.__siteManagerDeps = Promise.resolve(sd);
    const res = await handleNewDraft(post("https://site.example/api/new", { template: "lumen" }), { store: sd.store, config: sd.config, now: () => new Date() });
    const value = cookieFromHeader((res.headers.get("set-cookie") ?? "").split(";")[0], COOKIE_NAME) ?? "";
    const { id } = (await res.json()) as { id: string };
    const cookie = `${COOKIE_NAME}=${value}`;
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const url = `https://site.example/api/new/${id}/randevue`;
    expect((await randevueRoute(post(url, { url: `https://randevue.app/bg-BG/${ID}` }), ctx(id))).status).toBe(401);
    expect((await randevueRoute(post(url, { url: `https://randevue.app/bg-BG/${ID}` }, { cookie: `${COOKIE_NAME}=${id}.${"0".repeat(64)}` }), ctx(id))).status).toBe(404);
    expect(fake.urls).toEqual([]);
    const ok = await randevueRoute(post(url, { url: `https://randevue.app/bg-BG/${ID}` }, { cookie }), ctx(id));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as RandevueImport).menu.categories).toHaveLength(10);
    expect(fake.urls).toHaveLength(2);
  });
});

describe("publish with Randevue items", () => {
  const IMG = "https://icmafymfqhifonzfawss.supabase.co/storage/v1/render/image/public/commercial_entities/x/products/a.png?width=1120&height=720&resize=contain";
  const cats = [{ key: "c", name_bg: "Храна", name_en: "Food", items: [
    { key: "a", name_bg: "Пиле", name_en: "Chicken", desc_bg: "", desc_en: "", price_eur: 9.5, allergens: [], image_media_id: null, image_url: IMG, sold_out_until: "2026-10-15T16:00:00+00:00" },
    { key: "b", name_bg: "Супа", name_en: "Soup", desc_bg: "", desc_en: "", price_eur: 4, allergens: [], image_media_id: null, image_url: "https://icmafymfqhifonzfawss.supabase.co/storage/v1/object/public/b.png", sold_out_until: "2026-10-01T16:00:00+00:00" },
    { key: "c", name_bg: "Вода", name_en: "Water", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], image_media_id: null },
  ] }];
  const imageFetch = (fail: (url: string) => boolean = () => false) => {
    const urls: string[] = [];
    const f: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      if (fail(url)) return new Response("nope", { status: 500 });
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    };
    return { f, urls };
  };

  it("marks items still sold out, leaves a past date alone, and copies the product photos in a deferred job", async () => {
    const { store, wd, venue } = await draftVenue();
    await updateDraft(store, venue, { name: "Кафе", slug: "kafe-rv", categories: cats });
    const jobs: (() => Promise<void>)[] = [];
    const img = imageFetch();
    const res = await handlePublish({ ...wd, fetch: img.f, defer: (fn) => jobs.push(fn) }, await store.getVenue(venue.id));
    expect(res.status).toBe(200);
    const site = await store.getSite(venue.id);
    const byName = Object.fromEntries(site.items.map((i) => [i.name_en, i]));
    expect(byName.Chicken.sold_out_until).toBe("2026-10-15T16:00:00+00:00");
    expect(byName.Soup.sold_out_until).toBeNull();
    expect(byName.Water.sold_out_until).toBeNull();
    expect(site.items.every((i) => i.image_media_id === null)).toBe(true); // photos arrive after the response
    const soldOut = (await store.listChangeSets(venue.id)).find((s) => s.changes.some((c) => c.op === "set_sold_out"))!;
    expect(soldOut).toMatchObject({ status: "applied", source: "auto", chat_ref: null });
    expect(soldOut.summary_en).toBe("Initial photos and sold-out items");
    expect(jobs).toHaveLength(1);
    expect(img.urls).toEqual([]);
    await jobs[0]();
    expect(img.urls.sort()).toEqual([IMG, "https://icmafymfqhifonzfawss.supabase.co/storage/v1/object/public/b.png"].sort());
    const after = await store.getSite(venue.id);
    const withImage = after.items.filter((i) => i.image_media_id);
    expect(withImage.map((i) => i.name_en).sort()).toEqual(["Chicken", "Soup"]);
    expect(after.media.filter((m) => !m.is_gallery)).toHaveLength(2);
    const photos = (await store.listChangeSets(venue.id)).find((s) => s.changes.some((c) => c.op === "set_item_image")) as ChangeSet;
    expect(photos).toMatchObject({ status: "applied", source: "auto", summary_bg: "Снимки от Randevue", summary_en: "Photos from Randevue" });
    expect(photos.changes).toHaveLength(2);
  });

  it("publishes without a job when no item has a photo url, and the job survives failed downloads", async () => {
    const { store, wd, venue } = await draftVenue();
    await updateDraft(store, venue, { name: "Кафе", slug: "kafe-rv2", categories: [{ ...cats[0], items: [cats[0].items[2]] }] });
    const jobs: (() => Promise<void>)[] = [];
    expect((await handlePublish({ ...wd, fetch: imageFetch().f, defer: (fn) => jobs.push(fn) }, await store.getVenue(venue.id))).status).toBe(200);
    expect(jobs).toHaveLength(0);

    const demo = await makeDemo();
    const live = demo.venue;
    const liveStore = demo.store;
    const items = (await liveStore.getSite(live.id)).items;
    const img = imageFetch((u) => u.includes("/b.png"));
    const r = await importItemImages({ store: liveStore, fetch: img.f, now: () => T0 }, live.id, [
      { item_id: items[0].id, url: IMG },
      { item_id: items[1].id, url: "https://icmafymfqhifonzfawss.supabase.co/storage/v1/object/public/b.png" },
      { item_id: items[2].id, url: "https://evil.example/c.png" }, // not Randevue's bucket: never fetched
      { item_id: "missing", url: IMG },
    ]);
    expect(r).toEqual({ saved: 1, failed: 3 });
    expect(img.urls).toHaveLength(2);
    const after = await liveStore.getSite(live.id);
    expect(after.items.find((i) => i.id === items[0].id)?.image_media_id).toBeTruthy();
    expect(after.items.find((i) => i.id === items[1].id)?.image_media_id).toBeNull();
    // nothing to do → no change set, no throw
    expect(await importItemImages({ store: liveStore, fetch: img.f, now: () => T0 }, live.id, [])).toEqual({ saved: 0, failed: 0 });
  });
});
