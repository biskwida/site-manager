import type { Metadata } from "next";
import type { ReactNode } from "react";
import { def } from "@/src/templates/current";
import { htmlLang, loadFeed, siteUrl } from "./feed";
import "./globals.css";

/** Every route (the static not-found page included) resolves the Open Graph image against this site's own origin. */
export const metadata: Metadata = { metadataBase: new URL(siteUrl()) };

/**
 * The template's next/font classes go on <html> so --font-display/--font-body exist everywhere (body, not-found, template root).
 * lang is the venue's main language (the same revalidated feed fetch the pages make, deduplicated by Next).
 * Template fonts are declared with preload: false (the main app bundles all six templates); next/font does not expose the
 * hashed file URLs, so there is no clean <link rel="preload"> here and the faces load on first use with display: swap.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = htmlLang(await loadFeed());
  return (
    <html lang={lang} className={`${def.fontVars} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
