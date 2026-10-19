// test/inbound.test.ts
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { appendMemory } from "@/src/agent/memory";
import { PHOTO_NO_CAPTION } from "@/src/agent/prompt";
import { createBot, telegramLang, type BotDeps, type RunRequest } from "@/src/bot/bot";
import { followLanguage, handleInbound, normalizeCommand } from "@/src/bot/inbound";
import { makeLangClassifier } from "@/src/bot/lang-classify";
import { makeTranscriber } from "@/src/bot/voice";
import { planChanges } from "@/src/domain/changes";
import type { InMemoryStore } from "@/src/store/memory";
import { FakeMessenger, makeDemo } from "./helpers";
import { BOT_INFO, textUpdate } from "./tg";

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
    expect(messenger.raw.at(-1)).toMatch(/^Вече сте свързани с ⟦Кафене „Ъгъла“⟧\. /); // the venue's name stays as written in any language
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:803", role: "staff", lang: "bg" });
    await handleInbound(d, { chatRef: "fb:803", kind: "text", text: "" });
    expect(messenger.raw.at(-1)).toMatch(/^Свързахте се като персонал на ⟦Кафене „Ъгъла“⟧\. /);
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
    expect(messenger.raw[1]).toMatch(/^Свързахте се като персонал на ⟦Кафене „Ъгъла“⟧\. /);
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
  it("links an own-site venue's own site without a /menu path, plus the dashboard for the owner", async () => {
    const { d, messenger, store, venue } = await setup();
    await store.updateVenue(venue.id, { site_mode: "own", site_url: "https://coffique.vercel.app" });
    const key = await store.getAdminToken(venue.id);
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/menu" });
    expect(texts(messenger).at(-1)).toBe(`Сайтът: https://coffique.vercel.app\nQR код и табло: https://site.example/admin/agala?key=${key}`);
    await handleInbound(d, { chatRef: "tg:1002", kind: "text", text: "/menu" });
    expect(texts(messenger).at(-1)).toBe("Site: https://coffique.vercel.app");
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:901", role: "staff", lang: "bg" });
    await handleInbound(d, { chatRef: "fb:901", kind: "text", text: "меню" });
    expect(texts(messenger).at(-1)).toBe("Сайтът: https://coffique.vercel.app");
  });
  it("sends the dashboard link instead of the key link once the venue has an owner account (/menu and welcome-back)", async () => {
    const { d, messenger, store, venue } = await setup();
    const key = await store.getAdminToken(venue.id);
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/menu" });
    expect(texts(messenger).at(-1)).toContain(`https://site.example/admin/agala?key=${key}`);
    await store.linkVenueUser(venue.id, crypto.randomUUID(), "owner");
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/menu" });
    expect(texts(messenger).at(-1)).toContain("QR код и табло: https://site.example/dashboard/agala");
    expect(texts(messenger).at(-1)).not.toContain(key);
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:810", role: "owner", lang: "bg" });
    await handleInbound(d, { chatRef: "fb:810", kind: "text", text: "" });
    expect(texts(messenger).at(-1)).toBe("Вече сте свързани с Кафене „Ъгъла“. Табло: https://site.example/dashboard/agala");
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
  it("holds a photo sent without a caption: no agent run, one question, and an album asks only once", async () => {
    const { d, runs, messenger, store, venue } = await setup();
    const photo = { download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg", name: "a.jpg" }) };
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", media: photo });
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "  ", media: photo });
    expect(runs).toHaveLength(0);
    expect(texts(messenger)).toEqual(["📷 Получих снимката. Какво да направя с нея? Напишете или изпратете гласово съобщение."]);
    expect((await store.getSite(venue.id)).media).toHaveLength(2);
    const conv = await store.getConversation(venue.id, "tg:1001");
    expect(conv?.turns[0].media_ids).toHaveLength(2);
    expect(conv?.turns[0].waiting).toBe(true);
  });
  it("starts a turn at once for a photo without a caption that follows a fresh agent reply; album siblings join it silently", async () => {
    const { d, runs, messenger, store, venue } = await setup();
    const ago = new Date(T0.getTime() - 5 * 60_000);
    await appendMemory(store, venue.id, "tg:1001", { at: ago.toISOString(), owner: "смени водата на 1.50 и прати стори само в инстаграм", agent: "Изпратете ми снимката и ще я подготвя за стори само в Instagram." }, ago);
    const photo = { download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg", name: "a.jpg" }) };
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", messageRef: "77", media: photo });
    const [media] = (await store.getSite(venue.id)).media;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ source: "photo", text: PHOTO_NO_CAPTION, image: { media_type: "image/jpeg", data: Buffer.from([9, 9]).toString("base64") }, mediaId: media.id, replyTo: "77" });
    expect(texts(messenger)).toEqual([]); // no "what should I do with it?": the agent answers
    // A second photo of the same album arrives while that turn runs: it waits with the first, no second turn, no message.
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", media: photo });
    expect(runs).toHaveLength(1);
    expect(texts(messenger)).toEqual([]);
    expect((await store.getConversation(venue.id, "tg:1001"))?.turns.at(-1)).toMatchObject({ waiting: true, media_ids: [media.id, expect.any(String)] });
  });
  it("holds a photo without a caption as before when the agent's last reply is stale or missing", async () => {
    const photo = { download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg", name: "a.jpg" }) };
    const ask = "📷 Получих снимката. Какво да направя с нея? Напишете или изпратете гласово съобщение.";
    // 20 minutes ago: still in memory (30 min), but too old to be what the photo answers.
    const stale = await setup();
    const old = new Date(T0.getTime() - 20 * 60_000);
    await appendMemory(stale.store, stale.venue.id, "tg:1001", { at: old.toISOString(), owner: "прати стори", agent: "Изпратете ми снимката." }, old);
    await handleInbound(stale.d, { chatRef: "tg:1001", kind: "photo", media: photo });
    expect(stale.runs).toHaveLength(0);
    expect(texts(stale.messenger)).toEqual([ask]);
    // The last turn made a proposal and said nothing.
    const silent = await setup();
    await appendMemory(silent.store, silent.venue.id, "tg:1001", { at: T0.toISOString(), owner: "капучиното е 3,20", agent: "(no reply)", outcome: "proposed: Капучино 3,20 €" }, T0);
    await handleInbound(silent.d, { chatRef: "tg:1001", kind: "photo", media: photo });
    expect(silent.runs).toHaveLength(0);
    expect(texts(silent.messenger)).toEqual([ask]);
  });
  it("transcribes voice with the media's content type", async () => {
    const seen: string[] = [];
    const { d, runs, messenger } = await setup({ transcribe: async (_b, _s, ct) => { seen.push(ct ?? ""); return { text: "Капучиното става три и двайсет", lang: "bg" }; } });
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", messageRef: "wamid.7", media: { download: async () => ({ bytes: new Uint8Array([1]), contentType: "audio/mp4" }) } });
    expect(seen).toEqual(["audio/mp4"]);
    expect(runs[0]).toMatchObject({ source: "voice", text: "Капучиното става три и двайсет", replyTo: "wamid.7" });
    expect(texts(messenger)[0]).toBe("🎤 Чух: „Капучиното става три и двайсет“");
    expect(messenger.raw[0]).toBe("🎤 Чух: „⟦Капучиното става три и двайсет⟧“"); // the owner's words stay as heard in any language
  });
  it("guesses the voice type from the file name when the download's content type is uninformative", async () => {
    const seen: string[] = [];
    const { d } = await setup({ transcribe: async (_b, _s, ct) => { seen.push(ct ?? ""); return { text: "x", lang: null }; } });
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

describe("handleInbound: own-site venues", () => {
  it("welcomes the owner with the venue's own site, says it is connected and managed, and never announces publishing", async () => {
    const joined: string[] = [];
    const { d, messenger, store, venue } = await setup({ onOwnerJoined: (id) => joined.push(id) });
    await store.updateVenue(venue.id, { site_mode: "own", site_url: "https://coffique.vercel.app" });
    const bg = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "fb:950", kind: "text", text: bg });
    const [welcomeBg, ownBg, ...restBg] = texts(messenger);
    expect(welcomeBg).toMatch(/^Свързахте се като собственик/);
    expect(welcomeBg).toContain("Сайт: https://coffique.vercel.app\n");
    expect(welcomeBg).not.toContain("https://site.example/agala\n");
    expect(ownBg).toBe("Сайтът ви https://coffique.vercel.app е свързан и аз го поддържам: промените, които одобрите тук, се появяват на него.");
    expect(restBg).toEqual([]); // no "your site is being published"
    expect(joined).toEqual([venue.id]); // startDeploy is still called and skips the own site itself

    messenger.sent.length = 0;
    const en = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "tg:951", kind: "text", text: `/start ${en}`, langHint: "en" });
    const [welcomeEn, ownEn, ...restEn] = texts(messenger);
    expect(welcomeEn).toMatch(/^You are linked as the owner/);
    expect(welcomeEn).toContain("Site: https://coffique.vercel.app\n");
    expect(ownEn).toBe("Your site https://coffique.vercel.app is connected and I manage it: the changes you approve here appear on it.");
    expect(restEn).toEqual([]);
  });

  it("gives staff the venue's own site too", async () => {
    const { d, messenger, store, venue } = await setup();
    await store.updateVenue(venue.id, { site_mode: "own", site_url: "https://coffique.vercel.app" });
    const code = await store.createInvite(venue.id, "staff", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "fb:952", kind: "text", text: code });
    expect(texts(messenger).at(-1)).toMatch(/Сайт: https:\/\/coffique\.vercel\.app$/);
  });
});

describe("handleInbound: WordPress /connect and venue switching on Meta channels", () => {
  it("runs /connect from WhatsApp and Messenger with the whole argument (url and code)", async () => {
    const calls: unknown[] = [];
    const { d, messenger, store, venue } = await setup({
      connect: async (venueId, siteUrl, code) => {
        calls.push([venueId, siteUrl, code]);
        return { ok: true, site: { name: "Smoke Café" } as never, destination: { config: { site_mode: "own", site_url: "https://cafe.example" } } as never };
      },
    });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359888123456", role: "owner", lang: "bg" });
    await handleInbound(d, { chatRef: "wa:359888123456", kind: "text", text: "/connect https://cafe.example/ GOOD" });
    expect(calls).toEqual([[venue.id, "https://cafe.example/", "GOOD"]]);
    expect(texts(messenger).at(-1)).toMatch(/^✅ Свързах WordPress сайта „Smoke Café“/);
    expect(messenger.raw.at(-1)).toMatch(/^✅ Свързах WordPress сайта „⟦Smoke Café⟧“ \(https:\/\/cafe\.example\)\. /); // the site's name, kept
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:900", role: "staff", lang: "en" });
    await handleInbound(d, { chatRef: "fb:900", kind: "text", text: "/connect https://cafe.example GOOD" });
    expect(texts(messenger).at(-1)).toBe("Only the owner can connect the site.");
    await handleInbound(d, { chatRef: "fb:901", kind: "text", text: "/connect https://cafe.example GOOD" });
    expect(texts(messenger).at(-1)).toBe("This bot manages one venue's website. Send the code you received from us.");
    expect(calls).toHaveLength(1);
  });
  it("moves a linked Messenger owner to another venue with a new code, announces the switch and calls onOwnerJoined", async () => {
    const joined: string[] = [];
    const { d, messenger, store, venue } = await setup({ onOwnerJoined: (id) => joined.push(id) });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:902", role: "owner", lang: "bg" });
    const other = await store.createVenue({ slug: "bar-nosht", name: "Бар Нощ" });
    const code = await store.createInvite(other.id, "owner", "2026-10-10T00:00:00.000Z");
    // Reopening m.me/<page>?ref=<code> in an existing thread: a referral event with no text.
    await handleInbound(d, { chatRef: "fb:902", kind: "text", text: "", referralCode: code });
    expect(texts(messenger)[0]).toBe("Вече управлявате Бар Нощ.");
    expect(texts(messenger)[1]).toMatch(/^Свързахте се като собственик на Бар Нощ/);
    expect(messenger.raw.slice(0, 2).map((t) => t.split("\n")[0])).toEqual(["Вече управлявате ⟦Бар Нощ⟧.", "Свързахте се като собственик на ⟦Бар Нощ⟧."]);
    expect(joined).toEqual([other.id]);
    expect(await store.findMember("fb:902")).toMatchObject({ venue_id: other.id, role: "owner" });
  });
  it("keeps an owner an owner when they redeem a staff code for their own venue", async () => {
    const { d, store, venue } = await setup();
    const code = await store.createInvite(venue.id, "staff", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: `/start ${code}` });
    expect(await store.findMember("tg:1001")).toMatchObject({ venue_id: venue.id, role: "owner" });
  });
});

describe("handleInbound: /members and removed members", () => {
  it("shows an owner who has access and which codes are still open, in the owner's language, without whole codes", async () => {
    const { d, messenger, runs, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359888123456", role: "staff", lang: "bg" });
    const staffCode = await store.createInvite(venue.id, "staff", "2026-10-12T00:00:00.000Z");
    const used = await store.createInvite(venue.id, "owner", "2026-10-14T00:00:00.000Z");
    await store.redeemInvite(used, "fb:910", "en", T0.toISOString());
    await store.createInvite(venue.id, "owner", "2026-10-01T00:00:00.000Z"); // expired: not shown
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/members" });
    const bg = texts(messenger).at(-1) as string;
    const lines = bg.split("\n");
    expect(lines[0]).toBe("Достъп до Кафене „Ъгъла“:");
    expect(messenger.raw.at(-1)?.split("\n")[0]).toBe("Достъп до ⟦Кафене „Ъгъла“⟧:");
    expect(lines[1]).toMatch(/^• Собственик \(вие\) · Telegram 1001 · BG · последно писал 09\.10\.2026, 12:00 · добавен \d\d\.\d\d\.\d{4}, \d\d:\d\d$/);
    expect(lines[2]).toMatch(/^• Персонал · Telegram 1002 · EN · още не е писал · добавен /);
    expect(lines[3]).toMatch(/^• Персонал · WhatsApp …3456 · BG · още не е писал · добавен /);
    expect(lines[4]).toMatch(/^• Собственик · Messenger 910 · EN · /);
    expect(bg).toContain("Неизползвани кодове:\n• Персонал · валиден до 12.10.2026, 03:00");
    expect(bg).not.toContain("359888123456");
    expect(bg).not.toContain(staffCode);
    expect(bg).not.toContain(used);
    expect(lines.at(-1)).toMatch(/премахва/);
    expect(runs).toHaveLength(0);

    await store.setMemberLang(venue.id, "tg:1001", "en");
    await store.cancelInvites(venue.id);
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/members@site_manager_bot" });
    const en = texts(messenger).at(-1) as string;
    expect(en.split("\n")[0]).toBe("Who has access to Кафене „Ъгъла“:");
    expect(en.split("\n")[1]).toMatch(/^• Owner \(you\) · Telegram 1001 · EN · last message 9 Oct 2026, 12:00 · joined /);
    expect(en).toContain("No unused codes.");
  });

  it("works on Meta channels too, refuses staff, and answers a stranger like any known command", async () => {
    const { d, messenger, runs, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "ig:920", role: "owner", lang: "en" });
    await handleInbound(d, { chatRef: "ig:920", kind: "text", text: "/members" });
    expect(texts(messenger).at(-1)).toMatch(/^Who has access to/);
    await handleInbound(d, { chatRef: "tg:1002", kind: "text", text: "/members" });
    expect(texts(messenger).at(-1)).toBe("Only the owner can see who has access.");
    await handleInbound(d, { chatRef: "fb:921", kind: "text", text: "/members" });
    expect(texts(messenger).at(-1)).toBe("This bot manages one venue's website. Send the code you received from us.");
    expect(runs).toHaveLength(0);
  });

  it("treats a removed member as a stranger: no agent run, the no-access answer, and old proposals cannot be applied", async () => {
    const { d, messenger, runs, store, venue, items } = await setup();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1002", summary_bg: "", summary_en: "", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Espresso.id, price_eur: 9 }], { newId: () => "n", now: T0.toISOString() }) });
    expect(await store.removeMember(venue.id, "tg:1002")).toBe(true);
    await handleInbound(d, { chatRef: "tg:1002", kind: "text", text: "Espresso is 9 now", langHint: "en" });
    expect(texts(messenger).at(-1)).toBe("This bot manages one venue's website. Send /start <code> with the code you received from us.");
    await handleInbound(d, { chatRef: "tg:1002", kind: "button", text: `cs:apply:${cs.id}`, messageRef: "55" });
    expect((await store.getChangeSet(cs.id)).status).toBe("proposed");
    expect(runs).toHaveLength(0);
    // A stranger gets the very same answer.
    await handleInbound(d, { chatRef: "tg:1999", kind: "text", text: "Espresso is 9 now", langHint: "en" });
    expect(texts(messenger).at(-1)).toBe(texts(messenger).at(-2));
  });
});

/** Records every setMemberLang call ("chat=lang") and still saves. */
function langSaves(store: InMemoryStore) {
  const saves: string[] = [];
  const save = store.setMemberLang.bind(store);
  store.setMemberLang = async (venueId, chatRef, lang) => {
    saves.push(`${chatRef}=${lang}`);
    return save(venueId, chatRef, lang);
  };
  return saves;
}
const langOf = async (store: InMemoryStore, chatRef: string) => (await store.findMember(chatRef))?.lang;

describe("handleInbound: the owner's last language is remembered", () => {
  const photo = { download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg", name: "a.jpg" }) };

  it("a Bulgarian message saves bg for a member stored as en, and the run already has it", async () => {
    const { d, runs, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359111", role: "owner", lang: "en" });
    await handleInbound(d, { chatRef: "wa:359111", kind: "text", text: "Капучиното е 4,20" });
    expect(await langOf(store, "wa:359111")).toBe("bg");
    expect(runs[0].member.lang).toBe("bg");
    // Each member has a language of their own: nobody else switched.
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(await langOf(store, "tg:1002")).toBe("en");
  });

  it("an English message saves en for a member stored as bg, and the run already has it", async () => {
    const { d, runs, store } = await setup();
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "change the price to 4.20" });
    expect(await langOf(store, "tg:1001")).toBe("en");
    expect(runs[0].member.lang).toBe("en");
  });

  it("a price or an uncaptioned photo changes nothing, nor does a dish name or Bulgarian typed in Latin letters", async () => {
    const { d, runs, messenger, store } = await setup();
    const saves = langSaves(store);
    for (const text of ["4.20", "Flat white 4.30", "ok 👍", "kafeto e 4.20"]) {
      await handleInbound(d, { chatRef: "tg:1001", kind: "text", text }); // stored bg
      await handleInbound(d, { chatRef: "tg:1002", kind: "text", text }); // stored en
    }
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", media: photo });
    expect(saves).toEqual([]);
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(await langOf(store, "tg:1002")).toBe("en");
    expect(runs.map((r) => `${r.chatRef}=${r.member.lang}`)).toEqual(["tg:1001=bg", "tg:1002=en", "tg:1001=bg", "tg:1002=en", "tg:1001=bg", "tg:1002=en", "tg:1001=bg", "tg:1002=en"]);
    expect(texts(messenger)).toEqual(["📷 Получих снимката. Какво да направя с нея? Напишете или изпратете гласово съобщение."]); // the photo is held, in the stored language
  });

  it("a voice note the transcriber heard in Bulgarian saves bg and one heard in English saves en, and the heard line follows", async () => {
    let said: { text: string; lang: string | null } = { text: "капучиното вече е четири и двайсет", lang: "bg" };
    const { d, runs, messenger, store, venue } = await setup({ transcribe: async () => said });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359111", role: "owner", lang: "en" });
    const voice = { download: async () => ({ bytes: new Uint8Array([1]), contentType: "audio/mp4" }) };
    await handleInbound(d, { chatRef: "wa:359111", kind: "voice", media: voice });
    expect(await langOf(store, "wa:359111")).toBe("bg");
    expect(runs[0]).toMatchObject({ source: "voice", text: "капучиното вече е четири и двайсет" });
    expect(runs[0].member.lang).toBe("bg");
    expect(texts(messenger).at(-1)).toBe("🎤 Чух: „капучиното вече е четири и двайсет“");
    said = { text: "please make the price 4.20", lang: "en" };
    await handleInbound(d, { chatRef: "wa:359111", kind: "voice", media: voice });
    expect(await langOf(store, "wa:359111")).toBe("en");
    expect(runs[1].member.lang).toBe("en");
    expect(texts(messenger).at(-1)).toBe("🎤 Heard: “please make the price 4.20”");
  });

  it("a voice note the transcriber reports no language for keeps the stored one", async () => {
    let said = "4.20";
    const { d, runs, store } = await setup({ transcribe: async () => ({ text: said, lang: null }) });
    const saves = langSaves(store);
    const voice = { download: async () => ({ bytes: new Uint8Array([1]), contentType: "audio/ogg" }) };
    await handleInbound(d, { chatRef: "tg:1002", kind: "voice", media: voice });
    said = "www.my-open-cafe.bg";
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: voice });
    expect(saves).toEqual([]);
    expect(runs.map((r) => `${r.chatRef}=${r.member.lang}`)).toEqual(["tg:1002=en", "tg:1001=bg"]);
  });

  it("a photo caption saves its language like a message", async () => {
    const { d, runs, store } = await setup();
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "make it a story please", media: photo });
    expect(await langOf(store, "tg:1001")).toBe("en");
    expect(runs[0]).toMatchObject({ source: "photo", text: "make it a story please" });
    expect(runs[0].member.lang).toBe("en");
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "новата корица", media: photo });
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(runs[1].member.lang).toBe("bg");
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "Flat white 4.30", media: photo });
    expect(await langOf(store, "tg:1001")).toBe("bg"); // a caption that shows no language leaves it
    expect(runs[2].member.lang).toBe("bg");
  });

  it("a failed photo download is reported in the language of the caption, which is saved", async () => {
    const { d, runs, messenger, store } = await setup();
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "please add this to the menu", media: { download: async () => { throw new Error("download failed (HTTP 500)"); } } });
    expect(texts(messenger)).toEqual(["I couldn't download the photo. Please try again."]);
    expect(await langOf(store, "tg:1001")).toBe("en");
    expect(runs).toHaveLength(0);
  });

  it("a link is not the owner's language: the words inside it never switch it", async () => {
    const { d, runs, store } = await setup();
    const saves = langSaves(store);
    for (const text of ["https://my-open-cafe.bg/menu", "www.my-open-cafe.bg", "HTTPS://MY-OPEN-CAFE.BG/the-menu"]) await handleInbound(d, { chatRef: "tg:1001", kind: "text", text });
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "https://my-open-cafe.bg/menu", media: photo });
    await handleInbound(d, { chatRef: "tg:1002", kind: "text", text: "https://кафе.bg/меню" }); // nor does a Cyrillic address make an English speaker Bulgarian
    expect(saves).toEqual([]);
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(await langOf(store, "tg:1002")).toBe("en");
    expect(runs.map((r) => r.member.lang)).toEqual(["bg", "bg", "bg", "bg", "en"]);
  });

  it("the words around a link still show the language", async () => {
    const { d, runs, store } = await setup();
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "please change the price on https://my-open-cafe.bg/menu" });
    expect(await langOf(store, "tg:1001")).toBe("en");
    expect(runs[0].member.lang).toBe("en");
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "виж www.my-open-cafe.bg" });
    expect(await langOf(store, "tg:1001")).toBe("bg");
  });

  it("answers a stranger who sends only a link in the default language, and one who writes English in English", async () => {
    const { d, messenger } = await setup();
    await handleInbound(d, { chatRef: "fb:700", kind: "text", text: "https://my-open-cafe.bg/menu" });
    expect(texts(messenger).at(-1)).toBe("Този бот управлява сайта на конкретно заведение. Изпратете кода, който получихте от нас.");
    await handleInbound(d, { chatRef: "fb:700", kind: "text", text: "hello, my cafe is on https://my-open-cafe.bg/menu" });
    expect(texts(messenger).at(-1)).toBe("This bot manages one venue's website. Send the code you received from us.");
  });

  it("/connect carries a link and a code, not a language: it saves nothing and answers in the stored language", async () => {
    const { d, messenger, store } = await setup({
      connect: async () => ({ ok: true, site: { name: "My Open Café" } as never, destination: { config: { site_url: "https://my-open-cafe.bg" } } as never }),
    });
    const saves = langSaves(store);
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/connect https://my-open-cafe.bg ABCD1234" });
    expect(saves).toEqual([]);
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(texts(messenger).at(-1)).toMatch(/^✅ Свързах WordPress сайта „My Open Café“/); // not English because of "my" and "open" in the address
    await handleInbound(d, { chatRef: "tg:1002", kind: "text", text: "/connect https://кафе.bg/меню ABCD1234" });
    expect(saves).toEqual([]);
    expect(await langOf(store, "tg:1002")).toBe("en"); // staff: refused, in their own language
    expect(texts(messenger).at(-1)).toBe("Only the owner can connect the site.");
  });

  it("/lang still sets the language, and the next message that shows the other one switches it again", async () => {
    const { d, messenger, runs, store } = await setup();
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/lang en" });
    expect(await langOf(store, "tg:1001")).toBe("en");
    expect(texts(messenger).at(-1)).toBe("Language set to English.");
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "Капучиното е 4,20" });
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(runs[0].member.lang).toBe("bg");
  });

  it("still starts the run, in the language just written, when saving the language fails", async () => {
    const { d, runs, store } = await setup();
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
    try {
      store.setMemberLang = async () => { throw new Error("db down"); };
      await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "change the price to 4.20" });
    } finally { console.error = orig; }
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: "change the price to 4.20" });
    expect(runs[0].member.lang).toBe("en");
    expect(errs.some((e) => e.includes("db down"))).toBe(true);
  });
});

describe("followLanguage", () => {
  it("returns the very same member, without touching the store, when nothing is detected or the language is the same", async () => {
    const { d, store } = await setup();
    const member = (await store.findMember("tg:1001"))!; // bg
    let calls = 0;
    store.setMemberLang = async () => { calls++; };
    expect(await followLanguage(d, member, null)).toBe(member);
    expect(await followLanguage(d, member, "bg")).toBe(member);
    expect(calls).toBe(0);
  });

  it("saves a different language and returns the member with it, leaving the one it was given alone", async () => {
    const { d, store } = await setup();
    const member = (await store.findMember("tg:1001"))!;
    const next = await followLanguage(d, member, "en");
    expect(next).toEqual({ ...member, lang: "en" });
    expect(member.lang).toBe("bg");
    expect((await store.findMember("tg:1001"))?.lang).toBe("en");
    expect((await followLanguage(d, next, "bg")).lang).toBe("bg");
    expect((await store.findMember("tg:1001"))?.lang).toBe("bg");
  });

  it("does not lose the message when the save fails: it logs and returns the member with the language just written", async () => {
    const { d, store } = await setup();
    const member = (await store.findMember("tg:1001"))!;
    store.setMemberLang = async () => { throw new Error("db down"); };
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
    let next: Awaited<ReturnType<typeof followLanguage>>;
    try {
      next = await followLanguage(d, member, "en");
    } finally { console.error = orig; }
    expect(next).toEqual({ ...member, lang: "en" });
    expect(errs.some((e) => e.includes("db down") && e.includes("tg:"))).toBe(true);
  });
});

describe("handleInbound: any conversation language", () => {
  const photo = { download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg", name: "a.jpg" }) };
  const voice = { download: async () => ({ bytes: new Uint8Array([1]), contentType: "audio/ogg" }) };
  /** A language classifier that answers `answer` (or throws it) and records what it was asked. */
  function classifier(answer: string | null | Error) {
    const asked: string[] = [];
    const classifyLang = async (text: string) => {
      asked.push(text);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { asked, classifyLang };
  }
  /** The real transcriber over a Whisper-style client that answers in turn and records its requests: the language it reports is the one the label and the letters give. */
  function whisper(...answers: { text: string; language?: string; segments?: { no_speech_prob?: number }[] }[]) {
    const asked: Record<string, unknown>[] = [];
    const client = { audio: { transcriptions: { create: async (p: Record<string, unknown>) => { asked.push(p); return answers[Math.min(asked.length, answers.length) - 1]; } } } };
    return { asked, transcribe: makeTranscriber({ apiKey: "k", baseUrl: "https://stt.example/v1", model: "whisper-large-v3" }, () => client as never) };
  }

  it("member bg; Ich möchte den Preis ändern with a classifier returning de → saved de, and the run has it", async () => {
    const { asked, classifyLang } = classifier("de");
    const { d, runs, store } = await setup({ classifyLang });
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "Ich möchte den Preis ändern" });
    expect(asked).toEqual(["Ich möchte den Preis ändern"]);
    expect(await langOf(store, "tg:1001")).toBe("de");
    expect(runs[0].member.lang).toBe("de");
  });

  it("Flat white 4.30 → classifier not called; nor for a price, up to three Latin words, a bare link, or a message with other letters", async () => {
    const { asked, classifyLang } = classifier("de");
    const { d, runs, store } = await setup({ classifyLang });
    for (const text of ["Flat white 4.30", "4.20", "kafeto e 4.20", "Neue Preise heute", "https://my-open-cafe.bg/menu/today/specials"]) await handleInbound(d, { chatRef: "tg:1001", kind: "text", text });
    expect(await langOf(store, "tg:1001")).toBe("bg");
    // Up to three Latin words go by the English words alone; a message with other letters goes by its letters.
    for (const [text, lang] of [["please change it", "en"], ["Это кофе", "ru"], ["please change the price of Капучино to 4.20", "en"], ["Ο καφές είναι 4,20", "el"], ["Капучиното е 4,20", "bg"]]) {
      await handleInbound(d, { chatRef: "tg:1001", kind: "text", text });
      expect(await langOf(store, "tg:1001")).toBe(lang);
    }
    expect(asked).toEqual([]);
    expect(runs.map((r) => r.member.lang)).toEqual(["bg", "bg", "bg", "bg", "bg", "en", "ru", "en", "el", "bg"]);
  });

  it("the classifier decides Latin text of four words or more, even what the English words would call English", async () => {
    const cases: [string, string, string][] = [
      ["Ich will den Preis in der Karte ändern", "de", "de"], // "will" and "in" alone would say English
      ["We zijn morgen open", "nl", "nl"],
      ["change the price to 4.20", "en", "en"],
    ];
    for (const [text, answer, saved] of cases) {
      const { asked, classifyLang } = classifier(answer);
      const { d, runs, store } = await setup({ classifyLang });
      await handleInbound(d, { chatRef: "tg:1001", kind: "text", text }); // stored bg
      expect(asked).toEqual([text]);
      expect(await langOf(store, "tg:1001")).toBe(saved);
      expect(runs[0].member.lang).toBe(saved);
    }
  });

  it("without an answer from the classifier (unknown, a failure) the English words decide", async () => {
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
    try {
      for (const answer of [null, new Error("timeout")]) {
        const { asked, classifyLang } = classifier(answer);
        const { d, runs, store } = await setup({ classifyLang });
        await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "change the price to 4.20" }); // stored bg
        expect(asked).toHaveLength(1);
        expect(await langOf(store, "tg:1001")).toBe("en");
        expect(runs[0].member.lang).toBe("en");
      }
    } finally { console.error = orig; }
  });

  it("Cyrillic without a marker letter keeps a Russian, Ukrainian, Belarusian, Macedonian or Serbian speaker's language", async () => {
    const { d, store, venue } = await setup();
    const saves = langSaves(store);
    for (const [ref, lang] of [["wa:3591", "ru"], ["wa:3592", "uk"], ["wa:3593", "be"], ["wa:3594", "mk"], ["wa:3595", "sr"]]) {
      await store.upsertMember({ venue_id: venue.id, chat_ref: ref, role: "owner", lang });
      await handleInbound(d, { chatRef: ref, kind: "text", text: "Добавь пиццу" });
      expect(await langOf(store, ref)).toBe(lang);
    }
    expect(saves).toEqual([]);
    await handleInbound(d, { chatRef: "wa:3595", kind: "text", text: "Ђе је кафа" }); // a Serbian marker: still Serbian
    expect(await langOf(store, "wa:3595")).toBe("sr");
    await handleInbound(d, { chatRef: "wa:3591", kind: "text", text: "Ще піду" }); // a Ukrainian marker switches a Russian speaker
    expect(await langOf(store, "wa:3591")).toBe("uk");
    await handleInbound(d, { chatRef: "tg:1002", kind: "text", text: "Капучиното е 4,20" }); // stored en: Bulgarian as before
    expect(await langOf(store, "tg:1002")).toBe("bg");
    expect(saves).toEqual(["wa:3591=uk", "tg:1002=bg"]);
  });

  it("a voice note and a photo caption in Cyrillic without a marker letter keep a Russian speaker's language too", async () => {
    const { asked, transcribe } = whisper({ language: "russian", text: "добавь пиццу в меню" });
    const { d, runs, messenger, store, venue } = await setup({ transcribe });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:3596", role: "owner", lang: "ru" });
    const saves = langSaves(store);
    await handleInbound(d, { chatRef: "wa:3596", kind: "voice", media: voice });
    expect(asked).toHaveLength(1); // Whisper heard Russian, the letters do not argue, the speaker is stored as Russian: no second pass as Bulgarian
    expect(runs[0]).toMatchObject({ source: "voice", text: "добавь пиццу в меню" });
    expect(runs[0].member.lang).toBe("ru");
    expect(texts(messenger).at(-1)).toBe("🎤 Heard: “добавь пиццу в меню”"); // Russian has no hand-written texts: English for now
    await handleInbound(d, { chatRef: "wa:3596", kind: "photo", text: "новое фото для меню", media: photo });
    expect(runs[1].member.lang).toBe("ru");
    expect(saves).toEqual([]);
  });

  it("a voice note the transcriber heard in German keeps the stored language: only typed words switch to a language other than bg/en", async () => {
    const { d, runs, messenger, store } = await setup({ transcribe: async () => ({ text: "Ich möchte den Preis ändern", lang: "de" }) });
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: voice }); // stored bg
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(runs[0]).toMatchObject({ source: "voice", text: "Ich möchte den Preis ändern" });
    expect(runs[0].member.lang).toBe("bg");
    expect(texts(messenger).at(-1)).toBe("🎤 Чух: „Ich möchte den Preis ändern“");
  });

  it("over background music Whisper's invented intros never switch the language (seen live 2026-10-17)", async () => {
    for (const [text, lang] of [["Hello everyone, welcome to my channel.", "jv"], ["안녕하세요. 오늘은 한국에서 가장 유명한", "ko"]] as const) {
      const { d, store } = await setup({ transcribe: async () => ({ text, lang }) });
      const saves = langSaves(store);
      await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: voice }); // stored bg
      expect(saves, text).toEqual([]);
    }
  });

  it("a three-word Bulgarian question brings an owner back to Bulgarian; two words do not", async () => {
    for (const [text, saved] of [["Колко струва капучиното?", true], ["Да, добре", false]] as const) {
      const { d, store, venue } = await setup({ transcribe: async () => ({ text, lang: "bg" }) });
      await store.upsertMember({ venue_id: venue.id, chat_ref: "tg:8990", role: "owner", lang: "ko" });
      const saves = langSaves(store);
      await handleInbound(d, { chatRef: "tg:8990", kind: "voice", media: voice });
      expect(saves, text).toEqual(saved ? ["tg:8990=bg"] : []);
    }
  });

  it("the transcriber is told the member's stored language itself, not its Bulgarian or English reduction", async () => {
    const seen: string[] = [];
    const { d, store, venue } = await setup({ transcribe: async (_b, stored) => { seen.push(stored); return { text: "x", lang: null }; } });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:491511", role: "owner", lang: "de" });
    for (const chatRef of ["wa:491511", "tg:1001", "tg:1002"]) await handleInbound(d, { chatRef, kind: "voice", media: voice });
    expect(seen).toEqual(["de", "bg", "en"]);
  });

  it("a voice note Whisper labels Russian but whose words have no Russian-only letter is Bulgarian: transcribed again, saved bg", async () => {
    const { asked, transcribe } = whisper({ language: "russian", text: "кафето е готово за гостите" }, { language: "bulgarian", text: "Кафето е готово за гостите." });
    const { d, runs, messenger, store, venue } = await setup({ transcribe });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359333", role: "owner", lang: "en" });
    await handleInbound(d, { chatRef: "wa:359333", kind: "voice", media: voice });
    expect(asked.map((a) => a.language)).toEqual([undefined, "bg"]);
    expect(await langOf(store, "wa:359333")).toBe("bg");
    expect(runs[0]).toMatchObject({ source: "voice", text: "Кафето е готово за гостите." }); // the second transcript, not the Russian-mode one
    expect(runs[0].member.lang).toBe("bg");
    expect(texts(messenger).at(-1)).toBe("🎤 Чух: „Кафето е готово за гостите.“");
  });

  it("a bg or en member is never moved into Russian by a note Whisper decoded in Russian mode, ы and all", async () => {
    for (const [chatRef, saved] of [["tg:1001", []], ["tg:1002", ["tg:1002=bg"]]] as const) {
      const { asked, transcribe } = whisper({ language: "russian", text: "Вы можете забрать кофе сегодня" }, { language: "bulgarian", text: "Можете да вземете кафето днес" });
      const { d, runs, messenger, store } = await setup({ transcribe });
      const saves = langSaves(store);
      await handleInbound(d, { chatRef, kind: "voice", media: voice }); // tg:1001 is stored bg, tg:1002 en
      expect(asked.map((a) => a.language), chatRef).toEqual([undefined, "bg"]);
      expect(runs[0], chatRef).toMatchObject({ source: "voice", text: "Можете да вземете кафето днес" });
      expect(runs[0].member.lang, chatRef).toBe("bg");
      expect(await langOf(store, chatRef)).toBe("bg");
      expect(saves, chatRef).toEqual(saved);
      expect(texts(messenger).at(-1), chatRef).toBe("🎤 Чух: „Можете да вземете кафето днес“");
    }
  });

  describe("a voice note switches the language only when its transcript has at least four words", () => {
    /** One voice note from `chatRef` that the transcriber reports as `text` in `lang`, with every language save recorded. */
    async function note(chatRef: string, text: string, lang: string) {
      const s = await setup({ transcribe: async () => ({ text, lang }) });
      const saves = langSaves(s.store);
      await handleInbound(s.d, { chatRef, kind: "voice", media: voice });
      return { ...s, saves };
    }

    it("a bg member's Thank you. (what Whisper invents on a silent clip) saves nothing, and the run and the heard line stay Bulgarian", async () => {
      const { runs, messenger, store, saves } = await note("tg:1001", "Thank you.", "en");
      expect(saves).toEqual([]);
      expect(await langOf(store, "tg:1001")).toBe("bg");
      expect(runs[0]).toMatchObject({ source: "voice", text: "Thank you." });
      expect(runs[0].member.lang).toBe("bg");
      expect(texts(messenger).at(-1)).toBe("🎤 Чух: „Thank you.“");
    });

    it("an en member's Продолжение следует heard as Bulgarian saves nothing, and the run and the heard line stay English", async () => {
      const { runs, messenger, store, saves } = await note("tg:1002", "Продолжение следует", "bg");
      expect(saves).toEqual([]);
      expect(await langOf(store, "tg:1002")).toBe("en");
      expect(runs[0].member.lang).toBe("en");
      expect(texts(messenger).at(-1)).toBe("🎤 Heard: “Продолжение следует”");
    });

    it("a bg member's make it a story please (more than four words) heard as English saves en", async () => {
      const { runs, messenger, store, saves } = await note("tg:1001", "make it a story please", "en");
      expect(saves).toEqual(["tg:1001=en"]);
      expect(await langOf(store, "tg:1001")).toBe("en");
      expect(runs[0].member.lang).toBe("en");
      expect(texts(messenger).at(-1)).toBe("🎤 Heard: “make it a story please”");
    });

    it("the limit is four words in any script; numbers and emoji are not words", async () => {
      const cases: [string, string, boolean][] = [
        ["make it story", "en", false], // three
        ["make it a story", "en", true], // four
        ["Ich möchte Preis", "de", false],
        ["Ich möchte den Preis", "de", false], // not bg/en: typed words only,
        ["Добавь пиццу сегодня", "ru", false],
        ["Добавь пиццу в меню", "ru", false],
        ["Ο καφές είναι έτοιμος", "el", false],
        ["make it a 4.20 😀", "en", false], // three words and two things that are not
        // Scripts written without spaces: a real sentence is many words, a thank-you is one.
        ["我想把卡布奇诺的价格改成四欧元", "zh", false],
        ["谢谢", "zh", false],
        ["カプチーノの値段を四ユーロに変更してください", "ja", false],
        ["ありがとう", "ja", false],
        ["ฉันต้องการเปลี่ยนราคากาแฟเป็นสี่ยูโร", "th", false],
        ["ขอบคุณ", "th", false],
      ];
      for (const [text, lang, saved] of cases) {
        const { saves } = await note("tg:1001", text, lang);
        expect(saves, text).toEqual(saved ? [`tg:1001=${lang}`] : []);
      }
    });
  });

  it("a transcriber that fails is the usual voice-failed line, in the stored language, and changes no language", async () => {
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
    try {
      const { d, runs, messenger, store } = await setup({ transcribe: async () => { throw new Error("HTTP 500"); } });
      const saves = langSaves(store);
      await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: voice });
      await handleInbound(d, { chatRef: "tg:1002", kind: "voice", media: voice });
      expect(texts(messenger)).toEqual(["Не успях да разпозная записа. Опитайте отново или го напишете.", "I couldn't transcribe that. Try again or type it."]);
      expect(runs).toHaveLength(0);
      expect(saves).toEqual([]);
    } finally { console.error = orig; }
    expect(errs).toEqual(["[bot] voice failed: HTTP 500", "[bot] voice failed: HTTP 500"]);
  });

  it("a voice note that comes back empty is the usual voice-failed line and changes no language", async () => {
    const { d, runs, messenger, store } = await setup({ transcribe: async () => ({ text: "  ", lang: "de" }) });
    const saves = langSaves(store);
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: voice });
    expect(texts(messenger)).toEqual(["Не успях да разпозная записа. Опитайте отново или го напишете."]);
    expect(runs).toHaveLength(0);
    expect(saves).toEqual([]);
  });

  it("a silent clip Whisper labels Russian is the usual voice-failed line after one request, and changes no language", async () => {
    const { asked, transcribe } = whisper({ language: "russian", text: "" });
    const { d, runs, messenger, store } = await setup({ transcribe });
    const saves = langSaves(store);
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: voice }); // stored bg: no second request in Bulgarian to invent words
    expect(asked).toHaveLength(1);
    expect(texts(messenger)).toEqual(["Не успях да разпозная записа. Опитайте отново или го напишете."]);
    expect(runs).toHaveLength(0);
    expect(saves).toEqual([]);
  });

  it("a silent clip Whisper fills with a stock phrase (here Japanese thanks for watching) is the usual voice-failed line: no run, no language saved", async () => {
    const { asked, transcribe } = whisper({ language: "japanese", text: "ご視聴ありがとうございました", segments: [{ no_speech_prob: 0.95 }] });
    const { d, runs, messenger, store } = await setup({ transcribe });
    const saves = langSaves(store);
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: voice }); // stored bg
    } finally { console.log = orig; }
    expect(asked).toHaveLength(1);
    expect(texts(messenger)).toEqual(["Не успях да разпозная записа. Опитайте отново или го напишете."]);
    expect(runs).toHaveLength(0); // nothing reaches the agent as an instruction
    expect(saves).toEqual([]);
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(logs.join("\n")).not.toContain("視聴");
  });

  describe("marker-less Cyrillic of four words or more from a member who is not stored as bg goes to the classifier", () => {
    const BULGARIAN = "Капучиното става три и двайсет"; // five words, no letter Russian lacks
    const RUSSIAN = "Добавь пиццу в меню сегодня"; // five words, no Russian-only letter
    /** A member stored in `lang`, with every language save recorded. */
    async function member(lang: string, answer: string | null | Error) {
      const { asked, classifyLang } = classifier(answer);
      const s = await setup({ classifyLang });
      await s.store.upsertMember({ venue_id: s.venue.id, chat_ref: "wa:3601", role: "owner", lang });
      return { ...s, asked, saves: langSaves(s.store) };
    }

    it("(a) ru member, Bulgarian, classifier bg: saved bg", async () => {
      const { d, runs, store, asked, saves } = await member("ru", "bg");
      await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: BULGARIAN });
      expect(asked).toEqual([BULGARIAN]);
      expect(saves).toEqual(["wa:3601=bg"]);
      expect(await langOf(store, "wa:3601")).toBe("bg");
      expect(runs[0].member.lang).toBe("bg");
    });

    it("(b) ru member, classifier ru: no save", async () => {
      const { d, runs, asked, saves } = await member("ru", "ru");
      await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: RUSSIAN });
      expect(asked).toEqual([RUSSIAN]);
      expect(saves).toEqual([]);
      expect(runs[0].member.lang).toBe("ru");
    });

    it("(c) ru member, classifier unknown or a throw: no save", async () => {
      const errs: string[] = [];
      const orig = console.error;
      console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
      try {
        for (const answer of [null, new Error("timeout")]) {
          const { d, runs, asked, saves } = await member("ru", answer);
          await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: BULGARIAN });
          expect(asked).toHaveLength(1);
          expect(saves).toEqual([]);
          expect(runs[0].member.lang).toBe("ru");
        }
      } finally { console.error = orig; }
      expect(errs.join("\n")).not.toContain("Капучиното");
    });

    it("(d) en member, marker-less Cyrillic, classifier ru: saved ru", async () => {
      const { d, store, asked, saves } = await member("en", "ru");
      await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: RUSSIAN });
      expect(asked).toEqual([RUSSIAN]);
      expect(saves).toEqual(["wa:3601=ru"]);
      expect(await langOf(store, "wa:3601")).toBe("ru");
    });

    it("(d) en member without an answer from the classifier: Bulgarian, as before", async () => {
      const { d, store, saves } = await member("en", null);
      await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: RUSSIAN });
      expect(saves).toEqual(["wa:3601=bg"]);
      expect(await langOf(store, "wa:3601")).toBe("bg");
    });

    it("(e) bg member, marker-less Cyrillic: the classifier is never called", async () => {
      const { d, runs, asked, saves } = await member("bg", "ru");
      for (const text of [BULGARIAN, RUSSIAN]) await handleInbound(d, { chatRef: "wa:3601", kind: "text", text });
      await handleInbound(d, { chatRef: "wa:3601", kind: "photo", text: RUSSIAN, media: photo });
      expect(asked).toEqual([]);
      expect(saves).toEqual([]);
      expect(runs.map((r) => r.member.lang)).toEqual(["bg", "bg", "bg"]);
    });

    it("(f) ru member, three words of marker-less Cyrillic: no call, no save", async () => {
      const { d, runs, asked, saves } = await member("ru", "bg");
      await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: "Баницата свърши днес" });
      expect(asked).toEqual([]);
      expect(saves).toEqual([]);
      expect(runs[0].member.lang).toBe("ru");
    });

    it("(g) a ru member's text with a Russian marker letter: no call", async () => {
      const { d, runs, asked, saves } = await member("ru", "bg");
      await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: "Мы открыты сегодня до десяти" });
      expect(asked).toEqual([]);
      expect(saves).toEqual([]);
      expect(runs[0].member.lang).toBe("ru");
    });

    it("counts words of any script: mixed Cyrillic and Latin without English words goes too; English that wins does not", async () => {
      const { d, store, venue, asked } = await member("ru", "bg");
      await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: "Flat white свърши днес" });
      expect(asked).toEqual(["Flat white свърши днес"]);
      expect(await langOf(store, "wa:3601")).toBe("bg");
      await store.setMemberLang(venue.id, "wa:3601", "ru");
      await handleInbound(d, { chatRef: "wa:3601", kind: "text", text: "please change the price of Капучино to 4.20" });
      expect(asked).toHaveLength(1); // English won by its words: no call
      expect(await langOf(store, "wa:3601")).toBe("en");
    });
  });

  // The 300-character cap is the classifier's own (src/bot/lang-classify.ts), so every caller gets it: inbound hands over the whole text.
  it("a 1,000-character text reaches the client as 300 characters", async () => {
    const sent: string[] = [];
    const client = { beta: { messages: { create: async (p: { messages: { content: { text: string }[] }[] }) => (sent.push(p.messages[0].content[0].text), { stop_reason: "end_turn", content: [{ type: "text", text: "de" }] }) } } } as unknown as Anthropic;
    const { d, store } = await setup({ classifyLang: makeLangClassifier(client, "claude-haiku-5-5") });
    const long = "Wir haben heute frischen Apfelstrudel und warmen Kakao im Angebot. ".repeat(20).slice(0, 1000);
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: long });
    expect(sent).toEqual([long.slice(0, 300)]);
    expect(sent[0]).toHaveLength(300);
    expect(await langOf(store, "tg:1001")).toBe("de");
  });

  it("asks the classifier about the words around a link, never the link", async () => {
    const { asked, classifyLang } = classifier("de");
    const { d, store } = await setup({ classifyLang });
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "Neue Preise auf https://my-open-cafe.bg/menu ab heute" });
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain("my-open-cafe");
    expect(asked[0]).toMatch(/Neue Preise auf\s+ab heute/);
    expect(await langOf(store, "tg:1001")).toBe("de");
  });

  it("a 4+ word Latin-typed Bulgarian message the classifier calls bg keeps a Bulgarian speaker and sets bg for anyone else", async () => {
    const { asked, classifyLang } = classifier("bg");
    const { d, runs, store } = await setup({ classifyLang });
    const saves = langSaves(store);
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "pusni post i story v instagram dnes" }); // stored bg
    await handleInbound(d, { chatRef: "tg:1002", kind: "text", text: "pusni post i story v instagram dnes" }); // stored en
    expect(asked).toEqual(["pusni post i story v instagram dnes", "pusni post i story v instagram dnes"]);
    expect(saves).toEqual(["tg:1002=bg"]);
    expect(runs.map((r) => r.member.lang)).toEqual(["bg", "bg"]);
  });

  it("Bulgarian typed in Latin letters stays Bulgarian when the classifier says bg", async () => {
    const { asked, classifyLang } = classifier("bg");
    const { d, runs, store } = await setup({ classifyLang });
    const saves = langSaves(store);
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "kafeto e gotovo i banicata svarshi" });
    expect(asked).toHaveLength(1);
    expect(saves).toEqual([]);
    expect(runs[0].member.lang).toBe("bg");
  });

  it("a classifier that knows nothing or fails keeps the stored language and never loses the message", async () => {
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
    try {
      for (const answer of [null, new Error("Ich möchte den Preis ändern: model down")]) {
        const { classifyLang } = classifier(answer);
        const { d, runs, store } = await setup({ classifyLang });
        const saves = langSaves(store);
        await handleInbound(d, { chatRef: "tg:1002", kind: "text", text: "Ich möchte den Preis ändern" }); // stored en
        expect(saves).toEqual([]);
        expect(runs).toHaveLength(1);
        expect(runs[0].member.lang).toBe("en");
      }
    } finally { console.error = orig; }
    expect(errs.join("\n")).not.toContain("möchte"); // a failure is logged without the owner's words
  });

  it("a photo caption goes to the classifier like a message", async () => {
    const { asked, classifyLang } = classifier("de");
    const { d, runs, store } = await setup({ classifyLang });
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "Das ist das neue Titelbild", media: photo });
    expect(asked).toEqual(["Das ist das neue Titelbild"]);
    expect(await langOf(store, "tg:1001")).toBe("de");
    expect(runs[0]).toMatchObject({ source: "photo", text: "Das ist das neue Titelbild" });
    expect(runs[0].member.lang).toBe("de");
  });

  it("a voice transcript, a stranger's message and /connect never go to the classifier", async () => {
    const { asked, classifyLang } = classifier("de");
    const { d, messenger, store } = await setup({ classifyLang, transcribe: async () => ({ text: "Ich möchte den Preis ändern", lang: null }) });
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: voice });
    await handleInbound(d, { chatRef: "fb:7770", kind: "text", text: "Ich möchte den Preis ändern" });
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/connect https://mein-cafe.example Ich bin der Besitzer" });
    expect(asked).toEqual([]);
    expect(await langOf(store, "tg:1001")).toBe("bg");
    expect(texts(messenger)).toContain("This bot manages one venue's website. Send the code you received from us.");
  });

  it("a member stored in a language without hand-written texts gets them in English for now", async () => {
    const { d, messenger, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:491511", role: "owner", lang: "de" });
    await handleInbound(d, { chatRef: "wa:491511", kind: "photo", media: photo });
    expect(texts(messenger).at(-1)).toBe("📷 Got the photo. What should I do with it? Type it or send a voice note.");
    await handleInbound(d, { chatRef: "wa:491511", kind: "text", text: "help" });
    expect(texts(messenger).at(-1)).toMatch(/^Tell me what to change/);
    expect(await langOf(store, "wa:491511")).toBe("de"); // "help" is one word: it shows no language
  });

  it("a member stored en sends помощ on WhatsApp → saved bg and the help reply is Bulgarian", async () => {
    const { asked, classifyLang } = classifier("de");
    const { d, messenger, runs, store, venue } = await setup({ classifyLang });
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359222", role: "owner", lang: "en" });
    await handleInbound(d, { chatRef: "wa:359222", kind: "text", text: "помощ" });
    expect(await langOf(store, "wa:359222")).toBe("bg");
    expect(texts(messenger).at(-1)).toMatch(/^Пишете какво искате да промените/);
    expect(texts(messenger).at(-1)).toContain("Думи-команди");
    // "help" and "menu" are one word each: no language shown, nothing asked of the classifier.
    await handleInbound(d, { chatRef: "wa:359222", kind: "text", text: "help" });
    await handleInbound(d, { chatRef: "wa:359222", kind: "text", text: "Menu" });
    expect(await langOf(store, "wa:359222")).toBe("bg");
    expect(texts(messenger).at(-2)).toMatch(/^Пишете какво искате да промените/);
    expect(texts(messenger).at(-1)).toMatch(/^Сайтът: https:\/\/site\.example\/agala\nМеню: /);
    expect(asked).toEqual([]);
    expect(runs).toHaveLength(0);
  });

  it("a language command word sets the language it names, and only that one", async () => {
    const { d, messenger, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359223", role: "owner", lang: "en" });
    const saves = langSaves(store);
    await handleInbound(d, { chatRef: "wa:359223", kind: "text", text: "език en" }); // a Bulgarian word, but it names English
    expect(saves).toEqual(["wa:359223=en"]);
    expect(texts(messenger).at(-1)).toBe("Language set to English.");
  });

  it("a Meta stranger is answered by the letters they write, never the classifier, and links in that language", async () => {
    const { asked, classifyLang } = classifier("de");
    const { d, messenger, store, venue } = await setup({ classifyLang });
    await handleInbound(d, { chatRef: "fb:8800", kind: "text", text: "Это наше кафе?" });
    expect(texts(messenger).at(-1)).toBe("This bot manages one venue's website. Send the code you received from us."); // Russian has no hand-written texts
    await handleInbound(d, { chatRef: "fb:8800", kind: "text", text: "Здравейте" });
    expect(texts(messenger).at(-1)).toBe("Този бот управлява сайта на конкретно заведение. Изпратете кода, който получихте от нас.");
    const code = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "fb:8800", kind: "text", text: "Это наше кафе", referralCode: code });
    expect(await store.findMember("fb:8800")).toMatchObject({ role: "owner", lang: "ru" });
    expect(texts(messenger).at(-1)).toMatch(/^You are linked as the owner/);
    expect(asked).toEqual([]);
  });

  it("followLanguage saves any language code", async () => {
    const { d, store } = await setup();
    const member = (await store.findMember("tg:1001"))!;
    expect(await followLanguage(d, member, "de")).toEqual({ ...member, lang: "de" });
    expect(await langOf(store, "tg:1001")).toBe("de");
  });
});

describe("Telegram's language_code", () => {
  it("telegramLang keeps the code's two-letter language, lower case; English when it has none", () => {
    expect(telegramLang("pt-BR")).toBe("pt");
    expect(telegramLang("pt-br")).toBe("pt");
    expect(telegramLang("zh-hans")).toBe("zh");
    expect(telegramLang("EN")).toBe("en");
    expect(telegramLang("bg")).toBe("bg");
    for (const none of [undefined, "", "  ", "x", "fil"]) expect(telegramLang(none)).toBe("en"); // "fil" (Filipino) has no two-letter code: not "fi"
  });

  it("telegramLang takes only a known language: an unknown two-letter code is English", () => {
    expect(telegramLang("xx")).toBe("en");
    expect(telegramLang("xx-YY")).toBe("en");
    expect(telegramLang("de")).toBe("de");
  });

  it("a forwarded message does not switch the language: no save, the run uses the stored one", async () => {
    const { d, runs, store } = await setup({ botInfo: BOT_INFO });
    const bot = createBot(d);
    const update = textUpdate(1001, "Please change the price of the cappuccino", "bg"); // member 1001 is stored bg
    (update.message as unknown as Record<string, unknown>).forward_origin = { type: "hidden_user", date: 0, sender_user_name: "Someone" };
    await bot.handleUpdate(update);
    expect(runs).toHaveLength(1);
    expect(runs[0].member.lang).toBe("bg");
    expect(runs[0].text).toBe("Please change the price of the cappuccino");
    expect(await langOf(store, "tg:1001")).toBe("bg");
    await bot.handleUpdate(textUpdate(1001, "Please change the price of the cappuccino", "bg")); // the same words typed by the owner switch it
    expect(await langOf(store, "tg:1001")).toBe("en");
  });

  it("linking with Telegram language_code pt-BR → member lang pt, welcomed in English for now", async () => {
    const { d, messenger, store, venue } = await setup({ botInfo: BOT_INFO });
    const bot = createBot(d);
    const code = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(4000, `/start ${code}`, "pt-BR"));
    expect(await store.findMember("tg:4000")).toMatchObject({ role: "owner", lang: "pt" });
    expect(texts(messenger)[0]).toMatch(/^You are linked as the owner/);
    await bot.handleUpdate(textUpdate(4001, "/start", "ru"));
    expect(texts(messenger)[1]).toBe("This bot manages one venue's website. Send /start <code> with the code you received from us.");
  });
});
