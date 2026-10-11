// test/instagram-ui.test.ts — the wizard's Instagram import UI: entry buttons, the picking grid and its target selects, in bg and en.
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { WIZARD_BG, WIZARD_EN } from "@/src/i18n/wizard";
import { emptyDraft, type WizardDraft } from "@/src/wizard/schema";
import { dishOptions, IG_PICKS_MAX, importPatch, InstagramGrid, InstagramImport } from "@/app/new/components/InstagramImport";
import { Look } from "@/app/new/components/Steps/Look";
import { Photos } from "@/app/new/components/Steps/Photos";
import type { IgItem } from "@/app/new/components/api";
import type { StepProps } from "@/app/new/components/types";
import { media } from "./fixtures";

const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const render = (lang: Lang, el: ReactElement) => renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, el));
const noop = () => undefined;

function draftWithMenu(): WizardDraft {
  const d = emptyDraft("classic");
  d.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }, { key: "i2", name_bg: "", name_en: "", desc_bg: "", desc_en: "", price_eur: 0, allergens: [], image_media_id: null }] }];
  return d;
}
function props(over: Partial<StepProps> = {}): StepProps {
  return { id: "v1", draft: draftWithMenu(), media: [media("m1")], update: noop, addMedia: noop, baseUrl: "https://site.example", aiAvailable: true, fieldErrors: [], ...over };
}
const ITEMS: IgItem[] = [
  { id: "10", thumb: "https://scontent.cdninstagram.com/10.jpg", caption: "Сутрешно капучино на терасата", permalink: "", taken_at: "" },
  { id: "21", thumb: "https://scontent.cdninstagram.com/21.jpg", caption: "", permalink: "", taken_at: "" },
];

describe("Instagram entry points", () => {
  it("are hidden when the server has no Instagram app", () => {
    for (const lang of ["bg", "en"] as const) {
      expect(render(lang, createElement(Photos, props()))).not.toContain("Instagram");
      expect(render(lang, createElement(Look, props({ instagramAvailable: false })))).not.toContain("Instagram");
    }
  });
  it("Photos shows the import button with the privacy hint in both languages", () => {
    const bg = render("bg", createElement(Photos, props({ instagramAvailable: true })));
    const en = render("en", createElement(Photos, props({ instagramAvailable: true })));
    expect(bg).toContain("Внеси снимки от Instagram");
    expect(bg).toContain("не пазим паролата или достъпа ви");
    expect(en).toContain("Import photos from Instagram");
    expect(en).toContain("we keep neither your password nor your access");
    expect(bg).not.toContain("Import photos");
  });
  it("Look has the smaller cover entry", () => {
    expect(render("bg", createElement(Look, props({ instagramAvailable: true })))).toContain("Вземи корица от Instagram");
    expect(render("en", createElement(Look, props({ instagramAvailable: true })))).toContain("Take the cover from Instagram");
  });
  it("tells the owner how the sign-in came back, only in the step it started from", () => {
    const at = (igReturn: StepProps["igReturn"], lang: Lang = "bg", from: "photos" | "look" = "photos") =>
      render(lang, createElement(InstagramImport, { ...props({ instagramAvailable: true, igReturn }), from }));
    expect(at({ status: "cancelled", step: "photos" })).toContain(WIZARD_BG["ig.cancelled"]);
    expect(at({ status: "cancelled", step: "photos" }, "en")).toContain(WIZARD_EN["ig.cancelled"]);
    expect(at({ status: "error", step: "photos", reason: "token" })).toContain(WIZARD_BG["ig.error.token"]);
    expect(at({ status: "error", step: "photos", reason: "media" }, "en")).toContain(WIZARD_EN["ig.error.media"].replace("'", "&#x27;"));
    expect(at({ status: "error", step: "photos", reason: "session" }, "en")).toContain(WIZARD_EN["ig.error.session"]);
    expect(at({ status: "error", step: "photos", reason: "weird" }, "en")).toContain(WIZARD_EN["ig.failed"].replace("'", "&#x27;"));
    expect(at({ status: "ok", step: "photos" })).toContain(WIZARD_BG["ig.loading"]);
    expect(at({ status: "cancelled", step: "look" }, "bg", "photos")).not.toContain(WIZARD_BG["ig.cancelled"]);
  });
});

describe("InstagramGrid", () => {
  const grid = (lang: Lang, picks: Record<string, string>) =>
    render(lang, createElement(InstagramGrid, { items: ITEMS, username: "agala.cafe", picks, dishes: dishOptions(draftWithMenu(), lang), onToggle: noop, onTarget: noop }));

  it("renders labelled checkboxes with the caption, and a target select for each ticked photo (bg)", () => {
    const html = grid("bg", { "10": "item:c1/i1" });
    expect(html).toContain("Снимки от @agala.cafe");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toMatch(/<label[^>]*>(?:(?!<\/label>)[\s\S])*<input type="checkbox"[^>]* checked=""\/>(?:(?!<\/label>)[\s\S])*Сутрешно капучино на терасата/);
    expect(html).toContain("Снимка 2 без описание");
    expect(html.match(/<select/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Къде да отиде: Сутрешно капучино на терасата"');
    for (const o of ["В галерията", "Корица", "Лого"]) expect(html).toContain(`>${o}</option>`);
    expect(html).toContain('<optgroup label="Снимка на ястие">');
    expect(html).toMatch(/<option value="item:c1\/i1" selected="">Кафе · Еспресо<\/option>/);
    expect(html).not.toContain("item:c1/i2"); // a dish without a name is not offered
    expect(html).toContain("min-h-11"); // 44 px targets
    expect(html).toContain('alt=""'); // the caption is the label; the thumbnail is decorative
  });
  it("renders in English", () => {
    const html = grid("en", { "21": "cover" });
    expect(html).toContain("Photos from @agala.cafe");
    expect(html).toContain('aria-label="Use as: Photo 2, no caption"');
    expect(html).toMatch(/<option value="cover" selected="">Cover photo<\/option>/);
    expect(html).toContain('<optgroup label="Dish photo">');
    expect(html).toContain("Coffee · Espresso");
    expect(html).not.toContain("Снимка");
  });
  it("disables unticked photos once the per-import maximum is reached", () => {
    const many: IgItem[] = Array.from({ length: IG_PICKS_MAX + 1 }, (_, i) => ({ id: String(i), thumb: `https://scontent.cdninstagram.com/${i}.jpg`, caption: `p${i}`, permalink: "", taken_at: "" }));
    const picks = Object.fromEntries(many.slice(0, IG_PICKS_MAX).map((m) => [m.id, "gallery"]));
    const html = render("en", createElement(InstagramGrid, { items: many, picks, dishes: [], onToggle: noop, onTarget: noop }));
    expect(html.match(/<input type="checkbox"[^>]* disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain("<optgroup");
  });
});

describe("importPatch", () => {
  it("takes only the imported fields from the server and keeps local edits", () => {
    const local = draftWithMenu();
    local.name = "Local edit";
    local.gallery_media_ids = ["a"];
    const server = { ...draftWithMenu(), name: "Old", cover_media_id: "cov", logo_media_id: "logo", gallery_media_ids: ["a", "g1"] };
    server.categories = server.categories.map((c) => ({ ...c, items: c.items.map((it) => (it.key === "i1" ? { ...it, image_media_id: "dish" } : it)) }));
    expect(importPatch(local, server, ["gallery"])).toEqual({ gallery_media_ids: ["a", "g1"] });
    const p = importPatch(local, server, ["cover", { item: "c1/i1" }]);
    expect(p.cover_media_id).toBe("cov");
    expect(p.logo_media_id).toBeUndefined();
    expect(p.categories?.[0].items.map((i) => i.image_media_id)).toEqual(["dish", null]);
    expect("name" in p).toBe(false);
  });
});
