// test/wizard-routes.test.ts
import { describe, expect, it } from "vitest";
import type { Deployer } from "@/src/deploy/types";
import { COOKIE_NAME, cookieFromHeader } from "@/src/server/draft-cookie";
import { sha256Hex } from "@/src/server/hash";
import { handleGetDraft, handleMedia, handleNewDraft, handlePublish, handlePutDraft, handleStatus, MAX_DRAFT_MEDIA, requireDraft, sniffImageType, type WizardDeps } from "@/src/server/wizard";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function setup(over: Partial<WizardDeps["config"]> = {}) {
  const demo = await makeDemo();
  const deps: WizardDeps = { store: demo.store, config: { publicBaseUrl: "https://site.example", rateSalt: "salt", maxSitesPerDay: 50, telegramBotUsername: "site_bot", ...over }, now: () => T0 };
  return { ...demo, deps };
}
const json = (url: string, body: unknown, init: RequestInit & { headers?: Record<string, string> } = {}) => {
  const { headers, ...rest } = init;
  return new Request(url, { method: "POST", body: JSON.stringify(body), ...rest, headers: { "content-type": "application/json", ...(headers ?? {}) } });
};

async function newDraft(deps: WizardDeps, ip = "1.2.3.4") {
  const res = await handleNewDraft(json("https://site.example/api/new", { template: "nocturne" }, { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } }), deps);
  const cookie = res.headers.get("set-cookie") ?? "";
  const value = cookieFromHeader(cookie.split(";")[0], COOKIE_NAME) ?? "";
  const { id } = (await res.clone().json()) as { id: string };
  return { res, id, cookie: `${COOKIE_NAME}=${value}` };
}

describe("POST /api/new", () => {
  it("creates a draft, sets the httpOnly cookie and rate-limits per ip and globally", async () => {
    const { deps } = await setup();
    const first = await newDraft(deps);
    expect(first.res.status).toBe(201);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    const sc = first.res.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(new RegExp(`^${COOKIE_NAME}=${first.id}\\.[0-9a-f]{64}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$`));
    for (let i = 0; i < 4; i++) expect((await newDraft(deps)).res.status).toBe(201);
    const sixth = await newDraft(deps);
    expect(sixth.res.status).toBe(429);
    expect(await sixth.res.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect((await newDraft(deps, "5.6.7.8")).res.status).toBe(201); // another ip
    const tight = await setup({ maxSitesPerDay: 1, publicBaseUrl: "http://localhost:3000" });
    const a = await newDraft(tight.deps, "9.9.9.9");
    expect(a.res.status).toBe(201);
    expect(a.res.headers.get("set-cookie")).not.toContain("Secure"); // http base url
    expect((await newDraft(tight.deps, "9.9.9.8")).res.status).toBe(429);
  });
  it("keys the limit on the salted hash of the first forwarded ip, never the raw ip", async () => {
    const { deps, store } = await setup();
    await newDraft(deps, "203.0.113.7");
    await handleNewDraft(json("https://site.example/api/new", { template: "classic" }), deps); // no x-forwarded-for
    const keys = [...store.rateLimits.keys()];
    expect(keys).toContain(`new:ip:${sha256Hex("203.0.113.7salt")}`);
    expect(keys).toContain(`new:ip:${sha256Hex("unknownsalt")}`);
    expect(keys).toContain("new:global");
    expect(keys.join(" ")).not.toContain("203.0.113.7");
  });
  it("rejects an unknown template", async () => {
    const { deps } = await setup();
    const res = await handleNewDraft(json("https://site.example/api/new", { template: "wix" }), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "bad_request", bg: "Изберете шаблон.", en: "Choose a template." } });
  });
});

describe("requireDraft", () => {
  it("needs the cookie for the same id with a token that resolves", async () => {
    const { deps, store } = await setup();
    const { id, cookie } = await newDraft(deps);
    const noCookie = await requireDraft(new Request(`https://site.example/api/new/${id}`), deps, id);
    expect(noCookie).toBeInstanceOf(Response);
    expect((noCookie as Response).status).toBe(401);
    const wrongId = await requireDraft(new Request(`https://site.example/api/new/other`, { headers: { cookie } }), deps, "other");
    expect((wrongId as Response).status).toBe(401);
    const badToken = await requireDraft(new Request(`https://site.example/api/new/${id}`, { headers: { cookie: `${COOKIE_NAME}=${id}.${"0".repeat(64)}` } }), deps, id);
    expect((badToken as Response).status).toBe(404);
    const ok = await requireDraft(new Request(`https://site.example/api/new/${id}`, { headers: { cookie } }), deps, id);
    expect("venue" in ok && ok.venue.id).toBe(id);
    expect((await store.getVenue(id)).status).toBe("draft");
  });
});

describe("GET/PUT /api/new/[id], media, publish, status", () => {
  it("runs the whole flow", async () => {
    const { deps, store } = await setup();
    const { id, cookie } = await newDraft(deps);
    const guard = await requireDraft(new Request(`https://site.example/api/new/${id}`, { headers: { cookie } }), deps, id);
    if (guard instanceof Response) throw new Error(`guard refused: ${guard.status}`);
    const venue = guard.venue;
    const got = await handleGetDraft(deps, venue);
    expect(await got.json()).toMatchObject({ draft: { template: "nocturne", step: "basics" }, media: [], status: "draft" });

    const bad = await handlePutDraft(json(`https://site.example/api/new/${id}`, { slug: "admin" }, { method: "PUT" }), deps, venue);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid", details: [{ path: "slug" }] } });

    const form = new FormData();
    form.append("file", new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" }));
    const up = await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: form }), deps, venue);
    expect(up.status).toBe(201);
    const { media } = (await up.json()) as { media: { id: string } };
    const pdfForm = new FormData();
    pdfForm.append("file", new File([new Uint8Array([1])], "menu.pdf", { type: "application/pdf" }));
    expect((await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: pdfForm }), deps, venue)).status).toBe(400);
    const bigForm = new FormData();
    bigForm.append("file", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" }));
    expect(await (await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: bigForm }), deps, venue)).json()).toMatchObject({ error: { code: "too_large" } });

    const put = await handlePutDraft(json(`https://site.example/api/new/${id}`, { name: "Нощ", slug: "nosht", logo_media_id: media.id, categories: [{ key: "c", name_bg: "Коктейли", name_en: "Cocktails", items: [{ key: "i", name_bg: "Негрони", name_en: "Negroni", desc_bg: "", desc_en: "", price_eur: 9, allergens: [], image_media_id: null }] }] }, { method: "PUT" }), deps, venue);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ draft: { name: "Нощ", slug: "nosht", logo_media_id: media.id } });

    const early = await handleStatus({ ...deps, deployer: fakeDeployer(), messenger: null }, await store.getVenue(id));
    expect(await early.json()).toEqual({ status: "draft", deploy: null, site_url: null });

    const pub = await handlePublish(deps, await store.getVenue(id));
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as Record<string, string | null>;
    expect(body.slug).toBe("nosht");
    expect(body.invite_code).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.start_url).toBe(`https://t.me/site_bot?start=${body.invite_code}`);
    expect(body.admin_url).toMatch(/^https:\/\/site\.example\/admin\/nosht\?key=[0-9a-f]{32}$/);
    expect(body.site_url).toBe("https://site.example/nosht");
    // publishing again is idempotent: 409 with the same slug, no second invite, no deploy started
    const invites = () => [...store.invites.values()].filter((i) => i.venue_id === id).length;
    expect(invites()).toBe(1);
    const again = await handlePublish(deps, await store.getVenue(id));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "already_published", slug: "nosht", bg: "Сайтът вече е създаден.", en: "This site has already been created." } });
    expect(invites()).toBe(1);
    expect((await store.getVenue(id)).deploy).toBeNull();
    expect((await store.getSite(id)).items).toHaveLength(1);
    // the published venue keeps its uploaded logo; no more uploads through the wizard cookie
    expect((await store.getVenue(id)).logo_media_id).toBe(media.id);
    const late = new FormData();
    late.append("file", new File([new Uint8Array([137, 80, 78, 71])], "late.png", { type: "image/png" }));
    const lateRes = await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: late }), deps, await store.getVenue(id));
    expect(lateRes.status).toBe(409);
    expect((await handlePutDraft(json(`https://site.example/api/new/${id}`, { name: "x" }, { method: "PUT" }), deps, await store.getVenue(id))).status).toBe(409);

    // no bot username → start_url null
    const noBot = await setup({ telegramBotUsername: null });
    const d2 = await newDraft(noBot.deps);
    await handlePutDraft(json(`https://site.example/api/new/${d2.id}`, { name: "B", slug: "b-cafe", categories: [{ key: "c", name_bg: "К", name_en: "", items: [{ key: "i", name_bg: "Ч", name_en: "", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] }, { method: "PUT" }), noBot.deps, await noBot.store.getVenue(d2.id));
    expect(await (await handlePublish(noBot.deps, await noBot.store.getVenue(d2.id))).json()).toMatchObject({ start_url: null, slug: "b-cafe" });

    // status after publish: live and our own url; with a pending deploy it polls the deployer
    const live = await handleStatus({ ...deps, deployer: fakeDeployer(), messenger: null }, await store.getVenue(id));
    expect(await live.json()).toEqual({ status: "live", deploy: null, site_url: "https://site.example/nosht" });
    await store.setDeploy(id, { provider: "fake", project_id: "p1", deployment_id: "d1", url: null, status: "pending", error: null, template: "nocturne", updated_at: T0.toISOString() });
    const polled = await handleStatus({ ...deps, deployer: fakeDeployer(), messenger: null }, await store.getVenue(id));
    const pj = (await polled.json()) as { status: string; deploy: { status: string; url: string | null }; site_url: string | null };
    expect(pj.status).toBe("live");
    expect(pj.deploy.status).toBe("ready");
    expect(pj.site_url).toBe("https://nosht.example.test");
  });
});

describe("media upload checks", () => {
  it("stores the type sniffed from the bytes and refuses non-images labelled as images", async () => {
    const { deps, store } = await setup();
    const { id } = await newDraft(deps);
    const venue = await store.getVenue(id);
    const upload = async (bytes: number[], name: string, type: string) => {
      const f = new FormData();
      f.append("file", new File([new Uint8Array(bytes)], name, { type }));
      return handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: f }), deps, venue);
    };
    const fake = await upload([60, 115, 118, 103], "x.png", "image/png"); // "<svg"
    expect(fake.status).toBe(400);
    expect(await fake.json()).toEqual({ error: { code: "unsupported_type", bg: "Само снимки: JPEG, PNG, WebP или GIF.", en: "Images only: JPEG, PNG, WebP or GIF." } });
    const mislabelled = await upload([0xff, 0xd8, 0xff, 0xe0], "photo.png", "image/png");
    expect(mislabelled.status).toBe(201);
    const { media } = (await mislabelled.json()) as { media: { storage_path: string } };
    expect(media.storage_path).toMatch(/\.jpg$/);
    expect((await upload([], "empty.jpg", "image/jpeg")).status).toBe(400);
    const noFile = await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: new FormData() }), deps, venue);
    expect(await noFile.json()).toMatchObject({ error: { code: "bad_request" } });
  });
  it("refuses a body whose declared length is over the limit before reading it", async () => {
    const { deps, store } = await setup();
    const { id } = await newDraft(deps);
    const res = await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", headers: { "content-length": String(6 * 1024 * 1024) }, body: "x" }), deps, await store.getVenue(id));
    expect(await res.json()).toMatchObject({ error: { code: "too_large" } });
  });
  it("caps the number of uploads per draft", async () => {
    const { deps, store } = await setup();
    const { id } = await newDraft(deps);
    for (let i = 0; i < MAX_DRAFT_MEDIA; i++) await store.saveMedia(id, new Uint8Array([1]), "image/png");
    const f = new FormData();
    f.append("file", new File([new Uint8Array([137, 80, 78, 71])], "one-more.png", { type: "image/png" }));
    const res = await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: f }), deps, await store.getVenue(id));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "too_many" } });
  });
  it("sniffs the four image formats", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });
});

/** A deployer that is READY on the first status() call (pollDeployments from Task 6 drives it). */
function fakeDeployer(): Deployer {
  return {
    provider: "fake",
    async createSite(i) { return { projectId: `prj_${i.slug}`, deploymentId: `dpl_${i.slug}` }; },
    async status() { return { state: "ready", url: "https://nosht.example.test", error: null }; },
    async redeploy(_p, i) { return { deploymentId: `dpl2_${i.slug}` }; },
    async deleteSite() {},
  };
}
