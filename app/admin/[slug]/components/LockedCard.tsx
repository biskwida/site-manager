"use client";
import Link from "next/link";
import type { Plan } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import { Chip, Section } from "./bits";

/**
 * A dashboard card for a feature the venue's plan does not include (for example the social card on an Admin plan). It is shown, not
 * hidden: the title, a line that it is not in the plan and the way to upgrade. Everything already published stays online.
 */
export function LockedCard({ id, title, plan, slug }: { id: string; title: MessageKey; plan: Plan | null; slug: string }) {
  const { lang, t } = useLang();
  return (
    <Section id={id} title={t(title)}>
      <div className="rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5" data-locked="true">
        <Chip tone="warn">{t("admin.locked.badge")}</Chip>
        <p className="mt-3 text-ink-soft">{t("admin.locked.text", { plan: plan ? t(`admin.billing.plan.${plan}` as MessageKey) : "" })}</p>
        <Link href={`/billing/${encodeURIComponent(slug)}?lang=${lang}`} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-ink/15 hover:bg-paper-deep">{t("admin.locked.upgrade")}</Link>
      </div>
    </Section>
  );
}
