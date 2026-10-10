// test/wizard-done.test.ts
import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeployInfo, Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { DoneStatus, phaseOf, type DoneStatusResponse } from "@/app/new/[id]/done/DoneStatus";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const deploy = (status: DeployInfo["status"], url: string | null = null): DeployInfo =>
  ({ provider: "fake", project_id: "prj_1", deployment_id: "dpl_1", url, status, error: null, template: "nocturne", updated_at: "2026-10-10T10:00:00.000Z" });

function render(lang: Lang, initial: DoneStatusResponse, over: Partial<Parameters<typeof DoneStatus>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(Provider, { defaultLang: lang },
      createElement(DoneStatus, { id: "v1", slug: "bar", code: "ABCD2345", startUrl: "https://t.me/site_manager_bot?start=ABCD2345", adminKey: "k1", baseUrl: "https://site.example", initial, ...over })),
  );
}

describe("phaseOf", () => {
  it("maps status + deploy to a phase", () => {
    expect(phaseOf({ status: "live", deploy: null, site_url: null })).toBe("waiting");
    expect(phaseOf({ status: "live", deploy: deploy("pending"), site_url: null })).toBe("publishing");
    expect(phaseOf({ status: "live", deploy: deploy("building"), site_url: null })).toBe("publishing");
    expect(phaseOf({ status: "live", deploy: deploy("ready", "https://bar.example.test"), site_url: "https://bar.example.test" })).toBe("live");
    expect(phaseOf({ status: "live", deploy: deploy("error"), site_url: null })).toBe("error");
  });
});

describe("DoneStatus", () => {
  const waiting: DoneStatusResponse = { status: "live", deploy: null, site_url: null };
  it("shows the code, the deep link, a QR and the waiting line in both languages", () => {
    const bg = render("bg", waiting);
    expect(bg).toContain("/start ABCD2345");
    expect(bg).toContain("https://t.me/site_manager_bot?start=ABCD2345");
    expect(bg).toContain("<svg");
    expect(bg).toContain("Чакаме Telegram");
    expect(bg).toContain("7 дни");
    expect(bg).toContain("https://site.example/bar");
    expect(bg).toContain("/admin/bar?key=k1");
    const en = render("en", waiting);
    expect(en).toContain("Waiting for Telegram");
    expect(en).toContain("7 days");
    expect(en).toContain('data-phase="waiting"');
  });
  it("encodes the raw code when the bot username is unknown", () => {
    const html = render("en", waiting, { startUrl: null });
    expect(html).not.toContain("t.me/");
    expect(html).toContain("/start ABCD2345");
    expect(html).toContain("<svg");
  });
  it("hides the code once the owner has joined", () => {
    const html = render("en", waiting, { code: null, startUrl: null });
    expect(html).toContain("Telegram is connected.");
    expect(html).not.toContain("/start");
  });
  it("shows publishing, live (as a link) and error lines", () => {
    expect(render("bg", { status: "live", deploy: deploy("building"), site_url: null })).toContain("Публикуваме сайта ви");
    expect(render("en", { status: "live", deploy: deploy("building"), site_url: null })).toContain('data-phase="publishing"');
    const live = render("en", { status: "live", deploy: deploy("ready", "https://bar.example.test"), site_url: "https://bar.example.test" });
    expect(live).toContain('href="https://bar.example.test"');
    expect(live).toContain("Live at");
    expect(live).toContain('data-phase="live"');
    expect(render("bg", { status: "live", deploy: deploy("ready", "https://bar.example.test"), site_url: "https://bar.example.test" })).toContain("На живо на");
    expect(render("en", { status: "live", deploy: deploy("error"), site_url: null })).toContain("hit a snag");
    expect(render("bg", { status: "live", deploy: deploy("error"), site_url: null })).toContain("запъна");
  });
  it("never puts the admin key or the code anywhere a crawler could follow", () => {
    const html = render("en", waiting);
    // the dashboard link is relative (same origin) and the page is noindex; no absolute admin URL is rendered
    expect(html).not.toContain("https://site.example/admin/");
  });
});
