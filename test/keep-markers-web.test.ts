// test/keep-markers-web.test.ts — keep markers (⟦…⟧, src/domain/format.ts keep) belong to chat texts only. itemName, categoryName
// and quote also feed every website template and the wizard, so they never return kept text: what those render has no marker.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Menu } from "@/app/new/components/Steps/Menu";
import type { StepProps } from "@/app/new/components/types";
import type { Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { TEMPLATES } from "@/src/templates";
import { emptyDraft } from "@/src/wizard/schema";
import { media } from "./fixtures";
import { makeDemo } from "./helpers";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const NOW = Date.parse("2026-10-09T09:00:00.000Z");

describe("keep markers stay out of websites and the wizard", () => {
  it("a website template render and the wizard menu step contain no ⟦ or ⟧", async () => {
    const { store, venue } = await makeDemo();
    const state = await store.getSite(venue.id);
    const draft = emptyDraft("classic");
    draft.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [7], image_media_id: null }] }];
    const step: StepProps = { id: "v1", draft, media: [media("m1")], update: () => undefined, addMedia: () => undefined, baseUrl: "https://site.example", aiAvailable: true, fieldErrors: [] };
    for (const lang of ["bg", "en"] as const) {
      const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, el));
      const pages = [render(createElement(Menu, step))];
      for (const t of Object.values(TEMPLATES)) {
        for (const page of ["home", "menu"] as const) pages.push(render(createElement(t.Component, { state, now: NOW, slug: "agala", page, draft: null, live: false, feedUrl: "/api/site/agala" })));
      }
      for (const html of pages) expect(html).not.toMatch(/[⟦⟧]/);
      expect(pages.join("")).toContain(lang === "bg" ? "Еспресо" : "Espresso"); // the names are there, as written
    }
  });
});
