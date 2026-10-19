"use client";
import type { ChangeSet } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import { formatDateTime } from "@/src/time";
import { Actions, Chip, Empty, previewOf, Section, summaryOf } from "./bits";
import type { Decide } from "./useAdminOverview";

const card = "rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5";

/** Proposals waiting for the owner: summary, the bot's preview text, Apply / Reject and a link to the draft on the site. */
export function PendingList({ sets, slug, adminKey, tz, decide }: { sets: ChangeSet[]; slug: string; adminKey?: string; tz: string; decide: Decide }) {
  const { lang, t } = useLang();
  return (
    <Section id="pending" title={t("admin.pending")}>
      {sets.length === 0 ? <Empty /> : (
        <ul className="grid gap-3">
          {sets.map((cs) => (
            <li key={cs.id} className={`${card} ring-accent/40`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 break-words text-lg font-semibold">{summaryOf(cs, lang)}</h3>
                <Chip>{t(`admin.source.${cs.source}` as MessageKey)}</Chip>
              </div>
              {cs.apply_at && <p className="mt-1 text-sm text-ink-soft">{t("admin.scheduledFor", { when: formatDateTime(cs.apply_at, lang, tz) })}</p>}
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink">{previewOf(cs, lang)}</pre>
              <Actions setId={cs.id} decide={decide} actions={[{ action: "apply", label: t("admin.apply"), primary: true }, { action: "reject", label: t("admin.reject") }]}>
                {/* The draft preview page proves the owner by the key in its URL: on the account dashboard (no key) the link is left out. */}
                {adminKey && (
                  <a href={`/${slug}?draft=${encodeURIComponent(cs.id)}&key=${encodeURIComponent(adminKey)}`} target="_blank" rel="noopener"
                    className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ink underline underline-offset-4 hover:text-accent">
                    {t("admin.preview")}<span className="sr-only"> {t("admin.newTab")}</span>
                  </a>
                )}
              </Actions>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Approved sets with a future apply time; Cancel stops them. */
export function ScheduledList({ sets, tz, decide }: { sets: ChangeSet[]; tz: string; decide: Decide }) {
  const { lang, t } = useLang();
  return (
    <Section id="scheduled" title={t("admin.scheduled")}>
      {sets.length === 0 ? <Empty /> : (
        <ul className="grid gap-3">
          {sets.map((cs) => (
            <li key={cs.id} className={card}>
              <h3 className="break-words text-lg font-semibold">{summaryOf(cs, lang)}</h3>
              {cs.apply_at && <p className="mt-1 text-sm font-semibold text-ink-soft">{t("admin.scheduledFor", { when: formatDateTime(cs.apply_at, lang, tz) })}</p>}
              <Actions setId={cs.id} decide={decide} actions={[{ action: "cancel", label: t("admin.cancel") }]} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
