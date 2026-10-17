// test/bot-media.test.ts
import { describe, expect, it } from "vitest";
import { createBot, type BotDeps, type RunRequest } from "@/src/bot/bot";
import { TelegramMessenger } from "@/src/bot/messenger";
import { withTranslation } from "@/src/bot/translate";
import { FakeMessenger, makeDemo } from "./helpers";
import { BOT_INFO, captureApi, photoUpdate, voiceUpdate } from "./tg";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function setup(over: Partial<BotDeps> = {}) {
  const demo = await makeDemo();
  const runs: RunRequest[] = [];
  const deps: BotDeps = {
    token: "t", store: demo.store, messenger: new FakeMessenger(), baseUrl: "https://site.example", now: () => T0,
    startRun: (r) => runs.push(r), transcribe: null, download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg" }), botInfo: BOT_INFO, ...over,
  };
  const bot = createBot(deps);
  deps.messenger = withTranslation(new TelegramMessenger(bot.api), { store: demo.store, translate: null }); // as in src/server/deps.ts
  return { ...demo, runs, bot, api: captureApi(bot) };
}

describe("photos", () => {
  it("downloads the largest size, stores it and starts a photo run with the media id", async () => {
    const { bot, api, runs, store, venue } = await setup();
    await bot.handleUpdate(photoUpdate(1001, "това е новата корица"));
    expect(api.calls.find((c) => c.method === "getFile")?.payload).toEqual({ file_id: "big" });
    expect(runs[0]).toMatchObject({ source: "photo", text: "това е новата корица", image: { media_type: "image/jpeg", data: Buffer.from([9, 9]).toString("base64") } });
    const media = (await store.getSite(venue.id)).media;
    expect(media).toHaveLength(1);
    expect(runs[0].mediaId).toBe(media[0].id);
  });
  it("tells the owner when the download fails, without the URL", async () => {
    const { bot, api, runs } = await setup({ download: async () => { throw new Error("download failed (HTTP 500)"); } });
    await bot.handleUpdate(photoUpdate(1001));
    expect(runs).toHaveLength(0);
    expect(api.texts()[0]).toBe("Не успях да изтегля снимката. Опитайте отново.");
  });
});

describe("voice", () => {
  it("says voice is unavailable without a transcriber", async () => {
    const { bot, api } = await setup();
    await bot.handleUpdate(voiceUpdate(1001));
    expect(api.texts()[0]).toBe("Гласовите съобщения не са включени на този сървър. Моля, напишете го.");
  });
  it("echoes what it heard and starts a voice run", async () => {
    const { bot, api, runs } = await setup({ transcribe: async (_b, stored) => ({ text: `heard in ${stored}`, lang: null }) }); // the member's stored language, as it is
    await bot.handleUpdate(voiceUpdate(1001));
    expect(runs[0]).toMatchObject({ source: "voice", text: "heard in bg" });
    expect(api.texts()[0]).toBe("🎤 Чух: „heard in bg“");
  });
  it("runs the turn in Bulgarian when an English-speaking member speaks Bulgarian, and remembers it", async () => {
    const { bot, api, runs, store } = await setup({ transcribe: async () => ({ text: "Баницата свърши, останаха само сладките", lang: "bg" }) });
    await bot.handleUpdate(voiceUpdate(1002, "en"));
    expect(runs[0]).toMatchObject({ source: "voice", text: "Баницата свърши, останаха само сладките" });
    expect(runs[0].member.lang).toBe("bg");
    expect(api.texts()[0]).toMatch(/^🎤 Чух/);
    expect((await store.findMember("tg:1002"))?.lang).toBe("bg");
  });
});
