"use client";
import Link from "next/link";
import { BUTTON_BASE, BUTTON_STYLES } from "./Field";
import { useT } from "./useWizardText";

/** What the sm_draft cookie in this browser points at (read on the server by app/new/page.tsx). */
export interface Resume {
  id: string;
  kind: "draft" | "live";
  name: string;
}

/** Above the chooser: back to the unfinished draft, or to the Telegram hand-off of a site this browser already published. */
export function ResumeDraft({ resume }: { resume: Resume }) {
  const { t } = useT();
  const id = encodeURIComponent(resume.id);
  const draft = resume.kind === "draft";
  return (
    <section aria-labelledby="resume-title" className="mt-6 flex flex-col gap-3 rounded-2xl bg-panel p-5 ring-2 ring-brand sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 id="resume-title" className="text-lg font-semibold leading-tight">{draft ? t("resume.title") : t("resume.liveTitle")}</h2>
        <p className="mt-1 text-sm text-fg-soft [overflow-wrap:anywhere]">{resume.name.trim() || t("resume.untitled")}</p>
      </div>
      <Link href={draft ? `/new/${id}` : `/new/${id}/done`} className={`${BUTTON_BASE} ${BUTTON_STYLES.primary} shrink-0 px-6`}>
        {draft ? t("resume.continue") : t("resume.liveOpen")}
      </Link>
    </section>
  );
}
