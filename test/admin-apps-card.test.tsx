// test/admin-apps-card.test.tsx — the dashboard's "Your apps" card (static render, both languages).
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppsCard } from "@/app/admin/[slug]/components/AppsCard";
import type { Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import type { ConnectedApp, OwnerCode } from "@/src/server/connect-apps";

const Provider = LangProvider as (props: { defaultLang: Lang; children?: ReactNode }) => ReactNode;
const post = async () => ({ ok: true, data: null });
const render = (lang: Lang, apps: ConnectedApp[], initialCode: OwnerCode | null = null, initialFailed: { bg: string; en: string } | true | null = null) =>
  renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, createElement(AppsCard, { apps, post, initialCode, initialFailed })));

const FRESH: OwnerCode = {
  code: "WXYZ6789",
  expires_at: "2026-10-18T09:00:00.000Z",
  links: [
    { app: "telegram", url: "https://t.me/site_bot?start=WXYZ6789", dest: "@site_bot", chat: "https://t.me/site_bot" },
    { app: "whatsapp", url: "https://wa.me/359888123456?text=WXYZ6789", dest: "+359888123456", chat: "https://wa.me/359888123456" },
    { app: "messenger", url: "https://m.me/sitemanager?ref=WXYZ6789", dest: "m.me/sitemanager", chat: "https://m.me/sitemanager" },
    { app: "instagram", url: "https://ig.me/m/site.manager?ref=WXYZ6789", dest: "@site.manager", chat: "https://ig.me/m/site.manager" },
  ],
};

describe("AppsCard", () => {
  it("lists connected apps with owner and staff counts", () => {
    const bg = render("bg", [{ app: "telegram", owners: 1, staff: 2 }]);
    expect(bg).toContain("Вашите приложения");
    expect(bg).toContain("Telegram");
    expect(bg).toContain('data-app-icon="telegram"');
    expect(bg).toContain("1 собственик, 2 служители");
    expect(bg).toContain("Свържете още едно");
    const en = render("en", [{ app: "telegram", owners: 2, staff: 0 }, { app: "whatsapp", owners: 1, staff: 1 }]);
    expect(en).toContain("Your apps");
    expect(en).toContain("2 owners");
    expect(en).not.toContain("0 staff");
    expect(en).toContain("1 owner, 1 staff member");
    expect(en).toContain("WhatsApp");
    expect(en).toContain("Connect another");
  });
  it("says so when no app is connected yet", () => {
    expect(render("bg", [])).toContain("Още няма свързано приложение");
    expect(render("en", [])).toContain("No app is connected yet");
  });
  it("shows a fresh code with a button per app, the QR picker and the bare code", () => {
    const html = render("en", [{ app: "telegram", owners: 1, staff: 0 }], FRESH);
    for (const l of FRESH.links) expect(html).toContain(`href="${l.url}"`);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(">WXYZ6789</code>");
    expect(html).toContain("last 24 hours");
    expect(html).toContain(">Done</button>");
    expect(html).not.toContain(">Connect another</button>"); // replaced by the open code until Done
  });
  it("the fresh-code lead offers another app only when the server answers several", () => {
    expect(render("en", [], FRESH)).toContain("A new owner code for one more app or a second phone.");
    expect(render("bg", [], FRESH)).toContain("за още едно приложение или втори телефон");
    const one = { ...FRESH, links: FRESH.links.slice(0, 1) };
    const en = render("en", [], one);
    expect(en).toContain("A new owner code for another phone.");
    expect(en).not.toContain("one more app");
    const bg = render("bg", [], one);
    expect(bg).toContain("за още един телефон");
    expect(bg).not.toContain("приложение или");
  });
  it("a fresh code with Telegram alone keeps the /start form", () => {
    const html = render("bg", [], { ...FRESH, links: FRESH.links.slice(0, 1) });
    expect(html).toContain("/start WXYZ6789");
    expect(html).toContain("Отворете Telegram");
    expect(html).not.toContain('role="radiogroup"');
  });
  it("shows the server's message for 429 and 409 in the page language, else a generic failure", () => {
    const limited = { bg: "Твърде много нови кодове за час. Опитайте по-късно.", en: "Too many new codes this hour. Try again later." };
    const notLive = { bg: "Първо публикувайте сайта.", en: "Publish the site first." };
    const bg = render("bg", [], null, limited);
    expect(bg).toContain('role="alert"');
    expect(bg).toContain(limited.bg);
    expect(bg).toContain("Свържете още едно"); // the button stays so the owner can try later
    expect(render("en", [], null, limited)).toContain(limited.en);
    expect(render("en", [], null, notLive)).toContain("Publish the site first.");
    expect(render("bg", [], null, notLive)).toContain("Първо публикувайте сайта.");
    expect(render("en", [], null, true)).toContain("That did not work");
  });
});
