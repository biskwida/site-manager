// test/site-mode.test.ts — Venue.site_mode ("claudia" | "own" | "none"): the explicit choice that replaces "site_url means own site".
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { templatePageProps } from "@/app/[slug]/props";
import { handleInbound } from "@/src/bot/inbound";
import type { BotDeps } from "@/src/bot/bot";
import { FakeDeployer } from "@/src/deploy/fake";
import { startDeploy } from "@/src/deploy/run";
import type { Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { adminOverview, setTemplate } from "@/src/server/admin";
import { loadSite, ownSiteRedirect, publicSiteState } from "@/src/server/site";
import { AdminPanel } from "@/app/admin/[slug]/components/AdminPanel";
import { InMemoryStore } from "@/src/store/memory";
import { getTemplate } from "@/src/templates";
import { toVenue } from "@/src/store/supabase";
import { prepareInvite, resolveSiteMode } from "../scripts/invite-lines.mts";
import { FakeMessenger, makeDemo } from "./helpers";

const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const T0 = new Date("2026-10-09T09:00:00.000Z");
const feedUrlFor = (slug: string) => `https://sm.example/api/site/${slug}`;

describe("site_mode on the venue", () => {
  it("defaults to claudia in both stores' mapping and is accepted by createVenue / updateVenue", async () => {
    const store = new InMemoryStore();
    const a = await store.createVenue({ slug: "sm-a", name: "A" });
    expect(a.site_mode).toBe("claudia");
    const b = await store.createVenue({ slug: "sm-b", name: "B", site_mode: "none" });
    expect(b.site_mode).toBe("none");
    expect((await store.updateVenue(a.id, { site_mode: "own", site_url: "https://a.example" })).site_mode).toBe("own");
    expect((await store.getVenueBySlug("sm-a"))?.site_mode).toBe("own");
    expect(toVenue({ id: "v", slug: "s", name: "n", created_at: "2026-10-09T09:00:00Z" }).site_mode).toBe("claudia");
    expect(toVenue({ id: "v", slug: "s", name: "n", site_mode: "none", created_at: "2026-10-09T09:00:00Z" }).site_mode).toBe("none");
    expect(toVenue({ id: "v", slug: "s", name: "n", site_mode: "bogus", created_at: "2026-10-09T09:00:00Z" }).site_mode).toBe("claudia");
  });

  it("is server-only: never in the public feed", async () => {
    const { store, venue } = await makeDemo();
    await store.updateVenue(venue.id, { site_mode: "none" });
    const pub = publicSiteState(await store.getSite(venue.id));
    expect("site_mode" in pub.venue).toBe(false);
  });
});

describe("startDeploy by site_mode", () => {
  it("skips own and none, runs for claudia", async () => {
    for (const [mode, deploys] of [["own", 0], ["none", 0], ["claudia", 1]] as const) {
      const { store, venue } = await makeDemo();
      await store.updateVenue(venue.id, { site_mode: mode, ...(mode === "own" ? { site_url: "https://own.example" } : {}) });
      const deployer = new FakeDeployer();
      await startDeploy({ store, deployer, feedUrlFor, now: () => T0, log: () => {} }, venue.id);
      expect(deployer.projects.size, mode).toBe(deploys);
      expect((await store.getVenue(venue.id)).deploy === null, mode).toBe(deploys === 0);
    }
  });
  it("does not treat a site_url on a claudia venue as an own site", async () => {
    const { store, venue } = await makeDemo();
    await store.updateVenue(venue.id, { site_url: "https://stale.example" }); // site_mode stays claudia
    const deployer = new FakeDeployer();
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0, log: () => {} }, venue.id);
    expect(deployer.projects.size).toBe(1);
  });
});

describe("hosted /<slug> by site_mode", () => {
  it("redirects an own-site venue to its site_url", async () => {
    const { store, venue } = await makeDemo();
    await store.updateVenue(venue.id, { site_mode: "own", site_url: "https://own.example" });
    expect(ownSiteRedirect((await loadSite(store, venue.slug))!)).toBe("https://own.example");
  });
  it("renders a none venue with the default template: 200, the name and the Instagram link, even with no menu or texts", async () => {
    const store = new InMemoryStore();
    const venue = await store.createVenue({ slug: "only-ig", name: "Salon Mira", instagram: "salon.mira", site_mode: "none" });
    const site = (await loadSite(store, venue.slug))!;
    expect(site).not.toBeNull();
    expect(ownSiteRedirect(site)).toBeNull();
    const { Component } = getTemplate(site.state.venue.template);
    for (const page of ["home", "menu"] as const) {
      const html = renderToStaticMarkup(createElement(Provider, { defaultLang: "bg" }, createElement(Component, templatePageProps(site, venue.slug, page, T0.getTime()))));
      expect(html).toContain("Salon Mira");
      if (page === "home") expect(html).toContain("https://instagram.com/salon.mira");
    }
  });
});

describe("welcome by site_mode", () => {
  async function owner(mode: "claudia" | "own" | "none", chatRef: string, hint?: "en") {
    const demo = await makeDemo();
    const joined: string[] = [];
    const messenger = new FakeMessenger();
    const d: BotDeps = { token: "t", store: demo.store, messenger, baseUrl: "https://site.example", now: () => T0, startRun: () => {}, transcribe: null, download: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }), onOwnerJoined: (id) => joined.push(id) };
    await demo.store.updateVenue(demo.venue.id, { site_mode: mode, ...(mode === "own" ? { site_url: "https://own.example" } : {}) });
    const code = await demo.store.createInvite(demo.venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, hint ? { chatRef, kind: "text", text: `/start ${code}`, langHint: hint } : { chatRef, kind: "text", text: code });
    return { texts: messenger.sent.map((s) => s.text), joined, venueId: demo.venue.id };
  }
  it("a none venue's owner hears about their Instagram, not a website, in both languages, with no publishing line", async () => {
    const bg = await owner("none", "fb:960");
    expect(bg.texts).toHaveLength(1);
    expect(bg.texts[0]).toContain("твоя Instagram");
    expect(bg.texts[0].replace(/https?:\/\/\S+/g, "")).not.toMatch(/сайт/i);
    expect(bg.texts[0]).toContain("/admin/agala?key=");
    const en = await owner("none", "tg:961", "en");
    expect(en.texts).toHaveLength(1);
    expect(en.texts[0]).toContain("your Instagram");
    expect(en.texts[0].replace(/https?:\/\/\S+/g, "")).not.toMatch(/website|site/i);
    expect(en.joined).toEqual([en.venueId]); // startDeploy is called and skips it itself
  });
  it("own keeps today's welcome; claudia still announces publishing", async () => {
    const own = await owner("own", "fb:962");
    expect(own.texts[0]).toContain("Сайт: https://own.example\n");
    expect(own.texts).toHaveLength(2);
    const claudia = await owner("claudia", "fb:963");
    expect(claudia.texts[1]).toMatch(/публикува/);
  });
});

describe("admin overview by site_mode", () => {
  async function overview(mode: "claudia" | "own" | "none") {
    const { store, venue } = await makeDemo();
    await store.updateVenue(venue.id, { site_mode: mode, ...(mode === "own" ? { site_url: "https://own.example" } : {}) });
    await store.setDeploy(venue.id, { provider: "vercel", project_id: "prj_1", deployment_id: "dpl_1", url: "https://x.vercel.app", status: "ready", error: null, template: "classic", custom_domain: "x.example", updated_at: "2026-10-10T09:00:00.000Z" });
    return adminOverview(store, await store.getVenue(venue.id), T0, "https://site.example");
  }
  it("hides deploy and domain for own and none, keeps them for claudia", async () => {
    const claudia = await overview("claudia");
    expect(claudia.deploy).not.toBeNull();
    expect(claudia.custom_domain).toBe("x.example");
    expect(claudia.site_mode).toBe("claudia");
    expect(claudia.own_site).toBe(false);
    for (const mode of ["own", "none"] as const) {
      const o = await overview(mode);
      expect(o.deploy, mode).toBeNull();
      expect(o.custom_domain, mode).toBeNull();
      expect(o.site_mode).toBe(mode);
    }
    const own = await overview("own");
    expect(own.own_site).toBe(true);
    expect(own.site_url).toBe("https://own.example");
    const none = await overview("none");
    expect(none.own_site).toBe(false);
    expect(none.site_url).toBe("https://site.example/agala"); // the hosted page, for the QR card
  });
  it("refuses a template switch for own and none", async () => {
    for (const mode of ["own", "none"] as const) {
      const { store, venue } = await makeDemo();
      await store.updateVenue(venue.id, { site_mode: mode });
      const r = await setTemplate({ store, deployer: null, feedUrlFor, now: () => T0 } as never, await store.getVenue(venue.id), "lumen");
      expect(r.ok, mode).toBe(false);
    }
  });
});

describe("dashboard by site_mode", () => {
  it("shows no site card, template switch or domain card for a none venue, and the QR card still has the hosted page", async () => {
    const { store, venue } = await makeDemo();
    await store.updateVenue(venue.id, { site_mode: "none" });
    const o = await adminOverview(store, await store.getVenue(venue.id), T0, "https://site.example");
    const html = renderToStaticMarkup(createElement(Provider, { defaultLang: "en" }, createElement(AdminPanel, { slug: "agala", adminKey: "k", initial: o })));
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Change template");
    expect(html).not.toContain("Your own domain");
    expect(html).not.toContain('id="your-site"');
    expect(html).toContain("https://site.example/agala");
  });
});

describe("migration", () => {
  const sql = readFileSync("supabase/migrations/2026-10-19-site-mode.sql", "utf8");
  it("adds the column, the check constraint and the backfill", () => {
    expect(sql).toContain("add column if not exists site_mode text not null default 'claudia'");
    expect(sql).toContain("drop constraint if exists venues_site_mode_check");
    expect(sql).toMatch(/check \(site_mode in \('claudia', 'own', 'none'\)\)/);
    expect(sql).toContain("update public.venues set site_mode='own' where site_url is not null and site_mode='claudia'");
  });
  it("is mirrored in schema.sql", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toContain("add column if not exists site_mode text not null default 'claudia'");
    expect(schema).toContain("venues_site_mode_check");
  });
});

describe("venue:create --site-mode", () => {
  it("--site-url alone implies own; no flags is claudia; the flags cannot disagree", () => {
    expect(resolveSiteMode(undefined, "https://a.example")).toEqual({ ok: true, mode: "own" });
    expect(resolveSiteMode(undefined, null)).toEqual({ ok: true, mode: "claudia" });
    expect(resolveSiteMode("none", null)).toEqual({ ok: true, mode: "none" });
    expect(resolveSiteMode("own", "https://a.example")).toEqual({ ok: true, mode: "own" });
    expect(resolveSiteMode("own", null).ok).toBe(false);
    expect(resolveSiteMode("none", "https://a.example").ok).toBe(false);
    expect(resolveSiteMode("claudia", "https://a.example").ok).toBe(false);
    expect(resolveSiteMode("website", null).ok).toBe(false);
  });
  it("invite:create with a site URL moves the venue to own", async () => {
    const { store, venue } = await makeDemo();
    const r = await prepareInvite(store, { slug: venue.slug, role: "owner", siteUrl: "https://own.example", now: T0 });
    expect(r.ok && r.venue).toMatchObject({ site_mode: "own", site_url: "https://own.example" });
  });
});
