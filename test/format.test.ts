import { describe, expect, it } from "vitest";
import { detectLang } from "@/src/domain/format";

describe("detectLang", () => {
  it.each([
    ["Капучиното е 4,20", "bg"],
    ["Flat white свърши", "bg"],
    ["change the price of the cappuccino to 4.20", "en"],
    ["make it a story", "en"],
    ["4.20", null],
    ["Flat white 4.30", null],
    ["kafeto e 4.20", null],
    ["pusni post v instagram", null],
    ["ok 👍", null],
  ])("detectLang(%s) = %s", (text, lang) => expect(detectLang(text)).toBe(lang));

  it("says nothing for an empty or blank message", () => {
    expect(detectLang("")).toBeNull();
    expect(detectLang("   ")).toBeNull();
  });

  it("lets any Cyrillic letter win over English words", () => {
    expect(detectLang("change the price на капучиното to 4.20")).toBe("bg");
  });

  it("needs two different listed words: one word, or the same word again, is not enough", () => {
    expect(detectLang("post")).toBeNull();
    expect(detectLang("Please")).toBeNull();
    expect(detectLang("the the the")).toBeNull();
    expect(detectLang("the price")).toBe("en");
  });

  it("matches whole words and ignores case", () => {
    expect(detectLang("MAKE IT A STORY")).toBe("en");
    expect(detectLang("Please Add oat milk")).toBe("en");
    // "to", "an", "open" and "in" sit inside these words but are not the words themselves
    expect(detectLang("tomato another opening inside")).toBeNull();
  });

  it("counts every word of the list", () => {
    const listed = [
      "the", "a", "an", "is", "are", "was", "be", "to", "for", "of", "and", "or", "in", "on", "at", "with", "from", "it", "this", "that",
      "my", "our", "we", "i", "you", "please", "can", "could", "would", "will",
      "make", "add", "remove", "change", "set", "put", "show", "post", "price", "today", "tomorrow", "closed", "open", "sold", "out",
      "what", "how", "when", "why",
    ];
    expect(listed).toHaveLength(49);
    const missed = listed.filter((word) => detectLang(`${word} ${word === "the" ? "please" : "the"}`) !== "en");
    expect(missed).toEqual([]);
  });
});
