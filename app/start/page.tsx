// app/start/page.tsx — the sign-up gate of onboarding. Signed out: the email link / Google form of /login, which returns to
// /start/choose with the plan and language this page was opened with. Signed in: straight to /start/choose.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/LoginForm";
import { AccountShell, otherLangHref } from "@/app/components/AccountShell";
import { pillCls } from "@/app/components/account-ui";
import { parsePlan, startPath } from "@/src/auth/start-links";
import { ONBOARDING, fill } from "@/src/i18n/onboarding";
import { firstParam, readPageLang } from "@/src/server/request-lang";
import { getSessionUser, supabasePublicEnv } from "@/src/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Започнете · Start · Claudia", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: PageProps<"/start">) {
  const sp = await searchParams;
  const plan = parsePlan(firstParam(sp.plan));
  const query = firstParam(sp.lang);
  const lang = await readPageLang(sp.lang);
  const next = startPath("/start/choose", { plan, lang });
  if (await getSessionUser()) redirect(next);
  const t = ONBOARDING[lang];
  return (
    <AccountShell lang={lang} otherLangHref={otherLangHref("/start", { plan: plan ?? undefined }, lang)}>
      <div className="mx-auto w-full max-w-md">
        {plan ? <span className={`${pillCls} mb-4`}>{fill(t.planLabel, { plan: t[`plan.${plan}`] })}</span> : null}
        <h1 className="font-display text-4xl leading-tight">{t["start.title"]}</h1>
        <p className="mb-6 mt-3 text-[var(--cl-ink-2)]">{t["start.lead"]}</p>
        {supabasePublicEnv() ? (
          <>
            <LoginForm lang={lang} next={next} rememberLang={query === "bg" || query === "en"} initialError={false} />
            <p className="mt-5 text-sm text-[var(--cl-ink-2)]">
              {t["start.haveAccount"]}{" "}
              <a href={`/login?lang=${lang}`} className="inline-flex min-h-11 items-center text-[var(--cl-accent)] underline underline-offset-4 hover:text-[var(--cl-accent-hover)]">{t["start.login"]}</a>
            </p>
          </>
        ) : (
          <p role="status" className="rounded-2xl border border-[var(--cl-line)] bg-[var(--cl-card)] p-6 text-[var(--cl-ink-2)]">{t["start.unavailable"]}</p>
        )}
      </div>
    </AccountShell>
  );
}
