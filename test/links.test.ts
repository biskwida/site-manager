import { describe, expect, it } from "vitest";
import { dashboardLink } from "@/src/bot/links";
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

describe("dashboardLink", () => {
  it("is the account dashboard with an owner account, the key link without", () => {
    expect(dashboardLink("https://x.app", { slug: "agala" }, "tok", true)).toBe("https://x.app/dashboard/agala");
    expect(dashboardLink("https://x.app", { slug: "agala" }, "tok", false)).toBe("https://x.app/admin/agala?key=tok");
  });
});
