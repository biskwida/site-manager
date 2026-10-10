import { describe, expect, it } from "vitest";
import { DICTS } from "@/src/i18n/dicts";

describe("dictionaries", () => {
  it("have the same keys in both languages and no empty strings", () => {
    const en = Object.keys(DICTS.en).sort();
    const bg = Object.keys(DICTS.bg).sort();
    expect(bg).toEqual(en);
    for (const k of en) {
      expect(DICTS.en[k as keyof typeof DICTS.en].length, `en ${k}`).toBeGreaterThan(0);
      expect(DICTS.bg[k as keyof typeof DICTS.bg].length, `bg ${k}`).toBeGreaterThan(0);
    }
  });
});
