// src/wizard/schema.ts
// Shared by the wizard UI (client), the API routes and publish. No secrets, no store access, no template imports
// (src/templates loads next/font, which server code and plain node never import).
import { z } from "zod";
import { isAllergenCode } from "../domain/allergens";
import { isValidHours } from "../domain/hours";
import { PRICE_MAX, PRICE_MIN, round2 } from "../domain/pricing";
import { BUSINESS_TYPES, LANGS, TEMPLATE_IDS, WEEKDAYS, type BusinessType, type Lang, type TemplateId, type WeekHours, type Weekday } from "../domain/types";
import { DEFAULT_HOURS } from "../store/types";

/** 2–39 chars: lowercase letters and digits, single dashes only between them (no leading, trailing or doubled dash). */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,38}$/;
export const RESERVED_SLUGS = ["new", "admin", "api", "embed", "draft", "demo", "www", "static", "_next"];
/** Placeholder slug of an unpublished draft: `draft-<8 hex>`. Never accepted as the final address. */
export const DRAFT_SLUG_PREFIX = "draft-";
const HEX = /^#[0-9a-fA-F]{6}$/;
/**
 * Largest image the wizard uploads (R25). Below Vercel's ~4.5 MB request body cap so the platform never answers first.
 * The Telegram path keeps MAX_IMAGE_BYTES (5 MB) in src/bot/media.ts.
 */
export const WIZARD_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * R25 (amended): menu extraction accepts at most 3 MB of decoded file bytes per request, all files together, which is
 * about 4 MB of base64 JSON and stays under Vercel's 4.5 MB request body limit. The client downscales to fit.
 */
export const EXTRACT_MAX_TOTAL_BYTES = 3 * 1024 * 1024;

/**
 * Copy of `def.accentDefault` from src/templates/<id>/index.ts, kept here so server code never imports next/font.
 * test/wizard-schema.test.ts asserts the two stay equal.
 */
export const TEMPLATE_ACCENT_DEFAULTS: Record<TemplateId, string> = {
  classic: "#2f6b4f",
  nocturne: "#d9a05b",
  lumen: "#2e5e4e",
  furna: "#2f6b4f",
  mehana: "#2f6b4f",
  kvartal: "#C23A1C",
};

export type WizardStep = "template" | "basics" | "look" | "hours" | "menu" | "texts" | "photos" | "review" | "done";
export const WIZARD_STEPS: readonly WizardStep[] = ["template", "basics", "look", "hours", "menu", "texts", "photos", "review", "done"];

export interface WizardItem {
  key: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  image_media_id: string | null;
}
export interface WizardCategory {
  key: string;
  name_bg: string;
  name_en: string;
  items: WizardItem[];
}
export interface WizardDraft {
  template: TemplateId;
  business_type: BusinessType;
  name: string;
  slug: string;
  default_lang: Lang;
  address: string;
  phone: string;
  instagram: string;
  maps_url: string;
  hours: WeekHours;
  theme: { accent: string };
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  texts: { welcome: { bg: string; en: string }; footer_note: { bg: string; en: string } };
  logo_media_id: string | null;
  cover_media_id: string | null;
  gallery_media_ids: string[];
  categories: WizardCategory[];
  /** Last step the owner reached. */
  step: WizardStep;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DayHoursSchema = z.object({ open: z.string().regex(HHMM), close: z.string().regex(HHMM) }).nullable();
export const WeekHoursSchema = z
  .object(Object.fromEntries(WEEKDAYS.map((d) => [d, DayHoursSchema])) as Record<Weekday, typeof DayHoursSchema>)
  .refine((h) => isValidHours(h), { message: "open must be before close" });

const Key = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const Price = z
  .number()
  .finite()
  .min(PRICE_MIN)
  .max(PRICE_MAX)
  .refine((p) => round2(p) === p, { message: "at most two decimals" });
const Allergens = z
  .array(z.number().int().refine(isAllergenCode, { message: "allergen codes are 1–14" }))
  .max(14)
  .refine((a) => new Set(a).size === a.length, { message: "no repeats" });
const Short = (max: number) => z.string().max(max);
const SlugSchema = z.string().regex(SLUG_RE).refine((s) => !RESERVED_SLUGS.includes(s), { message: "reserved" });
const Pair = z.object({ bg: Short(400), en: Short(400) });

export const WizardItemSchema = z.object({
  key: Key,
  name_bg: Short(120),
  name_en: Short(120),
  desc_bg: Short(400),
  desc_en: Short(400),
  price_eur: Price,
  allergens: Allergens,
  image_media_id: z.string().max(64).nullable(),
});
export const WizardCategorySchema = z.object({ key: Key, name_bg: Short(80), name_en: Short(80), items: z.array(WizardItemSchema).max(200) });

export const WizardDraftSchema = z.object({
  template: z.enum(TEMPLATE_IDS),
  business_type: z.enum(BUSINESS_TYPES),
  name: Short(80),
  slug: z.union([z.literal(""), SlugSchema]),
  default_lang: z.enum(LANGS),
  address: Short(200),
  phone: Short(40),
  instagram: Short(60),
  maps_url: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(500)]), // rendered as an href: http(s) only
  hours: WeekHoursSchema,
  theme: z.object({ accent: z.string().regex(HEX) }),
  tagline_bg: Short(160),
  tagline_en: Short(160),
  about_bg: Short(2000),
  about_en: Short(2000),
  texts: z.object({ welcome: Pair, footer_note: Pair }),
  logo_media_id: z.string().max(64).nullable(),
  cover_media_id: z.string().max(64).nullable(),
  gallery_media_ids: z.array(z.string().max(64)).max(40),
  categories: z.array(WizardCategorySchema).max(40),
  step: z.enum(WIZARD_STEPS),
}) satisfies z.ZodType<WizardDraft>;
/** PUT body: any subset of the draft; unknown keys are dropped. */
export const WizardPatchSchema = WizardDraftSchema.partial();

export function emptyDraft(template: TemplateId): WizardDraft {
  return {
    template,
    business_type: "cafe",
    name: "",
    slug: "",
    default_lang: "bg",
    address: "",
    phone: "",
    instagram: "",
    maps_url: "",
    hours: structuredClone(DEFAULT_HOURS),
    theme: { accent: TEMPLATE_ACCENT_DEFAULTS[template] },
    tagline_bg: "",
    tagline_en: "",
    about_bg: "",
    about_en: "",
    texts: { welcome: { bg: "", en: "" }, footer_note: { bg: "", en: "" } },
    logo_media_id: null,
    cover_media_id: null,
    gallery_media_ids: [],
    categories: [],
    step: "basics",
  };
}

export interface PublishError {
  path: string;
  bg: string;
  en: string;
}

/** The wizard step that owns a validation path (for "Fix" links and per-step blocking). */
export function stepForPath(path: string): WizardStep {
  const head = path.split(".")[0];
  if (["name", "slug", "default_lang", "address", "phone", "instagram", "maps_url", "business_type"].includes(head)) return "basics";
  if (["theme", "logo_media_id", "cover_media_id", "template"].includes(head)) return "look";
  if (head === "hours") return "hours";
  if (head === "categories") return "menu";
  if (["tagline_bg", "tagline_en", "about_bg", "about_en", "texts"].includes(head)) return "texts";
  if (head === "gallery_media_ids") return "photos";
  return "review";
}

/** When one language is empty the other is used for both, so nothing on the site is ever blank. */
export function bothLangs(bg: string, en: string): { bg: string; en: string } {
  const b = bg.trim();
  const e = en.trim();
  return { bg: b || e, en: e || b };
}

/** Why a slug cannot be the final address (format, reserved word or the draft placeholder); null when it can. */
export function slugError(slug: string): { bg: string; en: string } | null {
  if (!SLUG_RE.test(slug)) return { bg: "Адресът трябва да е от 2 до 39 знака: малки латински букви, цифри и единични тирета между тях.", en: "The address must be 2–39 characters: lowercase letters, digits and single dashes between them." };
  if (RESERVED_SLUGS.includes(slug) || slug.startsWith(DRAFT_SLUG_PREFIX)) return { bg: "Този адрес е запазен. Изберете друг.", en: "This address is reserved. Choose another." };
  return null;
}

export function validateForPublish(d: WizardDraft): { ok: true } | { ok: false; errors: PublishError[] } {
  const errors: PublishError[] = [];
  const push = (path: string, bg: string, en: string) => {
    if (!errors.some((e) => e.path === path)) errors.push({ path, bg, en });
  };
  if (!d.name.trim()) push("name", "Въведете името на заведението.", "Enter the venue's name.");
  const slugErr = slugError(d.slug);
  if (slugErr) push("slug", slugErr.bg, slugErr.en);
  if (!isValidHours(d.hours)) push("hours", "Проверете работното време: отварянето трябва да е преди затварянето.", "Check the opening hours: opening must be before closing.");
  if (!HEX.test(d.theme.accent)) push("theme.accent", "Цветът трябва да е във вид #rrggbb.", "The colour must look like #rrggbb.");
  if (!d.categories.some((c) => c.items.length > 0)) push("categories", "Добавете поне един продукт в менюто.", "Add at least one menu item.");
  const catKeys = new Set<string>();
  d.categories.forEach((c, i) => {
    if (catKeys.has(c.key)) push(`categories.${i}.key`, "Повтарящ се ключ на категория.", "Duplicate category key.");
    catKeys.add(c.key);
    if (!c.name_bg.trim() && !c.name_en.trim()) push(`categories.${i}.name`, "Дайте име на категорията.", "Give the category a name.");
    const itemKeys = new Set<string>();
    c.items.forEach((it, j) => {
      if (itemKeys.has(it.key)) push(`categories.${i}.items.${j}.key`, "Повтарящ се ключ на продукт.", "Duplicate item key.");
      itemKeys.add(it.key);
      if (!it.name_bg.trim() && !it.name_en.trim()) push(`categories.${i}.items.${j}.name`, "Дайте име на ястието.", "Give the dish a name.");
      if (!Number.isFinite(it.price_eur) || it.price_eur < PRICE_MIN || it.price_eur > PRICE_MAX || round2(it.price_eur) !== it.price_eur)
        push(`categories.${i}.items.${j}.price_eur`, `Цената трябва да е между ${PRICE_MIN.toFixed(2)} и ${PRICE_MAX.toFixed(2)} € с до два знака.`, `The price must be between ${PRICE_MIN.toFixed(2)} and ${PRICE_MAX.toFixed(2)} € with at most two decimals.`);
      if (!it.allergens.every(isAllergenCode) || new Set(it.allergens).size !== it.allergens.length) push(`categories.${i}.items.${j}.allergens`, "Алергените са кодове от 1 до 14, без повторения.", "Allergens are codes 1–14 without repeats.");
    });
  });
  // Anything the field checks above did not cover (lengths, URL shape, enums).
  const parsed = WizardDraftSchema.safeParse(d);
  if (!parsed.success) for (const i of parsed.error.issues) push(i.path.map(String).join("."), "Невалидна стойност.", "Invalid value.");
  return errors.length ? { ok: false, errors } : { ok: true };
}
