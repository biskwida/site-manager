"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import { socialErrorText } from "@/src/destinations/social-errors";
import type { GoogleOverview } from "@/src/server/admin";
import { formatDateTime } from "@/src/time";
import { Chip, Section } from "./bits";
import { adminApiUrl } from "./useAdminOverview";

const RESULTS = ["google_connected", "google_no_locations", "google_error"] as const;
type Result = (typeof RESULTS)[number];

// The Google callback returns to the dashboard with ?social_result=google_<code>#google. Read once per page load (the effect below
// drops it from the address bar, so a reload does not show it again); the server render has no notice. SocialCard reads the
// Meta values the same way and ignores these.
let captured: Result | null | undefined;
function readResult(): Result | null {
  if (captured === undefined) {
    try {
      const r = new URLSearchParams(window.location.search).get("social_result");
      captured = r && (RESULTS as readonly string[]).includes(r) ? (r as Result) : null;
    } catch {
      captured = null;
    }
  }
  return captured;
}
const noSubscribe = () => () => {};

/** Connect the venue's Google Business Profile: status, the profile, the last hours sync and review check, Connect/Disconnect. */
export function GoogleCard({ overview, slug, adminKey, tz }: { overview: GoogleOverview | null; slug: string; adminKey?: string; tz: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const result = useSyncExternalStore(noSubscribe, readResult, () => null);
  const o: GoogleOverview = overview ?? { available: false, account: null };
  const acc = o.account;

  useEffect(() => {
    if (!result) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("social_result");
      window.history.replaceState(null, "", url.toString());
    } catch {
      // the notice still shows; the parameter just stays in the address bar
    }
  }, [result]);

  async function disconnect() {
    if (!window.confirm(t("admin.google.disconnectConfirm"))) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(adminApiUrl(slug, adminKey, "/social"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disconnect", kind: "google" }) });
      setFailed(!res.ok);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  const tone = acc?.status === "connected" ? "good" : acc ? "warn" : "plain";
  const label = !acc ? t("admin.social.notConnected") : acc.status === "connected" ? t("admin.social.connected") : t("admin.social.error");
  const connectLink = (text: string) => (
    <a href={adminApiUrl(slug, adminKey, "/social/google/start")} className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110">
      {text}
    </a>
  );
  const good = result === "google_connected";

  return (
    <Section id="google" title={t("admin.google.title")}>
      <div className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
        {result && (
          <p role="status" className={`mb-4 rounded-2xl px-4 py-3 text-sm font-semibold ${good ? "bg-accent-soft text-ink" : "bg-amber-soft text-ink"}`}>
            {t(`admin.social.result.${result}` as MessageKey)}
          </p>
        )}
        <p className="max-w-prose text-ink-soft">{t("admin.google.intro")}</p>
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Google</span>
            <Chip tone={tone}>{label}</Chip>
            {acc && (
              <span className="[overflow-wrap:anywhere] text-sm text-ink-soft">
                {acc.title}
                {acc.connected_at && <span suppressHydrationWarning>{` · ${t("admin.social.since", { when: formatDateTime(acc.connected_at, lang, tz) })}`}</span>}
              </span>
            )}
          </div>
          {acc?.address && <p className="mt-1 [overflow-wrap:anywhere] text-sm text-ink-soft">{acc.address}</p>}
          {acc && (
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              <li suppressHydrationWarning>{acc.last_hours_push_at ? t("admin.google.lastSync", { when: formatDateTime(acc.last_hours_push_at, lang, tz) }) : t("admin.google.neverSynced")}</li>
              {acc.last_review_poll_at && <li suppressHydrationWarning>{t("admin.google.lastReviews", { when: formatDateTime(acc.last_review_poll_at, lang, tz) })}</li>}
            </ul>
          )}
          {acc?.hours_conflict && <p role="status" className="mt-3 rounded-2xl bg-amber-soft px-4 py-3 text-sm font-semibold text-ink">{t("admin.google.hoursConflict")}</p>}
          {acc?.last_error && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{socialErrorText(acc.last_error, lang)}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {!o.available ? (
              !acc && <p className="text-sm text-ink-soft">{t("admin.google.unavailable")}</p>
            ) : !acc ? (
              connectLink(t("admin.google.connect"))
            ) : acc.status !== "connected" ? (
              connectLink(t("admin.social.reconnect"))
            ) : null}
            {acc && (
              <button type="button" disabled={busy} onClick={() => void disconnect()} aria-busy={busy} className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5 disabled:opacity-60">
                {busy ? t("admin.busy") : t("admin.social.disconnect")}
              </button>
            )}
          </div>
        </div>
        {failed && <p role="alert" className="mt-3 text-sm font-semibold text-clay">{t("admin.failed")}</p>}
      </div>
    </Section>
  );
}
