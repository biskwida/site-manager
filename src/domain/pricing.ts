export const PRICE_MIN = 0.1;
export const PRICE_MAX = 500;

/**
 * Nearest integer, halves rounded up. The value is first snapped to 12
 * significant digits so binary noise (1.005 * 100 = 100.49999999999999)
 * counts as the exact tie it stands for.
 */
function roundHalfUp(x: number): number {
  return Math.round(Number(x.toPrecision(12)));
}

function toCents(eur: number): number {
  return roundHalfUp(eur * 100);
}

/** Nearest multiple of the step, in cents; half-steps round up. Integer maths, so ties are exact. */
function stepCents(cents: number, rounding: Rounding): number {
  if (rounding === "none") return cents;
  const step = Math.round(Number(rounding) * 100);
  return Math.round(cents / step) * step;
}

export function round2(n: number): number {
  return toCents(n) / 100;
}

export type Rounding = "none" | "0.05" | "0.10" | "0.50" | "1.00";
export const ROUNDINGS: readonly Rounding[] = ["none", "0.05", "0.10", "0.50", "1.00"];

export function roundTo(value: number, rounding: Rounding): number {
  return stepCents(toCents(value), rounding) / 100;
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
    const cents = toCents(i.price_eur);
    const raw = hasPercent
      ? roundHalfUp((cents * (100 + (change.percent as number))) / 100)
      : cents + toCents(change.delta_eur as number);
    return { item_id: i.id, name_bg: i.name_bg, name_en: i.name_en, old_eur: i.price_eur, new_eur: clampPrice(stepCents(raw, change.rounding) / 100) };
  });
}
