"use client";
import Link from "next/link";
import { LangToggle } from "@/src/i18n";
import { BUTTON_BASE, BUTTON_STYLES } from "./Field";
import { useT } from "./useWizardText";

export function NoDraft() {
  const { t } = useT();
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="font-brand-display text-lg font-semibold tracking-tight">{t("brand")}</span>
        <LangToggle />
      </header>
      <h1 className="mt-12 text-3xl font-semibold leading-tight sm:text-4xl">{t("nodraft.title")}</h1>
      <p className="mt-4 max-w-[55ch] text-lg leading-relaxed text-fg-soft">{t("nodraft.body")}</p>
      <Link href="/new" className={`${BUTTON_BASE} ${BUTTON_STYLES.primary} mt-8 px-6`}>{t("nodraft.cta")}</Link>
    </main>
  );
}
