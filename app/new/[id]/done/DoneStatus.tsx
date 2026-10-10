"use client";
// The moment the owner connects Telegram. Self-contained (no wizard components): brand tokens, Literata headings, Onest body.
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import type { DeployInfo, VenueStatus } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";

export interface DoneStatusResponse {
  status: VenueStatus;
  deploy: DeployInfo | null;
  site_url: string | null;
}
export type Phase = "waiting" | "publishing" | "live" | "error";

/** No deploy yet = waiting for /start; pending/building = publishing; ready = live; error = error. */
export function phaseOf(s: DoneStatusResponse): Phase {
  if (!s.deploy) return "waiting";
  if (s.deploy.status === "ready") return "live";
  if (s.deploy.status === "error") return "error";
  return "publishing";
}

const POLL_MS = 5_000;
const TICK_MS = 30_000;
const TICK_WINDOW_MS = 10 * 60_000;
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

interface Props {
  id: string;
  slug: string;
  /** null once the owner has joined (or when the page cannot show one). */
  code: string | null;
  /** https://t.me/<bot>?start=<code>; null when TELEGRAM_BOT_USERNAME is not set (the QR then carries the raw code). */
  startUrl: string | null;
  adminKey: string;
  baseUrl: string;
  initial: DoneStatusResponse;
  fetcher?: typeof fetch;
}

/** Telegram hand-off (deep link, raw code, QR), then a status line polled every 5 s until the site is live. */
export function DoneStatus({ id, slug, code, startUrl, adminKey, baseUrl, initial, fetcher = defaultFetch }: Props) {
  const { t } = useLang();
  const [status, setStatus] = useState(initial);
  const [copied, setCopied] = useState(false);
  const started = useRef<number | null>(null);
  const phase = phaseOf(status);

  useEffect(() => {
    if (phase === "live") return;
    let stop = false;
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      try {
        const res = await fetcher(`/api/new/${encodeURIComponent(id)}/status`, { cache: "no-store" });
        if (!res.ok || stop || mine !== seq) return;
        const data = (await res.json()) as DoneStatusResponse;
        if (!stop && mine === seq) setStatus(data);
      } catch {
        // keep the last status; the next poll retries
      }
    };
    const poll = window.setInterval(() => void load(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(poll);
    };
  }, [id, phase, fetcher]);

  // Vercel cron is daily: while publishing, nudge the tick with the owner's key (allowed by ?key= auth) for the first 10 minutes,
  // so the deploy is polled and the "your site is live" Telegram message goes out promptly.
  useEffect(() => {
    if (phase !== "publishing") return;
    started.current ??= Date.now();
    const nudge = () => {
      if (Date.now() - (started.current ?? Date.now()) > TICK_WINDOW_MS) return;
      void fetcher(`/api/tick?key=${encodeURIComponent(adminKey)}`, { method: "POST" }).catch(() => undefined);
    };
    nudge();
    const timer = window.setInterval(nudge, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, adminKey, fetcher]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`/start ${code}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the code is still visible to copy by hand
    }
  }

  const hostedUrl = `${baseUrl}/${slug}`;
  const adminUrl = `/admin/${encodeURIComponent(slug)}?key=${encodeURIComponent(adminKey)}`;
  const liveUrl = status.site_url ?? status.deploy?.url ?? null;
  const dot = phase === "live" ? "bg-accent" : phase === "error" ? "bg-clay" : "bg-amber";
  const link = "flex min-h-11 flex-col justify-center rounded-2xl bg-card px-4 py-2 ring-1 ring-ink/10 transition-[box-shadow,transform] duration-150 hover:ring-accent/50 active:scale-[0.99]";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-10">
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-base font-semibold tracking-tight text-ink/80">Site Manager</span>
        <LangToggle />
      </div>
      <h1 className="mt-6 text-3xl font-semibold leading-tight text-balance sm:mt-8 sm:text-4xl">{t("done.title")}</h1>
      <p className="mt-3 max-w-prose text-lg leading-snug text-ink-soft text-pretty">{t("done.lead")}</p>

      {code ? (
        <section aria-labelledby="tg" className="mt-7 rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-6">
          <h2 id="tg" className="sr-only">Telegram</h2>
          <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:gap-6">
            {/* The QR is for the owner reading this on a laptop; on a phone the button is the way in, so the code comes first there. */}
            <figure className="order-last flex flex-col items-center gap-2 sm:order-first sm:items-start">
              <div className="rounded-2xl bg-white p-2 ring-1 ring-ink/10">
                <QRCodeSVG value={startUrl ?? code} size={168} marginSize={2} level="M" role="img" aria-label={t("done.qr")} />
              </div>
              <figcaption className="max-w-48 text-center text-xs leading-snug text-ink-soft sm:text-left">{t("done.qr")}</figcaption>
            </figure>
            <div className="min-w-0">
              {startUrl && (
                <a href={startUrl} className="flex min-h-12 w-full items-center justify-center rounded-full bg-accent px-6 text-base font-semibold text-white transition-[transform,filter] duration-150 hover:brightness-110 active:scale-[0.98] sm:inline-flex sm:w-auto">
                  {t("done.openTelegram")}
                </a>
              )}
              <p className={`text-sm text-ink-soft ${startUrl ? "mt-5" : ""}`}>{t("done.codeLabel")}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="rounded-xl bg-paper-deep px-3 py-2 font-mono text-lg tracking-wider text-ink">/start {code}</code>
                <button type="button" onClick={() => void copy()} aria-live="polite"
                  className="min-h-11 rounded-full px-4 text-sm font-semibold text-ink ring-1 ring-ink/25 transition-[transform,background-color] duration-150 hover:bg-ink/5 active:scale-[0.98]">
                  {copied ? t("done.copied") : t("done.copy")}
                </button>
              </div>
              <p className="mt-3 text-xs text-ink-soft">{t("done.expires")}</p>
            </div>
          </div>
        </section>
      ) : (
        <p className="mt-7 rounded-2xl bg-accent-soft px-4 py-3 font-semibold text-ink">{t("done.joined")}</p>
      )}

      <section aria-labelledby="status" aria-live="polite" className="mt-5 rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-6">
        <h2 id="status" className="text-base font-semibold text-ink-soft">{t("done.statusTitle")}</h2>
        <p data-phase={phase} className="mt-2 flex items-start gap-2.5 text-lg font-semibold leading-snug">
          <span aria-hidden="true" className={`mt-[0.45em] size-2.5 shrink-0 rounded-full ${dot} ${phase === "publishing" ? "animate-pulse" : ""}`} />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {phase === "waiting" && t("done.waiting")}
            {phase === "publishing" && t("done.publishing")}
            {phase === "live" && (liveUrl ? <>{t("done.live")} <a href={liveUrl} className="underline underline-offset-4 hover:text-accent">{liveUrl}</a></> : t("done.live"))}
            {phase === "error" && t("done.error")}
          </span>
        </p>
      </section>

      <ul className="mt-5 grid gap-2">
        <li>
          <a href={hostedUrl} className={link}>
            <span className="font-semibold text-ink">{t("done.hosted")}</span>
            <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">{hostedUrl}</span>
          </a>
        </li>
        <li>
          <a href={adminUrl} className={`${link} font-semibold text-ink`}>{t("done.dashboard")}</a>
        </li>
      </ul>
    </main>
  );
}
