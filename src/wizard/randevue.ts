// src/wizard/randevue.ts
// "Import from Randevue": a pure parser for a randevue.app menu page (QR table ordering, no public API) and the mapping to the
// wizard's ExtractResult, so the owner reviews the import in the same step as a photo extraction. Nothing here fetches:
// the HTTP route (src/server/wizard-randevue.ts) downloads the page per locale and calls these.
//
// The page is a Next.js App Router page; the whole venue dataset sits in the React Flight payload the server streams as
// `self.__next_f.push([1,"…"])` script chunks. The format is undocumented (docs/randevue-import.md), so every step here is
// defensive: unknown lines are skipped, the payload is found by key rather than by position, and a page without it is null.
import { WEEKDAYS, type WeekHours, type Weekday } from "../domain/types";
import { isValidHours } from "../domain/hours";
import { localDate, localTime } from "../time";
import type { ExtractResult } from "./extract";

export const RANDEVUE_HOST = "randevue.app";
export const RANDEVUE_LOCALES = ["bg-BG", "en-GB"] as const;
export type RandevueLocale = (typeof RANDEVUE_LOCALES)[number];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_MAX = 2048;

export interface RandevueText {
  name: string;
  description: string;
}
export interface RandevueProduct {
  id: string;
  /** In the page's locale. */
  name: string;
  description: string;
  price: number;
  /** As printed in the payload (EUR on every page seen so far). */
  currency: string;
  /** Allergen names as Randevue shows them, in the page's locale; its codes do not follow the EU numbering. */
  allergens: string[];
  /** The large product image on Randevue's public Supabase bucket, or null. */
  image_url: string | null;
  /** ISO datetime from the payload, as is (the mapping decides whether it still counts). */
  sold_out_until: string | null;
  deleted: boolean;
  /** false = the owner took it off the menu; Randevue shows such a product only while it is sold out. */
  active: boolean;
  localizations: Partial<Record<RandevueLocale, RandevueText>>;
}
export interface RandevueCategory {
  id: string;
  name: string;
  localizations: Partial<Record<RandevueLocale, { name: string }>>;
  products: RandevueProduct[];
}
/** Working hours as Randevue stores them: lower-case weekday → UTC "HH:MM" start and end. */
export type RandevueRawHours = Record<string, { start: string; end: string }>;
export interface RandevueVenue {
  name: string;
  description: string;
  /** The table / floorPlanObject the link points at ("Маса 34"). */
  table: string;
  time_zone: string;
  currency: string;
  logo_url: string | null;
  cover_url: string | null;
  hours: RandevueRawHours | null;
}
export interface RandevuePage {
  locale: RandevueLocale;
  venue: RandevueVenue;
  categories: RandevueCategory[];
}

/** Both locales paired by id. An empty string means that language was not on any page (randevueToExtract fills it). */
export interface RandevueMenu {
  venue: RandevueVenue;
  categories: {
    id: string;
    name_bg: string;
    name_en: string;
    products: {
      id: string;
      name_bg: string;
      name_en: string;
      desc_bg: string;
      desc_en: string;
      price: number;
      currency: string;
      allergens: string[];
      image_url: string | null;
      sold_out_until: string | null;
      deleted: boolean;
      active: boolean;
    }[];
  }[];
}

// ---------------------------------------------------------------------------------------------------------------------
// URLs

/** `{ id }` for an https link to a menu on exactly randevue.app (`/<locale>/<uuid>` or `/<uuid>`); null for anything else. */
export function parseRandevueUrl(input: string): { id: string } | null {
  const s = input.trim();
  if (!s || s.length > URL_MAX) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== RANDEVUE_HOST || u.port || u.username || u.password) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  if (parts.length < 1 || parts.length > 2 || !UUID_RE.test(last)) return null;
  if (parts.length === 2 && !/^[a-z]{2}-[A-Z]{2}$/.test(parts[0])) return null;
  return { id: last.toLowerCase() };
}

export function randevuePageUrl(id: string, locale: RandevueLocale): string {
  return `https://${RANDEVUE_HOST}/${locale}/${id}`;
}

/** https on *.supabase.co under /storage/v1/: where Randevue keeps product, logo and cover images. */
export function isRandevueImageUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > URL_MAX) return false;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const h = url.hostname.toLowerCase();
  return (h === "supabase.co" || h.endsWith(".supabase.co")) && url.pathname.startsWith("/storage/v1/");
}

// ---------------------------------------------------------------------------------------------------------------------
// Flight payload

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The JSON values of the page's flight lines. Chunks are JSON strings inside `self.__next_f.push([1,"…"])`; concatenated
 * they form lines `<hex id>:<payload>\n`. Only lines whose payload is a JSON array or object are kept; import lines
 * (`I[…]`), text lines (`T…`), hints and anything unparsable are skipped.
 */
export function flightValues(html: string): unknown[] {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  const chunks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const s: unknown = JSON.parse(m[1]);
      if (typeof s === "string") chunks.push(s);
    } catch {
      // not a JSON string: skip the chunk
    }
  }
  const out: unknown[] = [];
  for (const line of chunks.join("").split("\n")) {
    const mm = /^[0-9a-f]+:([[{][\s\S]*)$/.exec(line);
    if (!mm) continue;
    try {
      out.push(JSON.parse(mm[1]));
    } catch {
      // a text line's continuation or a truncated chunk: skip
    }
  }
  return out;
}

/** Depth-first: the first value under a key named `key` for which `pred` holds. */
function findByKey(root: unknown, key: string, pred: (v: unknown) => boolean, depth = 0): unknown {
  if (depth > 60 || root === null || typeof root !== "object") return undefined;
  if (Array.isArray(root)) {
    for (const x of root) {
      const r = findByKey(x, key, pred, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  for (const [k, v] of Object.entries(root)) {
    if (k === key && pred(v)) return v;
    const r = findByKey(v, key, pred, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** Control characters and runs of whitespace (the payload has "\r\n" inside descriptions) → single spaces, trimmed. */
const clean = (v: unknown): string => str(v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function readLocalizations<T>(v: unknown, read: (o: Obj) => T): Partial<Record<RandevueLocale, T>> {
  const out: Partial<Record<RandevueLocale, T>> = {};
  if (!isObj(v)) return out;
  for (const loc of RANDEVUE_LOCALES) if (isObj(v[loc])) out[loc] = read(v[loc] as Obj);
  return out;
}

function readProduct(v: unknown): RandevueProduct | null {
  if (!isObj(v)) return null;
  const name = clean(v.name);
  const price = num(v.price);
  if (!name || price === null) return null;
  const big = isObj(v.bigImage) ? v.bigImage.url : undefined;
  const small = isObj(v.image) ? v.image.url : undefined;
  const image = isRandevueImageUrl(big) ? big : isRandevueImageUrl(small) ? small : null;
  const allergens = Array.isArray(v.allergens) ? v.allergens.map((a) => (isObj(a) ? clean(a.name) : "")).filter(Boolean) : [];
  return {
    id: str(v.id) || name,
    name,
    description: clean(v.description),
    price,
    currency: clean(v.priceCurrency).toUpperCase(),
    allergens,
    image_url: image,
    sold_out_until: isoOrNull(v.soldOutUntilDatetime),
    deleted: v.deletedAt != null,
    active: v.isActive !== false,
    localizations: readLocalizations(v.localizations, (o) => ({ name: clean(o.name), description: clean(o.description) })),
  };
}

function readCategory(v: unknown): RandevueCategory | null {
  if (!isObj(v) || !Array.isArray(v.products)) return null;
  const name = clean(v.name);
  if (!name) return null;
  return { id: str(v.id) || name, name, localizations: readLocalizations(v.localizations, (o) => ({ name: clean(o.name) })), products: v.products.map(readProduct).filter((p): p is RandevueProduct => p !== null) };
}

function readHours(v: unknown): RandevueRawHours | null {
  if (!isObj(v)) return null;
  const out: RandevueRawHours = {};
  for (const [day, h] of Object.entries(v)) {
    if (!isObj(h) || !isObj(h.start) || !isObj(h.end)) continue;
    const start = str(h.start.time);
    const end = str(h.end.time);
    if (HHMM.test(start) && HHMM.test(end)) out[day.toLowerCase()] = { start, end };
  }
  return Object.keys(out).length ? out : null;
}

const imageUrlOf = (v: unknown): string | null => (isObj(v) && isRandevueImageUrl(v.url) ? v.url : null);

function readVenue(values: unknown[]): RandevueVenue {
  const empty: RandevueVenue = { name: "", description: "", table: "", time_zone: "", currency: "", logo_url: null, cover_url: null, hours: null };
  const entity = findByKey(values, "commercialEntity", (v) => isObj(v) && typeof v.name === "string") as Obj | undefined;
  const table = findByKey(values, "floorPlanObject", (v) => isObj(v) && typeof v.name === "string") as Obj | undefined;
  const cover = findByKey(values, "supabaseImage", (v) => imageUrlOf(v) !== null);
  if (!entity && !table && cover === undefined) return empty;
  return {
    name: clean(entity?.name),
    description: clean(entity?.description),
    table: clean(table?.name),
    time_zone: clean(entity?.timeZone),
    currency: clean(entity?.currency).toUpperCase(),
    logo_url: imageUrlOf(entity?.logoImage),
    cover_url: imageUrlOf(cover),
    hours: readHours(findByKey(entity ?? {}, "weeklyWorkingHours", isObj)),
  };
}

/** The venue and menu in one locale's page, or null when the page carries no menu (another page, a changed format, an error page). */
export function parseRandevuePage(html: string, locale: RandevueLocale): RandevuePage | null {
  if (!html) return null;
  const values = flightValues(html);
  const raw = findByKey(values, "productsByCategories", (v) => Array.isArray(v) && v.some((c) => isObj(c) && Array.isArray(c.products)));
  if (!Array.isArray(raw)) return null;
  const categories = raw.map(readCategory).filter((c): c is RandevueCategory => c !== null);
  if (!categories.length) return null;
  return { locale, venue: readVenue(values), categories };
}

// ---------------------------------------------------------------------------------------------------------------------
// Both locales → one bilingual menu

const LANG_OF: Record<RandevueLocale, "bg" | "en"> = { "bg-BG": "bg", "en-GB": "en" };

/**
 * Pairs categories and products by id across the pages that were fetched. A page's top-level texts are in its own locale
 * and its `localizations` carry the other locale where the venue translated it; the first page given sets the order.
 */
export function mergeRandevuePages(pages: Partial<Record<RandevueLocale, RandevuePage>>): RandevueMenu {
  const order = (["bg-BG", "en-GB"] as const).filter((l) => pages[l]);
  const first = order[0] ? pages[order[0]]! : null;
  const venue: RandevueVenue = first?.venue ?? { name: "", description: "", table: "", time_zone: "", currency: "", logo_url: null, cover_url: null, hours: null };
  if (!first) return { venue, categories: [] };
  // Category texts and product texts per language, from every page: the page's own locale first, then localizations.
  const catText: Record<string, { bg: string; en: string }> = {};
  const prodText: Record<string, { name_bg: string; name_en: string; desc_bg: string; desc_en: string }> = {};
  const set = (t: Record<string, string>, key: string, value: string) => {
    if (value && !t[key]) t[key] = value;
  };
  for (const loc of order) {
    const page = pages[loc]!;
    for (const c of page.categories) {
      const ct = (catText[c.id] ??= { bg: "", en: "" });
      set(ct, LANG_OF[loc], c.name);
      for (const l of RANDEVUE_LOCALES) set(ct, LANG_OF[l], c.localizations[l]?.name ?? "");
      for (const p of c.products) {
        const pt = (prodText[p.id] ??= { name_bg: "", name_en: "", desc_bg: "", desc_en: "" });
        set(pt, `name_${LANG_OF[loc]}`, p.name);
        set(pt, `desc_${LANG_OF[loc]}`, p.description);
        for (const l of RANDEVUE_LOCALES) {
          set(pt, `name_${LANG_OF[l]}`, p.localizations[l]?.name ?? "");
          set(pt, `desc_${LANG_OF[l]}`, p.localizations[l]?.description ?? "");
        }
      }
    }
  }
  return {
    venue,
    categories: first.categories.map((c) => ({
      id: c.id,
      name_bg: catText[c.id].bg,
      name_en: catText[c.id].en,
      products: c.products.map((p) => {
        const t = prodText[p.id];
        return { id: p.id, name_bg: t.name_bg, name_en: t.name_en, desc_bg: t.desc_bg, desc_en: t.desc_en, price: p.price, currency: p.currency, allergens: p.allergens, image_url: p.image_url, sold_out_until: p.sold_out_until, deleted: p.deleted, active: p.active };
      }),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// → ExtractResult

/** Specific stems first (peanuts before nuts, sulphites before anything with "sul"). Lower-case substrings of the allergen name. */
const ALLERGEN_STEMS: readonly { code: number; stems: string[] }[] = [
  { code: 5, stems: ["фъстъ", "peanut"] },
  { code: 8, stems: ["ядки", "nuts", "бадем", "лешни", "орех", "almond", "hazelnut", "walnut"] },
  { code: 1, stems: ["глутен", "gluten", "пшениц", "wheat"] },
  { code: 2, stems: ["ракообразн", "crustacean", "скарид", "shrimp"] },
  { code: 3, stems: ["яйц", "egg"] },
  { code: 4, stems: ["риба", "рибни", "fish"] },
  { code: 6, stems: ["соя", "соев", "soy"] },
  { code: 7, stems: ["мляко", "млечн", "milk", "lactose", "лактоза"] },
  { code: 9, stems: ["целина", "celery"] },
  { code: 10, stems: ["горчиц", "mustard"] },
  { code: 11, stems: ["сусам", "sesame"] },
  { code: 12, stems: ["сулфит", "серен диоксид", "sulphite", "sulfite", "sulphur dioxide", "sulfur dioxide"] },
  { code: 13, stems: ["лупин", "lupin"] },
  { code: 14, stems: ["мекотел", "mollusc", "mollusk", "миди"] },
];

/** The EU allergen code for one of Randevue's allergen names (either language), or null when none matches. */
export function randevueAllergenCode(name: string): number | null {
  const t = name.toLowerCase();
  for (const a of ALLERGEN_STEMS) if (a.stems.some((s) => t.includes(s))) return a.code;
  return null;
}

const CURRENCIES = { EUR: "EUR", BGN: "BGN" } as const;

/**
 * The menu as the review step shows it. Deleted products are dropped; a sold-out date still counts only when it is after
 * `now`; a product Randevue does not show (inactive and not sold out) is `hidden`, so the review unticks it by default.
 * A language missing on both pages is filled from the other. The result still goes through postProcessExtract.
 */
export function randevueToExtract(menu: RandevueMenu, now: Date): ExtractResult {
  const both = (a: string, b: string): [string, string] => [a || b, b || a];
  const nowMs = now.getTime();
  const categories = menu.categories.map((c) => {
    const [name_bg, name_en] = both(c.name_bg, c.name_en);
    const items = c.products
      .filter((p) => !p.deleted)
      .map((p) => {
        const [nb, ne] = both(p.name_bg, p.name_en);
        const [db, de] = both(p.desc_bg, p.desc_en);
        const soldOut = p.sold_out_until && Date.parse(p.sold_out_until) > nowMs ? p.sold_out_until : null;
        const codes = [...new Set(p.allergens.map(randevueAllergenCode).filter((x): x is number => x !== null))].sort((a, b) => a - b);
        const item: ExtractResult["categories"][number]["items"][number] = {
          name_bg: nb,
          name_en: ne,
          desc_bg: db,
          desc_en: de,
          price_eur: p.price,
          currency_seen: p.currency in CURRENCIES ? CURRENCIES[p.currency as keyof typeof CURRENCIES] : "unknown",
          allergens: codes,
        };
        if (isRandevueImageUrl(p.image_url)) item.image_url = p.image_url;
        if (soldOut) item.sold_out_until = soldOut;
        if (!p.active && !soldOut) item.hidden = true;
        return item;
      });
    return { name_bg, name_en, items };
  });
  const hidden = categories.reduce((n, c) => n + c.items.filter((i) => i.hidden).length, 0);
  const total = categories.reduce((n, c) => n + c.items.length, 0);
  const bgHidden = hidden ? ` ${hidden} от тях не се показват в Randevue в момента и са без отметка.` : "";
  const enHidden = hidden ? ` ${hidden} of them are not shown on Randevue right now and start unticked.` : "";
  return {
    categories,
    notes_bg: `Внесено от Randevue${menu.venue.name ? ` (${menu.venue.name})` : ""}: ${total} продукта.${bgHidden} Проверете цените и имената на двата езика.`,
    notes_en: `Imported from Randevue${menu.venue.name ? ` (${menu.venue.name})` : ""}: ${total} products.${enHidden} Check the prices and the names in both languages.`,
  };
}

const DAY_KEYS: Record<Weekday, string> = { mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday" };

/**
 * Randevue stores working hours in UTC; the wizard wants the venue's local time. Converted with the zone's offset on the
 * day of `now` (a DST change moves them by an hour, which the owner fixes in the Hours step). Null when nothing usable:
 * no day at all, a day that would close before it opens, or an unknown time zone.
 */
export function randevueHours(raw: RandevueRawHours | null | undefined, timeZone: string, now: Date): WeekHours | null {
  if (!raw || typeof raw !== "object") return null;
  let date: string;
  try {
    date = localDate(now, timeZone);
  } catch {
    return null;
  }
  const toLocal = (hhmm: string): string | null => {
    if (!HHMM.test(hhmm)) return null;
    try {
      return localTime(new Date(`${date}T${hhmm}:00Z`), timeZone);
    } catch {
      return null;
    }
  };
  const hours = {} as WeekHours;
  let any = false;
  for (const d of WEEKDAYS) {
    const r = raw[DAY_KEYS[d]];
    const open = r ? toLocal(r.start) : null;
    const close = r ? toLocal(r.end) : null;
    if (r && (!open || !close)) return null;
    hours[d] = open && close ? { open, close } : null;
    if (hours[d]) any = true;
  }
  return any && isValidHours(hours) ? hours : null;
}
