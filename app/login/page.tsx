// app/login/page.tsx — sign in to the owner's account: an email link or Google, through Supabase Auth.
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/src/auth/next";
import { LANG_COOKIE, resolvePageLang } from "@/src/auth/page-lang";
import { LOGIN } from "@/src/i18n/login";
import { getSessionUser, supabasePublicEnv } from "@/src/server/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход · Sign in · Claudia", robots: { index: false, follow: false } };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(first(sp.next));
  // Already signed in: straight to where they were going.
  if (await getSessionUser()) redirect(next);
  const query = first(sp.lang);
  const lang = resolvePageLang({ query, cookie: (await cookies()).get(LANG_COOKIE)?.value, acceptLanguage: (await headers()).get("accept-language") });
  const t = LOGIN[lang];
  const other = new URLSearchParams({ lang: t.otherLangCode, ...(next !== "/dashboard" ? { next } : {}) });
  return (
    <main className="cl-auth flex min-h-dvh flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-md">
        <header className="mb-8 flex items-center justify-between">
          <span className="font-display text-2xl font-semibold tracking-tight text-[var(--cl-accent)]">Claudia</span>
          <a href={`/login?${other}`} lang={t.otherLangCode} className="inline-flex min-h-11 items-center text-sm text-[var(--cl-ink-2)] underline underline-offset-4 hover:text-[var(--cl-ink)]">{t.otherLang}</a>
        </header>
        <h1 className="font-display text-3xl leading-tight sm:text-4xl">{t.title}</h1>
        <p className="mb-6 mt-3 text-[var(--cl-ink-2)]">{t.lead}</p>
        {supabasePublicEnv() ? (
          <LoginForm lang={lang} next={next} rememberLang={query === "bg" || query === "en"} initialError={Boolean(first(sp.error))} />
        ) : (
          <p role="status" className="rounded-2xl border border-[var(--cl-line)] bg-[var(--cl-card)] p-6 text-[var(--cl-ink-2)]">{t.unavailable}</p>
        )}
      </div>
    </main>
  );
}
