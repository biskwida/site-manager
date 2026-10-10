// test/shell-feed.test.ts
// The venue shell's <html lang> follows the venue's main language from the feed.
import { describe, expect, it } from "vitest";
import { htmlLang } from "@/templates/shell/app/feed";
import { makeDemo } from "./helpers";

describe("shell htmlLang", () => {
  it("uses the venue's default_lang, and bg without a feed", async () => {
    const { store, venue } = await makeDemo();
    const state = await store.getSite(venue.id);
    expect(htmlLang(state)).toBe("bg");
    expect(htmlLang({ ...state, venue: { ...state.venue, default_lang: "en" } })).toBe("en");
    expect(htmlLang(null)).toBe("bg");
  });
});
