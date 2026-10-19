// app/start/choose/page.tsx — the three paths: A a website made for me (the wizard), B I already have a website, C only social media.
// With ?plan=social paths B and C come first and A says that a website comes with Admin or Both (it stays clickable).
// An owner who already has businesses sees "add another business". Signed out: back to /start with the plan and language kept.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { AccountShell, otherLangHref } from "@/app/components/AccountShell";
import { eyebrowCls, pillCls } from "@/app/components/account-ui";
import { parsePlan, startPath } from "@/src/auth/start-links";
import { ONBOARDING, fill, type OnboardingKey } from "@/src/i18n/onboarding";
import { getServerDeps } from "@/src/server/deps";
import { firstParam, readPageLang } from "@/src/server/request-lang";
import { getSessionUser } from "@/src/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Започнете · Start · Claudia", robots: { index: false, follow: false } };

const ICONS: Record<"a" | "b" | "c", React.ReactNode> = {
  a: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 14h5" />
    </>
  ),
  b: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  c: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="5" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="17" cy="7" r="1" />
    </>
  ),
};

export default async function Page({ searchParams }: PageProps<"/start/choose">) {
  const sp = await searchParams;
  const plan = parsePlan(firstParam(sp.plan));
  const lang = await readPageLang(sp.lang);
  const user = await getSessionUser();
  if (!user) redirect(startPath("/start", { plan, lang }));
  const deps = await getServerDeps((fn) => after(fn));
  const hasVenues = (await deps.store.listVenuesForUser(user.id)).length > 0;
  const t = ONBOARDING[lang];
  const ctx = { plan, lang };
  const cards = [
    { id: "a" as const, href: startPath("/new", { lang }), note: plan === "social" },
    { id: "b" as const, href: startPath("/start/own-site", ctx), note: false },
    { id: "c" as const, href: startPath("/start/social", ctx), note: false },
  ];
  // Social media only: B and C first; A last and explained, still a normal link.
  const ordered = plan === "social" ? [cards[1], cards[2], cards[0]] : cards;
  return (
    <AccountShell lang={lang} wide otherLangHref={otherLangHref("/start/choose", { plan: plan ?? undefined }, lang)}>
      <span className={eyebrowCls}>{t["choose.eyebrow"]}</span>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-4xl leading-tight">{hasVenues ? t["choose.titleMore"] : t["choose.title"]}</h1>
        {plan ? <span className={pillCls}>{fill(t.planLabel, { plan: t[`plan.${plan}`] })}</span> : null}
      </div>
      {hasVenues ? (
        <p className="mt-2 text-[var(--cl-ink-2)]">
          {t["choose.leadMore"]}{" "}
          <Link href="/dashboard" className="inline-flex min-h-11 items-center text-[var(--cl-accent)] underline underline-offset-4">{t["choose.dashboard"]}</Link>
        </p>
      ) : null}
      <ul className="mt-6 grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {ordered.map((c) => (
          <li key={c.id}>
            <a href={c.href} className="grid h-full gap-2.5 rounded-2xl border border-[var(--cl-line)] bg-[var(--cl-card)] p-5 transition-colors hover:border-[var(--cl-accent)] focus-visible:border-[var(--cl-accent)]" {...(c.note ? { "aria-describedby": "a-note" } : {})}>
              <span className="grid size-11 place-items-center rounded-xl bg-[var(--cl-accent-soft)]">
                <svg viewBox="0 0 24 24" className="size-6 fill-none stroke-[var(--cl-accent)]" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[c.id]}</svg>
              </span>
              <h2 className="font-display text-2xl">{t[`choose.${c.id}.title` as OnboardingKey]}</h2>
              <p className="text-[var(--cl-ink-2)]">{t[`choose.${c.id}.text` as OnboardingKey]}</p>
              <span id={c.note ? "a-note" : undefined} className={c.note ? "text-sm font-medium text-[var(--cl-ink)]" : "text-sm text-[var(--cl-ink-2)]"}>
                {c.note ? t["choose.a.socialNote"] : t[`choose.${c.id}.meta` as OnboardingKey]}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </AccountShell>
  );
}
