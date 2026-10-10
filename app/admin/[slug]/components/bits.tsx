"use client";
import { useState, type ReactNode } from "react";
import type { ChangeSet } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { AdminActionName } from "@/src/server/admin";
import type { Decide } from "./useAdminOverview";

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-2xl font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Empty() {
  const { t } = useLang();
  return <p className="rounded-2xl bg-card px-4 py-3 text-ink-soft ring-1 ring-ink/10">{t("admin.none")}</p>;
}

export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "good" | "warn" }) {
  const tones = { plain: "bg-paper-deep text-ink", good: "bg-accent-soft text-ink", warn: "bg-amber-soft text-amber" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function summaryOf(cs: ChangeSet, lang: "bg" | "en") {
  return (lang === "bg" ? cs.summary_bg : cs.summary_en) || cs.summary_bg || cs.summary_en;
}
export function previewOf(cs: ChangeSet, lang: "bg" | "en") {
  return (lang === "bg" ? cs.preview_bg : cs.preview_en) || cs.preview_bg || cs.preview_en;
}

interface ActionSpec {
  action: AdminActionName;
  label: string;
  primary?: boolean;
}

/** A row's decision buttons: all disabled while one runs; `admin.failed` under them on a non-OK response. */
export function Actions({ setId, decide, actions, children }: { setId: string; decide: Decide; actions: ActionSpec[]; children?: ReactNode }) {
  const { t } = useLang();
  const [busy, setBusy] = useState<AdminActionName | null>(null);
  const [failed, setFailed] = useState(false);
  async function run(action: AdminActionName) {
    setBusy(action);
    setFailed(false);
    const ok = await decide(action, setId);
    setFailed(!ok);
    setBusy(null);
  }
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <button key={a.action} type="button" disabled={busy !== null} onClick={() => void run(a.action)} aria-busy={busy === a.action}
            className={`min-h-11 rounded-full px-5 text-sm font-semibold transition disabled:opacity-60 ${a.primary ? "bg-accent text-white hover:brightness-110" : "text-ink ring-1 ring-ink/25 hover:bg-ink/5"}`}>
            {busy === a.action ? t("admin.busy") : a.label}
          </button>
        ))}
        {children}
      </div>
      {failed && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{t("admin.failed")}</p>}
    </div>
  );
}
