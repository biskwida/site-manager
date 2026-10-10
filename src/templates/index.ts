// Single source for site designs: app/[slug] (preview, drafts, fallback) renders through here; a deployed venue site gets one
// template through the generated src/templates/current.ts instead.
// Runtime imports of this module are for app/** only; templates import only its types (the shell manifest does not ship this file).
import type { ComponentType } from "react";
import { TEMPLATE_IDS, type BusinessType, type DraftInfo, type SiteState, type TemplateId } from "@/src/domain/types";
import { def as classic } from "./classic";

export interface TemplateProps {
  state: SiteState;
  /** Server time in ms when the page rendered; templates tick from it with useNow. */
  now: number;
  slug: string;
  page: "home" | "menu";
  draft: DraftInfo | null;
  /** Poll the feed (false for draft previews and the wizard preview). */
  live: boolean;
  /** Absolute or site-relative URL of the public feed (`/api/site/<slug>` in the main app, `${SITE_MANAGER_URL}/api/site/<slug>` in a deployed site). */
  feedUrl: string;
  /** Wizard preview: allows blob:/data: media URLs. */
  preview?: boolean;
}

export interface TemplateDef {
  id: TemplateId;
  name_bg: string;
  name_en: string;
  tagline_bg: string;
  tagline_en: string;
  business_types: BusinessType[];
  accentDefault: string;
  /** CSS class string from next/font that sets --font-display and --font-body (and any extra vars). */
  fontVars: string;
  Component: ComponentType<TemplateProps>;
}

// Tasks 3 and 4 replace the two placeholders (classic components under their own ids) with `def` from ./nocturne and ./lumen.
export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  classic,
  nocturne: { ...classic, id: "nocturne" },
  lumen: { ...classic, id: "lumen" },
};

/** The template for an id from the database or a query string; unknown or missing ids fall back to classic. */
export function getTemplate(id: string | null | undefined): TemplateDef {
  return id && (TEMPLATE_IDS as readonly string[]).includes(id) ? TEMPLATES[id as TemplateId] : TEMPLATES.classic;
}
