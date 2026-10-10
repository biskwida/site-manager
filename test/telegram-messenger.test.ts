// test/telegram-messenger.test.ts
import { Bot } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramMessenger } from "@/src/bot/messenger";
import { BOT_INFO, captureApi } from "./tg";

function setup() {
  const bot = new Bot("t", { botInfo: BOT_INFO });
  return { api: captureApi(bot), messenger: new TelegramMessenger(bot.api) };
}

describe("TelegramMessenger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends to tg: refs with the numeric chat id and returns the message ref", async () => {
    const { api, messenger } = setup();
    expect(await messenger.send("tg:1001", "x")).toBe("500");
    expect(api.calls).toEqual([{ method: "sendMessage", payload: expect.objectContaining({ chat_id: 1001, text: "x" }) }]);
  });

  it("never sends a non-Telegram ref to Telegram: logs, returns null, makes no API call", async () => {
    const { api, messenger } = setup();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await messenger.send("fb:123", "x")).toBeNull();
    expect(await messenger.sendProposal("wa:359888123456", "x", "set-1", "bg")).toBeNull();
    await expect(messenger.edit("ig:178414", "7", "x")).resolves.toBeUndefined();
    expect(api.calls).toEqual([]);
    expect(err).toHaveBeenCalledTimes(3);
    expect(String(err.mock.calls[0][1])).toBe("not a Telegram ref: fb");
  });
});
