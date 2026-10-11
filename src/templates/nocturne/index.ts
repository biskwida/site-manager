import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "nocturne",
  name_bg: "Ноктюрн",
  name_en: "Nocturne",
  tagline_bg: "Тъмен и едър. За барове и вечерни заведения.",
  tagline_en: "Dark and bold. For bars and evening venues.",
  business_types: ["bar", "restaurant", "cafe"],
  // Brass on near-black: 8.4:1 against --n-bg as text, and dark text on it reads at the same ratio as a button fill.
  accentDefault: "#d9a05b",
  fontVars,
  Component: Template,
};
