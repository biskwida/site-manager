// test/connect-apps.test.ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/src/config";
import { connectedApps, connectLinks, enabledApps, memberApp, type AppsConfig } from "@/src/server/connect-apps";

const none: AppsConfig = { telegramBotUsername: null, messengerPageHandle: null, instagramUsername: null, whatsappNumber: null, channelsEnabled: false };
const all: AppsConfig = { telegramBotUsername: "site_bot", messengerPageHandle: "sitemanager", instagramUsername: "site.manager", whatsappNumber: "359888123456", channelsEnabled: true };

describe("loadConfig: app link keys", () => {
  const lenient = (env: Record<string, string>) => loadConfig(env, { lenient: true });
  it("are optional and off by default", () => {
    expect(lenient({})).toMatchObject({ messengerPageHandle: null, instagramUsername: null, whatsappNumber: null, channelsEnabled: false });
  });
  it("normalise like the channels branch (no @, digits only) and read CHANNELS_ENABLED as a boolean", () => {
    const c = lenient({ MESSENGER_PAGE_HANDLE: " sitemanager ", INSTAGRAM_USERNAME: "@site.manager", WHATSAPP_NUMBER: "+359 888 123 456", CHANNELS_ENABLED: "true" });
    expect(c).toMatchObject({ messengerPageHandle: "sitemanager", instagramUsername: "site.manager", whatsappNumber: "359888123456", channelsEnabled: true });
    expect(lenient({ CHANNELS_ENABLED: "1" }).channelsEnabled).toBe(true);
    expect(lenient({ CHANNELS_ENABLED: "false" }).channelsEnabled).toBe(false);
    expect(lenient({ CHANNELS_ENABLED: "yes please" }).channelsEnabled).toBe(false);
    expect(lenient({ WHATSAPP_NUMBER: "+" }).whatsappNumber).toBeNull();
  });
  it("reduce a pasted Messenger link to the Page handle and refuse anything that is not a handle", () => {
    const m = (v: string) => lenient({ MESSENGER_PAGE_HANDLE: v }).messengerPageHandle;
    expect(m("sitemanager.demo")).toBe("sitemanager.demo");
    expect(m("@sitemanager_1")).toBe("sitemanager_1");
    expect(m("https://m.me/sitemanager.demo")).toBe("sitemanager.demo");
    expect(m("https://m.me/sitemanager.demo/")).toBe("sitemanager.demo");
    expect(m("http://m.me/sitemanager?ref=x")).toBe("sitemanager");
    expect(m("m.me/sitemanager")).toBe("sitemanager");
    for (const bad of ["https://evil.example/sitemanager", "https://m.me/a/b", "https://m.me/", "site manager", "café", "a/b", "x".repeat(65), "@", "https://instagram.com/sitemanager", "javascript:alert(1)"]) expect(m(bad), bad).toBeNull();
    expect(m("x".repeat(64))).toBe("x".repeat(64));
  });
  it("reduce a pasted Instagram profile link to the username and refuse anything that is not one", () => {
    const ig = (v: string) => lenient({ INSTAGRAM_USERNAME: v }).instagramUsername;
    expect(ig("site.manager")).toBe("site.manager");
    expect(ig("@site.manager")).toBe("site.manager");
    expect(ig("https://instagram.com/site.manager")).toBe("site.manager");
    expect(ig("https://www.instagram.com/site.manager/")).toBe("site.manager");
    expect(ig("https://www.instagram.com/site.manager/?hl=bg")).toBe("site.manager");
    expect(ig("instagram.com/site_manager")).toBe("site_manager");
    for (const bad of ["https://m.me/site.manager", "https://www.instagram.com/p/abc/", "https://evil.example/site.manager", "site-manager", "@@x", "<script>"]) expect(ig(bad), bad).toBeNull();
  });
  it("never throws on a bad handle (the app still starts, the link is just not offered)", () => {
    expect(() => loadConfig({ MESSENGER_PAGE_HANDLE: "%%%", INSTAGRAM_USERNAME: "http://[" }, { lenient: true })).not.toThrow();
  });
});

describe("enabledApps", () => {
  it("is empty with nothing configured", () => {
    expect(enabledApps(none)).toEqual([]);
  });
  it("is Telegram only until CHANNELS_ENABLED, even with every handle set", () => {
    expect(enabledApps({ ...all, channelsEnabled: false })).toEqual(["telegram"]);
    expect(enabledApps({ ...all, channelsEnabled: false, telegramBotUsername: null })).toEqual([]);
  });
  it("lists each app whose handle is set once channels are enabled, Telegram first", () => {
    expect(enabledApps(all)).toEqual(["telegram", "whatsapp", "messenger", "instagram"]);
    expect(enabledApps({ ...none, channelsEnabled: true, whatsappNumber: "359888123456" })).toEqual(["whatsapp"]);
    expect(enabledApps({ ...all, messengerPageHandle: null })).toEqual(["telegram", "whatsapp", "instagram"]);
  });
});

describe("connectLinks", () => {
  it("builds the same URL shapes as the channels branch's startLinks", () => {
    expect(connectLinks(all, "ABCD2345")).toEqual([
      { app: "telegram", url: "https://t.me/site_bot?start=ABCD2345" },
      { app: "whatsapp", url: "https://wa.me/359888123456?text=ABCD2345" },
      { app: "messenger", url: "https://m.me/sitemanager?ref=ABCD2345" },
      { app: "instagram", url: "https://ig.me/m/site.manager?ref=ABCD2345" },
    ]);
  });
  it("URL-encodes the code", () => {
    const links = connectLinks(all, "A B&c=1");
    for (const l of links) expect(l.url).toMatch(/A%20B%26c%3D1$/);
  });
  it("only for enabled apps (the gate applies)", () => {
    expect(connectLinks({ ...all, channelsEnabled: false }, "ABCD2345")).toEqual([{ app: "telegram", url: "https://t.me/site_bot?start=ABCD2345" }]);
    expect(connectLinks(none, "ABCD2345")).toEqual([]);
  });
});

describe("memberApp", () => {
  it("is Telegram for every member today", () => {
    expect(memberApp({ venue_id: "v", tg_chat_id: 42, role: "owner", lang: "bg", created_at: "2026-10-11T00:00:00.000Z" })).toBe("telegram");
  });
});

describe("connectedApps", () => {
  it("counts owners and staff per app and leaves out apps nobody linked", () => {
    const m = (role: "owner" | "staff", id: number) => ({ venue_id: "v", tg_chat_id: id, role, lang: "bg" as const, created_at: "2026-10-11T00:00:00.000Z" });
    expect(connectedApps([])).toEqual([]);
    expect(connectedApps([m("owner", 1), m("staff", 2), m("staff", 3), m("owner", 4)])).toEqual([{ app: "telegram", owners: 2, staff: 2 }]);
  });
});
