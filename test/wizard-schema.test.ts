// test/wizard-schema.test.ts
import { describe, expect, it } from "vitest";
import { TEMPLATE_IDS } from "@/src/domain/types";
import { DEFAULT_HOURS } from "@/src/store/types";
import { TEMPLATES } from "@/src/templates";
import {
  bothLangs, DRAFT_SLUG_PREFIX, WIZARD_MAX_IMAGE_BYTES, emptyDraft, RESERVED_SLUGS, SLUG_RE, stepForPath, TEMPLATE_ACCENT_DEFAULTS, validateForPublish, WIZARD_STEPS, WizardDraftSchema, WizardPatchSchema,
} from "@/src/wizard/schema";

function full() {
  const d = emptyDraft("classic");
  d.name = "Кафене „Ъгъла“";
  d.slug = "agala";
  d.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }];
  return d;
}

describe("slug rules", () => {
  it("accepts 2–39 lowercase letters, digits and dashes starting with a letter or digit", () => {
    expect(SLUG_RE.test("agala")).toBe(true);
    expect(SLUG_RE.test("a1")).toBe(true);
    expect(SLUG_RE.test("my-cafe-2")).toBe(true);
    expect(SLUG_RE.test("a")).toBe(false);
    expect(SLUG_RE.test("-abc")).toBe(false);
    expect(SLUG_RE.test("Abc")).toBe(false);
    expect(SLUG_RE.test("кафе")).toBe(false);
    expect(SLUG_RE.test("a".repeat(40))).toBe(false);
    expect(SLUG_RE.test("a".repeat(39))).toBe(true);
  });
  it("lists the reserved words", () => {
    expect(RESERVED_SLUGS).toEqual(["new", "admin", "api", "embed", "draft", "demo", "www", "static", "_next"]);
    expect(DRAFT_SLUG_PREFIX).toBe("draft-");
  });
});

describe("TEMPLATE_ACCENT_DEFAULTS", () => {
  it("matches every registered template's accentDefault", () => {
    for (const id of TEMPLATE_IDS) expect(TEMPLATE_ACCENT_DEFAULTS[id]).toBe(TEMPLATES[id].accentDefault);
    expect(Object.keys(TEMPLATE_ACCENT_DEFAULTS).sort()).toEqual([...TEMPLATE_IDS].sort());
  });
});

describe("emptyDraft", () => {
  it("has sensible defaults, the default hours and the template's accent", () => {
    const d = emptyDraft("nocturne");
    expect(d).toMatchObject({ template: "nocturne", business_type: "cafe", name: "", slug: "", default_lang: "bg", step: "basics", logo_media_id: null, cover_media_id: null, gallery_media_ids: [], categories: [] });
    expect(d.hours).toEqual(DEFAULT_HOURS);
    expect(d.hours).not.toBe(DEFAULT_HOURS); // a copy, never the shared constant
    expect(d.theme.accent).toBe(TEMPLATE_ACCENT_DEFAULTS.nocturne);
    expect(d.texts).toEqual({ welcome: { bg: "", en: "" }, footer_note: { bg: "", en: "" } });
    expect(WizardDraftSchema.safeParse(d).success).toBe(true);
  });
  it("lists the steps in wizard order", () => {
    expect(WIZARD_STEPS).toEqual(["template", "basics", "look", "hours", "menu", "texts", "photos", "review", "done"]);
  });
});

describe("WizardDraftSchema / WizardPatchSchema", () => {
  it("bounds prices and allergen codes and validates hours", () => {
    const d = full();
    expect(WizardDraftSchema.safeParse(d).success).toBe(true);
    d.categories[0].items[0].price_eur = 0.05;
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].price_eur = 500.01;
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].price_eur = 2.999;
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].price_eur = 2.5;
    d.categories[0].items[0].allergens = [0];
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].allergens = [15];
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].allergens = [7, 7];
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].allergens = [1, 7];
    expect(WizardDraftSchema.safeParse(d).success).toBe(true);
    d.hours = { ...d.hours, mon: { open: "18:00", close: "08:00" } };
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
  });
  it("rejects reserved and malformed slugs but allows the empty slug of a fresh draft", () => {
    expect(WizardPatchSchema.safeParse({ slug: "" }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ slug: "admin" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ slug: "_next" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ slug: "My Cafe" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ slug: "my-cafe" }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ theme: { accent: "red" } }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ theme: { accent: "#A1b2C3" } }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ template: "shopify" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ step: "menu" }).success).toBe(true);
  });
  it("accepts only http(s) map links (templates render them as hrefs)", () => {
    expect(WizardPatchSchema.safeParse({ maps_url: "" }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ maps_url: "https://maps.google.com/?q=1,2" }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ maps_url: "http://maps.example/x" }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ maps_url: "javascript:alert(1)" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ maps_url: "ftp://maps.example/x" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ maps_url: "data:text/html,hi" }).success).toBe(false);
  });
  it("caps wizard uploads at 4 MB (under Vercel's request body limit)", () => {
    expect(WIZARD_MAX_IMAGE_BYTES).toBe(4 * 1024 * 1024);
  });
  it("strips unknown keys on PUT", () => {
    const r = WizardPatchSchema.safeParse({ name: "X", status: "live", deploy: {} });
    expect(r.success).toBe(true);
    expect(r.success && Object.keys(r.data)).toEqual(["name"]);
  });
});

describe("validateForPublish", () => {
  it("passes a complete draft", () => {
    expect(validateForPublish(full())).toEqual({ ok: true });
  });
  it("names every missing piece in both languages", () => {
    const d = emptyDraft("lumen");
    const r = validateForPublish(d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const byPath = Object.fromEntries(r.errors.map((e) => [e.path, e]));
    expect(byPath.name).toEqual({ path: "name", bg: "Въведете името на заведението.", en: "Enter the venue's name." });
    expect(byPath.slug).toEqual({ path: "slug", bg: "Адресът трябва да е 2–39 малки латински букви, цифри и тирета.", en: "The address must be 2–39 lowercase letters, digits and dashes." });
    expect(byPath.categories).toEqual({ path: "categories", bg: "Добавете поне един продукт в менюто.", en: "Add at least one menu item." });
    for (const e of r.errors) {
      expect(e.bg.length).toBeGreaterThan(0);
      expect(e.en.length).toBeGreaterThan(0);
      expect(e.bg).not.toBe(e.en);
    }
  });
  it("rejects reserved words and the draft placeholder as the final slug", () => {
    const a = full();
    a.slug = "demo";
    expect(validateForPublish(a)).toMatchObject({ ok: false, errors: [{ path: "slug", bg: "Този адрес е запазен. Изберете друг.", en: "This address is reserved. Choose another." }] });
    const b = full();
    b.slug = "draft-0a1b2c3d";
    expect(validateForPublish(b)).toMatchObject({ ok: false, errors: [{ path: "slug" }] });
    const c = full();
    c.slug = "";
    expect(validateForPublish(c)).toMatchObject({ ok: false, errors: [{ path: "slug", en: "The address must be 2–39 lowercase letters, digits and dashes." }] });
  });
  it("needs a name in at least one language per category and item, and unique keys", () => {
    const d = full();
    d.categories[0].items[0].name_bg = "";
    d.categories[0].items[0].name_en = "";
    const r = validateForPublish(d);
    expect(r).toMatchObject({ ok: false, errors: [{ path: "categories.0.items.0.name", en: "Give the dish a name." }] });
    const dup = full();
    dup.categories[0].items.push({ ...dup.categories[0].items[0] });
    expect(validateForPublish(dup)).toMatchObject({ ok: false, errors: [{ path: "categories.0.items.1.key" }] });
  });
  it("maps error paths to wizard steps", () => {
    expect(stepForPath("name")).toBe("basics");
    expect(stepForPath("slug")).toBe("basics");
    expect(stepForPath("theme.accent")).toBe("look");
    expect(stepForPath("hours.mon")).toBe("hours");
    expect(stepForPath("categories.0.items.1.price_eur")).toBe("menu");
    expect(stepForPath("tagline_bg")).toBe("texts");
    expect(stepForPath("texts.welcome.en")).toBe("texts");
    expect(stepForPath("gallery_media_ids")).toBe("photos");
    expect(stepForPath("anything.else")).toBe("review");
  });
  it("fills the missing language from the other one", () => {
    expect(bothLangs("Еспресо", "")).toEqual({ bg: "Еспресо", en: "Еспресо" });
    expect(bothLangs("", "Espresso")).toEqual({ bg: "Espresso", en: "Espresso" });
    expect(bothLangs(" a ", " b ")).toEqual({ bg: "a", en: "b" });
  });
});
