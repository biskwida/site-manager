"use client";
import { LangToggle, useLang } from "@/src/i18n";

/** Shown on the account dashboard when the session ends while the page is open (the poll gets a 401): a way back in. */
export function SessionExpired({ slug }: { slug: string }) {
  const { t } = useLang();
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col px-4 py-6">
      <div className="flex justify-end">
        <LangToggle />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p role="alert" className="text-lg text-ink-soft text-balance">{t("admin.sessionExpired")}</p>
        <a href={`/login?next=${encodeURIComponent(`/dashboard/${slug}`)}`} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110">
          {t("admin.sessionExpired.cta")}
        </a>
      </div>
    </main>
  );
}
