// test/wizard-ui.test.ts
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { WIZARD_BG, WIZARD_EN } from "@/src/i18n/wizard";
import { emptyDraft, validateForPublish } from "@/src/wizard/schema";
import { Basics } from "@/app/new/components/Steps/Basics";
import { ExtractReview } from "@/app/new/components/Steps/ExtractReview";
import { Hours } from "@/app/new/components/Steps/Hours";
import { Look } from "@/app/new/components/Steps/Look";
import { Menu } from "@/app/new/components/Steps/Menu";
import { Photos } from "@/app/new/components/Steps/Photos";
import { Review } from "@/app/new/components/Steps/Review";
import { Texts } from "@/app/new/components/Steps/Texts";
import { NoDraft } from "@/app/new/components/NoDraft";
import { Stepper } from "@/app/new/components/Stepper";
import type { StepProps } from "@/app/new/components/types";
import { media } from "./fixtures";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const render = (lang: Lang, el: ReactElement) => renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, el));
const noop = () => undefined;
function props(over: Partial<StepProps> = {}): StepProps {
  const draft = emptyDraft("classic");
  draft.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [7], image_media_id: null }] }];
  draft.gallery_media_ids = ["m2"];
  return { id: "v1", draft, media: [media("m1"), media("m2")], update: noop, addMedia: noop, baseUrl: "https://site.example", aiAvailable: true, serverErrors: [], ...over };
}

describe("wizard dictionary", () => {
  it("has the same keys in both languages, no empty strings, Bulgarian is not English", () => {
    const bg = Object.keys(WIZARD_BG).sort();
    const en = Object.keys(WIZARD_EN).sort();
    expect(bg).toEqual(en);
    for (const k of bg) {
      expect(WIZARD_BG[k as keyof typeof WIZARD_BG].length, `bg ${k}`).toBeGreaterThan(0);
      expect(WIZARD_EN[k as keyof typeof WIZARD_EN].length, `en ${k}`).toBeGreaterThan(0);
    }
    expect(WIZARD_BG["review.create"]).toBe("Създай сайта ми");
    expect(WIZARD_EN["review.create"]).toBe("Create my site");
  });
});

describe("step components render labelled fields in both languages", () => {
  const cases: [string, (p: StepProps) => ReactElement, string, string][] = [
    ["Basics", (p) => createElement(Basics, p), "Име на заведението", "Venue name"],
    ["Look", (p) => createElement(Look, p), "Основен цвят", "Accent colour"],
    ["Hours", (p) => createElement(Hours, p), "Понеделник", "Monday"],
    ["Menu", (p) => createElement(Menu, p), "Качете сегашното си меню", "Upload your current menu"],
    ["Texts", (p) => createElement(Texts, p), "Напиши вместо мен", "Write for me"],
    ["Photos", (p) => createElement(Photos, p), "Добави снимки", "Add photos"],
    ["Review", (p) => createElement(Review, { ...p, errors: [], goTo: noop, onPublished: noop }), "Създай сайта ми", "Create my site"],
  ];
  for (const [name, make, bgLabel, enLabel] of cases) {
    it(`${name}: bg and en`, () => {
      const bg = render("bg", make(props()));
      const en = render("en", make(props()));
      expect(bg).toContain(bgLabel);
      expect(en).toContain(enLabel);
      expect(bg).not.toContain(enLabel);
    });
  }
  it("Basics shows the slug prefix, the required name and a server slug error", () => {
    const html = render("en", createElement(Basics, props({ serverErrors: [{ path: "slug", bg: "Зает", en: "Taken" }] })));
    expect(html).toContain("site.example/");
    expect(html).toContain('required=""');
    expect(html).toContain("Taken");
    expect(html).toContain('aria-invalid="true"');
  });
  it("Menu lists the dish, its allergen chip pressed, and the move/remove buttons", () => {
    const html = render("bg", createElement(Menu, props()));
    expect(html).toContain("Еспресо");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Премести нагоре");
    expect(html).toContain("Премахни продукта");
    expect(html).toContain('role="tablist"');
  });
  it("Menu and Texts explain when AI is unavailable", () => {
    expect(render("en", createElement(Menu, props({ aiAvailable: false })))).toContain("not enabled on this server");
    expect(render("bg", createElement(Texts, props({ aiAvailable: false })))).toContain("не е включено на този сървър");
    expect(render("en", createElement(Texts, props({ aiAvailable: false })))).not.toContain("Write for me");
    expect(render("en", createElement(Menu, props({ aiAvailable: false })))).not.toContain("Choose files");
  });
  it("Photos renders the gallery order with a placeholder for unrenderable media", () => {
    const html = render("en", createElement(Photos, props()));
    expect(html).toContain("Photo 1");
    expect(html).toContain('src="https://cdn.example/v1/m2.jpg"');
    expect(html).toContain("Remove from gallery");
    const offline = render("en", createElement(Photos, props({ media: [media("m2", { public_url: "memory://v1/m2" })] })));
    expect(offline).toContain("No preview");
    expect(offline).not.toContain('src="memory');
  });
  it("Review lists validation errors with Fix buttons and disables Create", () => {
    const draft = emptyDraft("lumen");
    const r = validateForPublish(draft);
    const errors = r.ok ? [] : r.errors;
    const html = render("en", createElement(Review, { ...props({ draft }), errors, goTo: noop, onPublished: noop }));
    expect(html).toContain("Before we create the site:");
    expect(html).toContain("Enter the venue&#x27;s name."); // React escapes the apostrophe
    expect(html).toContain("Fix: Basics");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Lumen");
  });
  it("ExtractReview shows rows with the BGN flag and the accept buttons", () => {
    const html = render("bg", createElement(ExtractReview, {
      result: { categories: [{ name_bg: "Кафе", name_en: "Coffee", items: [{ name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "", desc_en: "", price_eur: 2.56, currency_seen: "BGN", allergens: [7] }] }], notes_bg: "Една цена не се чете.", notes_en: "" },
      onAccept: noop, onDiscard: noop,
    }));
    expect(html).toContain("Проверете какво прочетохме");
    expect(html).toContain("Преизчислено от лева");
    expect(html).toContain("Добави избраните (1)");
    expect(html).toContain("Една цена не се чете.");
    expect(html).toContain("2,56 €");
  });
  it("Stepper marks the current step and numbers all seven", () => {
    const html = render("en", createElement(Stepper, { current: "hours", onSelect: noop }));
    expect(html).toContain("Step 3 of 7");
    expect(html).toContain('aria-current="step"');
    expect((html.match(/<li>/g) ?? []).length).toBe(7);
    expect((html.match(/<button/g) ?? []).length).toBe(2); // basics and look are reachable, later steps are not
  });
  it("NoDraft links back to the chooser", () => {
    const html = render("bg", createElement(NoDraft));
    expect(html).toContain('href="/new"');
    expect(html).toContain("Изберете дизайн");
  });
});
