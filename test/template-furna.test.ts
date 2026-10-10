// test/template-furna.test.ts
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DraftInfo, Lang, Media, SiteState } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { def } from "@/src/templates/furna";
import { TEMPLATE_ACCENT_DEFAULTS } from "@/src/wizard/schema";
import { makeDemo } from "./helpers";

// Fonts come from the global next/font/google mock in test/setup.ts (R8): variables are `font-var-<Family>`.

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const NOW = Date.parse("2026-10-09T09:00:00.000Z"); // Fri 12:00 Sofia; demo hours 08:00–18:00

async function render(lang: Lang, opts: { page?: "home" | "menu"; now?: number; mutate?: (s: SiteState) => void; draft?: DraftInfo | null } = {}) {
  const { store, venue } = await makeDemo();
  const state = await store.getSite(venue.id);
  opts.mutate?.(state);
  return renderToStaticMarkup(
    createElement(Provider, { defaultLang: lang },
      createElement(def.Component, { state, now: opts.now ?? NOW, slug: "agala", page: opts.page ?? "menu", draft: opts.draft ?? null, live: false, feedUrl: "/api/site/agala" })),
  );
}

function photo(s: SiteState, id: string, gallery = false): Media {
  const m: Media = { id, venue_id: s.venue.id, storage_path: `${id}.jpg`, public_url: `https://demo.supabase.co/storage/v1/object/public/media/${id}.jpg`, is_gallery: gallery, position: 0, created_at: "2026-10-01T08:00:00.000Z" };
  s.media.push(m);
  return m;
}

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe("furna template", () => {
  it("is registered with Cyrillic-capable fonts, the mockup's tomato accent and the cafe business type", () => {
    expect(def.id).toBe("furna");
    expect(def.fontVars).toContain("font-var-Yeseva_One");
    expect(def.fontVars).toContain("font-var-Arsenal");
    expect(def.accentDefault).toBe("#b8432a");
    expect(TEMPLATE_ACCENT_DEFAULTS.furna).toBe(def.accentDefault);
    expect(def.business_types).toEqual(["cafe"]);
  });

  it("renders the menu page in Bulgarian: name, category, item, bg price, open status", async () => {
    const html = await render("bg");
    expect(html).toContain("Кафене „Ъгъла“");
    expect(html).toContain("Витрината");
    expect(html).toContain("Закуски");
    expect(html).toContain("Капучино");
    expect(html).toContain("2,90 €");
    expect(html).toContain("Отворено до 18:00");
    expect(html).toContain('class="tpl-furna');
    expect(html).toMatch(/<h1 class="fu-title" translate="no">/);
  });

  it("renders the menu page in English with en prices", async () => {
    const html = await render("en");
    expect(html).toContain("In the window");
    expect(html).toContain("Pastries");
    expect(html).toContain("Cappuccino");
    expect(html).toContain("€2.90");
    expect(html).toContain("Open until 18:00");
    expect(html).toContain("Allergens: 7 milk");
  });

  it("renders the home page with the shop window, the week strip (today marked) and no gallery without photos", async () => {
    const en = await render("en", { page: "home" });
    expect(en).toContain("See what&#x27;s in today");
    expect(en).toContain("When and where");
    expect(count(en, /class="fu-day[ "]/g)).toBe(7);
    expect(en).toMatch(/aria-current="date" class="fu-day is-today/);
    expect(en).toContain('<span class="fu-day-name">Fri · today</span>');
    expect(en).not.toContain('aria-labelledby="gallery"');
    const bg = await render("bg", { page: "home" });
    expect(bg).toContain("Кога и къде");
    expect(bg).toContain("Виж какво има днес");
  });

  it("shows the holiday note when today is a holiday, and on that day's tile", async () => {
    const mutate = (s: SiteState) => { s.holidays.push({ id: "h1", venue_id: s.venue.id, date: "2026-10-09", note_bg: "Инвентаризация", note_en: "Stock count" }); };
    const en = await render("en", { page: "home", mutate });
    expect(en).toContain('class="fu-holiday">Stock count');
    expect(en).toMatch(/class="fu-day is-today is-closed"[^>]*>.*?Stock count/);
    expect(await render("bg", { mutate })).toContain("Инвентаризация");
  });

  it("says closed when today's hours are null", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    const en = await render("en", { mutate });
    expect(en).toContain("Closed");
    expect(en).toContain("fu-status is-closed");
    expect(await render("bg", { mutate })).toContain("Затворено");
  });

  it("says closed today when nothing opens later this week", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }; };
    expect(await render("en", { mutate })).toContain("Closed today");
    expect(await render("bg", { mutate })).toContain("Днес е почивен ден");
  });

  it("says opens later before opening time", async () => {
    const now = Date.parse("2026-10-09T04:00:00.000Z"); // Fri 07:00 Sofia, opens 08:00
    const en = await render("en", { now });
    expect(en).toContain("Opens today at 08:00");
    expect(en).toContain("fu-status is-opens_later");
    expect(await render("bg", { now })).toContain("Отваря днес в 08:00");
  });

  it("keeps sold-out items (struck, with a badge) and hides expired specials", async () => {
    const mutate = (s: SiteState) => {
      s.items[1].sold_out_until = "2026-10-10T06:00:00.000Z";
      s.items.push({ ...s.items[0], id: "sp-old", name_bg: "Стара оферта", name_en: "Old special", is_special: true, special_expires_at: "2026-10-09T08:00:00.000Z" });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Sold out until");
    expect(html).toMatch(/class="fu-item is-sold"><div class="fu-item-body"><h4 class="fu-item-name">Cappuccino/);
    expect(html).toContain("Cappuccino");
    expect(html).not.toContain("Old special");
  });

  it("lists specials in the oven panel by expiry, with today's time, and strikes a sold-out one", async () => {
    const mutate = (s: SiteState) => {
      const base = { ...s.items[4], is_special: true, sold_out_until: null };
      s.items.push({ ...base, id: "sp-late", name_bg: "Козунак с портокал", name_en: "Orange kozunak", special_expires_at: "2026-10-09T15:00:00.000Z", created_at: "2026-10-09T07:30:00.000Z" });
      s.items.push({ ...base, id: "sp-soon", name_bg: "Тиквеник", name_en: "Pumpkin pie", special_expires_at: "2026-10-09T11:00:00.000Z", created_at: "2026-10-09T04:15:00.000Z", sold_out_until: "2026-10-10T04:15:00.000Z" });
      s.items.push({ ...base, id: "sp-open", name_bg: "Селски хляб", name_en: "Country loaf", special_expires_at: null, created_at: "2026-10-09T08:40:00.000Z" });
    };
    const html = await render("en", { page: "home", mutate });
    const oven = html.slice(html.indexOf('aria-labelledby="oven-h"'), html.indexOf("</aside>"));
    expect(oven).toContain("Fresh from the oven");
    const order = ["Pumpkin pie", "Orange kozunak", "Country loaf"].map((n) => oven.indexOf(n));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(oven).toContain('class="fu-oven-time">07:15'); // 04:15Z posted today, Sofia time
    expect(oven).toMatch(/class="fu-oven-row is-sold">.*?Pumpkin pie.*?sold out · back tomorrow at 07:15/);
    expect(oven).toContain("until 18:00");
    expect(oven).toContain("out 20 min ago");
    const bg = await render("bg", { page: "home", mutate });
    expect(bg).toContain("Днес от пещта");
    expect(bg).toContain("свърши · пак от утре в 07:15");
  });

  it("falls back to picks from the window in the oven panel on the home page when there are no specials, and hides it on the menu page", async () => {
    const home = await render("en", { page: "home" });
    expect(home).toContain("In the window today");
    expect(home).not.toContain("fu-oven-time");
    const menu = await render("en", { page: "menu" });
    expect(menu).not.toContain('aria-labelledby="oven-h"');
  });

  it("renders a square photo for an item with an image and the compact row for one without", async () => {
    const mutate = (s: SiteState) => { s.items[0].image_media_id = photo(s, "m-espresso").id; };
    const html = await render("en", { mutate });
    expect(count(html, /class="fu-item has-photo/g)).toBe(1);
    expect(html).toMatch(/class="fu-item-photo"><img alt="Espresso"/);
    expect(count(html, /class="fu-item-photo"/g)).toBe(1);
    const plain = await render("en");
    expect(plain).not.toContain("fu-item-photo");
    expect(plain).not.toContain("<img");
  });

  it("shows the cover in the side column, or the designed letter tile without one", async () => {
    const withCover = await render("en", { page: "home", mutate: (s) => { s.venue.cover_media_id = photo(s, "m-cover").id; } });
    expect(withCover).toMatch(/class="fu-side-photo"><img/);
    const without = await render("en", { page: "home" });
    expect(without).toContain('class="fu-side-photo is-fallback"');
    expect(without).toContain("<span>К</span>");
  });

  it("shows live announcements in the notice strip and nothing when there are none", async () => {
    expect(await render("en", { page: "home" })).not.toContain("fu-notice");
    const mutate = (s: SiteState) => {
      s.announcements.push({ id: "a1", venue_id: s.venue.id, text_bg: "В неделя печем по поръчка", text_en: "Sunday: baking to order only", expires_at: null, created_at: "2026-10-08T08:00:00.000Z" });
      s.announcements.push({ id: "a2", venue_id: s.venue.id, text_bg: "Стара", text_en: "Expired notice", expires_at: "2026-10-08T08:00:00.000Z", created_at: "2026-10-07T08:00:00.000Z" });
    };
    const html = await render("en", { page: "home", mutate });
    expect(html).toContain("Sunday: baking to order only");
    expect(html).not.toContain("Expired notice");
    expect(await render("bg", { page: "home", mutate })).toContain(">Обява</h2>");
  });

  it("adds category jump links for a long menu", async () => {
    const mutate = (s: SiteState) => {
      for (let n = 0; n < 40; n++) s.items.push({ ...s.items[0], id: `big-${n}`, name_bg: `Артикул ${n}`, name_en: `Item ${n}`, position: 100 + n, category_id: s.categories[n % s.categories.length].id });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Item 39");
    expect(count(html, /class="fu-jumplink"/g)).toBe(4);
    for (const c of ["Coffee", "Pastries"]) expect(html).toMatch(new RegExp(`href="#cat-[^"]+" class="fu-jumplink">${c}`));
  });

  it("offers the menu and the call in the phone dock on the home page, only the call on the menu page", async () => {
    const home = await render("en", { page: "home" });
    expect(home).toMatch(/class="fu-dock">.*?href="\/agala\/menu"/);
    expect(home).toContain('href="tel:+35920000000"');
    const menu = await render("en", { page: "menu" });
    expect(menu).toContain('class="fu-dock is-single"');
  });

  it("keeps the change flash reaching its final frame under reduced motion", () => {
    // `animation: none` would freeze .fu-flash at its base opacity (1) forever, because useLiveSite never clears `changed`.
    const css = readFileSync(new URL("../src/templates/furna/styles.css", import.meta.url), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.fu-flash\s*\{[^}]*animation:\s*fu-flash\s+1ms[^}]*both\s*!important/);
    expect(reduced.indexOf(".fu-flash")).toBeGreaterThan(reduced.indexOf("animation: none !important"));
  });

  it("scopes every rule under the root class or its own fu- prefix", () => {
    const css = readFileSync(new URL("../src/templates/furna/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/(^|[{}])\s*([^{}@][^{}]*)\{/g)].map((m) => m[2].trim()).filter((s) => !/^(@|from|to|\d+%)/.test(s));
    expect(selectors.length).toBeGreaterThan(80);
    for (const sel of selectors.flatMap((s) => s.split(","))) expect(sel.trim()).toMatch(/^(\.tpl-furna|\.fu-)/);
  });

  it("keeps the status date-time on one line", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    expect(await render("en", { mutate })).toMatch(/<span class="fu-nowrap">[^<]*2026[^<]*<\/span>/);
  });

  it("renders the draft note with the summary when a draft is given", async () => {
    const draft: DraftInfo = { id: "d1", status: "proposed", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "", preview_en: "", key: "k" };
    expect(await render("en", { draft })).toContain("Cappuccino €3.20");
    expect(await render("bg", { draft })).toContain("Капучино 3,20 €");
  });
});
