// src/agent/tool-schemas.ts
import { z } from "zod";
import { ROUNDINGS } from "../domain/pricing";
import { SITE_TEXT_KEYS, VENUE_TEXT_KEYS, WEEKDAYS } from "../domain/types";

const Id = z.string().min(1);
const Price = z.number().describe("EUR with at most two decimals, 0.10–500");
const Allergens = z.array(z.number().int().min(1).max(14)).describe("EU allergen codes 1–14 (see check_allergens)");
const Until = z.string().nullable().describe('"next_opening" (the tool resolves it from the opening hours), an ISO 8601 datetime with offset, or null = back on sale');
const Expiry = z.string().nullable().describe('"closing_today" (resolved by the tool), an ISO 8601 datetime with offset, or null = no expiry');

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a hex colour like #1f3d2b");

const DayHours = z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) }).nullable();
export const HoursSchema = z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, DayHours])) as Record<(typeof WEEKDAYS)[number], typeof DayHours>);

export const NewItemSchema = z.object({
  category_id: Id,
  name_bg: z.string().min(1),
  name_en: z.string().min(1),
  desc_bg: z.string().describe("One short sentence in Bulgarian; may be empty"),
  desc_en: z.string().describe("One short sentence in English; may be empty"),
  price_eur: Price,
  allergens: Allergens,
  is_special: z.boolean().describe("true for a daily special (it disappears at special_expires_at)"),
  special_expires_at: Expiry,
  image_media_id: z.string().nullable().optional(),
});

export const ChangeInputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_price"), item_id: Id, price_eur: Price }),
  z.object({ op: z.literal("set_sold_out"), item_id: Id, until: Until }),
  z.object({ op: z.literal("add_item"), item: NewItemSchema }),
  z.object({
    op: z.literal("update_item"),
    item_id: Id,
    patch: z.object({ category_id: Id.optional(), name_bg: z.string().optional(), name_en: z.string().optional(), desc_bg: z.string().optional(), desc_en: z.string().optional(), price_eur: Price.optional(), allergens: Allergens.optional(), position: z.number().int().optional() }),
  }),
  z.object({ op: z.literal("remove_item"), item_id: Id }),
  z.object({ op: z.literal("set_item_image"), item_id: Id, media_id: z.string().nullable() }),
  z.object({ op: z.literal("set_cover_image"), media_id: z.string().nullable() }),
  z.object({ op: z.literal("set_logo_image"), media_id: z.string().nullable() }),
  z.object({ op: z.literal("add_gallery_image"), media_id: Id }),
  z.object({ op: z.literal("remove_gallery_image"), media_id: Id }),
  z.object({ op: z.literal("set_hours"), hours: HoursSchema }),
  z.object({ op: z.literal("add_holiday"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note_bg: z.string().min(1), note_en: z.string().min(1) }),
  z.object({ op: z.literal("remove_holiday"), holiday_id: Id }),
  z.object({ op: z.literal("add_announcement"), text_bg: z.string().min(1), text_en: z.string().min(1), expires_at: Expiry }),
  z.object({ op: z.literal("remove_announcement"), announcement_id: Id }),
  z.object({ op: z.literal("set_text"), key: z.enum([...SITE_TEXT_KEYS, ...VENUE_TEXT_KEYS]), text_bg: z.string(), text_en: z.string() }),
  z.object({
    op: z.literal("set_theme"),
    accent: Hex.optional().describe("Buttons, links and highlights, #rrggbb"),
    background: Hex.nullable().optional().describe("The page background, #rrggbb, clearly dark or clearly light; null = back to the design's own"),
  }).refine((o) => o.accent !== undefined || o.background !== undefined, { message: "set_theme needs accent, background or both." }),
]);
export type ChangeInput = z.infer<typeof ChangeInputSchema>;

export const ProposeSchema = z.object({
  summary_bg: z.string().min(1).describe("One line in Bulgarian, e.g. „Капучино 3,20 €“"),
  summary_en: z.string().min(1).describe("The same line in English"),
  changes: z.array(ChangeInputSchema).min(1).max(40),
});
export const ScheduleSchema = ProposeSchema.extend({
  apply_at: z.string().describe("ISO 8601 datetime with offset, in the future, e.g. 2026-12-24T08:00:00+02:00"),
});
export const BulkSchema = z.object({
  summary_bg: z.string().optional(),
  summary_en: z.string().optional(),
  category_id: z.string().optional().describe("Limit to one category (id from get_menu)"),
  name_contains: z.string().optional().describe("Limit to items whose BG or EN name contains this text (case-insensitive)"),
  percent: z.number().optional().describe("e.g. 10 for +10 %, -5 for -5 %"),
  delta_eur: z.number().optional().describe("e.g. 0.2 for +0.20 €"),
  rounding: z.enum(ROUNDINGS).describe('Round the new price to this step; "0.10" is the usual choice'),
});
export const CheckAllergensSchema = z.object({ name: z.string(), desc: z.string().optional(), declared: Allergens.default([]) });
export const UndoSchema = z.object({ change_set_id: z.string().describe('An id from list_changes, or "last" for the most recent applied set') });
export const ListSchema = z.object({ limit: z.number().int().min(1).max(50).default(10) });
export const CancelSchema = z.object({ change_set_id: Id });

export const BOOST_RESETS = ["all", "radius", "place", "age", "gender", "audience", "schedule", "budget", "days", "goal", "placements"] as const;
/** propose_boost (src/agent/boost-tools.ts). The budget and days ranges are checked by planBoost, which names the allowed range. */
export const BoostSchema = z.object({
  media_id: z.string().min(1).optional().describe("The media_id of the photo to boost, when the owner sent or named one (this message or the conversation)."),
  post_ref: z.string().min(1).optional().describe("A published Instagram or Facebook post the owner names: Meta's post id or its link. Omit both media_id and post_ref to boost the owner's last published post (else the best recent Instagram post)."),
  budget_eur: z.number().optional().describe("Total budget in EUR, only when the owner says one (allowed 5–200). Omit for the recommended 20 €."),
  days: z.number().int().optional().describe("How many days the ad runs, only when the owner says it (allowed 1–14). Omit for the recommended 5."),
  radius_km: z.number().optional().describe("Radius in km, only when the owner says it (allowed 1–50, steps of 0.5)."),
  place: z.string().min(1).max(120).optional().describe('Run the ad around another place than the business, only when the owner says it, e.g. "НДК".'),
  age_min: z.number().int().optional().describe("Minimum age, only when the owner says it (allowed 18–65)."),
  age_max: z.number().int().nullable().optional().describe("Maximum age, only when the owner says it (from the minimum up to 65); null = 65+."),
  gender: z.enum(["all", "women", "men"]).optional().describe("Who the ad is suggested to, only when the owner says it."),
  audience: z.string().min(1).max(200).optional().describe("The owner's own words about who their customers are, only when the owner says it."),
  weekdays: z.array(z.enum(WEEKDAYS)).optional().describe("The days of the week the ad runs, only when the owner says it."),
  from: z.string().optional().describe("Start time of day HH:MM, only when the owner says it."),
  to: z.string().optional().describe("End time of day HH:MM, only when the owner says it."),
  goal: z.enum(["reach", "profile_visits", "website_visits"]).optional().describe("What the ad is for, only when the owner says it."),
  placements: z.enum(["automatic", "instagram", "facebook"]).optional().describe("Where the ad shows, only when the owner says it."),
  reset: z.array(z.enum(BOOST_RESETS)).optional().describe('Fields where the owner says "ти реши" ("you decide"): Claudia\'s analysis decides them again. "all" when the owner says "ти реши за всичко" ("decide everything"): every owner choice is dropped.'),
  variant: z.enum(["default", "morning", "weekend"]).optional().describe('"morning" only when the owner says сутрин / закуска / до 11 / morning / breakfast; "weekend" only when the owner says уикенд / събота / неделя / бранч / концерт / weekend / brunch / event / live music. Omit it when the owner asks for neither (the caption decides).'),
});
