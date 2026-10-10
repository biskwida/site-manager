"use client";
import { QRCodeSVG } from "qrcode.react";
import { useLang } from "@/src/i18n";
import { Section } from "./bits";

/**
 * The menu QR for the tables (white quiet zone so it scans when printed), then plain links to the site and the menu.
 * `siteUrl` is the overview's site_url: the deployed site once it is ready, otherwise the hosted /<slug> (both serve /menu).
 */
export function QrCard({ siteUrl }: { siteUrl: string }) {
  const { t } = useLang();
  const menuUrl = `${siteUrl}/menu`;
  const links = [
    { href: siteUrl, label: t("admin.site"), shown: siteUrl },
    { href: menuUrl, label: t("admin.menuLink"), shown: menuUrl },
  ];
  return (
    <>
      <Section id="qr" title={t("admin.qr")}>
        <figure className="flex flex-col items-center gap-3 rounded-3xl bg-card p-5 ring-1 ring-ink/10 sm:flex-row sm:items-center sm:gap-6">
          <div className="rounded-2xl bg-white p-2 ring-1 ring-ink/10">
            <QRCodeSVG value={menuUrl} size={200} marginSize={2} level="M" title={t("admin.qr")} role="img" aria-label={t("admin.qr")} />
          </div>
          <figcaption className="[overflow-wrap:anywhere] text-center text-sm text-ink-soft sm:text-left">{t("admin.qrNote", { url: menuUrl })}</figcaption>
        </figure>
      </Section>
      <Section id="links" title={t("admin.links")}>
        <ul className="grid gap-2">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener" className="flex min-h-11 flex-col justify-center rounded-2xl bg-card px-4 py-2 ring-1 ring-ink/10 hover:ring-accent/50">
                <span className="font-semibold text-ink">{l.label}<span className="sr-only"> {t("admin.newTab")}</span></span>
                <span className="[overflow-wrap:anywhere] text-sm text-ink-soft">{l.shown}</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
