"use client";
import { LangToggle, useLang } from "@/src/i18n";

/** Shown for a missing, wrong or rotated key; says nothing about whether the venue exists. */
export function InvalidKey() {
  const { t } = useLang();
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col px-4 py-6">
      <div className="flex justify-end">
        <LangToggle />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="text-3xl font-semibold">{t("admin.title")}</h1>
        <p role="alert" className="mt-4 text-lg text-ink-soft text-balance">{t("admin.invalid")}</p>
      </div>
    </main>
  );
}
