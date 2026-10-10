import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "classic",
  name_bg: "Класика",
  name_en: "Classic",
  tagline_bg: "Топла, списанийна страница върху кремава хартия.",
  tagline_en: "Warm, editorial pages on cream paper.",
  business_types: ["cafe", "restaurant"],
  accentDefault: "#2f6b4f",
  fontVars,
  Component: Template,
};
