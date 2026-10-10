"use client";
import Link from "next/link";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";

export function SiteFooter({ state }: { state: SiteState }) {
  const { lang, t } = useLang();
  const note = state.texts.find((x) => x.key === "footer_note");
  const noteText = note ? (lang === "bg" ? note.text_bg : note.text_en) || note.text_bg : "";
  return (
    <footer className="border-t border-ink/10 bg-paper-deep">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-6 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="font-semibold text-ink">{state.venue.name}</p>
          {noteText && <p className="mt-0.5">{noteText}</p>}
        </div>
        <Link href="/" className="underline decoration-ink/30 underline-offset-4 hover:text-ink">{t("site.poweredBy")}</Link>
      </div>
    </footer>
  );
}
