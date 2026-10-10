// test/wizard-ai.test.ts — the HTTP half of Task 8: handleExtract / handleTexts and the two cookie-guarded routes, with a fake Anthropic client.
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { POST as extractRoute } from "@/app/api/new/[id]/extract/route";
import { POST as textsRoute } from "@/app/api/new/[id]/texts/route";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import { COOKIE_NAME, cookieFromHeader } from "@/src/server/draft-cookie";
import { handleNewDraft, updateDraft, type WizardDeps } from "@/src/server/wizard";
import { EXTRACT_MAX_TOTAL_BYTES, handleExtract, handleTexts, type WizardAiDeps } from "@/src/server/wizard-ai";
import type { ExtractResult } from "@/src/wizard/extract";
import type { DraftTexts } from "@/src/wizard/texts";
import { makeDemo } from "./helpers";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PDF_STUB = Buffer.from("%PDF-1.4\n%stub\n").toString("base64");

type Reply = { stop_reason: string; content: unknown[] } | Error;
/** Records the request params and answers with the scripted message (or throws). */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); if (reply instanceof Error) throw reply; return reply; } } } };
  return { client: client as unknown as Anthropic, calls };
}
const toolUse = (name: string, input: unknown): Reply => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name, input }] });

const MENU: ExtractResult = {
  categories: [{ name_bg: "Кафе", name_en: "Coffee", items: [{ name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "", desc_en: "", price_eur: 5, currency_seen: "BGN", allergens: [] }] }],
  notes_bg: "",
  notes_en: "",
};
const TEXTS: DraftTexts = {
  tagline_bg: "Кафе и тишина на ъгъла", tagline_en: "Coffee and quiet on the corner",
  about_bg: "Малко квартално кафене.", about_en: "A small neighbourhood café.",
  welcome_bg: "Добре дошли!", welcome_en: "Welcome!",
  footer_note_bg: "Приемаме карти.", footer_note_en: "Cards accepted.",
};

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const EXTRACT_URL = "https://site.example/api/new/v/extract";
const TEXTS_URL = "https://site.example/api/new/v/texts";
const png = { media_type: "image/png", data: PNG_1x1 };
/** base64 that decodes to exactly `bytes` bytes. */
const b64Of = (bytes: number) => Buffer.alloc(bytes).toString("base64");

async function draftVenue() {
  const { store } = await makeDemo();
  const wd: WizardDeps = { store, config: { publicBaseUrl: "https://site.example", rateSalt: "s", maxSitesPerDay: 50, telegramBotUsername: null }, now: () => new Date() };
  const res = await handleNewDraft(post("https://site.example/api/new", { template: "classic" }), wd);
  const { id } = (await res.json()) as { id: string };
  return { store, venue: await store.getVenue(id) };
}
async function aiDeps(reply: Reply | null) {
  const { store, venue } = await draftVenue();
  const fake = reply ? fakeClient(reply) : null;
  const d: WizardAiDeps = { store, anthropic: fake?.client ?? null, model: "claude-opus-5-5" };
  return { d, venue, store, calls: fake?.calls ?? [] };
}
const errorOf = async (r: Response) => ((await r.json()) as { error: { code: string; bg: string; en: string } }).error;

describe("handleExtract", () => {
  it("answers 503 ai_unavailable without a client, in both languages", async () => {
    const { d, venue } = await aiDeps(null);
    const res = await handleExtract(post(EXTRACT_URL, { files: [png] }), d, venue);
    expect(res.status).toBe(503);
    const err = await errorOf(res);
    expect(err.code).toBe("ai_unavailable");
    expect(err.bg).toMatch(/[а-я]/);
    expect(err.en).toMatch(/AI/);
  });

  it("answers 200 with the post-processed ExtractResult and sends the files to the model", async () => {
    const { d, venue, calls } = await aiDeps(toolUse("extract_menu", MENU));
    const res = await handleExtract(post(EXTRACT_URL, { files: [png, { media_type: "application/pdf", data: PDF_STUB }] }), d, venue);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as ExtractResult;
    expect(body).toMatchObject({ categories: [{ name_bg: "Кафе", items: [{ price_eur: 2.56, currency_seen: "BGN", allergens: [7] }] }], notes_bg: "", notes_en: "" });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("claude-opus-5-5");
    const content = (calls[0].messages as { content: { type: string }[] }[])[0].content;
    expect(content.map((b) => b.type)).toEqual(["image", "document", "text"]);
  });

  it("answers 422 refused on a refusal and 502 ai_error on a failure or a reply without the tool call", async () => {
    const refused = await aiDeps({ stop_reason: "refusal", content: [] });
    const r1 = await handleExtract(post(EXTRACT_URL, { files: [png] }), refused.d, refused.venue);
    expect(r1.status).toBe(422);
    expect(await errorOf(r1)).toMatchObject({ code: "refused" });
    const thrown = await aiDeps(new Error("down"));
    const r2 = await handleExtract(post(EXTRACT_URL, { files: [png] }), thrown.d, thrown.venue);
    expect(r2.status).toBe(502);
    expect(await errorOf(r2)).toMatchObject({ code: "ai_error" });
    const prose = await aiDeps({ stop_reason: "end_turn", content: [{ type: "text", text: "No menu here." }] });
    expect((await handleExtract(post(EXTRACT_URL, { files: [png] }), prose.d, prose.venue)).status).toBe(502);
  });

  it("answers 400 on a bad body or bad files without calling the model", async () => {
    const { d, venue, calls } = await aiDeps(toolUse("extract_menu", MENU));
    const status = async (req: Request) => (await handleExtract(req, d, venue)).status;
    expect(await status(post(EXTRACT_URL, "{"))).toBe(400);
    expect(await status(post(EXTRACT_URL, {}))).toBe(400);
    expect(await status(post(EXTRACT_URL, { files: [{ media_type: "text/plain", data: "QUJD" }] }))).toBe(400);
    expect(await status(post(EXTRACT_URL, { files: [{ media_type: "image/png", data: `data:image/png;base64,${PNG_1x1}` }] }))).toBe(400);
    const none = await handleExtract(post(EXTRACT_URL, { files: [] }), d, venue);
    expect(await errorOf(none)).toMatchObject({ code: "bad_request", en: "Upload at least one file." });
    const seven = await handleExtract(post(EXTRACT_URL, { files: Array(7).fill(png) }), d, venue);
    expect(seven.status).toBe(400);
    expect(await errorOf(seven)).toMatchObject({ code: "bad_request", en: "Up to 6 files at a time." });
    expect(calls).toHaveLength(0);
  });

  it("applies the 4 MB wizard limit to the decoded files together (R25), and to a declared body length before reading it", async () => {
    const { d, venue, calls } = await aiDeps(toolUse("extract_menu", MENU));
    expect(EXTRACT_MAX_TOTAL_BYTES).toBe(4 * 1024 * 1024);
    // Each image is under the helper's 5 MB per-file limit; together they are over 4 MB.
    const half = { media_type: "image/jpeg", data: b64Of(2 * 1024 * 1024 + 3) };
    const tooBig = await handleExtract(post(EXTRACT_URL, { files: [half, half] }), d, venue);
    expect(tooBig.status).toBe(400);
    expect(await errorOf(tooBig)).toMatchObject({ code: "too_large", en: expect.stringContaining("4 MB") });
    // A single PDF the helper would accept (≤ 10 MB) is still over the wizard's 4 MB.
    const pdf = { media_type: "application/pdf", data: b64Of(4 * 1024 * 1024 + 3) };
    expect(await errorOf(await handleExtract(post(EXTRACT_URL, { files: [pdf] }), d, venue))).toMatchObject({ code: "too_large" });
    // Exactly 4 MB together is allowed.
    const exact = { media_type: "image/jpeg", data: b64Of(2 * 1024 * 1024) };
    const ok = await handleExtract(post(EXTRACT_URL, { files: [exact, exact] }), d, venue);
    expect(ok.status).toBe(200);
    expect(calls).toHaveLength(1);
    // A declared content-length far over the limit is refused before the body is read.
    const declared = await handleExtract(new Request(EXTRACT_URL, { method: "POST", headers: { "content-length": String(8 * 1024 * 1024) }, body: "x" }), d, venue);
    expect(await errorOf(declared)).toMatchObject({ code: "too_large" });
    expect(calls).toHaveLength(1);
  });

  it("answers 409 already_published for a live venue (the cookie outlives the wizard) without calling the model", async () => {
    const { d, calls } = await aiDeps(toolUse("extract_menu", MENU));
    const { venue: live } = await makeDemo(); // the seeded demo venue is live
    const res = await handleExtract(post(EXTRACT_URL, { files: [png] }), d, live);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: "already_published" });
    expect(calls).toHaveLength(0);
  });
});

describe("handleTexts", () => {
  it("answers 503 without a client, 400 on missing/blank/too long facts, 200 with the texts", async () => {
    const off = await aiDeps(null);
    const r0 = await handleTexts(post(TEXTS_URL, { facts: "Кафене" }), off.d, off.venue);
    expect(r0.status).toBe(503);
    expect(await errorOf(r0)).toMatchObject({ code: "ai_unavailable" });

    const { d, venue, calls } = await aiDeps(toolUse("draft_texts", TEXTS));
    const status = async (body: unknown) => (await handleTexts(post(TEXTS_URL, body), d, venue)).status;
    expect(await status("{")).toBe(400);
    expect(await status({})).toBe(400);
    expect(await status({ facts: 42 })).toBe(400);
    expect(await status({ facts: "   " })).toBe(400);
    expect(await status({ facts: "x".repeat(2001) })).toBe(400);
    expect(calls).toHaveLength(0);
    const good = await handleTexts(post(TEXTS_URL, { facts: "Кафене в Лозенец, кучета добре дошли" }), d, venue);
    expect(good.status).toBe(200);
    expect(good.headers.get("cache-control")).toBe("no-store");
    expect(await good.json()).toEqual(TEXTS);
    const msg = (calls[0].messages as { content: { text: string }[] }[])[0].content[0].text;
    expect(msg).toContain("Лозенец");
    expect(msg).toContain("Bulgarian"); // the draft's default language
  });

  it("uses the draft's default language", async () => {
    const { d, venue, store, calls } = await aiDeps(toolUse("draft_texts", TEXTS));
    await updateDraft(store, venue, { default_lang: "en" });
    expect((await handleTexts(post(TEXTS_URL, { facts: "Corner café" }), d, await store.getVenue(venue.id))).status).toBe(200);
    expect((calls[0].messages as { content: { text: string }[] }[])[0].content[0].text).toContain("English");
  });

  it("answers 422 refused and 502 ai_error", async () => {
    const refused = await aiDeps({ stop_reason: "refusal", content: [] });
    const r1 = await handleTexts(post(TEXTS_URL, { facts: "f" }), refused.d, refused.venue);
    expect(r1.status).toBe(422);
    expect(await errorOf(r1)).toMatchObject({ code: "refused" });
    const failed = await aiDeps(new Error("down"));
    const r2 = await handleTexts(post(TEXTS_URL, { facts: "f" }), failed.d, failed.venue);
    expect(r2.status).toBe(502);
    expect(await errorOf(r2)).toMatchObject({ code: "ai_error" });
    const blank = await aiDeps(toolUse("draft_texts", { ...TEXTS, about_en: " " }));
    expect((await handleTexts(post(TEXTS_URL, { facts: "f" }), blank.d, blank.venue)).status).toBe(502);
  });

  it("answers 409 for a live venue", async () => {
    const { d, calls } = await aiDeps(toolUse("draft_texts", TEXTS));
    const { venue: live } = await makeDemo();
    expect((await handleTexts(post(TEXTS_URL, { facts: "f" }), d, live)).status).toBe(409);
    expect(calls).toHaveLength(0);
  });
});

// The route files themselves: the draft cookie guard, then the handler with ServerDeps.anthropic and config.agentModel.
describe("POST /api/new/[id]/extract and /texts (routes)", () => {
  const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
  afterEach(() => {
    g.__siteManagerDeps = undefined;
  });

  async function serve(client: Anthropic | undefined) {
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory" }, log: () => {}, client });
    g.__siteManagerDeps = Promise.resolve(deps);
    const res = await handleNewDraft(post("https://site.example/api/new", { template: "lumen" }), { store: deps.store, config: deps.config, now: () => new Date() });
    const value = cookieFromHeader((res.headers.get("set-cookie") ?? "").split(";")[0], COOKIE_NAME) ?? "";
    const { id } = (await res.json()) as { id: string };
    return { deps, id, cookie: `${COOKIE_NAME}=${value}` };
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("guards with the draft cookie (401 without it or for another id, 404 for an unknown token) before calling the model", async () => {
    const fake = fakeClient(toolUse("extract_menu", MENU));
    const { id, cookie } = await serve(fake.client);
    const url = `https://site.example/api/new/${id}/extract`;
    expect((await extractRoute(post(url, { files: [png] }), ctx(id))).status).toBe(401);
    expect((await extractRoute(post("https://site.example/api/new/other/extract", { files: [png] }, { cookie }), ctx("other"))).status).toBe(401);
    expect((await extractRoute(post(url, { files: [png] }, { cookie: `${COOKIE_NAME}=${id}.${"0".repeat(64)}` }), ctx(id))).status).toBe(404);
    expect((await textsRoute(post(`https://site.example/api/new/${id}/texts`, { facts: "f" }), ctx(id))).status).toBe(401);
    expect((await textsRoute(post(`https://site.example/api/new/${id}/texts`, { facts: "f" }, { cookie: `${COOKIE_NAME}=${id}.${"0".repeat(64)}` }), ctx(id))).status).toBe(404);
    expect(fake.calls).toHaveLength(0);
    const ok = await extractRoute(post(url, { files: [png] }, { cookie }), ctx(id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ categories: [{ items: [{ price_eur: 2.56 }] }] });
    expect(fake.calls[0].model).toBe("claude-opus-5-5"); // config.agentModel default
  });

  it("serves texts with the injected client and answers 503 when the server has no key", async () => {
    const fake = fakeClient(toolUse("draft_texts", TEXTS));
    const withKey = await serve(fake.client);
    const res = await textsRoute(post(`https://site.example/api/new/${withKey.id}/texts`, { facts: "Кафене" }, { cookie: withKey.cookie }), ctx(withKey.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TEXTS);

    const keyless = await serve(undefined);
    expect(keyless.deps.anthropic).toBeNull();
    const ex = await extractRoute(post(`https://site.example/api/new/${keyless.id}/extract`, { files: [png] }, { cookie: keyless.cookie }), ctx(keyless.id));
    expect(ex.status).toBe(503);
    const tx = await textsRoute(post(`https://site.example/api/new/${keyless.id}/texts`, { facts: "f" }, { cookie: keyless.cookie }), ctx(keyless.id));
    expect(await errorOf(tx)).toMatchObject({ code: "ai_unavailable" });
  });
});
