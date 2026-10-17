// test/prompt.test.ts — the system prompt and the per-turn user message the agent reads (src/agent/prompt.ts).
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, userMessage, type UserMessageContext } from "@/src/agent/prompt";
import { SocialPostSchema } from "@/src/agent/social-tools";
import { MakeVisualSchema } from "@/src/agent/visual-tools";

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

describe("SYSTEM_PROMPT: the language rule", () => {
  it("the prompt tells the agent to write only in the owner language", () => {
    expect(SYSTEM_PROMPT).toMatch(/never mix in another language/i);
  });

  it("states the rule with its three exceptions and the script rule for picture text", () => {
    expect(SYSTEM_PROMPT).toContain(
      "Language: write every reply, question and caption in the Owner language; never mix in another language, except quoting the owner, quoting a customer, or a reply drafted for a customer in the customer's language. Picture text is in the Owner language when it uses Latin or Cyrillic letters, otherwise English.",
    );
  });

  it("is one more numbered rule, and the numbering stays continuous", () => {
    const numbers = [...SYSTEM_PROMPT.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    expect(SYSTEM_PROMPT).toMatch(/^15\. Language: /m);
  });

  it("rule 4 tells the agent to write both site languages when the owner writes in neither", () => {
    expect(SYSTEM_PROMPT).toMatch(/^4\. Languages: .*When the owner gives one language, write the other yourself; when the owner writes in neither Bulgarian nor English, write both Bulgarian and English yourself:/m);
  });

  it("leaves no older rule that sends captions to the venue's language or says the owner speaks only Bulgarian or English", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/default language/i);
    expect(SYSTEM_PROMPT).toMatch(/Write the caption in the Owner language unless the owner asks for another language or gives the text/);
    expect(SYSTEM_PROMPT).not.toMatch(/in Bulgarian or English/);
  });
});

describe("tool descriptions: the language of captions and picture text", () => {
  it("captions default to the owner language", () => {
    const caption = SocialPostSchema.shape.caption.description ?? "";
    expect(caption).toMatch(/owner'?s current language/i);
    expect(caption).toContain("(the Owner language line)");
    expect(caption).toContain("unless the owner asks for another language or gives the text");
    expect(caption).not.toMatch(/default language/i);
    expect(caption).toContain("Stories show no caption."); // the rest of the description is kept
  });

  it("picture text falls back to English for scripts the picture fonts lack", () => {
    // The fonts (src/visual/fonts) cover Latin and Cyrillic: a German or Bulgarian owner's text is printed as it is, a Greek or Japanese owner's is not.
    for (const field of ["dish", "line", "price"] as const) {
      const description = MakeVisualSchema.shape[field].description ?? "";
      expect(description).toMatch(/Latin or Cyrillic/);
      expect(description).toMatch(/otherwise English/);
      expect(description).toMatch(/owner'?s current language/i);
      expect(description).toContain("(the Owner language line)");
      expect(description).toContain("unless the owner asks for another language or gives the text");
      // What the fonts cover: Bulgarian, English and Western European Latin; Latin Extended letters are not covered.
      expect(description).toContain("Bulgarian, English and Western European Latin");
      expect(description).toContain("Latin Extended letters (ł č š ş ğ ő ă and the like: Polish, Czech, Turkish, Romanian, Croatian…) are not covered");
      expect(description).toContain("the picture text is English");
      expect(description).toContain("The caption stays in the owner's language.");
    }
    expect(MakeVisualSchema.shape.dish.description).toContain("at most 40 characters"); // what was there is kept
    expect(MakeVisualSchema.shape.line.description).toContain("at most 40 characters");
    expect(MakeVisualSchema.shape.price.description).toContain("From the owner, else from get_menu for that item, else omit.");
  });
});
