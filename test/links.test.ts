import { describe, expect, it } from "vitest";
import { startLinks } from "@/src/channels/links";

describe("startLinks", () => {
  it("builds a deep link per configured channel and omits the rest", () => {
    expect(startLinks({ telegramBotUsername: "site_manager_bot", messengerPageHandle: "sitemanagerbg", instagramUsername: "sitemanager.bg", whatsappNumber: "359888123456" }, "ABCD2345")).toEqual({
      telegram: "https://t.me/site_manager_bot?start=ABCD2345",
      messenger: "https://m.me/sitemanagerbg?ref=ABCD2345",
      instagram: "https://ig.me/m/sitemanager.bg?ref=ABCD2345",
      whatsapp: "https://wa.me/359888123456?text=ABCD2345",
    });
    expect(startLinks({ telegramBotUsername: null, messengerPageHandle: null, instagramUsername: null, whatsappNumber: null }, "X")).toEqual({});
  });
});
