import { describe, expect, it } from "vitest";
import { channelOf, isMetaChannel, legacyTelegramId, makeRef, maskRef, parseRef } from "@/src/channels/ref";

describe("chat_ref", () => {
  it("round-trips every channel, including negative Telegram group ids", () => {
    expect(makeRef("tg", 1001)).toBe("tg:1001");
    expect(makeRef("tg", -100123)).toBe("tg:-100123");
    expect(parseRef("tg:-100123")).toEqual({ channel: "tg", id: "-100123" });
    expect(parseRef("fb:1254477777772919")).toEqual({ channel: "fb", id: "1254477777772919" });
    expect(parseRef("wa:359888123456")).toEqual({ channel: "wa", id: "359888123456" });
    expect(channelOf("ig:178414")).toBe("ig");
  });
  it("rejects malformed refs and ids", () => {
    expect(() => parseRef("1001")).toThrow(/malformed chat_ref/);
    expect(() => parseRef("vb:1")).toThrow(/malformed chat_ref/);
    expect(() => parseRef("fb:")).toThrow(/malformed chat_ref/);
    expect(() => makeRef("fb", "a b")).toThrow(/bad channel id/);
  });
  it("knows which channels are Meta and which refs have a legacy Telegram id", () => {
    expect(isMetaChannel("tg")).toBe(false);
    expect(["fb", "ig", "wa"].every((c) => isMetaChannel(c as never))).toBe(true);
    expect(legacyTelegramId("tg:-100123")).toBe(-100123);
    expect(legacyTelegramId("fb:123456")).toBeNull();
    expect(legacyTelegramId(null)).toBeNull();
  });
  it("masks WhatsApp phone numbers for logs and leaves other refs alone", () => {
    expect(maskRef("wa:359888123456")).toBe("wa:…3456");
    expect(maskRef("wa:4242")).toBe("wa:…4242");
    expect(maskRef("fb:1254477777772919")).toBe("fb:1254477777772919");
    expect(maskRef("tg:-100123")).toBe("tg:-100123");
  });
});
