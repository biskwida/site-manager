// test/prompt.test.ts — the per-turn user message the agent reads (src/agent/prompt.ts).
import { describe, expect, it } from "vitest";
import { userMessage, type UserMessageContext } from "@/src/agent/prompt";

const turn = (lang: UserMessageContext["lang"]): string =>
  userMessage({ venueName: "V", slug: "v", nowText: "now", lang, role: "owner", memory: "", correctionFor: null, text: "x", source: "text" });

describe("userMessage: the Owner language line", () => {
  it("names the owner's language in English: Owner language: German. for de", () => {
    expect(turn("de")).toContain("Owner language: German.");
    expect(turn("el")).toContain("Owner language: Greek.");
    expect(turn("pt")).toContain("Owner language: Portuguese.");
  });

  it("still reads Bulgarian and English as before", () => {
    expect(turn("bg")).toContain("Owner language: Bulgarian. Member role: owner.");
    expect(turn("en")).toContain("Owner language: English. Member role: owner.");
  });
});
