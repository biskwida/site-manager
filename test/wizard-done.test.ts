// test/wizard-done.test.ts
import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeployInfo, Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { DoneStatus, phaseOf, type DoneStatusResponse } from "@/app/new/[id]/done/DoneStatus";
import type { AppLink } from "@/app/components/ConnectApps";

// createElement passes children positionally, which LangProvider's required `children` prop type does not model.
const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;

const deploy = (status: DeployInfo["status"], url: string | null = null): DeployInfo =>
  ({ provider: "fake", project_id: "prj_1", deployment_id: "dpl_1", url, status, error: null, template: "nocturne", updated_at: "2026-10-10T10:00:00.000Z" });

const TG: AppLink[] = [{ app: "telegram", url: "https://t.me/site_manager_bot?start=ABCD2345" }];
const FOUR: AppLink[] = [
  ...TG,
  { app: "whatsapp", url: "https://wa.me/359888123456?text=ABCD2345" },
  { app: "messenger", url: "https://m.me/sitemanager?ref=ABCD2345" },
  { app: "instagram", url: "https://ig.me/m/site.manager?ref=ABCD2345" },
];
const ALL = ["telegram", "whatsapp", "messenger", "instagram"] as const;

function render(lang: Lang, initial: DoneStatusResponse, over: Partial<Parameters<typeof DoneStatus>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(Provider, { defaultLang: lang },
      createElement(DoneStatus, { id: "v1", slug: "bar", code: "ABCD2345", links: TG, apps: ["telegram"], adminKey: "k1", baseUrl: "https://site.example", initial, ...over })),
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
  it("without a deployer the hosted site is live as soon as the owner joined", () => {
    expect(phaseOf({ status: "live", deploy: null, site_url: "https://site.example/bar", owner_joined: false, hosted: true })).toBe("waiting");
    expect(phaseOf({ status: "live", deploy: null, site_url: "https://site.example/bar", owner_joined: true, hosted: true })).toBe("live");
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
    const html = render("en", waiting, { links: [], apps: [] });
    expect(html).not.toContain("t.me/");
    expect(html).toContain("/start ABCD2345");
    expect(html).toContain("<svg");
  });
  it("hides the code once the owner has joined", () => {
    const html = render("en", { ...waiting, owner_joined: true, connected_apps: [{ app: "telegram", owners: 1, staff: 0 }] }, { code: null, links: [] });
    expect(html).toContain("Connected:");
    expect(html).toContain("Telegram ✓");
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
  it("hosted mode: the code stays until an owner exists, then the hosted URL shows as live", () => {
    const before = render("en", { status: "live", deploy: null, site_url: "https://site.example/bar", owner_joined: false, hosted: true });
    expect(before).toContain("/start ABCD2345");
    expect(before).toContain('data-phase="waiting"');
    const after = render("bg", { status: "live", deploy: null, site_url: "https://site.example/bar", owner_joined: true, hosted: true, connected_apps: [{ app: "telegram", owners: 1, staff: 0 }] }, { code: null, links: [] });
    expect(after).not.toContain("/start ABCD2345");
    expect(after).toContain("Свързано:");
    expect(after).toContain("Telegram ✓");
    expect(after).toContain('data-phase="live"');
    expect(after).toContain('href="https://site.example/bar"');
  });
  it("never puts the admin key or the code anywhere a crawler could follow", () => {
    const html = render("en", waiting);
    // the dashboard link is relative (same origin) and the page is noindex; no absolute admin URL is rendered
    expect(html).not.toContain("https://site.example/admin/");
  });
});

describe("DoneStatus: connect an app", () => {
  const waiting: DoneStatusResponse = { status: "live", deploy: null, site_url: null, owner_joined: false, connected_apps: [] };
  const count = (html: string, needle: string) => html.split(needle).length - 1;
  it("one app (production today): the Telegram block as before, no picker, no 24-hour line", () => {
    for (const lang of ["bg", "en"] as const) {
      const html = render(lang, waiting);
      expect(count(html, 'href="https://t.me/')).toBe(1);
      expect(html).not.toContain('role="radiogroup"');
      expect(html).not.toMatch(/24 (часа|hours)/);
      expect(html).toContain("/start ABCD2345");
    }
    expect(render("bg", waiting)).toContain("Отворете Telegram");
    expect(render("en", waiting)).toContain("Open Telegram");
    expect(render("bg", waiting)).toContain("натиснете Start в Telegram");
  });
  it("four apps: a button per app with its icon, a keyboard radio group for the QR (Telegram picked), the bare code and the 24-hour line", () => {
    const bg = render("bg", waiting, { links: FOUR, apps: [...ALL] });
    for (const name of ["Telegram", "WhatsApp", "Messenger", "Instagram"]) expect(bg).toContain(`Отворете ${name}`);
    for (const l of FOUR) expect(bg).toContain(`href="${l.url.replace(/&/g, "&amp;")}"`);
    for (const a of ALL) expect(count(bg, `data-app-icon="${a}"`)).toBe(2); // one on its button, one in the QR picker
    expect(bg).toContain('role="radiogroup"');
    expect(bg).toContain('aria-label="QR код за"');
    expect(count(bg, 'role="radio"')).toBe(4);
    expect(bg).toMatch(/role="radio" aria-checked="true" tabindex="0"[^>]*>(<svg[^>]*>.*?<\/svg>)?Telegram/);
    expect(count(bg, 'aria-checked="false" tabindex="-1"')).toBe(3);
    expect(bg).toContain("Ако линкът не пренесе кода, изпратете го като съобщение");
    expect(bg).toContain(">ABCD2345</code>");
    expect(bg).not.toContain("/start ABCD2345");
    expect(bg).toContain("В Messenger, Instagram и WhatsApp напомнянията идват, ако сте писали на бота през последните 24 часа.");
    expect(bg).toContain("Свържете приложение");
    expect(bg).toContain("свържете приложението, от което ще управлявате сайта");
    expect(bg).toContain("Чакаме да свържете приложение");
    const en = render("en", waiting, { links: FOUR, apps: [...ALL] });
    expect(en).toContain("Open WhatsApp");
    expect(en).toContain("If the link doesn&#x27;t carry the code, send it as a message");
    expect(en).toContain("reminders reach you if you have written to the bot in the last 24 hours");
    expect(en).toContain('aria-label="Scan with your phone to open the bot: Telegram"');
  });
  it("Telegram plus WhatsApp only: still the 24-hour line (a Meta app is on)", () => {
    expect(render("en", waiting, { links: FOUR.slice(0, 2), apps: ["telegram", "whatsapp"] })).toContain("last 24 hours");
  });
  it("after the first app connects: the connected line and, with more apps on, a secondary connect-another button", () => {
    const joined: DoneStatusResponse = { ...waiting, owner_joined: true, connected_apps: [{ app: "telegram", owners: 1, staff: 0 }] };
    const bg = render("bg", joined, { code: null, links: [], apps: [...ALL] });
    expect(bg).toContain("Свързано:");
    expect(bg).toContain("Telegram ✓");
    expect(bg).toContain("Свържете още едно приложение");
    expect(bg).not.toContain('role="radiogroup"');
    expect(render("en", joined, { code: null, links: [], apps: [...ALL] })).toContain("Connect another app");
    // one app enabled: as before, no extra button
    expect(render("en", joined, { code: null, links: [] })).not.toContain("Connect another app");
  });
});
