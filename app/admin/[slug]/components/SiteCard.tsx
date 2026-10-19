"use client";
import { useEffect, useState, type FormEvent } from "react";
import { startTickNudge } from "@/app/components/tickNudge";
import { TEMPLATE_IDS, type TemplateId } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import type { AdminOverview } from "@/src/server/admin";
import { formatDateTime } from "@/src/time";
import { Chip, Section } from "./bits";
import type { Post, Refresh } from "./useAdminOverview";

const isLocalized = (d: unknown): d is { bg: string; en: string } =>
  typeof d === "object" && d !== null && typeof (d as { bg?: unknown }).bg === "string" && typeof (d as { en?: unknown }).en === "string";

/**
 * "Your site": where it lives, whether it is live, which template it wears, and the switch (for an own site: only the link).
 * Changing the template redeploys a deployed site; while a deploy is in flight the switch waits (the 3 s poll re-enables it)
 * and the card nudges the tick every 30 s so the deploy is polled promptly.
 */
export function SiteCard({ overview: o, post, adminKey = "", refresh }: { overview: AdminOverview; post: Post; adminKey?: string; refresh?: Refresh }) {
  const { lang, t } = useLang();
  const [template, setTemplate] = useState<TemplateId>(o.template);
  const [busy, setBusy] = useState(false);
  // Kept as a key (or the server's bg/en pair) so the line follows the language toggle instead of freezing in the language it was submitted in.
  const [msg, setMsg] = useState<{ tone: "good" | "warn"; key: MessageKey } | { tone: "warn"; bg: string; en: string } | null>(null);
  const d = o.deploy;
  const publishing = d?.status === "pending" || d?.status === "building";
  const unchanged = template === o.template;
  // After a failed publish the same template can be sent again: setTemplate redeploys (or creates the site) from the error state.
  const retry = d?.status === "error" && unchanged;

  useEffect(() => {
    if (!publishing || !adminKey) return;
    return startTickNudge({ adminKey, onNudged: () => void refresh?.() });
  }, [publishing, adminKey, refresh]);

  async function change(e: FormEvent) {
    e.preventDefault();
    if (busy || (unchanged && !retry)) return;
    setBusy(true);
    setMsg(null);
    const r = await post({ action: "set_template", template });
    if (r.ok) setMsg({ tone: "good", key: retry ? "admin.retryStarted" : d ? "admin.templateChanged" : "admin.templateChangedLocal" });
    else setMsg(isLocalized(r.data) ? { tone: "warn", bg: r.data.bg, en: r.data.en } : { tone: "warn", key: "admin.failed" });
    setBusy(false);
  }
  const msgText = msg ? ("key" in msg ? t(msg.key) : msg[lang]) : null;

  // No website at all (social media only): there is nothing to show, deploy or switch here.
  if (o.site_mode === "none") return null;

  const statusTone = d?.status === "ready" ? "good" : d?.status === "error" ? "warn" : "plain";
  // Own site (built and hosted elsewhere, reads our feed): just the link and who runs it; no deploy rows, no template switch.
  if (o.own_site) {
    return (
      <Section id="your-site" title={t("admin.yourSite")}>
        <div className="rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
          <a href={o.site_url} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 [overflow-wrap:anywhere] hover:text-accent">
            {o.site_url}<span className="sr-only"> {t("admin.newTab")}</span>
          </a>
          <p className="mt-1 text-sm text-ink-soft">{t("admin.ownSiteLine")}</p>
        </div>
      </Section>
    );
  }
  return (
    <Section id="your-site" title={t("admin.yourSite")}>
      <div className="rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-ink-soft">
          {/* No deploy record (hosted mode, or before the first publish): the hosted /<slug> below is the site, so no deploy rows. */}
          {d && <Chip tone={statusTone}>{t(`admin.deploy.${d.status}` as MessageKey)}</Chip>}
          <Chip>{t(`admin.template.${o.template}` as MessageKey)}</Chip>
          {d && <time dateTime={d.updated_at}>{t("admin.lastUpdate", { when: formatDateTime(d.updated_at, lang, o.venue.tz) })}</time>}
        </div>
        <a href={o.site_url} target="_blank" rel="noopener" className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-4 [overflow-wrap:anywhere] hover:text-accent">
          {o.site_url}<span className="sr-only"> {t("admin.newTab")}</span>
        </a>
        {/* The provider's build log means nothing to an owner (and may be long): a short line, then Try again. */}
        {d?.status === "error" && <p className="text-sm text-clay">{t("admin.deployFailedLine")}</p>}
        <form onSubmit={(e) => void change(e)} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold sm:flex-none">
            {t("admin.template")}
            <select value={template} onChange={(e) => { setTemplate(e.target.value as TemplateId); setMsg(null); }} disabled={busy} className="min-h-11 rounded-xl bg-paper px-3 pr-8 text-base font-normal text-ink ring-1 ring-ink/20 sm:min-w-44">
              {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{t(`admin.template.${id}` as MessageKey)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || publishing || (unchanged && !retry)} aria-busy={busy}
            className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white transition-[transform,filter] duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:hover:brightness-100 disabled:active:scale-100">
            {busy ? t("admin.busy") : retry ? t("admin.tryAgain") : t("admin.changeTemplate")}
          </button>
        </form>
        {msg && <p role="status" className={`mt-2 text-sm font-semibold ${msg.tone === "good" ? "text-ink" : "text-clay"}`}>{msgText}</p>}
        {!msg && publishing && <p className="mt-2 text-sm text-ink-soft">{t("admin.busyPublishing")}</p>}
      </div>
    </Section>
  );
}
