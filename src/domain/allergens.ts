import type { Lang } from "./types";

/** Regulation (EU) 1169/2011, Annex II. Short display names; the site shows a legend. */
export const ALLERGENS: readonly { code: number; bg: string; en: string }[] = [
  { code: 1, bg: "Глутен", en: "Gluten" },
  { code: 2, bg: "Ракообразни", en: "Crustaceans" },
  { code: 3, bg: "Яйца", en: "Eggs" },
  { code: 4, bg: "Риба", en: "Fish" },
  { code: 5, bg: "Фъстъци", en: "Peanuts" },
  { code: 6, bg: "Соя", en: "Soybeans" },
  { code: 7, bg: "Мляко", en: "Milk" },
  { code: 8, bg: "Ядки", en: "Nuts" },
  { code: 9, bg: "Целина", en: "Celery" },
  { code: 10, bg: "Горчица", en: "Mustard" },
  { code: 11, bg: "Сусам", en: "Sesame" },
  { code: 12, bg: "Сулфити", en: "Sulphites" },
  { code: 13, bg: "Лупина", en: "Lupin" },
  { code: 14, bg: "Мекотели", en: "Molluscs" },
];

export function isAllergenCode(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 14;
}

export function allergenName(code: number, lang: Lang): string {
  const a = ALLERGENS.find((x) => x.code === code);
  return a ? a[lang] : String(code);
}

/** Lower-case stems; a stem matches when it is a substring of the lower-cased text. Advisory only. */
const KEYWORDS: readonly { code: number; stems: string[] }[] = [
  { code: 1, stems: ["хляб", "брашно", "тесто", "баниц", "кроасан", "паста", "пица", "питк", "кори", "козунак", "бисквит", "браун", "кекс", "торта", "пшениц", "ръж", "ечемик", "овес", "сандвич", "тост", "bread", "flour", "dough", "croissant", "pasta", "pizza", "wheat", "rye", "barley", "oat", "biscuit", "brownie", "cake", "sandwich", "toast", "bun", "pastry", "banitsa"] },
  { code: 2, stems: ["скарид", "рак", "омар", "лангуст", "shrimp", "prawn", "crab", "lobster", "crayfish"] },
  { code: 3, stems: ["яйц", "майонез", "омлет", "egg", "mayonnaise", "omelet", "meringue"] },
  { code: 4, stems: ["риба", "сьомга", "тон ", "риба тон", "скумрия", "пъстърва", "аншоа", "fish", "salmon", "tuna", "mackerel", "trout", "anchov", "cod"] },
  { code: 5, stems: ["фъстъ", "peanut"] },
  { code: 6, stems: ["соя", "соев", "тофу", "soy", "tofu", "edamame"] },
  { code: 7, stems: ["мляко", "млечн", "сирене", "кашкавал", "масло", "сметана", "йогурт", "кисело мляко", "капучино", "лате", "моцарела", "извара", "milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "cappuccino", "latte", "mozzarella", "ricotta", "whey"] },
  { code: 8, stems: ["орех", "бадем", "лешни", "шам", "кашу", "пекан", "ядки", "walnut", "almond", "hazelnut", "pistachio", "cashew", "pecan", "nuts"] },
  { code: 9, stems: ["целина", "celery"] },
  { code: 10, stems: ["горчиц", "mustard"] },
  { code: 11, stems: ["сусам", "тахан", "sesame", "tahini"] },
  { code: 12, stems: ["вино", "сулфит", "wine", "sulphite", "sulfite"] },
  { code: 13, stems: ["лупин", "lupin"] },
  { code: 14, stems: ["миди", "калмар", "октопод", "охлюв", "mussel", "squid", "octopus", "clam", "oyster", "snail"] },
];

/** Codes whose keywords appear in the text, ascending. */
export function suggestAllergens(text: string): number[] {
  return matches(text).map((m) => m.code);
}

function matches(text: string): { code: number; keyword: string }[] {
  const t = ` ${text.toLowerCase()} `;
  const out: { code: number; keyword: string }[] = [];
  for (const k of KEYWORDS) {
    const stem = k.stems.find((s) => t.includes(s));
    if (stem !== undefined) out.push({ code: k.code, keyword: stem.trim() });
  }
  return out;
}

/** Suggested allergens the dish does not declare, with the keyword that triggered each. */
export function allergenWarnings(declared: number[], text: string): { code: number; keyword: string }[] {
  const have = new Set(declared);
  return matches(text).filter((m) => !have.has(m.code));
}
