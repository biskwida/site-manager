import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "lumen",
  name_bg: "Лумен",
  name_en: "Lumen",
  tagline_bg: "Светъл и въздушен, със снимките на преден план. За specialty кафенета.",
  tagline_en: "Light and airy, photos first. For specialty coffee.",
  business_types: ["cafe", "restaurant"],
  // Deep green on cool paper: 7.1:1 against --l-bg as text, and the paper on it reads at the same ratio as a button fill.
  accentDefault: "#2e5e4e",
  fontVars,
  Component: Template,
};
