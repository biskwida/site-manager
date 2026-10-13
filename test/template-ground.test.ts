// test/template-ground.test.ts
// The owner's page background in the templates: shared/ground.ts derives the neutrals, each wired template paints with them.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { INK_DARK, INK_LIGHT } from "@/src/domain/color";
import type { Lang, SiteState } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { contrastRatio } from "@/src/templates/shared/color";
import { groundFor, onGround } from "@/src/templates/shared/ground";
import { Template as Classic } from "@/src/templates/classic/Template";
import { makeDemo } from "./helpers";

const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const NOW = Date.parse("2026-10-09T09:00:00.000Z");

/** Dark, light and the two edges of what validateChange lets through. */
const GROUNDS = ["#1f3d2b", "#6e1f1b", "#1b2a4a", "#161616", "#f3eadb", "#ffffff", "#e8b4b8", "#b8432a", "#909090", "#d9a05b"];

describe("shared/ground", () => {
  it("is null for no background, null, or anything that is not #rrggbb", () => {
    expect(groundFor(undefined)).toBeNull();
    expect(groundFor(null)).toBeNull();
    expect(groundFor("")).toBeNull();
    expect(groundFor("green")).toBeNull();
    expect(groundFor("#fff")).toBeNull();
  });
  it("takes light text on a dark background and dark text on a light one", () => {
    expect(groundFor("#1f3d2b")).toMatchObject({ bg: "#1f3d2b", dark: true });
    expect(groundFor("#F3EADB")).toMatchObject({ bg: "#f3eadb", dark: false });
  });
  it("keeps body text, secondary text and status colours readable on every ground", () => {
    for (const hex of GROUNDS) {
      const g = groundFor(hex)!;
      const best = Math.max(contrastRatio(INK_DARK, hex), contrastRatio(INK_LIGHT, hex));
      expect(contrastRatio(g.ink, g.bg), `${hex} ink`).toBeGreaterThanOrEqual(Math.min(7, best) - 0.05);
      expect(contrastRatio(g.ink, g.surface), `${hex} ink on surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(g.ink, g.bg2), `${hex} ink on bg2`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(g.inkSoft, g.bg), `${hex} soft on bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(g.inkSoft, g.bg2), `${hex} soft on bg2`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(g.inkSoft, g.surface), `${hex} soft on surface`).toBeGreaterThanOrEqual(4.5);
      // Inverse blocks (ink fill, background-coloured text) read as well as the page does.
      expect(contrastRatio(g.bg, g.ink)).toBeGreaterThanOrEqual(4.5);
      for (const status of ["#8f5c10", "#a4442c", "#2f6b3f"]) {
        const on = onGround(status, g, [g.bg, g.bg2, g.surface]);
        for (const under of [g.bg, g.bg2, g.surface]) expect(contrastRatio(on, under), `${status} on ${under} (${hex})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("leaves a status colour that already reads unchanged", () => {
    const g = groundFor("#ffffff")!;
    expect(onGround("#8f5c10", g, [g.bg])).toBe("#8f5c10");
  });
});

async function renderClassic(background: string | null | undefined, page: "home" | "menu" = "home") {
  const { store, venue } = await makeDemo();
  const state: SiteState = await store.getSite(venue.id);
  state.venue.theme = { ...state.venue.theme, background };
  return renderToStaticMarkup(createElement(Provider, { defaultLang: "bg" },
    createElement(Classic, { state, now: NOW, slug: "agala", page, draft: null, live: false, feedUrl: "/api/site/agala" })));
}

const rootStyle = (html: string) => /^<div style="([^"]*)"/.exec(html)?.[1] ?? "";
const cssVar = (style: string, name: string) => new RegExp(`${name}:(#[0-9a-f]{6})`).exec(style)?.[1];

describe("classic: the owner's background", () => {
  it("adds nothing to the root without a background", async () => {
    for (const bg of [undefined, null]) expect(rootStyle(await renderClassic(bg))).toBe("--accent:#2f6b4f;font-family:var(--font-body)");
  });
  it("paints the page and swaps the neutrals for a dark background", async () => {
    const style = rootStyle(await renderClassic("#1f3d2b"));
    expect(style).toContain("--color-paper:#1f3d2b");
    expect(style).toContain("background:#1f3d2b");
    expect(style).toContain("color-scheme:dark");
    const ink = cssVar(style, "--color-ink")!;
    expect(contrastRatio(ink, "#1f3d2b")).toBeGreaterThanOrEqual(7);
    expect(cssVar(style, "--accent-ground")).toBe("#1f3d2b");
    for (const name of ["--color-paper-deep", "--color-card", "--color-ink-soft", "--color-amber", "--color-amber-soft", "--color-clay", "--color-clay-soft"]) {
      expect(cssVar(style, name), name).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(contrastRatio(cssVar(style, "--color-amber")!, cssVar(style, "--color-amber-soft")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssVar(style, "--color-clay")!, cssVar(style, "--color-clay-soft")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssVar(style, "--color-clay")!, cssVar(style, "--color-card")!)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps dark text on a light background", async () => {
    const style = rootStyle(await renderClassic("#f3eadb", "menu"));
    expect(style).toContain("color-scheme:light");
    expect(contrastRatio(cssVar(style, "--color-ink")!, "#f3eadb")).toBeGreaterThanOrEqual(7);
  });
  it("draws the current page pill on a cover with the card colour, so it follows the ground", async () => {
    const { store, venue } = await makeDemo();
    const state = await store.getSite(venue.id);
    state.media.push({ id: "m-cover", venue_id: venue.id, storage_path: "x/cover.jpg", public_url: "https://abc.supabase.co/storage/v1/object/public/media/x/cover.jpg", is_gallery: false, position: 0, created_at: "2026-10-01T00:00:00.000Z" });
    state.venue.cover_media_id = "m-cover";
    const html = renderToStaticMarkup(createElement(Provider, { defaultLang: "bg" },
      createElement(Classic, { state, now: NOW, slug: "agala", page: "home", draft: null, live: false, feedUrl: "/api/site/agala" })));
    expect(html).toContain("bg-card text-ink");
    expect(html).not.toContain("bg-white text-ink");
  });
});
