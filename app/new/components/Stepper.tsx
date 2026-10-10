"use client";
import { useEffect, useRef } from "react";
import type { WizardStep } from "@/src/wizard/schema";
import { useT } from "./useWizardText";

export const FORM_STEPS: readonly WizardStep[] = ["basics", "look", "hours", "menu", "texts", "photos", "review"];
type StepKey = `step.${Exclude<WizardStep, "template" | "done">}`;

/** Numbered steps; earlier ones are buttons, the current is aria-current, later ones are plain text (Next validates first). */
export function Stepper({ current, onSelect }: { current: WizardStep; onSelect: (s: WizardStep) => void }) {
  const { t } = useT();
  const idx = FORM_STEPS.indexOf(current);
  const list = useRef<HTMLOListElement>(null);
  // On phones the strip scrolls sideways: keep the current step in view (horizontal only, the page itself never jumps).
  useEffect(() => {
    const ol = list.current;
    const chip = ol?.children[idx] as HTMLElement | undefined;
    if (!ol || !chip || ol.scrollWidth <= ol.clientWidth) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ol.scrollTo({ left: chip.offsetLeft - (ol.clientWidth - chip.offsetWidth) / 2, behavior: reduce ? "auto" : "smooth" });
  }, [idx]);
  return (
    <nav aria-label={t("nav.steps")} className="grid gap-2">
      <p className="text-sm text-fg-soft">{t("nav.stepOf", { n: idx + 1, total: FORM_STEPS.length })}</p>
      <ol ref={list} className="sm-scroll-x relative -mx-4 flex gap-1.5 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {FORM_STEPS.map((s, i) => {
          const label = t(`step.${s}` as StepKey);
          const done = i < idx;
          const active = i === idx;
          const cls = `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full py-1 pl-1.5 pr-3 text-sm whitespace-nowrap transition-[background-color,color] duration-150 ease-out ${
            active ? "bg-fg font-semibold text-canvas" : done ? "bg-panel text-fg ring-1 ring-line hover:bg-sunken" : "text-fg-soft"
          }`;
          const num = <span aria-hidden="true" className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${active ? "bg-canvas/20" : done ? "bg-brand-soft text-brand" : "ring-1 ring-line"}`}>{i + 1}</span>;
          return (
            <li key={s}>
              {done ? (
                <button type="button" className={cls} onClick={() => onSelect(s)}>
                  {num}
                  {label}
                  <span className="sr-only">, {t("a11y.stepDone")}</span>
                </button>
              ) : (
                <span className={cls} aria-current={active ? "step" : undefined}>
                  {num}
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
