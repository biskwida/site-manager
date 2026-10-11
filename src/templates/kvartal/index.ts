import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "kvartal",
  name_bg: "Квартал",
  name_en: "Kvartal",
  tagline_bg: "Швейцарска решетка, огромен шрифт и номерирано меню. За бранч през деня и коктейли вечер.",
  tagline_en: "Swiss grid, huge type and a numbered menu. For brunch by day and cocktails by night.",
  business_types: ["cafe", "bar"],
  // Vermilion from the approved mockup. The "Now" block puts #F6F5F1 text on it at 5.3:1 (the fill is capped at OKLCH
  // L 0.53, which nudges it to #BC3415); as text on the #E9E8E3 paper it is capped at L 0.5 (#B22905, 5.3:1).
  accentDefault: "#c23a1c",
  fontVars,
  Component: Template,
};
