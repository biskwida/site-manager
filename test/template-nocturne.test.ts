// test/template-nocturne.test.ts
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DraftInfo, Lang, SiteState } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { EXTREME_ACCENTS, LOOK_ACCENT_PRESETS, makeDemo, sweepAccents } from "./helpers";

// next/font/google only works through the Next.js compiler; at test time its module is empty, so stub every family the templates use.
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ className: `f-${name}`, variable: `fv-${name}`, style: { fontFamily: name } });
  return { Literata: font("literata"), Onest: font("onest"), Unbounded: font("unbounded"), Manrope: font("manrope"), Playfair_Display: font("playfair"), Golos_Text: font("golos") };
});

import { contrastRatio } from "@/src/templates/shared/color";
import { def } from "@/src/templates/nocturne";
import { accentVars } from "@/src/templates/nocturne/Template";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const NOW = Date.parse("2026-10-09T09:00:00.000Z"); // Fri 12:00 Sofia; demo hours 08:00–18:00

async function render(lang: Lang, opts: { page?: "home" | "menu"; mutate?: (s: SiteState) => void; draft?: DraftInfo | null } = {}) {
  const { store, venue } = await makeDemo();
  const state = await store.getSite(venue.id);
  opts.mutate?.(state);
  return renderToStaticMarkup(
    createElement(Provider, { defaultLang: lang },
      createElement(def.Component, { state, now: NOW, slug: "agala", page: opts.page ?? "menu", draft: opts.draft ?? null, live: false, feedUrl: "/api/site/agala" })),
  );
}

describe("nocturne template", () => {
  it("is registered with Cyrillic-capable fonts and a dark accent default", () => {
    expect(def.id).toBe("nocturne");
    expect(def.fontVars).toContain("fv-unbounded");
    expect(def.fontVars).toContain("fv-manrope");
    expect(def.accentDefault).toMatch(/^#[0-9a-f]{6}$/i);
    expect(def.business_types).toContain("bar");
  });
  it("renders the menu page in Bulgarian: name, category, item, bg price, open status", async () => {
    const html = await render("bg");
    expect(html).toContain("Кафене „Ъгъла“");
    expect(html).toContain("Закуски");
    expect(html).toContain("Капучино");
    expect(html).toContain("2,90 €");
    expect(html).toContain("Отворено до 18:00");
    expect(html).toContain('class="tpl-nocturne');
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
    expect(html.match(/class="n-chip"/g)?.length).toBe(4);
  });
  it("computes the accent text colour in TypeScript (no CSS relative colour) and keeps it readable on near-black for every accent", async () => {
    const css = readFileSync(new URL("../src/templates/nocturne/styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/oklch\(from/);
    for (const accent of [def.accentDefault, ...LOOK_ACCENT_PRESETS, ...EXTREME_ACCENTS]) {
      const html = await render("en", { page: "home", mutate: (s) => { s.venue.theme.accent = accent; } });
      const text = /--n-accent-text:(#[0-9a-f]{6})/.exec(html)?.[1];
      expect(text, accent).toBeDefined();
      // Eyebrow, prices and focus ring on both grounds; the same pair is --n-bg text on the accent button and draft badge.
      expect(contrastRatio(text!, "#100d08"), `${text} on --n-bg`).toBeGreaterThanOrEqual(8.2);
      expect(contrastRatio(text!, "#1c1711"), `${text} on --n-bg-2`).toBeGreaterThanOrEqual(8.2);
    }
    expect(await render("en", { mutate: (s) => { s.venue.theme.accent = "#f4e7a1"; } })).toContain("--n-accent-text:#f4e7a1"); // already light: unchanged
  });
  it("keeps the default and every Look-step preset at exactly the colours they had before the contrast guard", () => {
    const expected: [string, Record<string, string>][] = [
      ["#d9a05b", {"--n-accent-text": "#e4ab66"}],
      ["#2f6b4f", {"--n-accent-text": "#8ac7a7"}],
      ["#8f5c10", {"--n-accent-text": "#e3ab69"}],
      ["#a4442c", {"--n-accent-text": "#ff977d"}],
      ["#1d4ed8", {"--n-accent-text": "#94b6ff"}],
      ["#6b21a8", {"--n-accent-text": "#caa0ff"}],
      ["#1d2a24", {"--n-accent-text": "#acbcb4"}],
    ];
    expect(expected.map(([a]) => a.toLowerCase())).toEqual(expect.arrayContaining([def.accentDefault.toLowerCase(), ...LOOK_ACCENT_PRESETS]));
    for (const [accent, vars] of expected) expect(accentVars(accent), accent).toEqual(vars);
  });
  it("keeps every promised contrast floor across the colour space (64 hues × 3 lightnesses × 3 chromas)", () => {
    const misses: string[] = [];
    for (const accent of [...sweepAccents(), ...EXTREME_ACCENTS]) {
      const v = accentVars(accent);
      const pairs: [string, number, number][] = [
        [`${v["--n-accent-text"]} on --n-bg`, contrastRatio(v["--n-accent-text"], "#100d08"), 8.2],
        [`${v["--n-accent-text"]} on --n-bg-2`, contrastRatio(v["--n-accent-text"], "#1c1711"), 8.2],
      ];
      for (const [what, ratio, floor] of pairs) if (!(ratio >= floor)) misses.push(`${accent}: ${what} ${ratio.toFixed(2)} < ${floor}`);
    }
    expect(misses).toEqual([]);
  });
  it("keeps the change flash reaching its final frame under reduced motion", () => {
    // `animation: none` would freeze .n-flash at its base opacity (1) forever, because useLiveSite never clears `changed`.
    const css = readFileSync(new URL("../src/templates/nocturne/styles.css", import.meta.url), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.n-flash\s*\{[^}]*animation:\s*n-flash\s+1ms[^}]*both\s*!important/);
    expect(reduced.indexOf(".n-flash")).toBeGreaterThan(reduced.indexOf("animation: none !important"));
  });
  it("keeps the status date-time on one line", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    expect(await render("en", { mutate })).toMatch(/<span class="n-nowrap">[^<]*2026[^<]*<\/span>/);
  });
  it("renders the draft bar with the summary when a draft is given", async () => {
    const draft: DraftInfo = { id: "d1", status: "proposed", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "", preview_en: "", key: "k" };
    expect(await render("en", { draft })).toContain("Cappuccino €3.20");
    expect(await render("bg", { draft })).toContain("Капучино 3,20 €");
  });
});
