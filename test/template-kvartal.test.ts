// test/template-kvartal.test.ts
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DraftInfo, Lang, SiteState } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { TEMPLATE_ACCENT_DEFAULTS } from "@/src/wizard/schema";
import { EXTREME_ACCENTS, LOOK_ACCENT_PRESETS, makeDemo, sweepAccents } from "./helpers";

// next/font/google only works through the Next.js compiler; this file asserts the fv-* values below, so it keeps its own stub.
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ className: `f-${name}`, variable: `fv-${name}`, style: { fontFamily: name } });
  return { Geologica: font("geologica"), Fira_Sans: font("fira") };
});

import { def } from "@/src/templates/kvartal";
import { accentVars } from "@/src/templates/kvartal/Template";
import { contrastRatio } from "@/src/templates/shared/color";
import { fitHeadline } from "@/src/templates/kvartal/Hero";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const NOW = Date.parse("2026-10-09T09:00:00.000Z"); // Fri 12:00 Sofia; demo hours 08:00–18:00
const PHOTO = "https://demo.supabase.co/storage/v1/object/public/media/v/latte.jpg";

async function render(lang: Lang, opts: { page?: "home" | "menu"; now?: number; mutate?: (s: SiteState) => void; draft?: DraftInfo | null } = {}) {
  const { store, venue } = await makeDemo();
  const state = await store.getSite(venue.id);
  opts.mutate?.(state);
  return renderToStaticMarkup(
    createElement(Provider, { defaultLang: lang },
      createElement(def.Component, { state, now: opts.now ?? NOW, slug: "agala", page: opts.page ?? "menu", draft: opts.draft ?? null, live: false, feedUrl: "/api/site/agala" })),
  );
}

/** Gives the Latte (third coffee) a photo on an allowed host. */
const withPhoto = (s: SiteState) => {
  s.media.push({ id: "m-latte", venue_id: s.venue.id, storage_path: "v/latte.jpg", public_url: PHOTO, is_gallery: false, position: 0, created_at: "2026-10-01T00:00:00.000Z" });
  s.items.find((i) => i.name_en === "Latte")!.image_media_id = "m-latte";
};

describe("kvartal template", () => {
  it("is registered with Geologica + Fira Sans, the mockup's vermilion and cafe/bar business types", () => {
    expect(def.id).toBe("kvartal");
    expect(def.fontVars).toContain("fv-geologica");
    expect(def.fontVars).toContain("fv-fira");
    expect(def.accentDefault).toBe("#c23a1c");
    expect(TEMPLATE_ACCENT_DEFAULTS.kvartal).toBe(def.accentDefault);
    expect(def.business_types).toEqual(["cafe", "bar"]);
  });
  it("renders the menu page in Bulgarian: name, numbered table, bg price, open status", async () => {
    const html = await render("bg");
    expect(html).toContain('class="tpl-kvartal');
    expect(html).toContain("Кафене „Ъгъла“");
    expect(html).toContain("Закуски");
    expect(html).toContain("Капучино");
    expect(html).toContain("2,90 €");
    expect(html).toContain("Отворено до 18:00");
    expect(html).toContain('role="table"');
    expect(html).toContain('role="columnheader"');
    expect(html).toContain("Алергени");
    // Coffee is category 1, Cappuccino its second item; Pastries is category 2.
    expect(html).toMatch(/<span role="cell" class="kv-td-no">1\.2<\/span>/);
    expect(html).toMatch(/<span role="cell" class="kv-td-no">2\.1<\/span>/);
  });
  it("renders the home page in English with en prices, the tagline as the headline and the address as the visit heading", async () => {
    const html = await render("en", { page: "home" });
    expect(html).toContain("Cappuccino");
    expect(html).toContain("€2.90");
    expect(html).toContain("Open until 18:00");
    expect(html).toContain("Coffee, pastries and a quiet corner on Rakovski street.");
    expect(html).toMatch(/<h2 id="visit-h" class="kv-address">.*ул\. „Георги С\. Раковски“ 100, София<\/h2>/);
    expect(html).toContain("Full menu");
    expect(html).not.toContain('aria-labelledby="gallery"');
  });
  it("falls back to the venue name as the headline when there is no tagline", async () => {
    const mutate = (s: SiteState) => { s.venue.tagline_bg = ""; s.venue.tagline_en = ""; };
    const html = await render("en", { page: "home", mutate });
    expect(html).toMatch(/<h1 id="kv-h1"[^>]*translate="no"[^>]*>Кафене „Ъгъла“<\/h1>/);
  });
  it("shows the holiday note when today is a holiday", async () => {
    const mutate = (s: SiteState) => { s.holidays.push({ id: "h1", venue_id: s.venue.id, date: "2026-10-09", note_bg: "Инвентаризация", note_en: "Stock count" }); };
    const en = await render("en", { mutate });
    expect(en).toContain("Stock count");
    expect(en).toContain('class="kv-now is-closed"');
    expect(await render("bg", { mutate })).toContain("Инвентаризация");
  });
  it("says closed when today's hours are null, and keeps the date-time on one line", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    const en = await render("en", { mutate });
    expect(en).toContain("Closed");
    expect(en).toMatch(/<span class="kv-nowrap">[^<]*2026[^<]*<\/span>/);
    expect(await render("bg", { mutate })).toContain("Затворено");
  });
  it("says closed today when nothing opens later this week", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }; };
    expect(await render("en", { mutate })).toContain("Closed today");
    expect(await render("bg", { mutate })).toContain("Днес е почивен ден");
  });
  it("says opens later before opening time, with today's hours under it", async () => {
    const now = Date.parse("2026-10-09T04:00:00.000Z"); // Fri 07:00 Sofia, opens 08:00
    const en = await render("en", { now });
    expect(en).toContain("Opens today at 08:00");
    expect(en).toContain("Today 08:00–18:00");
    expect(en).toContain('class="kv-now is-opens_later"');
    expect(await render("bg", { now })).toContain("Отваря днес в 08:00");
  });
  it("strikes sold-out items, keeps them listed, and hides expired specials", async () => {
    const mutate = (s: SiteState) => {
      s.items.find((i) => i.name_en === "Cappuccino")!.sold_out_until = "2026-10-10T06:00:00.000Z";
      s.items.push({ ...s.items[0], id: "sp-old", name_bg: "Стара оферта", name_en: "Old special", is_special: true, special_expires_at: "2026-10-09T08:00:00.000Z" });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("<s>Cappuccino</s>");
    expect(html).toContain("Sold out until");
    expect(html).toContain("kv-tr is-sold");
    expect(html).not.toContain("Old special");
  });
  it("lists live specials and announcements in the Today band, sold-out specials struck", async () => {
    const mutate = (s: SiteState) => {
      s.items.push({ ...s.items[0], id: "sp-1", name_bg: "Шакшука", name_en: "Shakshuka", price_eur: 9.9, is_special: true, special_expires_at: null, position: 50 });
      s.items.push({ ...s.items[0], id: "sp-2", name_bg: "Палачинки", name_en: "Pancakes", price_eur: 8.2, is_special: true, special_expires_at: null, sold_out_until: "2026-10-10T06:00:00.000Z", position: 51 });
      s.announcements.push({ id: "a1", venue_id: s.venue.id, text_bg: "DJ в събота от 21:00", text_en: "DJ on Saturday from 21:00", expires_at: null, created_at: "2026-10-01T00:00:00.000Z" });
    };
    const html = await render("en", { page: "home", mutate });
    const band = html.slice(html.indexOf('class="kv-today"'), html.indexOf('class="kv-wrap kv-menu-home"'));
    expect(band).toContain("Shakshuka");
    expect(band).toContain("€9.90");
    expect(band).toContain("1.5"); // Shakshuka is the fifth coffee by position
    expect(band).toContain("<s>Pancakes</s>");
    expect(band).toContain("DJ on Saturday from 21:00");
  });
  it("has no Today band when there are no specials or announcements", async () => {
    expect(await render("en", { page: "home" })).not.toContain('class="kv-today"');
  });
  it("renders a photo for an item with an image and none for an item without", async () => {
    const html = await render("en", { mutate: withPhoto });
    const latte = html.slice(html.indexOf('id="item-'), html.length);
    expect(html).toContain("kv-table has-photos");
    expect(html).toMatch(/<div role="row" id="item-[^"]+" class="kv-tr has-img">[\s\S]*?<img[^>]*alt="Latte"/);
    expect(latte.match(/<img /g)?.length).toBe(1);
    // Categories without photos keep the compact text rows (no photo column).
    expect(html.match(/kv-table has-photos/g)?.length).toBe(1);
  });
  it("renders no item images when no item has a photo", async () => {
    const html = await render("en");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("has-photos");
  });
  it("adds numbered category jump links for a long menu", async () => {
    const mutate = (s: SiteState) => {
      for (let n = 0; n < 40; n++) s.items.push({ ...s.items[0], id: `big-${n}`, name_bg: `Артикул ${n}`, name_en: `Item ${n}`, position: 100 + n, category_id: s.categories[n % s.categories.length].id });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Item 39");
    expect(html.match(/class="kv-jumplink"/g)?.length).toBe(4);
    expect(html).toContain('href="#cat-');
  });
  it("keeps the home page to a preview: two categories, four rows each, chips to every category", async () => {
    const mutate = (s: SiteState) => {
      for (let n = 0; n < 40; n++) s.items.push({ ...s.items[0], id: `big-${n}`, name_bg: `Артикул ${n}`, name_en: `Item ${n}`, position: 100 + n, category_id: s.categories[n % s.categories.length].id });
    };
    const html = await render("en", { page: "home", mutate });
    expect(html.match(/class="kv-chip"/g)?.length).toBe(4);
    expect(html.match(/class="kv-tr( is-sold)?( has-img)?"/g)?.length).toBe(8);
    expect(html).toContain('href="/agala/menu#cat-');
  });
  it("renders the draft note with the summary when a draft is given", async () => {
    const draft: DraftInfo = { id: "d1", status: "proposed", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "", preview_en: "", key: "k" };
    expect(await render("en", { draft })).toContain("Cappuccino €3.20");
    expect(await render("bg", { draft })).toContain("Капучино 3,20 €");
  });
  it("sizes the headline from its longest word and its length", () => {
    const short = fitHeadline("Яйца до обяд. Негрони до полунощ.");
    const long = fitHeadline("Кафе, закуски и спокойствие на ъгъла на „Раковски“, отворено всеки ден от сутрин до вечер.");
    expect(short.tier).toBe("s");
    expect(long.tier).toBe("l");
    const fit = (x: ReturnType<typeof fitHeadline>) => parseFloat(String((x.style as Record<string, string>)["--kv-fit"]));
    expect(fit(fitHeadline("Квартал"))).toBeGreaterThan(fit(fitHeadline("Спокойствие")));
  });
  it("keeps every table row's cell count equal to its header count (photo and text-only tables)", async () => {
    const html = await render("en", { mutate: withPhoto });
    const tables = html.split('role="table"').slice(1).map((t) => t.slice(0, t.indexOf("</section>")));
    expect(tables.length).toBe(4);
    for (const t of tables) {
      const rows = t.split('role="row"').slice(1);
      const head = (rows[0].match(/role="columnheader"/g) ?? []).length;
      expect(head).toBeGreaterThanOrEqual(4);
      for (const r of rows.slice(1)) expect((r.match(/role="cell"/g) ?? []).length).toBe(head);
    }
  });
  it("never removes photo or allergen cells from one row but not the header (no display:none on the photo column)", () => {
    const css = readFileSync(new URL("../src/templates/kvartal/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]*\.kv-td-img[^{}]*)\{([^}]*)\}/g)) expect(m[2]).not.toMatch(/display:\s*none/);
    // The allergen column is hidden on phones by one selector that matches header and cells alike.
    expect(css).toMatch(/\.kv-td-al\s*\{[^}]*display:\s*none/);
  });
  it("gives empty allergen cells screen-reader text", async () => {
    const en = await render("en");
    expect(en).toMatch(/<span role="cell" class="kv-td-al"><span aria-hidden="true">—<\/span><span class="kv-sr">none<\/span><\/span>/);
    expect(await render("bg")).toContain('<span class="kv-sr">без алергени</span>');
  });
  it("keeps the skip link visually hidden until focused, so it never sits over the draft note", async () => {
    const css = readFileSync(new URL("../src/templates/kvartal/styles.css", import.meta.url), "utf8");
    const base = css.match(/\.kv-skip\s*\{([^}]*)\}/)![1];
    expect(base).toMatch(/clip(-path)?:/);
    expect(base).toMatch(/width:\s*1px/);
    expect(base).not.toMatch(/top:\s*-100%/);
    expect(css).toMatch(/\.kv-skip:focus-visible\s*\{[^}]*clip(-path)?:\s*(auto|none)/);
    const draft: DraftInfo = { id: "d1", status: "proposed", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "", preview_en: "", key: "k" };
    const html = await render("en", { draft });
    expect(html.indexOf('class="kv-draft"')).toBeLessThan(html.indexOf('class="kv-skip"'));
  });
  it("lists phone and Instagram in their own list, outside the hours", async () => {
    const html = await render("en", { page: "home" });
    const hours = html.slice(html.indexOf('<dl class="kv-hours">'), html.indexOf("</dl>", html.indexOf('<dl class="kv-hours">')));
    expect(hours).not.toContain("tel:");
    expect(hours).not.toContain("instagram.com");
    expect(html).toMatch(/<ul class="kv-contacts">[\s\S]*tel:\+35920000000[\s\S]*instagram\.com\/agala\.cafe[\s\S]*<\/ul>/);
  });
  it("sizes unknown glyphs on the safe side", () => {
    const fit = (x: ReturnType<typeof fitHeadline>) => parseFloat(String((x.style as Record<string, string>)["--kv-fit"]));
    expect(fit(fitHeadline("★★★"))).toBeLessThanOrEqual((100 / 3) * 0.98 + 0.01); // unmapped symbol: 1em each
    expect(fit(fitHeadline("ѣѣѣ"))).toBeLessThanOrEqual((100 / (3 * 1.05)) * 0.98 + 0.01); // unmapped lowercase: widest lowercase
  });
  it("computes the accent text, fill and flash tint in TypeScript (no CSS relative colour) and keeps them readable for every accent", async () => {
    const css = readFileSync(new URL("../src/templates/kvartal/styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/oklch\(from/);
    expect(css).not.toMatch(/--kv-accent-soft:\s*color-mix/);
    for (const accent of [def.accentDefault, ...LOOK_ACCENT_PRESETS, ...EXTREME_ACCENTS]) {
      const html = await render("en", { page: "home", mutate: (s) => { s.venue.theme.accent = accent; } });
      const read = (name: string) => new RegExp(`--kv-accent-${name}:(#[0-9a-f]{6})`).exec(html)?.[1];
      const [text, fill, soft] = [read("text"), read("fill"), read("soft")];
      expect(text && fill && soft, accent).toBeTruthy();
      // Numbers, the full stop and the map link on the paper.
      expect(contrastRatio(text!, "#e9e8e3"), `${text} on paper`).toBeGreaterThanOrEqual(4.5);
      // The "Now" block: --kv-on text on the fill.
      expect(contrastRatio("#f6f5f1", fill!), `--kv-on on ${fill}`).toBeGreaterThanOrEqual(4.5);
      // A flashing row keeps its ink text readable.
      expect(contrastRatio("#17191b", soft!), `ink on ${soft}`).toBeGreaterThanOrEqual(4.5);
    }
    const html = await render("en", { mutate: (s) => { s.venue.theme.accent = "#c23a1c"; } });
    expect(html).toContain("--kv-accent-text:#b22905");
    expect(html).toContain("--kv-accent-fill:#bc3415");
    expect(html).toContain("--kv-accent-soft:#e7d1c8");
  });
  it("keeps the default and every Look-step preset at exactly the colours they had before the contrast guard", () => {
    const expected: [string, Record<string, string>][] = [
      ["#c23a1c", {"--kv-accent-text": "#b22905", "--kv-accent-fill": "#bc3415", "--kv-accent-soft": "#e7d1c8"}],
      ["#2f6b4f", {"--kv-accent-text": "#2f6b4f", "--kv-accent-fill": "#2f6b4f", "--kv-accent-soft": "#ced6cd"}],
      ["#8f5c10", {"--kv-accent-text": "#895705", "--kv-accent-fill": "#8f5c10", "--kv-accent-soft": "#ddd4c7"}],
      ["#a4442c", {"--kv-accent-text": "#a04129", "--kv-accent-fill": "#a4442c", "--kv-accent-soft": "#e2d1c8"}],
      ["#1d4ed8", {"--kv-accent-text": "#1d4ed8", "--kv-accent-fill": "#1d4ed8", "--kv-accent-soft": "#cbd4e5"}],
      ["#6b21a8", {"--kv-accent-text": "#6b21a8", "--kv-accent-fill": "#6b21a8", "--kv-accent-soft": "#d6cedd"}],
      ["#1d2a24", {"--kv-accent-text": "#1d2a24", "--kv-accent-fill": "#1d2a24", "--kv-accent-soft": "#c9cbc5"}],
    ];
    expect(expected.map(([a]) => a.toLowerCase())).toEqual(expect.arrayContaining([def.accentDefault.toLowerCase(), ...LOOK_ACCENT_PRESETS]));
    for (const [accent, vars] of expected) expect(accentVars(accent), accent).toEqual(vars);
  });
  it("keeps every promised contrast floor across the colour space (64 hues × 3 lightnesses × 3 chromas)", () => {
    const misses: string[] = [];
    for (const accent of [...sweepAccents(), ...EXTREME_ACCENTS]) {
      const v = accentVars(accent);
      const pairs: [string, number, number][] = [
        [`${v["--kv-accent-text"]} on paper`, contrastRatio(v["--kv-accent-text"], "#e9e8e3"), 4.5],
        [`--kv-on on ${v["--kv-accent-fill"]}`, contrastRatio("#f6f5f1", v["--kv-accent-fill"]), 4.5],
        [`ink on ${v["--kv-accent-soft"]}`, contrastRatio("#17191b", v["--kv-accent-soft"]), 4.5],
      ];
      for (const [what, ratio, floor] of pairs) if (!(ratio >= floor)) misses.push(`${accent}: ${what} ${ratio.toFixed(2)} < ${floor}`);
    }
    expect(misses).toEqual([]);
  });
  it("keeps the change flash reaching its final frame under reduced motion", () => {
    // `animation: none` would freeze .kv-flash at its base opacity (1) forever, because useLiveSite never clears `changed`.
    const css = readFileSync(new URL("../src/templates/kvartal/styles.css", import.meta.url), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.kv-flash\s*\{[^}]*animation:\s*kv-flash\s+1ms[^}]*both\s*!important/);
    expect(reduced.indexOf(".kv-flash")).toBeGreaterThan(reduced.indexOf("animation: none !important"));
  });
  it("scopes every rule under the template's root class or its own kv- classes", () => {
    const css = readFileSync(new URL("../src/templates/kvartal/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/(^|[{}])\s*([^{}@]+?)\s*\{/g)].map((m) => m[2].trim()).filter((s) => !/^(from|to|\d+%)/.test(s));
    // Split on top-level commas only (":where(a, b)" stays one selector).
    const split = (g: string) => g.split(/,(?![^(]*\))/).map((x) => x.trim());
    for (const group of selectors) for (const sel of split(group)) expect(sel).toMatch(/^\.(tpl-kvartal|kv-)/);
  });
});
