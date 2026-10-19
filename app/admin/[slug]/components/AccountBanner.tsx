"use client";
import { useLang } from "@/src/i18n";

/**
 * Shown on the key page (/admin/<slug>?key=) while the venue has no owner account: log in with an email next time. There is no
 * self-serve linking (an invite is claimed only at sign-in), so the text says to ask Claudia's team; the link goes to sign-in.
 */
export function AccountBanner({ slug }: { slug: string }) {
  const { t } = useLang();
  return (
    <aside role="note" className="mt-6 rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
      <h2 className="text-base font-semibold">{t("admin.account.title")}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t("admin.account.body")}</p>
      <a href={`/login?next=${encodeURIComponent(`/dashboard/${slug}`)}`} className="mt-3 inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5">
        {t("admin.account.cta")}
      </a>
    </aside>
  );
}
