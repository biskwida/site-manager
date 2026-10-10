// test/templates-classic.test.ts
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import type { TemplateProps } from "@/src/templates";
import { getTemplate, TEMPLATES } from "@/src/templates";
import { Template } from "@/src/templates/classic/Template";
import { makeDemo } from "./helpers";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const NOW = Date.parse("2026-10-09T09:00:00.000Z"); // Friday 12:00 in Sofia, open until 18:00

async function render(lang: Lang, over: Partial<TemplateProps> = {}) {
  const { store, venue } = await makeDemo();
  const state = await store.getSite(venue.id);
  const props: TemplateProps = { state, now: NOW, slug: "agala", page: "home", draft: null, live: false, feedUrl: "/api/site/agala", ...over };
  return renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, createElement(Template, props)));
}

describe("classic template", () => {
  it("renders the home page in Bulgarian and English", async () => {
    const bg = await render("bg");
    expect(bg).toContain("Кафене „Ъгъла“");
    expect(bg).toContain("Еспресо");
    expect(bg).toContain("Отворено до 18:00");
    const en = await render("en");
    expect(en).toContain("Кафене „Ъгъла“");
    expect(en).toContain("Espresso");
    expect(en).toContain("Open until 18:00");
  });
  it("renders the menu page with every category", async () => {
    const bg = await render("bg", { page: "menu" });
    expect(bg).toContain("Сандвичи и салати");
    expect(bg).toContain("Шопска салата");
    const en = await render("en", { page: "menu" });
    expect(en).toContain("Shopska salad");
  });
  it("links Home and Menu through pageHref (main-app form outside the shell)", async () => {
    const html = await render("bg");
    expect(html).toContain('href="/agala"');
    expect(html).toContain('href="/agala/menu"');
  });
  it("sets the accent and the font variables on the root", async () => {
    const html = await render("bg");
    expect(html.startsWith('<div style="--accent:#2f6b4f;font-family:var(--font-body)" class="font-var-Literata font-var-Onest flex flex-1 flex-col">')).toBe(true);
  });
  it("registry falls back to classic", () => {
    expect(getTemplate("classic").id).toBe("classic");
    expect(getTemplate("nope").id).toBe("classic");
    expect(getTemplate(null).Component).toBe(Template);
    expect(TEMPLATES.classic.fontVars).toBe("font-var-Literata font-var-Onest");
    expect(TEMPLATES.classic.business_types).toContain("cafe");
    // R9: until Tasks 3 and 4 land, nocturne and lumen reuse the classic components under their own ids.
    expect(getTemplate("nocturne").id).toBe("nocturne");
    expect(getTemplate("lumen").id).toBe("lumen");
  });
});
