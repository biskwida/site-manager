// test/server-telegram.test.ts
import { describe, expect, it } from "vitest";
import { createBot, type RunRequest } from "@/src/bot/bot";
import { handleTelegramRequest } from "@/src/server/telegram";
import { FakeMessenger, makeDemo } from "./helpers";
import { BOT_INFO, captureApi, textUpdate } from "./tg";

describe("handleTelegramRequest", () => {
  it("rejects a missing or wrong secret and accepts a valid update", async () => {
    const demo = await makeDemo();
    const runs: RunRequest[] = [];
    const bot = createBot({ token: "t", store: demo.store, messenger: new FakeMessenger(), baseUrl: "http://x", now: () => new Date(), startRun: (r) => runs.push(r), transcribe: null, download: async () => ({ bytes: new Uint8Array(), contentType: "" }), botInfo: BOT_INFO });
    captureApi(bot);
    const deps = { config: { telegramWebhookSecret: "s3cret" }, bot };
    const body = JSON.stringify(textUpdate(1001, "здрасти"));
    const mk = (headers: Record<string, string>) => new Request("http://localhost/api/telegram", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    expect((await handleTelegramRequest(mk({}), deps)).status).toBe(401);
    expect((await handleTelegramRequest(mk({ "x-telegram-bot-api-secret-token": "wrong" }), deps)).status).toBe(401);
    const ok = await handleTelegramRequest(mk({ "x-telegram-bot-api-secret-token": "s3cret" }), deps);
    expect(ok.status).toBe(200);
    expect(runs).toHaveLength(1);
  });
});
