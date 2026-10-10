"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TEMPLATE_IDS, type SiteState, type TemplateId } from "@/src/domain/types";
import { LangToggle } from "@/src/i18n";
import { getTemplate } from "@/src/templates";
import { api, type ApiError } from "./api";
import { Button } from "./Field";
import { ResumeDraft, type Resume } from "./ResumeDraft";
import { ScaledFrame } from "./ScaledFrame";
import { useT } from "./useWizardText";

export function TemplateChooser({ demo, now, resume = null }: { demo: SiteState; now: number; resume?: Resume | null }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<TemplateId | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // With a draft (or a just-published site) in this browser, a new one replaces its cookie: ask first.
  const [confirming, setConfirming] = useState<TemplateId | null>(null);

  async function start(id: TemplateId) {
    if (resume && confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    setBusy(id);
    setError(null);
    const r = await api.create(id);
    if (!r.ok) {
      setError(r.status === 429 ? { code: "limited", bg: t("chooser.limited"), en: t("chooser.limited") } : r.error);
      setBusy(null);
      return;
    }
    router.push(`/new/${r.data.id}`);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="font-brand-display text-lg font-semibold tracking-tight">{t("brand")}</span>
        <LangToggle />
      </header>
      <h1 className="mt-8 max-w-[22ch] text-[2rem] font-semibold leading-[1.05] sm:mt-14 sm:text-[2.75rem]">{t("chooser.h1")}</h1>
      <p className="mt-4 max-w-[58ch] text-lg leading-relaxed text-fg-soft">{t("chooser.lead")}</p>
      {resume && <ResumeDraft resume={resume} />}
      <ul className="mt-10 grid gap-5 md:grid-cols-3 sm:mt-14" aria-label={t("chooser.h1")}>
        {TEMPLATE_IDS.map((id) => {
          const def = getTemplate(id);
          const name = lang === "bg" ? def.name_bg : def.name_en;
          const state: SiteState = { ...demo, venue: { ...demo.venue, template: id, theme: { accent: def.accentDefault } } };
          return (
            <li key={id} className="flex flex-col overflow-hidden rounded-2xl bg-panel ring-1 ring-line transition-[transform,box-shadow] duration-200 ease-out motion-safe:hover:-translate-y-1 hover:shadow-[0_16px_40px_-16px_oklch(0.46_0.085_205/0.35)]">
              <ScaledFrame className="border-b border-line bg-sunken" title={t("a11y.preview", { name })} lang={lang}>
                <def.Component state={state} now={now} slug="agala" page="home" draft={null} live={false} feedUrl="" preview />
              </ScaledFrame>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <h2 className="text-xl font-semibold leading-tight">{name}</h2>
                <p className="flex-1 text-sm leading-relaxed text-fg-soft">{lang === "bg" ? def.tagline_bg : def.tagline_en}</p>
                <Button variant="primary" className="mt-3 w-full" disabled={busy !== null} aria-busy={busy === id} onClick={() => void start(id)} aria-describedby={`tpl-${id}-desc`}>
                  {busy === id ? t("chooser.starting") : t("chooser.start")}
                </Button>
                <span id={`tpl-${id}-desc`} className="sr-only">{t("a11y.preview", { name })}</span>
                {confirming === id && resume && (
                  <div role="alertdialog" aria-labelledby={`tpl-${id}-confirm`} className="mt-2 rounded-xl bg-sunken p-3 ring-1 ring-line">
                    <p id={`tpl-${id}-confirm`} className="text-sm leading-relaxed">{t(resume.kind === "draft" ? "chooser.confirmNew" : "chooser.confirmNewLive")}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="primary" autoFocus onClick={() => void start(id)}>{t("chooser.confirmYes")}</Button>
                      <Button variant="quiet" onClick={() => setConfirming(null)}>{t("chooser.confirmNo")}</Button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm text-fg-soft">{t("chooser.demoNote")}</p>
      {error && <p role="alert" className="mt-4 text-sm font-semibold text-danger">{lang === "bg" ? error.bg : error.en}</p>}
    </main>
  );
}
