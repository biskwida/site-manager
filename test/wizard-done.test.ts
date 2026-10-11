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

const TG: AppLink[] = [{ app: "telegram", url: "https://t.me/site_manager_bot?start=ABCD2345", dest: "@site_manager_bot", chat: "https://t.me/site_manager_bot" }];
const FOUR: AppLink[] = [
  ...TG,
  { app: "whatsapp", url: "https://wa.me/359888123456?text=ABCD2345", dest: "+359888123456", chat: "https://wa.me/359888123456" },
  { app: "messenger", url: "https://m.me/sitemanager?ref=ABCD2345", dest: "m.me/sitemanager", chat: "https://m.me/sitemanager" },
  { app: "instagram", url: "https://ig.me/m/site.manager?ref=ABCD2345", dest: "@site.manager", chat: "https://ig.me/m/site.manager" },
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
      expect(count(html, 'href="https://t.me/site_manager_bot?start=')).toBe(1);
      expect(html).not.toContain('role="radiogroup"');
      expect(html).not.toMatch(/24 (часа|hours)/);
      expect(html).toContain("/start ABCD2345");
    }
    expect(render("bg", waiting)).toContain("Отворете Telegram");
    expect(render("en", waiting)).toContain("Open Telegram");
    expect(render("bg", waiting)).toContain("натиснете Start в Telegram");
  });
  it("names the bot as a link to its chat (new tab, no code in the URL) with a paste hint, in both languages", () => {
    const bg = render("bg", waiting);
    expect(bg).toMatch(/Ботът в Telegram:\s*<a href="https:\/\/t\.me\/site_manager_bot" target="_blank" rel="noopener noreferrer" data-dest="telegram"[^>]*>@site_manager_bot<\/a>/);
    expect(bg).toContain("Натиснете името: чатът се отваря, а кодът се копира, за да го поставите.");
    const en = render("en", waiting);
    expect(en).toContain("The bot on Telegram:");
    expect(en).toContain("Tap the name: the chat opens and the code is copied, ready to paste.");
    // an older payload without dest still renders the button and the code, just no name line
    const old = render("en", waiting, { links: [{ app: "telegram", url: "https://t.me/site_manager_bot?start=ABCD2345" }] });
    expect(old).toContain("Open Telegram");
    expect(old).not.toContain("The bot on Telegram:");
  });
  it("four apps: each button shows where it goes", () => {
    const html = render("en", waiting, { links: FOUR, apps: [...ALL] });
    for (const l of FOUR) expect(html).toContain(`>${l.dest}</span>`);
  });
  it("four apps: a button per app with its icon, a keyboard radio group for the QR (Telegram picked), the bare code and the 24-hour line", () => {
    const bg = render("bg", waiting, { links: FOUR, apps: [...ALL] });
    for (const name of ["Telegram", "WhatsApp", "Messenger", "Instagram"]) expect(bg).toContain(`Отворете ${name}`);
    for (const l of FOUR) expect(bg).toContain(`href="${l.url.replace(/&/g, "&amp;")}"`);
    for (const a of ALL) expect(count(bg, `data-app-icon="${a}"`)).toBe(2); // one on its button, one in the QR picker
    expect(bg).toContain('role="radiogroup"');
    // a visible label names the picker, so it does not read as a second choice of app
    const label = /<p id="([^"]+)"[^>]*>QR код за:<\/p><div role="radiogroup" aria-labelledby="([^"]+)"/.exec(bg);
    expect(label?.[1]).toBeTruthy();
    expect(label?.[1]).toBe(label?.[2]);
    expect(bg).toContain("grid-cols-2"); // four apps: two rows of two
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
  it("three apps sit in one row of three, never two plus one", () => {
    const html = render("en", waiting, { links: FOUR.slice(0, 3), apps: ["telegram", "whatsapp", "messenger"] });
    expect(html).toMatch(/role="radiogroup"[^>]*class="[^"]*grid-cols-3/);
    expect(html).toContain(">QR code for:</p>");
  });
  it("one app that is not Telegram: generic copy and the bare code, never Start or /start", () => {
    const wa = [FOUR[1]];
    for (const lang of ["bg", "en"] as const) {
      const html = render(lang, waiting, { links: wa, apps: ["whatsapp"] });
      expect(html).not.toContain("Start");
      expect(html).not.toContain("/start");
      expect(html).toContain(">ABCD2345</code>");
      expect(html).toContain(lang === "bg" ? "Чакаме да свържете приложение" : "Waiting for you to connect an app");
      expect(html).toContain(lang === "bg" ? "свържете приложението, от което ще управлявате сайта" : "connect the app you will run the site from");
      expect(html).toContain(lang === "bg" ? "Отворете WhatsApp" : "Open WhatsApp");
      expect(html).not.toContain('role="radiogroup"');
      expect(html).toMatch(/24 (часа|hours)/);
    }
  });
  it("the connected line can take focus (it receives it when the fresh code closes)", () => {
    const joined: DoneStatusResponse = { ...waiting, owner_joined: true, connected_apps: [{ app: "telegram", owners: 1, staff: 0 }] };
    expect(render("en", joined, { code: null, links: [], apps: [...ALL] })).toMatch(/<p id="connected" tabindex="-1"[^>]*>/);
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
