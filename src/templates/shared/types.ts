import type { ComponentType } from "react";
import type { BusinessType, DraftInfo, SiteState, TemplateId } from "@/src/domain/types";

/** Ids whose content just changed → the change time (ms); drives the flash highlight. */
export type Changed = ReadonlyMap<string, number>;

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
