"use client";
import { useRef, useState } from "react";
import { WEEKDAYS } from "@/src/domain/types";
import { stepForPath, type PublishError, type WizardStep } from "@/src/wizard/schema";
import { api, type PublishResponse } from "../api";
import { publishOnce, type SaveSnapshot } from "../autosave";
import { Button, Status } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

export function Review({ id, draft, errors, goTo, onPublished, baseUrl, flush, saveSnapshot }: StepProps & {
  errors: PublishError[];
  goTo: (s: WizardStep) => void;
  onPublished: (r: PublishResponse) => void;
  /** Sends the pending autosave; false when the server does not have every edit. */
  flush: () => Promise<boolean>;
  /** Read after the flush: a rejected field explains itself in the refusal. */
  saveSnapshot: () => SaveSnapshot;
}) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The server's publish is not atomic under concurrent requests: one click, one request, whatever the render timing.
  // The pending autosave goes first: the server builds the site from the saved draft, not from this screen.
  const inFlight = useRef(false);
  const openDays = WEEKDAYS.filter((d) => draft.hours[d]).length;
  const items = draft.categories.reduce((n, c) => n + c.items.length, 0);
  async function create() {
    if (inFlight.current) return;
    setBusy(true);
    setFailed(null);
    const out = await publishOnce({ inFlight, flush, publish: () => api.publish(id), succeeded: (r) => r.ok });
    if (out.status === "busy") return;
    if (out.status === "unsaved") {
      const m = saveSnapshot().message;
      setFailed(m ? t("review.unsavedField", { msg: lang === "bg" ? m.bg : m.en }) : t("review.unsaved"));
      setBusy(false);
      return;
    }
    const r = out.value;
    if (!r.ok) { setFailed(lang === "bg" ? r.error.bg : r.error.en); setBusy(false); return; }
    onPublished(r.data); // stays busy: the page is about to change
  }
  const rows: [string, string][] = [
    [t("review.name"), draft.name || "—"],
    [t("review.address"), draft.slug ? `${baseUrl}/${draft.slug}` : "—"],
    [t("review.template"), t(`chooser.template.${draft.template}` as "chooser.template.classic")],
    [t("review.hours"), t("review.hoursSummary", { open: openDays, closed: 7 - openDays })],
    [t("review.menu"), t("review.menuSummary", { items, cats: draft.categories.length })],
    [t("review.photos"), t("review.photosSummary", { n: draft.gallery_media_ids.length })],
  ];
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-xl font-semibold leading-tight">{t("review.title")}</h2>
        <p className="mt-1 max-w-[60ch] leading-relaxed text-fg-soft">{t("review.lead")}</p>
      </div>
      <dl className="grid gap-y-3 rounded-xl bg-panel px-4 py-4 ring-1 ring-line sm:grid-cols-[9rem_1fr] sm:gap-x-4">
        {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-sm font-semibold text-fg-soft">{k}</dt><dd className="mb-1 [overflow-wrap:anywhere] sm:mb-0">{v}</dd></div>))}
      </dl>
      {errors.length > 0 && (
        <div role="alert" className="grid gap-2 rounded-xl bg-danger-soft px-4 py-3">
          <p className="font-semibold">{t("review.problems")}</p>
          <ul className="grid gap-1">
            {errors.map((e) => (
              <li key={e.path} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span>{lang === "bg" ? e.bg : e.en}</span>
                <Button variant="quiet" className="-mr-2 px-3 text-fg" onClick={() => goTo(stepForPath(e.path))}>{t("review.fix")}: {t(`step.${stepForPath(e.path)}` as "step.basics")}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-2">
        <Button variant="primary" className="min-h-12 w-full px-6 text-base sm:w-auto sm:justify-self-start" disabled={busy || errors.length > 0} aria-busy={busy} onClick={() => void create()}>{busy ? t("review.creating") : t("review.create")}</Button>
        <Status tone={failed ? "danger" : "soft"}>{failed ?? (busy ? t("review.creating") : "")}</Status>
      </div>
    </div>
  );
}
