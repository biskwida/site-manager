// test/admin-domain-card.test.ts
// Server render of the dashboard's "Your own domain" card in both languages: form, disabled state without a site, stored domain, DNS table.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DnsRecords, DomainCard } from "@/app/admin/[slug]/components/DomainCard";
import type { DomainInstructions } from "@/src/deploy/types";
import type { DeployInfo, Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import type { AdminOverview } from "@/src/server/admin";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const ready: DeployInfo = { provider: "fake", project_id: "prj_1", deployment_id: "dpl_1", url: "https://agala.example.test", status: "ready", error: null, template: "classic", updated_at: "2026-10-10T09:00:00.000Z" };
const base: AdminOverview = {
  venue: { id: "v1", slug: "agala", name: "Кафене „Ъгъла“", tz: "Europe/Sofia", default_lang: "bg" },
  now: "2026-10-10T10:00:00.000Z", public_url: "https://site.example/agala", template: "classic", status: "live", hosted: false, deploy: null, site_url: "https://site.example/agala",
  custom_domain: null, domain_verified: null, pending: [], scheduled: [], log: [], sold_out: [], connected_apps: [],
};
const post = async () => ({ ok: true, data: null });
const instructions: DomainInstructions = { verified: false, records: [{ type: "CNAME", name: "cafe", value: "cname.vercel-dns.com" }, { type: "TXT", name: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,fake" }] };

const render = (lang: Lang, over: Partial<AdminOverview> = {}) =>
  renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, createElement(DomainCard, { overview: { ...base, ...over }, post })));
const renderRecords = (lang: Lang, i: DomainInstructions, domain = "cafe.example.com") =>
  renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, createElement(DnsRecords, { domain, instructions: i })));

describe("DomainCard", () => {
  it("renders the labelled form in Bulgarian and English", () => {
    const bg = render("bg", { deploy: ready });
    expect(bg).toContain("Собствен домейн");
    expect(bg).toContain("Домейн");
    expect(bg).toContain(">Свържи<");
    expect(bg).toMatch(/<label[^>]*for="domain-input"/);
    expect(bg).toMatch(/<input[^>]*id="domain-input"/);
    expect(bg).not.toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""/);
    expect(bg).not.toMatch(/<input[^>]*\sdisabled=""/);
    const en = render("en", { deploy: ready });
    expect(en).toContain("Your own domain");
    expect(en).toContain(">Connect<");
    expect(en).not.toContain("Check again");
  });

  it("disables Connect and explains why when the site is not published yet or the publish failed", () => {
    const en = render("en");
    expect(en).toContain("Publish the site first (press Start in Telegram), then connect a domain.");
    expect(en).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""/);
    const bg = render("bg", { deploy: { ...ready, status: "error", error: "Build failed" } });
    expect(bg).toContain("Първо публикувайте сайта");
    expect(bg).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""/);
  });

  it("shows the publishing hint and disables the controls while a deploy is in flight", () => {
    for (const status of ["pending", "building"] as const) {
      const en = render("en", { deploy: { ...ready, status, custom_domain: "cafe.example.com" }, custom_domain: "cafe.example.com", domain_verified: false });
      expect(en).toContain("The site is publishing right now. Try again in a minute.");
      expect(en).not.toContain("Publish the site first");
      expect(en).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""/);
      expect(en).toMatch(/<button[^>]*type="button"[^>]*\sdisabled=""[^>]*>Check again</);
    }
    const bg = render("bg", { deploy: { ...ready, status: "building" } });
    expect(bg).toContain("Сайтът се публикува в момента. Опитайте след минута.");
  });

  it("keeps a live region on the card even before any records arrive", () => {
    expect(render("en", { deploy: ready })).toContain('aria-live="polite"');
  });

  it("shows the stored domain with its verification badge, prefilled input and Check again", () => {
    const en = render("en", { deploy: { ...ready, custom_domain: "cafe.example.com", domain_verified: false }, custom_domain: "cafe.example.com", domain_verified: false });
    expect(en).toContain("Connected domain: cafe.example.com");
    expect(en).toContain("Waiting for DNS");
    expect(en).toContain('value="cafe.example.com"');
    expect(en).toContain(">Check again<");
    const bg = render("bg", { deploy: { ...ready, custom_domain: "cafe.example.com", domain_verified: true }, custom_domain: "cafe.example.com", domain_verified: true });
    expect(bg).toContain("Свързан домейн: cafe.example.com");
    expect(bg).toContain("Потвърден");
    expect(bg).toContain(">Провери отново<");
  });

  it("renders the DNS records table with a copy button per row and the pending or verified status", () => {
    const en = renderRecords("en", instructions);
    expect(en).toContain("Not verified yet. DNS changes can take up to an hour; press Check again later.");
    expect(en).toMatch(/<th[^>]*>Type<\/th>/);
    expect(en).toMatch(/<th[^>]*>Name<\/th>/);
    expect(en).toMatch(/<th[^>]*>Value<\/th>/);
    expect(en).toContain("CNAME");
    expect(en).toContain("cname.vercel-dns.com");
    expect(en).toContain("_vercel.example.com");
    expect(en).toContain("vc-domain-verify=cafe.example.com,fake");
    expect((en.match(/aria-label="Copy: /g) ?? []).length).toBe(2);
    expect(en).toContain('aria-label="Copy: TXT _vercel.example.com"');
    const bg = renderRecords("bg", { ...instructions, verified: true });
    expect(bg).toContain("Свързан. Сайтът ви отговаря на cafe.example.com.");
    expect(bg).toContain("DNS записи за добавяне");
    expect(bg).toMatch(/<th[^>]*>Стойност<\/th>/);
    expect((bg.match(/aria-label="Копирай: /g) ?? []).length).toBe(2);
  });
});
