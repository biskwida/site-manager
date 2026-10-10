"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Media } from "@/src/domain/types";
import { getTemplate } from "@/src/templates";
import { buildPreviewState } from "@/src/wizard/preview";
import type { WizardDraft } from "@/src/wizard/schema";
import { Button } from "./Field";
import { FrameDoc } from "./FrameDoc";
import { useT } from "./useWizardText";

/** The chosen template rendering the draft. Sticky right pane from 1024 px; a full-screen sheet on smaller screens when `open`. */
export function Preview({ draft, media, now, open, onClose }: { draft: WizardDraft; media: Media[]; now: number; open: boolean; onClose: () => void }) {
  const { t, lang } = useT();
  const [page, setPage] = useState<"home" | "menu">("home");
  const state = useMemo(() => buildPreviewState(draft, media, new Date(now)), [draft, media, now]);
  const def = getTemplate(draft.template);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  const body = (sheet: boolean) => (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="mr-auto text-sm font-semibold">{t("preview.title")}</span>
        <div role="group" aria-label={t("preview.title")} className="inline-flex rounded-full bg-sunken p-0.5 ring-1 ring-line">
          {(["home", "menu"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={page === p} onClick={() => setPage(p)}
              className={`min-h-9 rounded-full px-3.5 text-sm font-semibold transition-[background-color,color] duration-150 ease-out ${page === p ? "bg-fg text-canvas" : "text-fg-soft hover:text-fg"}`}>
              {t(p === "home" ? "preview.home" : "preview.menu")}
            </button>
          ))}
        </div>
        {sheet && <Button ref={closeRef} variant="quiet" onClick={onClose}>{t("preview.close")}</Button>}
      </div>
      <div className="mx-3 mb-3 min-h-0 flex-1 overflow-hidden rounded-2xl bg-sunken ring-1 ring-line lg:mx-4">
        <FrameDoc title={t("preview.title")} lang={lang}>
          <def.Component key={draft.template} state={state} now={now} slug={state.venue.slug} page={page} draft={null} live={false} feedUrl="" preview />
        </FrameDoc>
      </div>
      <p className="px-4 pb-3 text-xs leading-snug text-fg-soft">{t("preview.note")}</p>
    </div>
  );
  return (
    <>
      <aside aria-label={t("preview.title")} className="hidden bg-sunken/60 lg:sticky lg:top-0 lg:block lg:h-dvh lg:border-l lg:border-line">{body(false)}</aside>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={t("preview.title")} className="sm-sheet fixed inset-0 z-50 bg-canvas lg:hidden">{body(true)}</div>
      )}
    </>
  );
}
