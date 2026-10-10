"use client";
import { useState } from "react";
import { useLang } from "@/src/i18n";
import type { WordPressOverview } from "@/src/server/admin";
import { formatDateTime } from "@/src/time";
import { Chip, Section } from "./bits";

const TONE = { done: "good", pending: "warn", failed: "warn" } as const;
const SYNC_LABEL = { done: "admin.wp.sync.done", pending: "admin.wp.sync.pending", failed: "admin.wp.sync.failed" } as const;

/** Connect-your-WordPress card: status, the three steps (download, two settings, /connect line), the last pushes, Disconnect. */
export function WordPressCard({ overview, slug, adminKey, baseUrl, tz }: { overview: WordPressOverview | null; slug: string; adminKey: string; baseUrl: string; tz: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // clipboard blocked: the value is visible and selectable anyway
    }
  }
  async function disconnect() {
    if (!window.confirm(t("admin.wp.disconnectConfirm"))) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/${encodeURIComponent(slug)}/wordpress?key=${encodeURIComponent(adminKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) });
      setFailed(!res.ok);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  const settings = [
    { key: "base", label: t("admin.wp.baseUrl"), value: baseUrl },
    { key: "slug", label: t("admin.wp.slug"), value: slug },
  ];
  const connected = overview !== null;
  const tone = overview?.status === "connected" ? "good" : overview ? "warn" : "plain";
  const statusLabel = !overview ? t("admin.wp.notConnected") : overview.status === "connected" ? t("admin.wp.connected") : t("admin.wp.error");

  return (
    <Section id="wordpress" title={t("admin.wp.title")}>
      <div className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={tone}>{statusLabel}</Chip>
          {overview && (
            <span className="[overflow-wrap:anywhere] text-sm text-ink-soft">
              <a href={overview.site_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline-offset-2 hover:underline">{overview.site_name || overview.site_url}<span className="sr-only"> {t("admin.newTab")}</span></a>
              {overview.connected_at && ` · ${t("admin.wp.since", { when: formatDateTime(overview.connected_at, lang, tz) })}`}
            </span>
          )}
        </div>
        {overview?.last_error && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{overview.last_error}</p>}
        {!connected && <p className="mt-3 max-w-prose text-ink-soft">{t("admin.wp.intro")}</p>}

        <ol className="mt-4 space-y-4 text-sm text-ink">
          <li className="flex gap-3">
            <span className="min-w-6 font-semibold tabular-nums text-ink-soft">1.</span>
            <div>
              <p>{t("admin.wp.step1")}</p>
              <a href="/wp/site-manager.zip" download className="mt-2 inline-flex min-h-11 items-center rounded-full bg-accent px-5 font-semibold text-white transition hover:brightness-110">{t("admin.wp.download")}</a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="min-w-6 font-semibold tabular-nums text-ink-soft">2.</span>
            <div className="min-w-0 flex-1">
              <p>{t("admin.wp.step2")}</p>
              <dl className="mt-2 grid gap-2">
                {settings.map((s) => (
                  <div key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-paper-deep px-3 py-2">
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{s.label}</dt>
                      <dd className="[overflow-wrap:anywhere] font-mono text-sm">{s.value}</dd>
                    </div>
                    <button type="button" onClick={() => void copy(s.key, s.value)} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-ink/25 hover:bg-ink/5">
                      {copied === s.key ? t("admin.wp.copied") : t("admin.wp.copy")}
                    </button>
                  </div>
                ))}
              </dl>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="min-w-6 font-semibold tabular-nums text-ink-soft">3.</span>
            <p>{t("admin.wp.step3")}</p>
          </li>
        </ol>

        {connected && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.wp.lastPushes")}</h3>
            {overview.syncs.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">{t("admin.wp.noPushes")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-ink/10">
                {overview.syncs.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 font-semibold">{(lang === "bg" ? s.summary_bg : s.summary_en) || s.summary_bg}</span>
                    <span className="flex items-center gap-2 text-ink-soft">
                      <span suppressHydrationWarning>{formatDateTime(s.updated_at, lang, tz)}</span>
                      <Chip tone={TONE[s.status]}>{t(SYNC_LABEL[s.status])}</Chip>
                    </span>
                    {s.status !== "done" && s.last_error && <span className="[overflow-wrap:anywhere] w-full text-xs text-clay">{s.last_error}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => void disconnect()} aria-busy={busy} className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5 disabled:opacity-60">
                {busy ? t("admin.busy") : t("admin.wp.disconnect")}
              </button>
              {failed && <p role="alert" className="text-sm font-semibold text-clay">{t("admin.failed")}</p>}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
