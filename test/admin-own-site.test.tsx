// test/admin-own-site.test.tsx — the dashboard for a venue with its own site (static render, both languages):
// "Your site" links the real site with a short line instead of deploy status and the template switch; no custom-domain card.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminPanel } from "@/app/admin/[slug]/components/AdminPanel";
import { SiteCard } from "@/app/admin/[slug]/components/SiteCard";
import type { DeployInfo, Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import type { AdminOverview } from "@/src/server/admin";

const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const ready: DeployInfo = { provider: "vercel", project_id: "prj_1", deployment_id: "dpl_1", url: "https://coffique-sm.vercel.app", status: "ready", error: null, template: "classic", updated_at: "2026-10-10T09:00:00.000Z" };
const base: AdminOverview = {
  venue: { id: "v1", slug: "coffique", name: "Coffique", tz: "Europe/Sofia", default_lang: "bg" },
  now: "2026-10-10T10:00:00.000Z", public_url: "https://site.example/coffique", template: "classic", status: "live", hosted: false, deploy: null, site_url: "https://site.example/coffique",
  custom_domain: null, domain_verified: null, pending: [], scheduled: [], log: [], sold_out: [], connected_apps: [],
};
const own: Partial<AdminOverview> = { own_site: true, site_url: "https://coffique.vercel.app" };
const post = async () => ({ ok: true, data: null });
const wrap = (lang: Lang, el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, el));
const card = (lang: Lang, over: Partial<AdminOverview>) => wrap(lang, createElement(SiteCard, { overview: { ...base, ...over }, post }));
const panel = (lang: Lang, over: Partial<AdminOverview>) => wrap(lang, createElement(AdminPanel, { slug: "coffique", adminKey: "k", initial: { ...base, ...over } }));

describe("SiteCard for an own site", () => {
  it("links the real site with the managed-by-us line, without deploy status or the template switch (EN)", () => {
    const html = card("en", own);
    expect(html).toContain("Your site");
    expect(html).toContain('href="https://coffique.vercel.app"');
    expect(html).toContain("We built and manage this site; it reads your menu, hours and texts from Claudia.");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Change template");
    expect(html).not.toContain("Classic");
    expect(html).not.toContain("Live");
    expect(html).not.toContain("site.example");
  });

  it("says the same in Bulgarian", () => {
    const html = card("bg", own);
    expect(html).toContain("Вашият сайт");
    expect(html).toContain('href="https://coffique.vercel.app"');
    expect(html).toContain("Този сайт е изграден и поддържан от нас; менюто, часовете и текстовете идват от Claudia.");
    expect(html).not.toContain("<select");
  });

  it("keeps the template switch for a template site", () => {
    const html = card("en", { deploy: ready, site_url: ready.url! });
    expect(html).toContain("<select");
    expect(html).not.toContain("We built and manage this site");
  });
});

describe("AdminPanel for an own site", () => {
  it("hides the custom-domain card, which a template deploy still shows", () => {
    expect(panel("en", { deploy: ready, site_url: ready.url! })).toContain("Your own domain");
    const html = panel("en", own);
    expect(html).not.toContain("Your own domain");
    expect(html).toContain('href="https://coffique.vercel.app"');
  });
});
