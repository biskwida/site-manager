"use client";
import type { ChangeSet, ChangeSetStatus } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import { formatDateTime } from "@/src/time";
import { Actions, Chip, Empty, previewOf, Section, summaryOf } from "./bits";
import type { Decide } from "./useAdminOverview";

const TONE: Partial<Record<ChangeSetStatus, "good" | "warn">> = { applied: "good", reverted: "warn" };

/** Decided sets, newest first: before → after from the stored preview text; Undo only on applied sets. */
export function LogList({ sets, tz, decide }: { sets: ChangeSet[]; tz: string; decide: Decide }) {
  const { lang, t } = useLang();
  return (
    <Section id="log" title={t("admin.log")}>
      {sets.length === 0 ? <Empty /> : (
        <ul className="divide-y divide-ink/10 rounded-3xl bg-card ring-1 ring-ink/10">
          {sets.map((cs) => {
            const when = cs.applied_at ?? cs.decided_at ?? cs.created_at;
            return (
              <li key={cs.id} className="p-4 sm:p-5">
                <p className="break-words font-semibold">{summaryOf(cs, lang)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <Chip tone={TONE[cs.status] ?? "plain"}>{t(`admin.status.${cs.status}` as MessageKey)}</Chip>
                  <Chip>{t(`admin.source.${cs.source}` as MessageKey)}</Chip>
                  <time dateTime={when}>{formatDateTime(when, lang, tz)}</time>
                </p>
                <details className="group mt-2">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink underline underline-offset-4">{t("admin.details")}</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-2xl bg-paper px-3 py-2 font-sans text-sm leading-relaxed text-ink">{previewOf(cs, lang)}</pre>
                </details>
                {cs.status === "applied" && <Actions setId={cs.id} decide={decide} actions={[{ action: "undo", label: t("admin.undo") }]} />}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
