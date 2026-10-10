import { describe, expect, it } from "vitest";
import { ALLERGENS, allergenName, allergenWarnings, suggestAllergens } from "@/src/domain/allergens";

describe("allergens", () => {
  it("lists the 14 EU allergens in both languages", () => {
    expect(ALLERGENS).toHaveLength(14);
    expect(ALLERGENS.map((a) => a.code)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(allergenName(7, "bg")).toBe("Мляко");
    expect(allergenName(7, "en")).toBe("Milk");
    expect(allergenName(1, "en")).toBe("Gluten");
  });

  it("suggests from Bulgarian keywords", () => {
    expect(suggestAllergens("Баница със сирене и яйца")).toEqual([1, 3, 7]);
    expect(suggestAllergens("Сандвич с пуешко и горчица")).toEqual([1, 10]);
    expect(suggestAllergens("Фреш портокал")).toEqual([]);
  });

  it("suggests from English keywords and is case-insensitive", () => {
    expect(suggestAllergens("Walnut brownie with CREAM")).toEqual([1, 7, 8]);
    expect(suggestAllergens("Shrimp salad with sesame")).toEqual([2, 11]);
  });

  it("does not fire on look-alike words", () => {
    expect(suggestAllergens("Пица с шампиньони")).toEqual([1]);
    expect(suggestAllergens("Ракия")).toEqual([]);
    expect(suggestAllergens("Donuts")).toEqual([]);
    expect(suggestAllergens("Veggie bowl")).toEqual([]);
    expect(suggestAllergens("Goat cheese")).toEqual([7]);
    expect(suggestAllergens("Сандвич с тон")).toEqual([1, 4]);
  });

  it("warns only about suggested codes that are not declared", () => {
    expect(allergenWarnings([1], "Кроасан с масло")).toEqual([{ code: 7, keyword: "масло" }]);
    expect(allergenWarnings([1, 7], "Кроасан с масло")).toEqual([]);
  });
});
