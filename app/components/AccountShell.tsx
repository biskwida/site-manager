// app/components/AccountShell.tsx — the frame of the account pages (/start, /onboarding): Sofia Sans in the getclaudia.app look, the
// wordmark and a language link. A server component; the language is chosen by the page (?lang=, cookie, Accept-Language).
import Link from "next/link";
import { Sofia_Sans, Sofia_Sans_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import type { PageLang } from "@/src/auth/page-lang";
import { ONBOARDING } from "@/src/i18n/onboarding";

// Both carry Bulgarian Cyrillic; the condensed face is the landing's heading face.
const body = Sofia_Sans({ subsets: ["latin", "cyrillic"], variable: "--font-sofia", display: "swap" });
const heading = Sofia_Sans_Condensed({ subsets: ["latin", "cyrillic"], variable: "--font-sofia-cond", display: "swap" });

export function AccountShell({ lang, otherLangHref, wide = false, children }: { lang: PageLang; otherLangHref: string; wide?: boolean; children: ReactNode }) {
  const t = ONBOARDING[lang];
  return (
    <div lang={lang} className={`cl-auth cl-account ${body.variable} ${heading.variable} flex min-h-dvh flex-col`}>
      <main className="mx-auto flex w-full flex-1 flex-col px-4 py-8 sm:py-14" style={{ maxWidth: wide ? "64rem" : "42rem" }}>
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="inline-flex min-h-11 items-center font-display text-3xl font-extrabold tracking-tight text-[var(--cl-accent)]">{t.brand}</Link>
          <a href={otherLangHref} lang={t.otherLangCode} className="inline-flex min-h-11 items-center text-sm text-[var(--cl-ink-2)] underline underline-offset-4 hover:text-[var(--cl-ink)]">{t.otherLang}</a>
        </header>
        {children}
      </main>
    </div>
  );
}

/** The same address with ?lang= switched to the other language (other query parts kept). */
export function otherLangHref(path: string, params: Record<string, string | undefined>, lang: PageLang): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && k !== "lang") q.set(k, v);
  q.set("lang", lang === "bg" ? "en" : "bg");
  return `${path}?${q}`;
}
