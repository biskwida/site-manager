"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Media } from "@/src/domain/types";
import type { AppChannel } from "@/src/server/connect-apps";
import { LangToggle } from "@/src/i18n";
import { stepForPath, validateForPublish, type WizardDraft, type WizardStep } from "@/src/wizard/schema";
import { api } from "./api";
import { Autosave, type SaveSnapshot } from "./autosave";
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
import type { IgReturn, StepProps } from "./types";
import { useT } from "./useWizardText";

const AUTOSAVE_MS = 800;

/** Media ids the draft points at directly (logo, cover, gallery, dish photos). */
function referencedMedia(d: WizardDraft): Set<string> {
  const ids = [d.logo_media_id, d.cover_media_id, ...d.gallery_media_ids, ...d.categories.flatMap((c) => c.items.map((i) => i.image_media_id))];
  return new Set(ids.filter((x): x is string => typeof x === "string"));
}

export function Wizard({ id, initialDraft, initialMedia, baseUrl, aiAvailable, now, instagramAvailable = false, igReturn = null, apps, slugLocked = false }: {
  id: string; initialDraft: WizardDraft; initialMedia: Media[]; baseUrl: string; aiAvailable: boolean; now: number;
  /** INSTAGRAM_APP_ID/SECRET are set on this server. */
  instagramAvailable?: boolean;
  /** The messaging apps this server answers (enabledApps). */
  apps?: AppChannel[];
  /** Back from Instagram's sign-in (`?step=…&ig=…`): opens that step and tells it how the sign-in went. */
  igReturn?: IgReturn | null;
  /** A website add-on: the business keeps its address. */
  slugLocked?: boolean;
}) {
  const { t, lang } = useT();
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [media, setMedia] = useState(initialMedia);
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [ig, setIg] = useState(igReturn);
  const consumeIg = useCallback(() => setIg(null), []);
  const [step, setStep] = useState<WizardStep>(igReturn ? igReturn.step : FORM_STEPS.includes(initialDraft.step) ? initialDraft.step : "basics");
  const [save, setSave] = useState<SaveSnapshot>({ state: "idle", errors: [], message: null });
  const [showErrors, setShowErrors] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const stepBox = useRef<HTMLDivElement>(null);
  const alertBox = useRef<HTMLDivElement>(null);
  const draftRef = useRef(initialDraft);
  /** Source of truth for blob: URLs (read in callbacks and on unmount); `localUrls` mirrors it for rendering. */
  const localUrlsRef = useRef<Record<string, string>>({});

  // One queue per wizard: one PUT in flight, retries on its own, rejected fields come back as field errors.
  const [queue] = useState(() => new Autosave<WizardDraft>({ send: (patch, keepalive) => api.put(id, patch, keepalive), onChange: setSave, debounceMs: AUTOSAVE_MS }));
  const flush = useCallback((keepalive = false) => queue.flush(keepalive), [queue]);

  /** Drop the blob: preview of media the draft stopped pointing at (a replaced logo, a removed photo). */
  const releaseUnreferenced = useCallback((before: WizardDraft, after: WizardDraft) => {
    const now = referencedMedia(after);
    const gone = [...referencedMedia(before)].filter((m) => !now.has(m) && localUrlsRef.current[m]);
    if (!gone.length) return;
    for (const m of gone) URL.revokeObjectURL(localUrlsRef.current[m]);
    localUrlsRef.current = Object.fromEntries(Object.entries(localUrlsRef.current).filter(([k]) => !gone.includes(k)));
    setLocalUrls(localUrlsRef.current);
  }, []);

  const update = useCallback((patch: Partial<WizardDraft>) => {
    const before = draftRef.current;
    const after = { ...before, ...patch };
    draftRef.current = after;
    setDraft(after);
    queue.edit(patch);
    releaseUnreferenced(before, after);
  }, [queue, releaseUnreferenced]);

  useEffect(() => {
    queue.resume();
    const onHide = () => { if (document.visibilityState === "hidden") void queue.flush(true); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      // Leaving the wizard (client navigation) must not lose the last edits: send them, then stop the timers.
      void queue.flush(true);
      queue.dispose();
    };
  }, [queue]);

  useEffect(() => () => { for (const u of Object.values(localUrlsRef.current)) URL.revokeObjectURL(u); }, []);

  // The ?step=&ig= of the return from Instagram is read once: a reload shows the plain wizard.
  useEffect(() => {
    if (igReturn) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [igReturn]);

  const addMedia = useCallback((m: Media, file?: File) => {
    setMedia((list) => [...list, m]);
    if (!file) return;
    localUrlsRef.current = { ...localUrlsRef.current, [m.id]: URL.createObjectURL(file) };
    setLocalUrls(localUrlsRef.current);
  }, []);
  const shownMedia = useMemo(() => media.map((m) => (localUrls[m.id] ? { ...m, public_url: localUrls[m.id] } : m)), [media, localUrls]);

  const errors = useMemo(() => { const r = validateForPublish(draft); return r.ok ? [] : r.errors; }, [draft]);
  const stepErrors = errors.filter((e) => stepForPath(e.path) === step);
  const idx = FORM_STEPS.indexOf(step);
  const fieldErrors = useMemo(() => [...save.errors, ...(showErrors ? stepErrors.filter((e) => !save.errors.some((s) => s.path === e.path)) : [])], [save.errors, showErrors, stepErrors]);

  function go(next: WizardStep) {
    if (FORM_STEPS.indexOf(next) > idx && stepErrors.length) {
      setShowErrors(true);
      // On a phone the alert and the field can be a screen away from the Next button: take the owner there.
      window.requestAnimationFrame(() => {
        const field = stepBox.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        const target = field ?? alertBox.current;
        if (!target) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
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
  const stepProps: StepProps = { slugLocked, id, draft, media: shownMedia, update, addMedia, baseUrl, aiAvailable, fieldErrors, instagramAvailable, apps, igReturn: ig, onIgConsumed: consumeIg, flush: () => flush() };
  const saveText = {
    idle: "",
    saving: t("save.saving"),
    saved: t("save.saved"),
    retrying: t("save.retrying"),
    rejected: save.message ? t("save.rejected", { msg: lang === "bg" ? save.message.bg : save.message.en }) : "",
  }[save.state];
  const saveBad = save.state === "retrying" || save.state === "rejected";

  return (
    <div className="flex-1 lg:grid lg:grid-cols-2">
      <div inert={previewOpen || undefined} className="mx-auto w-full max-w-xl px-4 pb-28 sm:px-6 lg:pb-16">
        <header className="flex items-center justify-between py-5">
          <span className="font-brand-display text-lg font-semibold tracking-tight">{t("brand")}</span>
          <LangToggle />
        </header>
        <div className="mt-4">
          <Stepper current={step} onSelect={go} />
        </div>
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 ref={heading} tabIndex={-1} className="text-[1.75rem] font-semibold leading-tight outline-none sm:text-[2rem]">{t(`step.${step}` as "step.basics")}</h1>
          <p aria-live="polite" className={`min-h-5 text-sm ${saveBad ? "font-semibold text-danger" : "text-fg-soft"}`}>{saveText}</p>
        </div>
        {showErrors && stepErrors.length > 0 && (
          <div ref={alertBox} role="alert" tabIndex={-1} className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-danger">
            <p className="font-semibold">{t("nav.fixFirst")}</p>
            <ul className="mt-1 list-disc pl-5">{stepErrors.map((e) => <li key={e.path}>{lang === "bg" ? e.bg : e.en}</li>)}</ul>
          </div>
        )}
        <div key={step} ref={stepBox} className="sm-step mt-6">
          {step === "basics" && <Basics {...stepProps} />}
          {step === "look" && <Look {...stepProps} />}
          {step === "hours" && <Hours {...stepProps} />}
          {step === "menu" && <Menu {...stepProps} />}
          {step === "texts" && <Texts {...stepProps} />}
          {step === "photos" && <Photos {...stepProps} />}
          {step === "review" && (
            <Review {...stepProps} errors={errors} flush={flush} saveSnapshot={() => queue.snapshot} goTo={(s) => { setShowErrors(false); setStep(s); update({ step: s }); window.requestAnimationFrame(() => heading.current?.focus()); }}
              onPublished={(r) => { const key = new URL(r.admin_url, baseUrl).searchParams.get("key") ?? ""; router.push(`/new/${id}/done?code=${encodeURIComponent(r.invite_code)}&key=${encodeURIComponent(key)}`); }} />
          )}
        </div>
        <nav className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-5" aria-label={t("nav.pager")}>
          <Button onClick={() => go(FORM_STEPS[idx - 1])} disabled={idx === 0}>{t("nav.back")}</Button>
          {step !== "review" && <Button variant="primary" className="px-6" onClick={() => go(FORM_STEPS[idx + 1])}>{t("nav.next")}</Button>}
        </nav>
      </div>
      <Preview draft={draft} media={shownMedia} now={now} open={previewOpen} onClose={closePreview} />
      <div inert={previewOpen || undefined} className="sm-bottom-bar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/90 p-3 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <Button variant="secondary" className="w-full" aria-haspopup="dialog" aria-expanded={previewOpen} onClick={() => setPreviewOpen(true)}>{t("preview.open")}</Button>
      </div>
    </div>
  );
}
