import { describe, expect, it } from "vitest";
import { bulkPrices, round2, roundTo } from "@/src/domain/pricing";

const items = [
  { id: "a", name_bg: "Еспресо", name_en: "Espresso", price_eur: 1.8 },
  { id: "b", name_bg: "Капучино", name_en: "Cappuccino", price_eur: 2.9 },
  { id: "c", name_bg: "Лате", name_en: "Latte", price_eur: 3.2 },
];

describe("pricing", () => {
  it("rounds to two decimals without float noise", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.9 * 1.1)).toBe(3.19);
  });

  it("rounds to a step", () => {
    expect(roundTo(3.19, "0.10")).toBe(3.2);
    expect(roundTo(3.14, "0.05")).toBe(3.15);
    expect(roundTo(3.24, "0.50")).toBe(3.0);
    expect(roundTo(3.26, "0.50")).toBe(3.5);
    expect(roundTo(3.19, "none")).toBe(3.19);
  });

  it("applies a percentage with rounding", () => {
    expect(bulkPrices(items, { percent: 10, rounding: "0.10" })).toEqual([
      { item_id: "a", name_bg: "Еспресо", name_en: "Espresso", old_eur: 1.8, new_eur: 2.0 },
      { item_id: "b", name_bg: "Капучино", name_en: "Cappuccino", old_eur: 2.9, new_eur: 3.2 },
      { item_id: "c", name_bg: "Лате", name_en: "Latte", old_eur: 3.2, new_eur: 3.5 },
    ]);
  });

  it("applies a delta and clamps to the price range", () => {
    expect(bulkPrices(items, { delta_eur: -2, rounding: "none" }).map((r) => r.new_eur)).toEqual([0.1, 0.9, 1.2]);
  });

  it("rejects percent and delta together or neither", () => {
    expect(() => bulkPrices(items, { rounding: "none" })).toThrow(/percent or delta_eur/);
    expect(() => bulkPrices(items, { percent: 5, delta_eur: 1, rounding: "none" })).toThrow(/not both/);
  });
});
