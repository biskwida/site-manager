// Single source for site designs: app/[slug] (preview, drafts, fallback) renders through here; a deployed venue site gets one
// template through the generated src/templates/current.ts instead.
// Runtime imports of this module are for app/** only; templates import only its types (the shell manifest ships a type-only
// stand-in, templates/shell/src/templates/index.d.ts, instead of this file).
import { TEMPLATE_IDS, type TemplateId } from "@/src/domain/types";
import type { TemplateDef } from "./shared/types";
import { def as classic } from "./classic";
import { def as lumen } from "./lumen";
import { def as nocturne } from "./nocturne";

// Defined in shared/types.ts so a deployed venue site (which ships only the type-only stand-in) can type-check the templates.
export type { TemplateDef, TemplateProps } from "./shared/types";

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  classic,
  nocturne,
  lumen,
};

/** The template for an id from the database or a query string; unknown or missing ids fall back to classic. */
export function getTemplate(id: string | null | undefined): TemplateDef {
  return id && (TEMPLATE_IDS as readonly string[]).includes(id) ? TEMPLATES[id as TemplateId] : TEMPLATES.classic;
}
