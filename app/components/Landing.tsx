"use client";
import Link from "next/link";
import { LangToggle, useLang } from "@/src/i18n";
import { SITE_NAME } from "@/src/i18n/dicts";
import { LegalLinks } from "./Legal";

export function Landing({ demoSlug }: { demoSlug: string }) {
  const { t } = useLang();
  const steps = [1, 2, 3] as const;
  const feats = [1, 2, 3, 4, 5, 6] as const;
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="font-display text-lg font-semibold">{SITE_NAME}</span>
        <LangToggle />
      </header>
      <section className="animate-rise pt-8 sm:pt-16">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">{t("landing.eyebrow")}</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-6xl">{t("landing.h1")}</h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-soft">{t("landing.lead")}</p>
        <div className="mt-8 flex flex-col items-start gap-2">
          <Link href="/new" className="rounded-full bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-110">{t("landing.cta")}</Link>
          <span className="text-sm text-ink-soft">{t("landing.ctaNote")}</span>
          <Link href={`/${demoSlug}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline">{t("nav.demo")}</Link>
        </div>
      </section>
      <section className="mt-16">
        <h2 className="text-2xl font-semibold">{t("landing.how")}</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {steps.map((n) => (
            <li key={n} className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
              <span className="font-display text-3xl text-accent">{n}</span>
              <h3 className="mt-2 text-lg font-semibold">{t(`landing.step${n}.title`)}</h3>
              <p className="mt-1 text-ink-soft">{t(`landing.step${n}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="mt-16">
        <h2 className="text-2xl font-semibold">{t("landing.what")}</h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {feats.map((n) => (
            <li key={n} className="flex gap-3 rounded-2xl bg-paper-deep px-4 py-3"><span aria-hidden="true" className="text-accent">●</span><span>{t(`landing.feat${n}`)}</span></li>
          ))}
        </ul>
      </section>
      <section className="mt-16 rounded-3xl bg-ink p-6 text-paper sm:p-10">
        <p className="font-display text-3xl font-semibold sm:text-4xl">{t("landing.price")}</p>
        <p className="mt-2 text-paper/80">{t("landing.priceNote")}</p>
        <p className="mt-6 border-t border-paper/20 pt-6 text-paper/90">{t("landing.evidence")}</p>
      </section>
      <section className="mt-12 text-ink-soft">
        <p>{t("landing.built")}</p>
      </section>
      <footer className="mt-16 text-sm text-ink-soft">
        <p>{t("landing.footer")}</p>
        <LegalLinks className="mt-2" />
      </footer>
    </main>
  );
}
