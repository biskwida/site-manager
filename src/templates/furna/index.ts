import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "furna",
  name_bg: "Фурна",
  name_en: "Furna",
  tagline_bg: "Топло и уютно, с тавите от пещта до часа. За фурни и места за закуска.",
  tagline_en: "Warm and homely, with each tray from the oven by the hour. For bakeries and breakfast places.",
  business_types: ["cafe"],
  // Tomato on cream, from the approved mockup: 4.69:1 against --fu-bg (used only for large display type) and the button
  // text (#fff8ea) reads at 5.13:1 on it as a fill.
  accentDefault: "#b8432a",
  fontVars,
  Component: Template,
};
