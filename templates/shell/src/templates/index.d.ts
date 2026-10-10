// Type-only stand-in for src/templates/index.ts, which a venue site does not ship (it imports every design).
// Templates import only TemplateDef/TemplateProps from that module; `next build` type-checks them against this file.
export type { TemplateDef, TemplateProps } from "./shared/types";
