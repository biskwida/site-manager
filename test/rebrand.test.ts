// test/rebrand.test.ts — the product is called Claudia: nothing a guest or an owner reads says "Site Manager" any more.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/src/domain/types";
import { copy } from "@/src/bot/copy";
import { DICTS } from "@/src/i18n/dicts";
import { TEMPLATES } from "@/src/templates";
import { makeDemo } from "./helpers";
import { LangProvider } from "@/src/i18n";

const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const NOW = Date.parse("2026-10-09T09:00:00.000Z");
const OLD = "Site Manager";

describe("rebrand to Claudia", () => {
  for (const [id, tpl] of Object.entries(TEMPLATES)) {
    for (const lang of ["bg", "en"] as const) {
      it(`${id} template (${lang}) renders the Claudia credit and never the old name`, async () => {
        const { store, venue } = await makeDemo();
        const state = await store.getSite(venue.id);
        const html = renderToStaticMarkup(
          createElement(Provider, { defaultLang: lang }, createElement(tpl.Component, { state, now: NOW, slug: "agala", page: "home", draft: null, live: false, feedUrl: "/api/site/agala" })),
        );
        expect(html).not.toContain(OLD);
        expect(html).toContain(lang === "bg" ? "Сайт от Claudia" : "Site by Claudia");
      });
    }
  }

  it("bot welcome and help texts never name the old product", () => {
    for (const lang of ["bg", "en"] as const) {
      const c = copy(lang);
      const texts: string[] = [];
      for (const ch of ["tg", "wa", "fb", "ig"] as const) {
        texts.push(c.welcome("Agala", "https://x.example/admin", "https://x.example/agala", ch));
      }
      texts.push(c.welcomeStaff("Agala", "https://x.example/agala"), c.welcomeBack("Agala", "https://x.example/admin"));
      for (const v of Object.values(c)) if (typeof v === "string") texts.push(v);
      for (const t of texts) expect(t).not.toContain(OLD);
    }
  });

  it("the bot's WordPress instructions name the Claudia plugin", () => {
    expect(copy("en").connectUsage).toContain("Claudia plugin");
    expect(copy("bg").connectUsage).toContain("плъгина Claudia");
  });

  it("the old name survives only as the one 'formerly' note in the privacy policy", () => {
    const hits = (["bg", "en"] as const).flatMap((l) => Object.entries(DICTS[l]).filter(([, v]) => v.includes(OLD)).map(([k]) => k));
    expect(hits).toEqual(["privacy.intro", "privacy.intro"]);
  });
});
