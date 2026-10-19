"use client";
import { useLang } from "@/src/i18n";

/**
 * Shown on the key page (/admin/<slug>?key=) while the venue has no owner account. There is no self-serve linking (an invite is
 * claimed only at sign-in), so it is text only: ask Claudia's team to link the email, then log in at getclaudia.app/login.
 */
export function AccountBanner() {
  const { t } = useLang();
  return (
    <aside role="note" className="mt-6 rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
      <h2 className="text-base font-semibold">{t("admin.account.title")}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t("admin.account.body")}</p>
    </aside>
  );
}
