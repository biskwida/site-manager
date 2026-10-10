"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang, Media } from "@/src/domain/types";
import { LangScope } from "@/src/i18n";
import { getTemplate } from "@/src/templates";
import { buildPreviewState } from "@/src/wizard/preview";
import type { WizardDraft } from "@/src/wizard/schema";
import { Button } from "./Field";
import { FrameDoc } from "./FrameDoc";
import { previewLinkAction } from "./previewLinks";
import { useT } from "./useWizardText";

/** The chosen template rendering the draft. Sticky right pane from 1024 px; a full-screen sheet on smaller screens when `open`. */
export function Preview({ draft, media, now, open, onClose }: { draft: WizardDraft; media: Media[]; now: number; open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [page, setPage] = useState<"home" | "menu">("home");
  const state = useMemo(() => buildPreviewState(draft, media, new Date(now)), [draft, media, now]);
  const def = getTemplate(draft.template);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The template's own БГ/EN toggle switches the preview only; it starts in the site's main language and follows it.
  const [siteLang, setSiteLang] = useState<Lang>(draft.default_lang);
  const [langFor, setLangFor] = useState(draft.default_lang);
  if (langFor !== draft.default_lang) {
    setLangFor(draft.default_lang);
    setSiteLang(draft.default_lang);
  }
  const slug = state.venue.slug;
  const onLinkClick = useCallback((a: HTMLAnchorElement, doc: Document) => {
    const action = previewLinkAction(a.getAttribute("href"), slug);
    if (action.kind === "page") {
      setPage(action.page);
      doc.defaultView?.scrollTo({ top: 0 });
    } else if (action.kind === "hash") {
      doc.getElementById(action.id)?.scrollIntoView({ block: "start" });
    }
  }, [slug]);

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
      <div className="flex items-center gap-2 px-3 py-3 lg:px-4">
        <span className={`mr-auto text-sm font-semibold ${sheet ? "sr-only" : ""}`}>{t("preview.title")}</span>
        <div role="group" aria-label={t("preview.title")} className="inline-flex rounded-full bg-sunken p-0.5 ring-1 ring-line">
          {(["home", "menu"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={page === p} onClick={() => setPage(p)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-[background-color,color] duration-150 ease-out ${page === p ? "bg-fg text-canvas" : "text-fg-soft hover:text-fg"}`}>
              {t(p === "home" ? "preview.home" : "preview.menu")}
            </button>
          ))}
        </div>
        {sheet && <Button ref={closeRef} variant="quiet" className="ml-auto" onClick={onClose}>{t("preview.close")}</Button>}
      </div>
      <div className="mx-3 mb-3 min-h-0 flex-1 overflow-hidden rounded-2xl bg-sunken ring-1 ring-line lg:mx-4">
        <FrameDoc title={t("preview.title")} lang={siteLang} onLinkClick={onLinkClick}>
          <LangScope lang={siteLang} setLang={setSiteLang}>
            <def.Component key={draft.template} state={state} now={now} slug={slug} page={page} draft={null} live={false} feedUrl="" preview />
          </LangScope>
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
