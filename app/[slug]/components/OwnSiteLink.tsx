"use client";
// app/[slug]/components/OwnSiteLink.tsx: the hosted page of a self-serve venue that has its own website (created on /start). Such a page does
// not redirect to the address the owner typed in (that would be an open redirect on our domain); it shows this plain link instead.
import { useLang } from "@/src/i18n";

export function OwnSiteLink({ href }: { href: string }) {
  const { t } = useLang();
  return (
    <p style={{ margin: 0, padding: "12px 16px", textAlign: "center", background: "#faf7f2", color: "#1d2a24", fontSize: 16, lineHeight: 1.4, borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
      <a href={href} target="_blank" rel="nofollow noopener" style={{ display: "inline-block", minHeight: 44, lineHeight: "44px", color: "inherit", fontWeight: 600, textDecoration: "underline" }}>{t("site.ownSite")}</a>
    </p>
  );
}
