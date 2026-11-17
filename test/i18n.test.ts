import { describe, expect, it } from "vitest";
import { DICTS } from "@/src/i18n/dicts";
import { ONBOARDING } from "@/src/i18n/onboarding";

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
  it("never describe Claudia with the forbidden phrase", () => {
    for (const dict of [DICTS.en, DICTS.bg, ONBOARDING.en, ONBOARDING.bg]) {
      for (const [k, v] of Object.entries(dict)) expect(v, k).not.toMatch(/AI assistant/i);
    }
  });
  it("have the Google listing keys in both languages", () => {
    expect(DICTS.en["admin.google.title"]).toBe("Google listing");
    expect(ONBOARDING.bg["list.google.connect"]).toBe("Свържи Google");
    expect(ONBOARDING.en["list.google.done"]).toBe("Google connected");
  });
});
