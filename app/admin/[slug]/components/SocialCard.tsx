"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import { socialErrorText } from "@/src/destinations/social-errors";
import type { SocialAccountOverview, SocialOverview } from "@/src/server/admin";
import { formatDateTime } from "@/src/time";
import { Chip, Section } from "./bits";

type Kind = "facebook" | "instagram";
const NAME: Record<Kind, string> = { facebook: "Facebook", instagram: "Instagram" };
const TONE = { done: "good", pending: "warn", failed: "warn" } as const;
const SYNC_LABEL = { done: "admin.social.sync.done", pending: "admin.social.sync.pending", failed: "admin.social.sync.failed" } as const;
const CONNECT: Record<Kind, MessageKey> = { facebook: "admin.social.connectFacebook", instagram: "admin.social.connectInstagram" };
const CONFIRM: Record<Kind, MessageKey> = { facebook: "admin.social.disconnectConfirmFacebook", instagram: "admin.social.disconnectConfirmInstagram" };
const RESULTS = ["facebook_connected", "facebook_cancelled", "facebook_no_pages", "facebook_error", "instagram_connected", "instagram_cancelled", "instagram_personal", "instagram_error"] as const;
type Result = (typeof RESULTS)[number];

// The OAuth callbacks return to the dashboard with ?social_result=<code>#social. Read once per page load (the effect below then
// drops it from the address bar, so a reload does not show it again); the server render has no notice.
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

/** Connect the venue's Facebook Page and Instagram account for posting: status per network, Connect/Disconnect, prerequisites, last posts. */
export function SocialCard({ overview, slug, adminKey, tz }: { overview: SocialOverview | null; slug: string; adminKey: string; tz: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [failed, setFailed] = useState(false);
  const result = useSyncExternalStore(noSubscribe, readResult, () => null);
  const o: SocialOverview = overview ?? { available: { facebook: false, instagram: false }, facebook: null, instagram: null, posts: [] };

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

  async function disconnect(kind: Kind) {
    if (!window.confirm(t(CONFIRM[kind]))) return;
    setBusy(kind);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/${encodeURIComponent(slug)}/social?key=${encodeURIComponent(adminKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disconnect", kind }) });
      setFailed(!res.ok);
    } catch {
      setFailed(true);
    }
    setBusy(null);
  }

  const startUrl = (kind: Kind) => `/api/admin/${encodeURIComponent(slug)}/social/${kind}/start?key=${encodeURIComponent(adminKey)}`;
  const connectLink = (kind: Kind, label: string, primary: boolean) => (
    <a href={startUrl(kind)} className={primary ? "inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110" : "inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5"}>
      {label}
    </a>
  );

  const row = (kind: Kind, acc: SocialAccountOverview | null) => {
    const tone = acc?.status === "connected" ? "good" : acc ? "warn" : "plain";
    const label = !acc ? t("admin.social.notConnected") : acc.status === "connected" ? t("admin.social.connected") : t("admin.social.error");
    return (
      <li key={kind} className="py-4 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{NAME[kind]}</span>
          <Chip tone={tone}>{label}</Chip>
          {acc && (
            <span className="[overflow-wrap:anywhere] text-sm text-ink-soft">
              {acc.name}
              {acc.connected_at && <span suppressHydrationWarning>{` · ${t("admin.social.since", { when: formatDateTime(acc.connected_at, lang, tz) })}`}</span>}
            </span>
          )}
        </div>
        {acc?.last_error && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{socialErrorText(acc.last_error, lang)}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {!o.available[kind] ? (
            !acc && <p className="text-sm text-ink-soft">{t("admin.social.unavailable")}</p>
          ) : !acc ? (
            connectLink(kind, t(CONNECT[kind]), true)
          ) : acc.status !== "connected" ? (
            connectLink(kind, t("admin.social.reconnect"), true)
          ) : null}
          {acc && (
            <button type="button" disabled={busy !== null} onClick={() => void disconnect(kind)} aria-busy={busy === kind} className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5 disabled:opacity-60">
              {busy === kind ? t("admin.busy") : t("admin.social.disconnect")}
            </button>
          )}
        </div>
      </li>
    );
  };

  const connectedAny = o.facebook !== null || o.instagram !== null;
  const good = result?.endsWith("_connected");

  return (
    <Section id="social" title={t("admin.social.title")}>
      <div className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
        {result && (
          <p role="status" className={`mb-4 rounded-2xl px-4 py-3 text-sm font-semibold ${good ? "bg-accent-soft text-ink" : "bg-amber-soft text-ink"}`}>
            {t(`admin.social.result.${result}` as MessageKey)}
          </p>
        )}
        <p className="max-w-prose text-ink-soft">{t("admin.social.intro")}</p>
        <ul className="mt-4 divide-y divide-ink/10">{row("facebook", o.facebook)}{row("instagram", o.instagram)}</ul>
        {failed && <p role="alert" className="mt-3 text-sm font-semibold text-clay">{t("admin.failed")}</p>}

        <div className="mt-5 rounded-2xl bg-paper-deep px-4 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.social.prereqTitle")}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink">
            <li>{t("admin.social.prereqInstagram")}</li>
            <li>{t("admin.social.prereqFacebook")}</li>
            <li>{t("admin.social.prereqPublic")}</li>
          </ul>
        </div>

        {connectedAny && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.social.lastPosts")}</h3>
            {o.posts.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">{t("admin.social.noPosts")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-ink/10">
                {o.posts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 font-semibold">
                      {NAME[p.kind]} · {(lang === "bg" ? p.summary_bg : p.summary_en) || p.summary_bg}
                    </span>
                    <span className="flex items-center gap-2 text-ink-soft">
                      <span suppressHydrationWarning>{formatDateTime(p.updated_at, lang, tz)}</span>
                      <Chip tone={TONE[p.status]}>{t(SYNC_LABEL[p.status])}</Chip>
                    </span>
                    {p.links.length > 0 && (
                      <span className="flex w-full flex-wrap gap-3">
                        {p.links.map((href) => (
                          <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="[overflow-wrap:anywhere] font-semibold text-ink underline underline-offset-2 hover:text-accent">
                            {t("admin.social.open")}: {href.replace(/^https:\/\/(www\.)?/, "")}<span className="sr-only"> {t("admin.newTab")}</span>
                          </a>
                        ))}
                      </span>
                    )}
                    {p.status !== "done" && p.last_error && <span className="[overflow-wrap:anywhere] w-full text-xs text-clay">{socialErrorText(p.last_error, lang)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
