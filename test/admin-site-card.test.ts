// test/admin-site-card.test.ts
// Server render of the dashboard's "Your site" card: deploy rows, hosted mode, retry after a failed publish.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QrCard } from "@/app/admin/[slug]/components/QrCard";
import { SiteCard } from "@/app/admin/[slug]/components/SiteCard";
import type { DeployInfo, Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import type { AdminOverview } from "@/src/server/admin";

const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const ready: DeployInfo = { provider: "vercel", project_id: "prj_1", deployment_id: "dpl_1", url: "https://agala.vercel.app", status: "ready", error: null, template: "classic", updated_at: "2026-10-10T09:00:00.000Z" };
const base: AdminOverview = {
  venue: { id: "v1", slug: "agala", name: "Кафене „Ъгъла“", tz: "Europe/Sofia", default_lang: "bg" },
  now: "2026-10-10T10:00:00.000Z", public_url: "https://site.example/agala", template: "classic", status: "live", hosted: false, deploy: null, site_url: "https://site.example/agala",
  custom_domain: null, domain_verified: null, pending: [], scheduled: [], log: [], sold_out: [],
};
const post = async () => ({ ok: true, data: null });
const render = (lang: Lang, over: Partial<AdminOverview> = {}) =>
  renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, createElement(SiteCard, { overview: { ...base, ...over }, post })));

describe("SiteCard", () => {
  it("shows the deploy status and last update when there is a deploy record", () => {
    const html = render("en", { deploy: ready, site_url: ready.url! });
    expect(html).toContain("Live");
    expect(html).toContain("last update");
    expect(html).toContain('href="https://agala.vercel.app"');
  });

  it("hides the deploy rows without a deploy record (hosted mode, or before the first publish)", () => {
    for (const over of [{ hosted: true }, { hosted: false }]) {
      const html = render("en", over);
      expect(html).not.toContain("Not published yet");
      expect(html).not.toContain("last update");
      expect(html).toContain("Classic");
      expect(html).toContain('href="https://site.example/agala"');
    }
  });

  it("offers Try again with the current template after a failed publish, and a short line instead of the build log", () => {
    const failed: DeployInfo = { ...ready, status: "error", error: "Error: Command \"npm run build\" exited with 1\n  at /vercel/path0/node_modules/next/dist/build" };
    const en = render("en", { deploy: failed });
    expect(en).toMatch(/<button type="submit"[^>]*>Try again<\/button>/);
    expect(en).not.toMatch(/<button type="submit" disabled=""/);
    expect(en).toContain("The last publish did not finish.");
    expect(en).not.toContain("npm run build");
    const bg = render("bg", { deploy: failed });
    expect(bg).toMatch(/<button type="submit"[^>]*>Опитай пак<\/button>/);
    expect(bg).toContain("Последното публикуване не завърши.");
  });

  it("keeps Change template disabled while nothing changed on a healthy site", () => {
    const html = render("en", { deploy: ready, site_url: ready.url! });
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Change template<\/button>/);
  });
});

describe("QrCard", () => {
  const renderQr = (siteUrl: string) => renderToStaticMarkup(createElement(Provider, { defaultLang: "en" }, createElement(QrCard, { siteUrl })));
  it("points the QR and the links at the deployed site once it is ready", () => {
    const html = renderQr("https://agala.vercel.app");
    expect(html).toContain("https://agala.vercel.app/menu");
    expect(html).toContain('href="https://agala.vercel.app"');
    expect(html).toContain('href="https://agala.vercel.app/menu"');
    expect(html).not.toContain("site.example");
  });
  it("uses the hosted URL otherwise", () => {
    const html = renderQr("https://site.example/agala");
    expect(html).toContain('href="https://site.example/agala/menu"');
  });
});
