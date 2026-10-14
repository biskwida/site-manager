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

  it("concludes by editing the proposal to the full text and removing the buttons", async () => {
    const { api, messenger } = setup();
    await messenger.conclude("tg:1001", "42", "preview\n\n✅ Applied", "✅ Applied");
    expect(api.calls).toEqual([{ method: "editMessageText", payload: expect.objectContaining({ chat_id: 1001, message_id: 42, text: "preview\n\n✅ Applied", reply_markup: { inline_keyboard: [] } }) }]);
  });

  it("concludes without a message ref by sending the short line", async () => {
    const { api, messenger } = setup();
    await messenger.conclude("tg:1001", null, "preview\n\n✅ Applied", "✅ Applied");
    expect(api.calls).toEqual([{ method: "sendMessage", payload: expect.objectContaining({ chat_id: 1001, text: "✅ Applied" }) }]);
  });

  it("edits and removes a plain status message", async () => {
    const { api, messenger } = setup();
    await messenger.edit("tg:1001", "42", "📖 Чета менюто…");
    await messenger.remove("tg:1001", "42");
    expect(api.calls).toEqual([
      { method: "editMessageText", payload: expect.objectContaining({ chat_id: 1001, message_id: 42, text: "📖 Чета менюто…" }) },
      { method: "deleteMessage", payload: expect.objectContaining({ chat_id: 1001, message_id: 42 }) },
    ]);
  });

  it("shows typing with a chat action", async () => {
    const { api, messenger } = setup();
    await messenger.typing("tg:1001");
    expect(api.calls).toEqual([{ method: "sendChatAction", payload: expect.objectContaining({ chat_id: 1001, action: "typing" }) }]);
  });

  it("never sends a non-Telegram ref to Telegram: logs, returns null, makes no API call", async () => {
    const { api, messenger } = setup();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await messenger.send("fb:123", "x")).toBeNull();
    expect(await messenger.sendProposal("wa:359888123456", "x", "set-1", "bg")).toBeNull();
    await expect(messenger.conclude("ig:178414", "7", "full", "short")).resolves.toBeUndefined();
    await expect(messenger.conclude("fb:123", null, "full", "short")).resolves.toBeUndefined();
    await expect(messenger.typing("fb:123")).resolves.toBeUndefined();
    expect(api.calls).toEqual([]);
    expect(err).toHaveBeenCalledTimes(5);
    expect(String(err.mock.calls[0][1])).toBe("not a Telegram ref: fb");
  });
  it("sends a photo by URL with a caption", async () => {
    const { api, messenger } = setup();
    expect(await messenger.sendPhoto("tg:1001", "https://cdn.example/p.jpg", "Флат уайт")).toBe("500");
    expect(api.calls).toEqual([{ method: "sendPhoto", payload: expect.objectContaining({ chat_id: 1001, photo: "https://cdn.example/p.jpg", caption: "Флат уайт" }) }]);
  });
});
