import type { Metadata } from "next";
import type { ReactNode } from "react";
import { def } from "@/src/templates/current";
import { siteUrl } from "./feed";
import "./globals.css";

/** Every route (the static not-found page included) resolves the Open Graph image against this site's own origin. */
export const metadata: Metadata = { metadataBase: new URL(siteUrl()) };

/** The template's next/font classes go on <html> so --font-display/--font-body exist everywhere (body, not-found, template root). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bg" className={`${def.fontVars} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
