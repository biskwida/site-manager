// test/template-mehana.test.ts
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DraftInfo, Lang, SiteState } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { makeDemo } from "./helpers";

// next/font/google only works through the Next.js compiler; at test time its module is empty, so stub the families this template uses.
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ className: `f-${name}`, variable: `fv-${name}`, style: { fontFamily: name } });
  return { Brygada_1918: font("brygada"), Wix_Madefor_Text: font("wix") };
});

import { boldLead, roman } from "@/src/templates/mehana/bits";
import { contrastRatio } from "@/src/templates/shared/color";
import { def } from "@/src/templates/mehana";
import { TEMPLATE_ACCENT_DEFAULTS } from "@/src/wizard/schema";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const NOW = Date.parse("2026-10-09T09:00:00.000Z"); // Fri 12:00 Sofia; demo hours 08:00–18:00
const PHOTO = "https://demo.supabase.co/storage/v1/object/public/media/plate.jpg";

async function render(lang: Lang, opts: { page?: "home" | "menu"; now?: number; mutate?: (s: SiteState) => void; draft?: DraftInfo | null } = {}) {
  const { store, venue } = await makeDemo();
  const state = await store.getSite(venue.id);
  opts.mutate?.(state);
  return renderToStaticMarkup(
    createElement(Provider, { defaultLang: lang },
      createElement(def.Component, { state, now: opts.now ?? NOW, slug: "agala", page: opts.page ?? "menu", draft: opts.draft ?? null, live: false, feedUrl: "/api/site/agala" })),
  );
}

/** Adds a photo to the media list and points the first item at it. */
function withPhoto(s: SiteState) {
  s.media.push({ id: "m-plate", venue_id: s.venue.id, storage_path: "plate.jpg", public_url: PHOTO, is_gallery: false, position: 0, created_at: "2026-10-01T00:00:00.000Z" });
  s.items[0].image_media_id = "m-plate";
}

describe("mehana template", () => {
  it("is registered with Cyrillic-capable fonts, tavern business types and the wine accent the wizard uses", () => {
    expect(def.id).toBe("mehana");
    expect(def.fontVars).toContain("fv-brygada");
    expect(def.fontVars).toContain("fv-wix");
    expect(def.accentDefault).toBe("#6e1f1b");
    expect(TEMPLATE_ACCENT_DEFAULTS.mehana).toBe(def.accentDefault);
    expect(def.business_types).toEqual(["restaurant", "bar"]);
  });
  it("numbers courses in roman numerals", () => {
    expect([1, 2, 3, 4, 9, 12, 40].map(roman)).toEqual(["I", "II", "III", "IV", "IX", "XII", "XL"]);
  });
  it("renders the menu page in Bulgarian: name, numbered course, item, bg price, open status", async () => {
    const html = await render("bg");
    expect(html).toContain("Кафене „Ъгъла“");
    expect(html).toContain("Закуски");
    expect(html).toContain("Капучино");
    expect(html).toContain("2,90 €");
    expect(html).toContain("Отворено до 18:00");
    expect(html).toContain("Менюто, по ред");
    expect(html).toMatch(/class="me-numeral">I<\/span>/);
    expect(html).toMatch(/class="me-numeral">II<\/span>/);
    expect(html).toContain('class="tpl-mehana');
    expect(html).toMatch(/<h1 class="me-title" translate="no">/);
  });
  it("renders the menu page in English with en prices", async () => {
    const html = await render("en");
    expect(html).toContain("Pastries");
    expect(html).toContain("Cappuccino");
    expect(html).toContain("€2.90");
    expect(html).toContain("Open until 18:00");
    expect(html).toContain("The menu, course by course");
  });
  it("shows the holiday note when today is a holiday", async () => {
    const mutate = (s: SiteState) => { s.holidays.push({ id: "h1", venue_id: s.venue.id, date: "2026-10-09", note_bg: "Инвентаризация", note_en: "Stock count" }); };
    expect(await render("en", { mutate })).toContain("Stock count");
    expect(await render("bg", { mutate })).toContain("Инвентаризация");
  });
  it("says closed when today's hours are null, with the next opening on one line", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    const en = await render("en", { mutate });
    expect(en).toContain("Closed · opens");
    expect(en).toMatch(/<span class="me-nowrap">[^<]*2026[^<]*<\/span>/);
    expect(await render("bg", { mutate })).toContain("Затворено");
  });
  it("says closed today when nothing opens this week", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }; };
    expect(await render("en", { mutate })).toContain("Closed today");
    expect(await render("bg", { mutate })).toContain("Днес е почивен ден");
  });
  it("says opens later before opening time", async () => {
    const now = Date.parse("2026-10-09T04:00:00.000Z"); // Fri 07:00 Sofia, opens 08:00
    expect(await render("en", { now })).toContain("Opens today at 08:00");
    expect(await render("bg", { now })).toContain("Отваря днес в 08:00");
  });
  it("puts the skip link on the status", async () => {
    const html = await render("en", { page: "home" });
    expect(html).toContain('href="#status"');
    expect(html).toContain('id="status"');
  });
  it("strikes sold-out items and says when they are back, and hides expired specials", async () => {
    const mutate = (s: SiteState) => {
      s.items[1].sold_out_until = "2026-10-10T06:00:00.000Z";
      s.items.push({ ...s.items[0], id: "sp-old", name_bg: "Стара оферта", name_en: "Old special", is_special: true, special_expires_at: "2026-10-09T08:00:00.000Z" });
    };
    const html = await render("en", { mutate });
    expect(html).toMatch(/<s>[^<]+<\/s>/);
    expect(html).toContain('class="me-sold">Sold out');
    expect(html).toContain("Back from");
    expect(html).not.toContain("Old special");
  });
  it("shows announcements under Tonight and the first live special as the dish of the day", async () => {
    const mutate = (s: SiteState) => {
      s.announcements.push({ id: "a1", venue_id: s.venue.id, text_bg: "Жива музика от 20:00. Вътре има места.", text_en: "Live music from 20:00. There is room inside.", expires_at: null, created_at: "2026-10-09T08:00:00.000Z" });
      s.items.push({ ...s.items[0], id: "sp1", name_bg: "Чомлек с телешко", name_en: "Beef chomlek", price_eur: 14.9, is_special: true, special_expires_at: "2026-10-09T19:30:00.000Z" });
      s.items.push({ ...s.items[0], id: "sp2", name_bg: "Боб чорба", name_en: "Bean soup", price_eur: 4.5, is_special: true, special_expires_at: null });
    };
    const bg = await render("bg", { page: "home", mutate });
    expect(bg).toContain("Тази вечер");
    expect(bg).toContain("<strong>Жива музика от 20:00.</strong> Вътре има места.");
    expect(bg).toContain("Ястие на деня");
    expect(bg).toMatch(/me-dish-name">Чомлек с телешко/);
    expect(bg).toContain("до 22:30");
    expect(bg).toContain("14,90 €");
    expect(bg).toContain("Също днес");
    const en = await render("en", { page: "home", mutate });
    expect(en).toContain("Tonight");
    expect(en).toContain("Dish of the day");
  });
  it("renders no Tonight section without announcements or specials", async () => {
    const html = await render("en", { page: "home" });
    expect(html).not.toContain("Dish of the day");
    expect(html).not.toContain("me-tonight");
  });
  it("shows the Book a table call button only when the venue has a phone", async () => {
    const withPhone = await render("bg", { page: "home" });
    expect(withPhone).toContain("Резервирай маса");
    expect(withPhone).toContain('href="tel:+35920000000"');
    expect(withPhone).toContain("me-actionbar");
    expect(withPhone).toContain('aria-label="Действия"');
    const none = await render("bg", { page: "home", mutate: (s) => { s.venue.phone = ""; } });
    expect(none).not.toContain("Резервирай");
    expect(none).not.toContain("tel:");
    expect(none).not.toContain("me-actionbar");
  });
  it("shows the phone number on the menu page too: in the call button, in the footer, and in the action bar's name", async () => {
    for (const page of ["home", "menu"] as const) {
      const bg = await render("bg", { page });
      expect(bg).toMatch(/me-reserve-top"><span>Резервирай маса<span aria-hidden="true"> · <\/span><span class="me-nowrap">\+359 2 000 0000<\/span><\/span><\/a>/);
      expect(bg).toMatch(/<footer[\s\S]*href="tel:\+35920000000"[^>]*>\+359 2 000 0000<\/a>[\s\S]*<\/footer>/);
      // The accessible name starts with the visible label (WCAG 2.5.3) and says that it calls.
      expect(bg).toContain('aria-label="Резервирай: обади се на +359 2 000 0000"');
      expect(await render("en", { page })).toContain('aria-label="Book a table: call +359 2 000 0000"');
    }
  });
  it("renders the home page: courses, the dark visit section, grouped hours, no gallery without photos", async () => {
    const html = await render("en", { page: "home" });
    expect(html).toContain("The menu, course by course");
    expect(html).toContain("Full menu");
    expect(html).toContain("Come on in");
    expect(html).toContain("Opening hours");
    expect(html).not.toContain('aria-labelledby="gallery-h"');
  });
  it("lists upcoming holidays in the visit section", async () => {
    const mutate = (s: SiteState) => { s.holidays.push({ id: "h2", venue_id: s.venue.id, date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" }); };
    const html = await render("en", { page: "home", mutate });
    expect(html).toContain("24 Dec 2026");
    expect(html).toContain("Christmas Eve");
  });
  it("renders a round plate photo for an item with a photo and none for an item without", async () => {
    const plain = await render("en");
    expect(plain).not.toContain("me-plate");
    expect(plain).not.toContain("<img");
    const html = await render("en", { mutate: withPhoto });
    expect(html.match(/class="me-plate"/g)?.length).toBe(1);
    expect(html).toContain("<img");
    // The plate sits beside the visible dish name, so the photo itself is decorative.
    expect(html).toMatch(/<span class="me-plate"><img alt=""/);
    expect(html).toContain(encodeURIComponent(PHOTO));
  });
  it("shows the cover on the home page band and nothing in its place without one", async () => {
    const cover = (s: SiteState) => {
      s.media.push({ id: "m-cover", venue_id: s.venue.id, storage_path: "cover.jpg", public_url: PHOTO, is_gallery: false, position: 0, created_at: "2026-10-01T00:00:00.000Z" });
      s.venue.cover_media_id = "m-cover";
    };
    expect(await render("en", { page: "home", mutate: cover })).toContain("me-frame-photo");
    expect(await render("en", { page: "home" })).not.toContain("me-frame");
  });
  it("shows three courses on the home page even when the first one holds only specials", async () => {
    const mutate = (s: SiteState) => {
      for (const i of s.items) if (i.category_id === s.categories[0].id) { i.is_special = true; i.special_expires_at = null; }
    };
    const html = await render("en", { page: "home", mutate });
    expect(html.match(/class="me-course"/g)?.length).toBe(3);
    expect(html).toContain("Drinks"); // the fourth category moves up
    expect(html).toMatch(/class="me-numeral">II<\/span><span>Pastries/); // numbering still follows the category order
  });
  it("lays out four or fewer courses in two columns and longer menus in up to three", async () => {
    expect(await render("en")).toContain('class="me-courses-full is-few"');
    const mutate = (s: SiteState) => {
      s.categories.push({ ...s.categories[0], id: "c5", name_bg: "Десерти", name_en: "Desserts", position: 9 });
      s.items.push({ ...s.items[0], id: "d1", category_id: "c5", name_bg: "Баклава", name_en: "Baklava" });
    };
    expect(await render("en", { mutate })).toContain('class="me-courses-full"');
  });
  it("bolds an announcement's first sentence without stopping at abbreviations", () => {
    expect(boldLead("Жива музика от 20:00. Вътре има места.")).toEqual(["Жива музика от 20:00.", "Вътре има места."]);
    expect(boldLead("Затворено на ул. Раковски днес. Отваряме утре.")).toEqual(["Затворено на ул. Раковски днес.", "Отваряме утре."]);
    expect(boldLead("Party with Dr. Smith tonight! Book now.")).toEqual(["Party with Dr. Smith tonight!", "Book now."]);
    expect(boldLead("Само една фраза")).toBeNull();
    expect(boldLead("Ще има музика. и танци")).toBeNull(); // no capital after the stop: ambiguous, bold nothing
  });
  it("computes the band colour in TypeScript (no CSS relative colour) and keeps band text readable on every accent", async () => {
    const css = readFileSync(new URL("../src/templates/mehana/styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/oklch\(from/);
    for (const accent of ["#6e1f1b", "#2f5d46", "#3b2f5c", "#7a4a12", "#e8b4b8", "#f5d547", "#9ad1d4"]) {
      const html = await render("bg", { page: "home", mutate: (s) => { s.venue.theme.accent = accent; } });
      const wine = /--me-wine:(#[0-9a-f]{6})/.exec(html)?.[1];
      expect(wine, accent).toBeDefined();
      expect(contrastRatio("#f3eadb", wine!), `parchment on ${wine}`).toBeGreaterThanOrEqual(4.5); // title, nav, status
      expect(contrastRatio("#e8c98b", wine!), `gold on ${wine}`).toBeGreaterThanOrEqual(4.5); // "To the menu" link
      expect(contrastRatio(wine!, "#f3eadb"), `${wine} numerals on paper`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#9bd39b", wine!), `open dot on ${wine}`).toBeGreaterThanOrEqual(3); // non-text indicator
    }
    expect(await render("bg", { mutate: (s) => { s.venue.theme.accent = "#6e1f1b"; } })).toContain("--me-wine:#6e1f1b");
  });
  it("adds numbered course jump links for a long menu", async () => {
    const mutate = (s: SiteState) => {
      for (let n = 0; n < 40; n++) s.items.push({ ...s.items[0], id: `big-${n}`, name_bg: `Артикул ${n}`, name_en: `Item ${n}`, position: 100 + n, category_id: s.categories[n % s.categories.length].id });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Item 39");
    expect(html.match(/class="me-jumplink"/g)?.length).toBe(4);
    expect(html).toMatch(/href="#cat-[^"]+" class="me-jumplink"><span aria-hidden="true" class="me-numeral">IV<\/span>/);
  });
  it("keeps the change flash reaching its final frame under reduced motion", () => {
    // `animation: none` would freeze .me-flash at its base opacity (1) forever, because useLiveSite never clears `changed`.
    const css = readFileSync(new URL("../src/templates/mehana/styles.css", import.meta.url), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.me-flash\s*\{[^}]*animation:\s*me-flash\s+1ms[^}]*both\s*!important/);
    expect(reduced.indexOf(".me-flash")).toBeGreaterThan(reduced.indexOf("animation: none !important"));
  });
  it("keeps the language toggle free of transitions and every rule scoped to the template", () => {
    const css = readFileSync(new URL("../src/templates/mehana/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.me-lang button \{[^}]*transition: none/);
    // Every selector starts with the root class or a me- class (no bare element selectors leak into the app).
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "")
      .match(/(^|[{}])\s*([^{}@]+)\{/g)?.map((m) => m.replace(/^[{}]?\s*/, "").replace(/\{$/, "").trim()) ?? [];
    const loose = selectors.flatMap((s) => s.split(",").map((x) => x.trim())).filter((x) => x && !/^(\.tpl-mehana|\.me-)/.test(x));
    expect(loose).toEqual([]);
  });
  it("renders the draft note with the summary when a draft is given", async () => {
    const draft: DraftInfo = { id: "d1", status: "proposed", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "", preview_en: "", key: "k" };
    expect(await render("en", { draft })).toContain("Cappuccino €3.20");
    expect(await render("bg", { draft })).toContain("Капучино 3,20 €");
  });
});
