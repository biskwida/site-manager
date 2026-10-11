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
const render = (lang: Lang, apps: ConnectedApp[], initialCode: OwnerCode | null = null) =>
  renderToStaticMarkup(createElement(Provider, { defaultLang: lang }, createElement(AppsCard, { apps, post, initialCode })));

const FRESH: OwnerCode = {
  code: "WXYZ6789",
  expires_at: "2026-10-18T09:00:00.000Z",
  links: [
    { app: "telegram", url: "https://t.me/site_bot?start=WXYZ6789" },
    { app: "whatsapp", url: "https://wa.me/359888123456?text=WXYZ6789" },
    { app: "messenger", url: "https://m.me/sitemanager?ref=WXYZ6789" },
    { app: "instagram", url: "https://ig.me/m/site.manager?ref=WXYZ6789" },
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
  it("a fresh code with Telegram alone keeps the /start form", () => {
    const html = render("bg", [], { ...FRESH, links: FRESH.links.slice(0, 1) });
    expect(html).toContain("/start WXYZ6789");
    expect(html).toContain("Отворете Telegram");
    expect(html).not.toContain('role="radiogroup"');
  });
});
