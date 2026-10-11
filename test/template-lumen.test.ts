// test/template-lumen.test.ts
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DraftInfo, Lang, SiteState } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { EXTREME_ACCENTS, LOOK_ACCENT_PRESETS, makeDemo, sweepAccents } from "./helpers";

// next/font/google only works through the Next.js compiler; at test time its module is empty, so stub every family the templates use.
// (The global mock in test/setup.ts returns generic names; this file asserts the fv-* values below, so it keeps its own.)
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ className: `f-${name}`, variable: `fv-${name}`, style: { fontFamily: name } });
  return { Literata: font("literata"), Onest: font("onest"), Unbounded: font("unbounded"), Manrope: font("manrope"), Playfair_Display: font("playfair"), Golos_Text: font("golos") };
});

import { contrastRatio } from "@/src/templates/shared/color";
import { def } from "@/src/templates/lumen";
import { accentVars } from "@/src/templates/lumen/Template";

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

describe("lumen template", () => {
  it("is registered with Cyrillic-capable fonts and a light accent default", () => {
    expect(def.id).toBe("lumen");
    expect(def.fontVars).toContain("fv-playfair");
    expect(def.fontVars).toContain("fv-golos");
    expect(def.accentDefault).toMatch(/^#[0-9a-f]{6}$/i);
    expect(def.business_types).toContain("cafe");
  });
  it("renders the menu page in Bulgarian: name, category, item, bg price, open status", async () => {
    const html = await render("bg");
    expect(html).toContain("Кафене „Ъгъла“");
    expect(html).toContain("Закуски");
    expect(html).toContain("Капучино");
    expect(html).toContain("2,90 €");
    expect(html).toContain("Отворено до 18:00");
    expect(html).toContain('class="tpl-lumen');
  });
  it("renders the menu page in English with en prices", async () => {
    const html = await render("en");
    expect(html).toContain("Pastries");
    expect(html).toContain("Cappuccino");
    expect(html).toContain("€2.90");
    expect(html).toContain("Open until 18:00");
  });
  it("shows the holiday note when today is a holiday", async () => {
    const mutate = (s: SiteState) => { s.holidays.push({ id: "h1", venue_id: s.venue.id, date: "2026-10-09", note_bg: "Инвентаризация", note_en: "Stock count" }); };
    expect(await render("en", { mutate })).toContain("Stock count");
    expect(await render("bg", { mutate })).toContain("Инвентаризация");
  });
  it("says closed when today's hours are null", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    expect(await render("en", { mutate })).toContain("Closed");
    expect(await render("bg", { mutate })).toContain("Затворено");
  });
  it("says closed today when today's hours are null and nothing opens later this week", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }; };
    expect(await render("en", { mutate })).toContain("Closed today");
    expect(await render("bg", { mutate })).toContain("Днес е почивен ден");
  });
  it("says opens later before opening time", async () => {
    const now = Date.parse("2026-10-09T04:00:00.000Z"); // Fri 07:00 Sofia, opens 08:00
    expect(await render("en", { now })).toContain("Opens today at 08:00");
    expect(await render("bg", { now })).toContain("Отваря днес в 08:00");
  });
  it("keeps sold-out items (struck, with a badge) and hides expired specials", async () => {
    const mutate = (s: SiteState) => {
      s.items[1].sold_out_until = "2026-10-10T06:00:00.000Z";
      s.items.push({ ...s.items[0], id: "sp-old", name_bg: "Стара оферта", name_en: "Old special", is_special: true, special_expires_at: "2026-10-09T08:00:00.000Z" });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Sold out until");
    expect(html).toContain("Cappuccino");
    expect(html).not.toContain("Old special");
  });
  it("renders the home page with highlights, the visit section and no gallery when there are no photos", async () => {
    const html = await render("en", { page: "home" });
    expect(html).toContain("From the menu");
    expect(html).toContain("Visit us");
    expect(html).toContain("Opening hours");
    expect(html).not.toContain('aria-labelledby="gallery"');
  });
  it("adds category jump links for a long menu", async () => {
    const mutate = (s: SiteState) => {
      for (let n = 0; n < 40; n++) s.items.push({ ...s.items[0], id: `big-${n}`, name_bg: `Артикул ${n}`, name_en: `Item ${n}`, position: 100 + n, category_id: s.categories[n % s.categories.length].id });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Item 39");
    expect(html.match(/class="l-jumplink"/g)?.length).toBe(4);
  });
  it("computes the accent text and soft tint in TypeScript (no CSS relative colour) and keeps both readable for every accent", async () => {
    const css = readFileSync(new URL("../src/templates/lumen/styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/oklch\(from/);
    expect(css).not.toMatch(/--l-accent-soft:\s*color-mix/);
    for (const accent of [def.accentDefault, ...LOOK_ACCENT_PRESETS, ...EXTREME_ACCENTS]) {
      const html = await render("en", { page: "home", mutate: (s) => { s.venue.theme.accent = accent; } });
      const text = /--l-accent-text:(#[0-9a-f]{6})/.exec(html)?.[1];
      const soft = /--l-accent-soft:(#[0-9a-f]{6})/.exec(html)?.[1];
      expect(text, accent).toBeDefined();
      expect(soft, accent).toBeDefined();
      // Eyebrow, open dot and focus ring on both papers; the same pair is the paper on the accent button.
      expect(contrastRatio(text!, "#f8fbf9"), `${text} on --l-bg`).toBeGreaterThanOrEqual(5.3);
      expect(contrastRatio(text!, "#edf2ed"), `${text} on --l-bg-2`).toBeGreaterThanOrEqual(4.9);
      // The pill's ink on the soft tint.
      expect(contrastRatio("#191f1a", soft!), `ink on ${soft}`).toBeGreaterThanOrEqual(11.9);
    }
    const html = await render("en", { mutate: (s) => { s.venue.theme.accent = "#2e5e4e"; } });
    expect(html).toContain("--l-accent-text:#2e5e4e"); // the default is inside the caps: unchanged
    expect(html).toContain("--l-accent-soft:#e3eae6");
  });
  it("keeps the default and every Look-step preset at exactly the colours they had before the contrast guard", () => {
    const expected: [string, Record<string, string>][] = [
      ["#2e5e4e", {"--l-accent-text": "#2e5e4e", "--l-accent-soft": "#e3eae6"}],
      ["#2f6b4f", {"--l-accent-text": "#2f6b4f", "--l-accent-soft": "#e3ece7"}],
      ["#8f5c10", {"--l-accent-text": "#895705", "--l-accent-soft": "#eeeae2"}],
      ["#a4442c", {"--l-accent-text": "#a04129", "--l-accent-soft": "#f1e8e4"}],
      ["#1d4ed8", {"--l-accent-text": "#375aae", "--l-accent-soft": "#e1ebf8"}],
      ["#6b21a8", {"--l-accent-text": "#633990", "--l-accent-soft": "#e9e6f2"}],
      ["#1d2a24", {"--l-accent-text": "#1d2a24", "--l-accent-soft": "#dfe4e1"}],
    ];
    expect(expected.map(([a]) => a.toLowerCase())).toEqual(expect.arrayContaining([def.accentDefault.toLowerCase(), ...LOOK_ACCENT_PRESETS]));
    for (const [accent, vars] of expected) expect(accentVars(accent), accent).toEqual(vars);
  });
  it("keeps every promised contrast floor across the colour space (64 hues × 3 lightnesses × 3 chromas)", () => {
    const misses: string[] = [];
    for (const accent of [...sweepAccents(), ...EXTREME_ACCENTS]) {
      const v = accentVars(accent);
      const pairs: [string, number, number][] = [
        [`${v["--l-accent-text"]} on --l-bg`, contrastRatio(v["--l-accent-text"], "#f8fbf9"), 5.3],
        [`${v["--l-accent-text"]} on --l-bg-2`, contrastRatio(v["--l-accent-text"], "#edf2ed"), 4.9],
        [`ink on ${v["--l-accent-soft"]}`, contrastRatio("#191f1a", v["--l-accent-soft"]), 11.9],
      ];
      for (const [what, ratio, floor] of pairs) if (!(ratio >= floor)) misses.push(`${accent}: ${what} ${ratio.toFixed(2)} < ${floor}`);
    }
    expect(misses).toEqual([]);
  });
  it("keeps the change flash reaching its final frame under reduced motion", () => {
    // `animation: none` would freeze .l-flash at its base opacity (1) forever, because useLiveSite never clears `changed`.
    const css = readFileSync(new URL("../src/templates/lumen/styles.css", import.meta.url), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.l-flash\s*\{[^}]*animation:\s*l-flash\s+1ms[^}]*both\s*!important/);
    expect(reduced.indexOf(".l-flash")).toBeGreaterThan(reduced.indexOf("animation: none !important"));
  });
  it("keeps the status date-time on one line", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    expect(await render("en", { mutate })).toMatch(/<span class="l-nowrap">[^<]*2026[^<]*<\/span>/);
  });
  it("renders the draft note with the summary when a draft is given", async () => {
    const draft: DraftInfo = { id: "d1", status: "proposed", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "", preview_en: "", key: "k" };
    expect(await render("en", { draft })).toContain("Cappuccino €3.20");
    expect(await render("bg", { draft })).toContain("Капучино 3,20 €");
  });
});
