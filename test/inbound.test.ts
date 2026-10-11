// test/inbound.test.ts
import { describe, expect, it } from "vitest";
import type { BotDeps, RunRequest } from "@/src/bot/bot";
import { handleInbound, normalizeCommand } from "@/src/bot/inbound";
import { planChanges } from "@/src/domain/changes";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");
async function setup(over: Partial<BotDeps> = {}) {
  const demo = await makeDemo();
  const runs: RunRequest[] = [];
  const messenger = new FakeMessenger();
  const d: BotDeps = { token: "t", store: demo.store, messenger, baseUrl: "https://site.example", now: () => T0, startRun: (r) => runs.push(r), transcribe: null, download: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }), ...over };
  return { ...demo, runs, messenger, d };
}
const texts = (m: FakeMessenger) => m.sent.map((s) => s.text);

describe("normalizeCommand", () => {
  it("maps plain words to slash commands in both languages on Meta channels", () => {
    expect(normalizeCommand("меню", "fb")).toBe("/menu");
    expect(normalizeCommand("Menu", "wa")).toBe("/menu");
    expect(normalizeCommand("помощ", "ig")).toBe("/help");
    expect(normalizeCommand("language en", "fb")).toBe("/lang en");
    expect(normalizeCommand("език bg", "fb")).toBe("/lang bg");
    expect(normalizeCommand("/undo", "fb")).toBe("/undo");
    expect(normalizeCommand("Капучиното става 3,20", "fb")).toBeNull();
  });
  it("has no word for undo, and leaves plain words alone on Telegram", () => {
    for (const w of ["отмени", "отмяна", "undo"]) expect(normalizeCommand(w, "fb")).toBeNull();
    expect(normalizeCommand("меню", "tg")).toBeNull();
    expect(normalizeCommand("language en", "tg")).toBeNull();
    expect(normalizeCommand("/menu", "tg")).toBe("/menu");
  });
});

describe("handleInbound: opening the chat again", () => {
  it("answers an empty open-chat event: no-access for a stranger, welcome-back for a member, never an agent run", async () => {
    const { d, messenger, runs, store, venue } = await setup();
    await handleInbound(d, { chatRef: "fb:800", kind: "text", text: "" });
    expect(texts(messenger).at(-1)).toBe("Този бот управлява сайта на конкретно заведение. Изпратете кода, който получихте от нас.");
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:801", role: "owner", lang: "bg" });
    await handleInbound(d, { chatRef: "fb:801", kind: "text", text: "" });
    expect(texts(messenger).at(-1)).toMatch(/^Вече сте свързани/);
    expect(runs).toHaveLength(0);
  });
  it("sends a linked member's text to the agent even when the message carries the deep-link referral", async () => {
    const { d, messenger, runs, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "ig:802", role: "owner", lang: "bg" });
    await handleInbound(d, { chatRef: "ig:802", kind: "text", text: "Капучиното става 3,20", referralCode: "OLDCODE12" });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ chatRef: "ig:802", text: "Капучиното става 3,20", source: "text" });
    expect(texts(messenger).some((t) => /Вече сте свързани/.test(t))).toBe(false);
  });
});

describe("handleInbound", () => {
  it("links a Messenger user with a bare code and tells a stranger to send the code (no /start wording)", async () => {
    const { d, messenger, store, venue } = await setup();
    await handleInbound(d, { chatRef: "fb:500", kind: "text", text: "hello" });
    expect(texts(messenger)[0]).toBe("This bot manages one venue's website. Send the code you received from us.");
    await handleInbound(d, { chatRef: "fb:500", kind: "text", text: "Здравей" });
    expect(texts(messenger)[1]).toBe("Този бот управлява сайта на конкретно заведение. Изпратете кода, който получихте от нас.");
    const code = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "fb:500", kind: "text", text: ` ${code.toLowerCase()} ` });
    expect(texts(messenger)[2]).toMatch(/^Свързахте се като собственик/);
    expect(await store.findMember("fb:500")).toMatchObject({ role: "owner", lang: "bg", last_seen_at: T0.toISOString() });
  });
  it("links through a referral code and keeps Telegram's /start wording", async () => {
    const { d, messenger, store, venue } = await setup();
    await handleInbound(d, { chatRef: "tg:600", kind: "text", text: "/start", langHint: "en" });
    expect(texts(messenger)[0]).toMatch(/Send \/start <code>/);
    const code = await store.createInvite(venue.id, "staff", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "ig:700", kind: "text", text: "", referralCode: code });
    expect(texts(messenger)[1]).toMatch(/^Свързахте се като персонал/);
    expect(await store.findMember("ig:700")).toMatchObject({ role: "staff" });
  });
  it("keeps Telegram's command edges: unknown commands stay silent, known ones tell a stranger to link, /start@bot works", async () => {
    const { d, messenger, store, venue } = await setup();
    await handleInbound(d, { chatRef: "tg:800", kind: "text", text: "/foo", langHint: "en" });
    expect(texts(messenger)).toEqual([]);
    await handleInbound(d, { chatRef: "tg:800", kind: "text", text: "/help", langHint: "en" });
    expect(texts(messenger)[0]).toMatch(/Send \/start <code>/);
    const code = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "tg:800", kind: "text", text: `/start@site_manager_bot ${code}`, langHint: "en" });
    expect(texts(messenger)[1]).toMatch(/^You are linked as the owner/);
    await handleInbound(d, { chatRef: "tg:800", kind: "text", text: "/foo" });
    expect(texts(messenger)).toHaveLength(2);
  });
  it("runs text, honours word commands on Meta channels and shows typing", async () => {
    const { d, messenger, runs, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359888", role: "owner", lang: "bg" });
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "Баницата свърши", messageRef: "wamid.1" });
    expect(runs[0]).toMatchObject({ chatRef: "wa:359888", text: "Баницата свърши", source: "text" });
    expect(messenger.typed).toEqual(["wa:359888"]);
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "language en" });
    expect(texts(messenger).at(-1)).toBe("Language set to English.");
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "menu" });
    expect(texts(messenger).at(-1)).toMatch(/^Site: https:\/\/site.example\/agala/);
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "help" });
    expect(texts(messenger).at(-1)).not.toContain("/lang");
    expect(texts(messenger).at(-1)).toContain("language bg");
    expect(texts(messenger).at(-1)).toContain("/undo");
    expect(texts(messenger).at(-1)).not.toContain("“undo” –");
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "/lang xx" });
    expect(texts(messenger).at(-1)).toBe("Write “language bg” or “language en”.");
  });
  it("sends 'отмени' from a Meta member to the agent as text, not as undo", async () => {
    const { d, runs, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:900", role: "owner", lang: "bg" });
    await handleInbound(d, { chatRef: "fb:900", kind: "text", text: "отмени" });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ chatRef: "fb:900", text: "отмени", source: "text" });
    await handleInbound(d, { chatRef: "fb:900", kind: "text", text: "/undo" });
    expect(runs[1]).toMatchObject({ text: "Undo the last change." });
  });
  it("sends 'меню' from a Telegram member to the agent; '/menu' still works on Telegram", async () => {
    const { d, messenger, runs } = await setup();
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "меню" });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ chatRef: "tg:1001", text: "меню", source: "text" });
    expect(texts(messenger)).toEqual([]);
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/menu" });
    expect(runs).toHaveLength(1);
    expect(texts(messenger).at(-1)).toMatch(/https:\/\/site.example\/agala\/menu/);
  });
  it("still starts the run when touchMember fails", async () => {
    const { d, runs } = await setup();
    const errs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
    try {
      d.store.touchMember = async () => { throw new Error("db down"); };
      await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "Баницата свърши" });
    } finally { console.error = orig; }
    expect(runs[0]).toMatchObject({ text: "Баницата свърши" });
    expect(errs.some((e) => e.includes("db down"))).toBe(true);
  });
  it("downloads a photo, stores it and starts a photo run; reports a failed download", async () => {
    const { d, runs, store, venue } = await setup();
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "новата корица", media: { download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg", name: "a.jpg" }) } });
    expect(runs[0]).toMatchObject({ source: "photo", text: "новата корица", image: { media_type: "image/jpeg" } });
    expect((await store.getSite(venue.id)).media).toHaveLength(1);
    const bad = await setup();
    await handleInbound(bad.d, { chatRef: "tg:1001", kind: "photo", media: { download: async () => { throw new Error("download failed (HTTP 500)"); } } });
    expect(texts(bad.messenger)[0]).toBe("Не успях да изтегля снимката. Опитайте отново.");
    expect(bad.runs).toHaveLength(0);
  });
  it("transcribes voice with the media's content type", async () => {
    const seen: string[] = [];
    const { d, runs, messenger } = await setup({ transcribe: async (_b, _l, ct) => { seen.push(ct ?? ""); return "Капучиното става три и двайсет"; } });
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: { download: async () => ({ bytes: new Uint8Array([1]), contentType: "audio/mp4" }) } });
    expect(seen).toEqual(["audio/mp4"]);
    expect(runs[0]).toMatchObject({ source: "voice", text: "Капучиното става три и двайсет" });
    expect(texts(messenger)[0]).toBe("🎤 Чух: „Капучиното става три и двайсет“");
  });
  it("guesses the voice type from the file name when the download's content type is uninformative", async () => {
    const seen: string[] = [];
    const { d } = await setup({ transcribe: async (_b, _l, ct) => { seen.push(ct ?? ""); return "x"; } });
    await handleInbound(d, { chatRef: "fb:1", kind: "voice", media: { download: async () => ({ bytes: new Uint8Array([1]), contentType: "application/octet-stream", name: "audioclip.mp4" }) } });
    expect(seen).toEqual([]); // fb:1 is not a member: nothing transcribed
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: { download: async () => ({ bytes: new Uint8Array([1]), contentType: "application/octet-stream", name: "audioclip.mp4" }) } });
    expect(seen).toEqual(["audio/mp4"]);
  });
  it("applies a button tap and concludes the proposal message", async () => {
    const { d, messenger, store, venue, items } = await setup();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", message_ref: "42", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
    await handleInbound(d, { chatRef: "tg:1001", kind: "button", text: `cs:apply:${cs.id}`, messageRef: "42" });
    expect(messenger.concluded[0]).toEqual({ chatRef: "tg:1001", messageRef: "42", full: "p\n\n✅ Приложено", short: "✅ Приложено", proactive: undefined });
    expect((await store.getChangeSet(cs.id)).status).toBe("applied");
  });
});
