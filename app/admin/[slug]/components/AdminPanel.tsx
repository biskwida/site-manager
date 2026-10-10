"use client";
import { LangToggle, useLang } from "@/src/i18n";
import type { AdminOverview } from "@/src/server/admin";
import { formatDateTime } from "@/src/time";
import { Empty, Section } from "./bits";
import { PendingList, ScheduledList } from "./Decisions";
import { InvalidKey } from "./InvalidKey";
import { LogList } from "./LogList";
import { QrCard } from "./QrCard";
import { useAdminOverview } from "./useAdminOverview";

/** The owner's dashboard: decisions, schedule, sold-out items, change log with undo, QR and links. Client-polled every 3 s. */
export function AdminPanel({ slug, adminKey, initial }: { slug: string; adminKey: string; initial: AdminOverview }) {
  const { lang, t } = useLang();
  const { overview: o, unauthorized, decide } = useAdminOverview(initial, slug, adminKey);
  if (unauthorized) return <InvalidKey />;
  const tz = o.venue.tz;
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-accent-soft">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 pb-6 pt-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.title")}</p>
            <h1 className="break-words text-3xl font-semibold leading-tight">{o.venue.name}</h1>
          </div>
          <LangToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <PendingList sets={o.pending} slug={slug} adminKey={adminKey} tz={tz} decide={decide} />
        <ScheduledList sets={o.scheduled} tz={tz} decide={decide} />
        <Section id="sold-out" title={t("admin.soldOut")}>
          {o.sold_out.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-ink/10 rounded-3xl bg-card ring-1 ring-ink/10">
              {o.sold_out.map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <span className="font-semibold">{lang === "bg" ? i.name_bg : i.name_en || i.name_bg}</span>
                  <span className="text-sm text-ink-soft">{t("admin.backAt", { when: formatDateTime(i.sold_out_until, lang, tz) })}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <LogList sets={o.log} tz={tz} decide={decide} />
        <QrCard publicUrl={o.public_url} slug={slug} />
      </main>
    </div>
  );
}
