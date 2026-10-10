"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Media } from "@/src/domain/types";
import { LangToggle } from "@/src/i18n";
import { stepForPath, validateForPublish, type PublishError, type WizardDraft, type WizardStep } from "@/src/wizard/schema";
import { api } from "./api";
import { Button } from "./Field";
import { Preview } from "./Preview";
import { FORM_STEPS, Stepper } from "./Stepper";
import { Basics } from "./Steps/Basics";
import { Hours } from "./Steps/Hours";
import { Look } from "./Steps/Look";
import { Menu } from "./Steps/Menu";
import { Photos } from "./Steps/Photos";
import { Review } from "./Steps/Review";
import { Texts } from "./Steps/Texts";
import type { StepProps } from "./types";
import { useT } from "./useWizardText";

const AUTOSAVE_MS = 800;
type SaveState = "idle" | "saving" | "saved" | "error";

export function Wizard({ id, initialDraft, initialMedia, baseUrl, aiAvailable, now }: { id: string; initialDraft: WizardDraft; initialMedia: Media[]; baseUrl: string; aiAvailable: boolean; now: number }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [media, setMedia] = useState(initialMedia);
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [step, setStep] = useState<WizardStep>(FORM_STEPS.includes(initialDraft.step) ? initialDraft.step : "basics");
  const [save, setSave] = useState<SaveState>("idle");
  const [serverErrors, setServerErrors] = useState<PublishError[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const pending = useRef<Partial<WizardDraft>>({});
  const timer = useRef<number | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);

  const flush = useCallback(async (keepalive = false) => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    setSave("saving");
    const r = await api.put(id, patch, keepalive);
    if (r.ok) {
      setSave("saved");
      setServerErrors([]);
    } else {
      setSave("error");
      setServerErrors(r.error.details ?? (r.error.code === "slug_taken" ? [{ path: "slug", bg: r.error.bg, en: r.error.en }] : []));
      pending.current = { ...patch, ...pending.current }; // retry with the next change
    }
  }, [id]);

  const update = useCallback((patch: Partial<WizardDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flush(true); };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); window.clearTimeout(timer.current); };
  }, [flush]);

  const addMedia = useCallback((m: Media, file: File) => {
    setMedia((list) => [...list, m]);
    setLocalUrls((u) => ({ ...u, [m.id]: URL.createObjectURL(file) }));
  }, []);
  const shownMedia = useMemo(() => media.map((m) => (localUrls[m.id] ? { ...m, public_url: localUrls[m.id] } : m)), [media, localUrls]);

  const errors = useMemo(() => { const r = validateForPublish(draft); return r.ok ? [] : r.errors; }, [draft]);
  const stepErrors = errors.filter((e) => stepForPath(e.path) === step);
  const idx = FORM_STEPS.indexOf(step);

  function go(next: WizardStep) {
    if (FORM_STEPS.indexOf(next) > idx && stepErrors.length) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    update({ step: next });
    void flush();
    setStep(next);
    setPreviewOpen(false);
    window.requestAnimationFrame(() => heading.current?.focus());
  }

  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const stepProps: StepProps = { id, draft, media: shownMedia, update, addMedia, baseUrl, aiAvailable, serverErrors };
  const saveText = save === "saving" ? t("save.saving") : save === "saved" ? t("save.saved") : save === "error" ? t("save.error") : "";

  return (
    <div className="flex-1 lg:grid lg:grid-cols-2">
      <div className="mx-auto w-full max-w-xl px-4 pb-28 sm:px-6 lg:pb-16">
        <header className="flex items-center justify-between py-5">
          <span className="font-brand-display text-lg font-semibold tracking-tight">{t("brand")}</span>
          <LangToggle />
        </header>
        <div className="mt-4">
          <Stepper current={step} onSelect={go} />
        </div>
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 ref={heading} tabIndex={-1} className="text-[1.75rem] font-semibold leading-tight outline-none sm:text-[2rem]">{t(`step.${step}` as "step.basics")}</h1>
          <p aria-live="polite" className={`min-h-5 text-sm ${save === "error" ? "font-semibold text-danger" : "text-fg-soft"}`}>{saveText}</p>
        </div>
        {showErrors && stepErrors.length > 0 && (
          <div role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-fg">
            <p className="font-semibold">{t("nav.fixFirst")}</p>
            <ul className="mt-1 list-disc pl-5">{stepErrors.map((e) => <li key={e.path}>{lang === "bg" ? e.bg : e.en}</li>)}</ul>
          </div>
        )}
        <div key={step} className="sm-step mt-6">
          {step === "basics" && <Basics {...stepProps} />}
          {step === "look" && <Look {...stepProps} />}
          {step === "hours" && <Hours {...stepProps} />}
          {step === "menu" && <Menu {...stepProps} />}
          {step === "texts" && <Texts {...stepProps} />}
          {step === "photos" && <Photos {...stepProps} />}
          {step === "review" && (
            <Review {...stepProps} errors={errors} goTo={(s) => { setShowErrors(false); setStep(s); update({ step: s }); window.requestAnimationFrame(() => heading.current?.focus()); }}
              onPublished={(r) => { const key = new URL(r.admin_url, baseUrl).searchParams.get("key") ?? ""; router.push(`/new/${id}/done?code=${encodeURIComponent(r.invite_code)}&key=${encodeURIComponent(key)}`); }} />
          )}
        </div>
        <nav className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-5" aria-label={t("nav.steps")}>
          <Button onClick={() => go(FORM_STEPS[idx - 1])} disabled={idx === 0}>{t("nav.back")}</Button>
          {step !== "review" && <Button variant="primary" className="px-6" onClick={() => go(FORM_STEPS[idx + 1])}>{t("nav.next")}</Button>}
        </nav>
      </div>
      <Preview draft={draft} media={shownMedia} now={now} open={previewOpen} onClose={closePreview} />
      <div className="sm-bottom-bar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/90 p-3 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <Button variant="secondary" className="w-full" aria-haspopup="dialog" aria-expanded={previewOpen} onClick={() => setPreviewOpen(true)}>{t("preview.open")}</Button>
      </div>
    </div>
  );
}
