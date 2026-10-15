// src/wizard/edit.ts
// Pure helpers behind the wizard's buttons (unit-tested; the components stay thin).
import type { ExtractResult } from "./extract";
import { SLUG_RE, type WizardCategory, type WizardItem } from "./schema";

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};

/** Bulgarian or Latin name → a slug that passes SLUG_RE (or "" when nothing usable is left). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split("")
    .map((ch) => CYR[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 39)
    .replace(/-+$/g, "");
  return SLUG_RE.test(s) ? s : "";
}

export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `k${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

export function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export function blankItem(): WizardItem {
  return { key: newKey(), name_bg: "", name_en: "", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], image_media_id: null };
}
export function blankCategory(): WizardCategory {
  return { key: newKey(), name_bg: "", name_en: "", items: [] };
}

const norm = (s: string) => s.trim().toLowerCase();

/** Appends extracted dishes to the category with the same name (either language), or adds the category. Returns a new array. */
export function mergeExtracted(categories: readonly WizardCategory[], r: ExtractResult): WizardCategory[] {
  const out = categories.map((c) => ({ ...c, items: [...c.items] }));
  for (const ec of r.categories) {
    const items: WizardItem[] = ec.items.map((it) => ({
      key: newKey(), name_bg: it.name_bg, name_en: it.name_en, desc_bg: it.desc_bg, desc_en: it.desc_en, price_eur: it.price_eur, allergens: [...it.allergens], image_media_id: null,
      // Randevue import only: the photo to copy and the sold-out date travel with the item; `hidden` is a review-time default and stays behind.
      ...(it.image_url ? { image_url: it.image_url } : {}),
      ...(it.sold_out_until ? { sold_out_until: it.sold_out_until } : {}),
    }));
    const bg = norm(ec.name_bg);
    const en = norm(ec.name_en);
    const existing = out.find((c) => (bg && norm(c.name_bg) === bg) || (en && norm(c.name_en) === en) || (bg && norm(c.name_en) === bg) || (en && norm(c.name_bg) === en));
    if (existing) existing.items.push(...items);
    else out.push({ key: newKey(), name_bg: ec.name_bg, name_en: ec.name_en, items });
  }
  return out;
}
