"use client";
import { LangToggle, useLang } from "@/src/i18n";
import type { AdminOverview } from "@/src/server/admin";
import { formatDateTime } from "@/src/time";
import { AppsCard } from "./AppsCard";
import { CommentsCard } from "./CommentsCard";
import { Empty, Section } from "./bits";
import { PendingList, ScheduledList } from "./Decisions";
import { DomainCard } from "./DomainCard";
import { InvalidKey } from "./InvalidKey";
import { LogList } from "./LogList";
import { QrCard } from "./QrCard";
import { SiteCard } from "./SiteCard";
import { useAdminOverview } from "./useAdminOverview";
import { WordPressCard } from "./WordPressCard";
import { SocialCard } from "./SocialCard";

/** The owner's dashboard: the site (status, template switch), the optional custom domain, decisions, schedule, sold-out items, change log with undo, connected apps, QR and links. Client-polled every 3 s. */
export function AdminPanel({ slug, adminKey, initial }: { slug: string; adminKey: string; initial: AdminOverview }) {
  const { lang, t } = useLang();
  const { overview: o, unauthorized, decide, post, refresh } = useAdminOverview(initial, slug, adminKey);
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
        <SiteCard overview={o} post={post} adminKey={adminKey} refresh={refresh} />
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
        <LogList sets={o.log} tz={tz} decide={decide} usage={o.changes_this_month} />
        <AppsCard apps={o.connected_apps ?? []} post={post} />
        <WordPressCard overview={o.wordpress ?? null} slug={slug} adminKey={adminKey} baseUrl={o.public_url.replace(new RegExp(`/${slug}$`), "")} tz={tz} />
        <SocialCard overview={o.social ?? null} slug={slug} adminKey={adminKey} tz={tz} />
        <CommentsCard overview={o.comments ?? null} post={post} tz={tz} />
        {/* Hosted mode (no deployer on this server), an own site or no website: there is no provider project of ours to attach a domain to. */}
        {!o.hosted && !o.own_site && o.site_mode !== "none" && <DomainCard overview={o} post={post} />}
        <QrCard siteUrl={o.site_url} />
      </main>
    </div>
  );
}
