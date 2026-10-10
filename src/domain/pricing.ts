export const PRICE_MIN = 0.1;
export const PRICE_MAX = 500;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type Rounding = "none" | "0.05" | "0.10" | "0.50" | "1.00";
export const ROUNDINGS: readonly Rounding[] = ["none", "0.05", "0.10", "0.50", "1.00"];

export function roundTo(value: number, rounding: Rounding): number {
  if (rounding === "none") return round2(value);
  const step = Number(rounding);
  return round2(Math.round(value / step) * step);
}

export function clampPrice(value: number): number {
  return Math.min(PRICE_MAX, Math.max(PRICE_MIN, round2(value)));
}

export interface BulkInput {
  percent?: number;
  delta_eur?: number;
  rounding: Rounding;
}
export interface BulkRow {
  item_id: string;
  name_bg: string;
  name_en: string;
  old_eur: number;
  new_eur: number;
}

/** old → new for each item. The model never does this arithmetic. */
export function bulkPrices(items: { id: string; name_bg: string; name_en: string; price_eur: number }[], change: BulkInput): BulkRow[] {
  const hasPercent = typeof change.percent === "number";
  const hasDelta = typeof change.delta_eur === "number";
  if (hasPercent && hasDelta) throw new Error("Give percent or delta_eur, not both.");
  if (!hasPercent && !hasDelta) throw new Error("Give percent or delta_eur.");
  return items.map((i) => {
    const raw = hasPercent ? i.price_eur * (1 + (change.percent as number) / 100) : i.price_eur + (change.delta_eur as number);
    return { item_id: i.id, name_bg: i.name_bg, name_en: i.name_en, old_eur: i.price_eur, new_eur: clampPrice(roundTo(raw, change.rounding)) };
  });
}
