// test/bot.test.ts
import { describe, expect, it } from "vitest";
import { createBot, type BotDeps, type RunRequest } from "@/src/bot/bot";
import { TelegramMessenger } from "@/src/bot/messenger";
import { withTranslation } from "@/src/bot/translate";
import { planChanges } from "@/src/domain/changes";
import { FakeMessenger, makeDemo } from "./helpers";
import { BOT_INFO, callbackUpdate, captureApi, textUpdate } from "./tg";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function setup() {
  const demo = await makeDemo();
  const runs: RunRequest[] = [];
  const deps: BotDeps = {
    token: "t", store: demo.store, messenger: new FakeMessenger(), baseUrl: "https://site.example", now: () => T0,
    startRun: (r) => runs.push(r), transcribe: null, download: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }), botInfo: BOT_INFO,
  };
  const bot = createBot(deps);
  deps.messenger = withTranslation(new TelegramMessenger(bot.api), { store: demo.store, translate: null }); // as in src/server/deps.ts
  const api = captureApi(bot);
  return { ...demo, runs, bot, api, deps };
}

describe("bot", () => {
  it("rejects unknown chats in their language and links them with a valid code", async () => {
    const { bot, api, store, venue } = await setup();
    await bot.handleUpdate(textUpdate(2000, "/start", "en"));
    expect(api.texts()[0]).toMatch(/^This bot manages one venue/);
    await bot.handleUpdate(textUpdate(2000, "/start WRONGCOD", "en"));
    expect(api.texts()[1]).toMatch(/invalid, expired/);
    const code = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(2000, `/start ${code}`, "bg"));
    const token = await store.getAdminToken(venue.id);
    expect(api.texts()[2]).toContain(`Табло (пазете линка, той е вашият ключ): https://site.example/admin/agala?key=${token}`);
    expect(api.texts()[2]).toContain("Сайт: https://site.example/agala");
    expect(await store.findMember("tg:2000")).toMatchObject({ role: "owner", lang: "bg" });
    await bot.handleUpdate(textUpdate(2000, "hello"));
    expect(api.texts()).toHaveLength(3);
  });
  it("links a staff invite with the staff welcome and no dashboard link", async () => {
    const { bot, api, store, venue } = await setup();
    const code = await store.createInvite(venue.id, "staff", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(2001, `/start ${code}`, "en"));
    expect(api.texts()[0]).toBe("You are linked as staff of Кафене „Ъгъла“. You can mark items sold out and add today's specials.\n\nSite: https://site.example/agala");
    expect(api.texts()[0]).not.toContain("/admin/");
    expect(await store.findMember("tg:2001")).toMatchObject({ role: "staff", lang: "en" });
  });
  it("calls onOwnerJoined after an owner redeem (not staff) and announces publishing when the venue has no site yet", async () => {
    const { bot, api, store, venue, deps } = await setup();
    const joined: string[] = [];
    deps.onOwnerJoined = (id) => joined.push(id);
    const staffCode = await store.createInvite(venue.id, "staff", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(3001, `/start ${staffCode}`, "en"));
    expect(joined).toEqual([]);
    const ownerCode = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(3002, `/start ${ownerCode}`, "bg"));
    expect(joined).toEqual([venue.id]);
    expect(api.texts().at(-2)).toMatch(/^Свързахте се като собственик/);
    expect(api.texts().at(-1)).toBe("Сайтът ви се публикува. Ще ви пиша, когато е готов (обикновено до 2–3 минути).");
    await store.setDeploy(venue.id, { provider: "fake", project_id: "p", deployment_id: "d", url: "https://agala.example.test", status: "ready", error: null, template: "classic", updated_at: "2026-10-09T09:00:00.000Z" });
    const code2 = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(3003, `/start ${code2}`, "en"));
    expect(joined).toEqual([venue.id, venue.id]);
    expect(api.texts().at(-1)).toMatch(/^You are linked as the owner/); // site exists: no publishing line
    // a throwing hook never breaks the welcome
    deps.onOwnerJoined = () => {
      throw new Error("boom");
    };
    const code3 = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(3004, `/start ${code3}`, "en"));
    expect(await store.findMember("tg:3004")).toMatchObject({ role: "owner" });
    expect(api.texts().at(-1)).toMatch(/^You are linked as the owner/);
  });
  it("a linked chat can redeem a code for another venue: it moves there and the owner-join path runs", async () => {
    const { bot, api, store, venue, deps } = await setup();
    const joined: string[] = [];
    deps.onOwnerJoined = (id) => joined.push(id);
    const other = await store.createVenue({ slug: "bar", name: "Бар Нощ" });
    const code = await store.createInvite(other.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(1001, `/start ${code}`, "bg")); // 1001 is the demo venue's owner
    expect(api.texts()[0]).toBe("Вече управлявате Бар Нощ.");
    expect(api.texts()[1]).toMatch(/^Свързахте се като собственик на Бар Нощ/);
    expect(api.texts()[2]).toMatch(/^Сайтът ви се публикува/);
    expect(joined).toEqual([other.id]);
    expect(await store.findMember("tg:1001")).toMatchObject({ venue_id: other.id, role: "owner" });
    expect((await store.listMembers(venue.id)).map((m) => m.chat_ref)).not.toContain("tg:1001");
    // English
    const third = await store.createVenue({ slug: "cafe3", name: "Third" });
    await bot.handleUpdate(textUpdate(1002, `/start ${await store.createInvite(third.id, "owner", "2026-10-10T00:00:00.000Z")}`, "en"));
    expect(api.texts()[3]).toBe("You now manage Third.");
  });
  it("an owner who taps a staff code for their own venue stays owner", async () => {
    const { bot, store, venue } = await setup();
    const staffCode = await store.createInvite(venue.id, "staff", "2026-10-20T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(1001, `/start ${staffCode}`, "bg")); // 1001 is the demo venue's owner
    expect(await store.findMember("tg:1001")).toMatchObject({ venue_id: venue.id, role: "owner" });
  });

  it("a linked chat with no code or an invalid code gets the welcome-back, not the bad-code reply", async () => {
    const { bot, api, store, venue } = await setup();
    const token = await store.getAdminToken(venue.id);
    await bot.handleUpdate(textUpdate(1001, "/start", "bg"));
    await bot.handleUpdate(textUpdate(1001, "/start WRONGCOD", "bg"));
    expect(api.texts()).toEqual([
      `Вече сте свързани с Кафене „Ъгъла“. Табло: https://site.example/admin/agala?key=${token}`,
      `Вече сте свързани с Кафене „Ъгъла“. Табло: https://site.example/admin/agala?key=${token}`,
    ]);
    expect(await store.findMember("tg:1001")).toMatchObject({ venue_id: venue.id });
  });
  it("handles /lang, /help, /menu and /undo", async () => {
    const { bot, api, runs, store } = await setup();
    await bot.handleUpdate(textUpdate(1001, "/lang en"));
    expect(api.texts().at(-1)).toBe("Language set to English.");
    expect((await store.findMember("tg:1001"))?.lang).toBe("en");
    await bot.handleUpdate(textUpdate(1001, "/lang"));
    expect(api.texts().at(-1)).toBe("Use /lang bg or /lang en.");
    await bot.handleUpdate(textUpdate(1001, "/help"));
    expect(api.texts().at(-1)).toMatch(/^Tell me what to change/);
    await bot.handleUpdate(textUpdate(1001, "/menu"));
    expect(api.texts().at(-1)).toMatch(/^Site: https:\/\/site.example\/agala\nMenu: https:\/\/site.example\/agala\/menu\nQR code and dashboard: https:\/\/site.example\/admin\/agala\?key=/);
    await bot.handleUpdate(textUpdate(1001, "/undo"));
    expect(runs.at(-1)).toMatchObject({ chatRef: "tg:1001", text: "Undo the last change.", source: "text" });
  });
  it("starts a run for a member's text and shows typing", async () => {
    const { bot, api, runs, venue } = await setup();
    await bot.handleUpdate(textUpdate(1001, "Капучиното става 3,20"));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ venueId: venue.id, chatRef: "tg:1001", text: "Капучиното става 3,20", source: "text" });
    expect(runs[0].member.role).toBe("owner");
    expect(api.calls.some((c) => c.method === "sendChatAction")).toBe(true);
    expect(api.texts()).toEqual([]);
  });
  it("a Cyrillic message from an English-speaking member runs the turn in Bulgarian and is remembered", async () => {
    const { bot, runs, store } = await setup();
    await bot.handleUpdate(textUpdate(1002, "Баницата свърши"));
    expect(runs[0].member.lang).toBe("bg");
    expect((await store.findMember("tg:1002"))?.lang).toBe("bg");
  });
  it("a Latin message keeps the stored language", async () => {
    const { bot, runs } = await setup();
    await bot.handleUpdate(textUpdate(1001, "ok"));
    expect(runs[0].member.lang).toBe("bg");
  });
  it("answers the callback first, then applies and edits the message", async () => {
    const { bot, api, store, venue, items } = await setup();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "• Капучино: 2,90 € → 3,20 €", preview_en: "p", source: "text", status: "proposed", message_ref: "42", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
    await bot.handleUpdate(callbackUpdate(1001, `cs:apply:${cs.id}`, 42));
    const methods = api.calls.map((c) => c.method);
    expect(methods.indexOf("answerCallbackQuery")).toBeLessThan(methods.indexOf("editMessageText"));
    const edit = api.calls.find((c) => c.method === "editMessageText")!.payload;
    expect(edit).toMatchObject({ chat_id: 1001, message_id: 42, text: "• Капучино: 2,90 € → 3,20 €\n\n✅ Приложено" });
    expect((await store.getChangeSet(cs.id)).status).toBe("applied");
    await bot.handleUpdate(callbackUpdate(1001, `cs:apply:${cs.id}`, 42));
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits).toHaveLength(2);
    expect(edits[1].payload.text).toBe("• Капучино: 2,90 € → 3,20 €\n\nВече е приложено.");
  });
  it("sends the change prompt on ✏️", async () => {
    const { bot, api, store, venue } = await setup();
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", message_ref: "43", changes: [] });
    await bot.handleUpdate(callbackUpdate(1001, `cs:change:${cs.id}`, 43));
    expect(api.texts().at(-1)).toBe("Напишете какво да променя в предложението.");
    expect(api.calls.some((c) => c.method === "editMessageText")).toBe(false);
  });
  it("handles /connect: usage, owner-only, feature off, success and failure", async () => {
    const { bot, api, deps } = await setup();
    await bot.handleUpdate(textUpdate(1001, "/connect"));
    expect(api.texts().at(-1)).toMatch(/^Свържете сайта си на WordPress/);
    await bot.handleUpdate(textUpdate(1002, "/connect https://cafe.example ABC", "en"));
    expect(api.texts().at(-1)).toBe("Only the owner can connect the site.");
    await bot.handleUpdate(textUpdate(1001, "/connect https://cafe.example ABC"));
    expect(api.texts().at(-1)).toBe("Свързването на сайтове не е включено на този сървър.");
    const calls: unknown[] = [];
    deps.connect = async (venueId, siteUrl, code) => {
      calls.push([venueId, siteUrl, code]);
      return code === "GOOD"
        ? { ok: true, site: { name: "Smoke Café" } as never, destination: { config: { site_url: "https://cafe.example" } } as never }
        : { ok: false, reason: { bg: "Кодът е грешен.", en: "The code is wrong." } };
    };
    await bot.handleUpdate(textUpdate(1001, "/connect https://cafe.example/ GOOD"));
    expect(calls[0]).toEqual([(await deps.store.findMember("tg:1001"))!.venue_id, "https://cafe.example/", "GOOD"]);
    expect(api.texts().at(-1)).toMatch(/^✅ Свързах WordPress сайта „Smoke Café“ \(https:\/\/cafe\.example\)/);
    await bot.handleUpdate(textUpdate(1001, "/connect https://cafe.example BAD", "en"));
    expect(api.texts().at(-1)).toBe("Не успях да свържа сайта. Кодът е грешен."); // the member's language is bg; a Latin command text keeps it
  });
});
