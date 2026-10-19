"use client";
import Link from "next/link";
import { LangToggle, useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";

export interface VenueRow {
  slug: string;
  name: string;
  site_mode: "claudia" | "own" | "none";
}

/** The signed-in owner's businesses: name, how its site is run, a link to each dashboard; an empty state that leads to /start. */
export function VenueList({ venues }: { venues: VenueRow[] }) {
  const { t } = useLang();
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold leading-tight">{t("dashboard.title")}</h1>
        <LangToggle />
      </div>
      {venues.length === 0 ? (
        <section className="mt-8 rounded-3xl bg-card p-5 ring-1 ring-ink/10">
          <p className="text-lg font-semibold">{t("dashboard.empty")}</p>
          <p className="mt-2 text-sm text-ink-soft">{t("dashboard.emptyHint")}</p>
          <Link href="/start" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110">{t("dashboard.start")}</Link>
        </section>
      ) : (
        <>
          <p className="mt-2 text-ink-soft">{t("dashboard.lead")}</p>
          <ul className="mt-6 grid gap-3">
            {venues.map((v) => (
              <li key={v.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
                <div className="min-w-0">
                  <p className="break-words text-lg font-semibold">{v.name}</p>
                  <p className="text-sm text-ink-soft">{v.slug} · {t(`dashboard.mode.${v.site_mode}` as MessageKey)}</p>
                </div>
                <a href={`/dashboard/${encodeURIComponent(v.slug)}`} className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5">{t("dashboard.open")}</a>
              </li>
            ))}
          </ul>
        </>
      )}
      <form action="/auth/signout" method="post" className="mt-10">
        <button type="submit" className="min-h-11 text-sm font-semibold text-ink-soft underline underline-offset-4 hover:text-ink">{t("dashboard.signout")}</button>
      </form>
    </main>
  );
}
