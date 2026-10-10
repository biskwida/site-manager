// src/wizard/schema.ts
// Types and constants of the wizard draft. Task 7 appends the zod schemas (WizardDraftSchema, WizardPatchSchema),
// emptyDraft and validateForPublish to this file; nothing declared here changes then.
import type { BusinessType, Lang, TemplateId, WeekHours } from "../domain/types";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
export const RESERVED_SLUGS = ["new", "admin", "api", "embed", "draft", "demo", "www", "static", "_next"];

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
