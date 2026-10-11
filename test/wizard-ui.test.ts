// test/wizard-ui.test.ts
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/src/domain/types";
import { LangProvider, LangScope, LangToggle } from "@/src/i18n";
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
import { ResumeDraft } from "@/app/new/components/ResumeDraft";
import { Stepper } from "@/app/new/components/Stepper";
import type { StepProps } from "@/app/new/components/types";
import { previewLinkAction } from "@/app/new/components/previewLinks";
import { media } from "./fixtures";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const render = (lang: Lang, el: ReactElement) => renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, el));
const noop = () => undefined;
const saveSnapshot = () => ({ state: "idle" as const, errors: [], message: null });
function props(over: Partial<StepProps> = {}): StepProps {
  const draft = emptyDraft("classic");
  draft.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [7], image_media_id: null }] }];
  draft.gallery_media_ids = ["m2"];
  return { id: "v1", draft, media: [media("m1"), media("m2")], update: noop, addMedia: noop, baseUrl: "https://site.example", aiAvailable: true, fieldErrors: [], ...over };
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
    ["Review", (p) => createElement(Review, { ...p, errors: [], goTo: noop, onPublished: noop, flush: async () => true, saveSnapshot }), "Създай сайта ми", "Create my site"],
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
    const html = render("en", createElement(Basics, props({ fieldErrors: [{ path: "slug", bg: "Зает", en: "Taken" }] })));
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
    expect(html).not.toContain('role="tab');
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
    const html = render("en", createElement(Review, { ...props({ draft }), errors, goTo: noop, onPublished: noop, flush: async () => true, saveSnapshot }));
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
  it("ResumeDraft links back to an unfinished draft, or to the hand-off page of a published site", () => {
    const bg = render("bg", createElement(ResumeDraft, { resume: { id: "v1", kind: "draft", name: "Бар Нощ" } }));
    expect(bg).toContain('href="/new/v1"');
    expect(bg).toContain("Продължете черновата");
    expect(bg).toContain("Бар Нощ");
    const en = render("en", createElement(ResumeDraft, { resume: { id: "v1", kind: "draft", name: "" } }));
    expect(en).toContain("Continue your draft");
    const live = render("en", createElement(ResumeDraft, { resume: { id: "v 2", kind: "live", name: "Bar" } }));
    expect(live).toContain('href="/new/v%202/done"');
    expect(live).toContain("Bar");
    expect(render("bg", createElement(ResumeDraft, { resume: { id: "v2", kind: "live", name: "Бар" } }))).toContain("Сайтът ви е създаден");
  });
  it("Look offers the three templates with the draft's one checked", () => {
    const html = render("en", createElement(Look, props()));
    expect(html).toContain("Design");
    for (const name of ["Classic", "Nocturne", "Lumen"]) expect(html).toContain(name);
    expect(html).toMatch(/name="template" checked="" value="classic"/);
    expect(html).not.toMatch(/checked="" value="lumen"/);
    expect(render("bg", createElement(Look, props()))).toContain("Дизайн");
  });
  it("Look picks the design's default swatch for a stored accent in any letter case", () => {
    for (const accent of ["#C23A1C", "#c23a1c"]) {
      const draft = emptyDraft("kvartal");
      draft.theme.accent = accent;
      const html = render("en", createElement(Look, props({ draft })));
      expect(html, accent).toMatch(/name="accent" checked="" value="#c23a1c"/);
      expect(html, accent).not.toMatch(/checked="" value="custom"/);
    }
  });
  it("NoDraft links back to the chooser", () => {
    const html = render("bg", createElement(NoDraft));
    expect(html).toContain('href="/new"');
    expect(html).toContain("Изберете дизайн");
  });

  it("client validation errors land on their fields: aria-invalid plus a described-by error line", () => {
    const html = render("en", createElement(Basics, props({ fieldErrors: [{ path: "name", bg: "Име", en: "Enter the venue name." }] })));
    const input = html.match(/<input[^>]*autoComplete="organization"[^>]*>/i)?.[0] ?? html.match(/<input[^>]*autocomplete="organization"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('aria-invalid="true"');
    const errId = input.match(/aria-describedby="([^"]+)"/)?.[1] ?? "";
    expect(errId).not.toBe("");
    expect(html).toMatch(new RegExp(`id="${errId.split(" ").at(-1)}"[^>]*>Enter the venue name.<`));
  });
  it("menu dish errors mark the dish's name and price fields", () => {
    const html = render("en", createElement(Menu, props({ fieldErrors: [
      { path: "categories.0.items.0.name", bg: "и", en: "Give the dish a name." },
      { path: "categories.0.items.0.price_eur", bg: "ц", en: "Bad price." },
    ] })));
    expect(html).toContain("Give the dish a name.");
    expect(html).toContain("Bad price.");
    expect((html.match(/aria-invalid="true"/g) ?? []).length).toBe(2);
  });
  it("text inputs shrink inside grid tracks (w-full min-w-0) and the dish grid uses minmax(0,1fr) tracks", () => {
    const html = render("en", createElement(Menu, props()));
    const inputs = html.match(/<input[^>]*type="text"[^>]*>|<input(?![^>]*type=)[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const i of inputs) expect(i).toMatch(/class="[^"]*\bw-full\b[^"]*"/);
    for (const i of inputs) expect(i).toMatch(/class="[^"]*\bmin-w-0\b[^"]*"/);
    expect(html).toContain("sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6.5rem]");
    expect(html).not.toContain("sm:grid-cols-[1fr_1fr_6.5rem]");
  });
  it("category picker is a labelled group of pressed buttons; the add button sits outside; the editor is named", () => {
    const html = render("en", createElement(Menu, props()));
    const group = html.match(/<div role="group" aria-label="Categories"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    expect(group).toMatch(/<button[^>]*aria-pressed="true"[^>]*id="([^"]+)"|<button[^>]*id="([^"]+)"[^>]*aria-pressed="true"/);
    expect(group).not.toContain("New category");
    expect(html).toContain("New category");
    const btnId = group.match(/id="([^"]+)"/)?.[1];
    expect(html).toContain(`aria-labelledby="${btnId}"`);
  });
  it("allergen chips and stepper chips are 44 px targets; allergen text is text-sm", () => {
    const menu = render("en", createElement(Menu, props()));
    const chip = menu.match(/<button[^>]*aria-pressed="true"[^>]*>7 /)?.[0] ?? menu.match(/<button[^>]*aria-pressed="[^"]+"[^>]*>\d+ [A-Z]/)?.[0] ?? "";
    expect(chip).toContain("min-h-11");
    expect(chip).toContain("text-sm");
    expect(chip).not.toContain("text-xs");
    const stepper = render("en", createElement(Stepper, { current: "hours", onSelect: noop }));
    expect(stepper).not.toContain("min-h-9");
    expect(stepper).toContain("min-h-11");
  });
  it("file buttons show focus: the hidden input is a peer before its label", () => {
    const html = render("en", createElement(Photos, props()));
    expect(html).toMatch(/<input[^>]*type="file"[^>]*class="[^"]*\bpeer\b/);
    expect(html).toMatch(/<label[^>]*class="[^"]*peer-focus-visible:/);
  });
  it("prices show two decimals with the language's separator when not being edited", () => {
    expect(render("bg", createElement(Menu, props()))).toContain('value="1,80"');
    expect(render("en", createElement(Menu, props()))).toContain('value="1.80"');
  });
});

describe("live preview containment", () => {
  it("maps template links to preview pages, keeps in-page anchors in the frame, ignores the rest", () => {
    expect(previewLinkAction("/agala", "agala")).toEqual({ kind: "page", page: "home" });
    expect(previewLinkAction("/agala/menu", "agala")).toEqual({ kind: "page", page: "menu" });
    expect(previewLinkAction("#cat-1", "agala")).toEqual({ kind: "hash", id: "cat-1" });
    expect(previewLinkAction("https://maps.google.com/x", "agala")).toEqual({ kind: "ignore" });
    expect(previewLinkAction("tel:+359", "agala")).toEqual({ kind: "ignore" });
    expect(previewLinkAction(null, "agala")).toEqual({ kind: "ignore" });
  });
  it("a LangScope gives the template its own language, separate from the wizard's", () => {
    const html = render("bg", createElement(LangScope, { lang: "en", setLang: noop }, createElement(LangToggle)));
    expect(html).toMatch(/<button[^>]*lang="en"[^>]*aria-pressed="true"/);
  });
});
