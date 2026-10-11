import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "mehana",
  name_bg: "Механа",
  name_en: "Mehana",
  tagline_bg: "Винено червено, шевица и менюто по ред. За механи и ресторанти с българска кухня.",
  tagline_en: "Wine red, an embroidery border and the menu course by course. For taverns and Bulgarian kitchens.",
  business_types: ["restaurant", "bar"],
  // Wine red from the approved mockup: the header band is this colour, and the parchment on it reads at 9.4:1 (the gold link at 7.0:1).
  accentDefault: "#6e1f1b",
  fontVars,
  Component: Template,
};
