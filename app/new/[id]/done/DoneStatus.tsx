"use client";
// app/new/[id]/done/DoneStatus.tsx: the moment the owner connects their messaging app(s). Renders inside app/new/layout.tsx,
// so the .sm-brand scope gives it the brand accent and faces (Commissioner headings, Sofia Sans body) over the shared app
// tokens (ink, card, paper). The connect block itself is app/components/ConnectApps.tsx (shared with the dashboard).
// Polls GET /api/new/[id]/status every 5 s until live (and while a fresh "another app" code is open); while publishing it
// also nudges the tick (app/components/tickNudge.ts). Hosted mode (no deployer): live as soon as the owner joined.
import { useEffect, useRef, useState } from "react";
import type { DeployInfo, VenueStatus } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import type { AppChannel, ConnectedApp } from "@/src/server/connect-apps";
import { AppIcon, APP_NAMES, ConnectApps, parseOwnerCode, type AppLink } from "@/app/components/ConnectApps";
import { startTickNudge } from "@/app/components/tickNudge";

/** GET /api/new/[id]/status (WizardStatusResponse). */
export interface DoneStatusResponse {
  status: VenueStatus;
  deploy: DeployInfo | null;
  site_url: string | null;
  /** An owner has linked a chat (pressed Start in Telegram, or sent the code in another app). */
  owner_joined?: boolean;
  /** No deployer on this server: the hosted /<slug> is the site (deploy is always null). */
  hosted?: boolean;
  /** Linked chats per app. */
  connected_apps?: ConnectedApp[];
}
export type Phase = "waiting" | "publishing" | "live" | "error";

/** Hosted mode: live once the owner joined. Otherwise no deploy yet = waiting for /start; pending/building = publishing; ready = live; error = error. */
export function phaseOf(s: DoneStatusResponse): Phase {
  if (s.hosted) return s.owner_joined ? "live" : "waiting";
  if (!s.deploy) return "waiting";
  if (s.deploy.status === "ready") return "live";
  if (s.deploy.status === "error") return "error";
  return "publishing";
}

const POLL_MS = 5_000;
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

interface Props {
  id: string;
  slug: string;
  /** null once the owner has joined (or when the page cannot show one). */
  code: string | null;
  /** One owner link per enabled app for `code` (empty when no app is configured: the QR then carries the raw code). */
  links: AppLink[];
  /** The apps this server answers (enabledApps); more than one shows "Connect another app" after the first. */
  apps: AppChannel[];
  adminKey: string;
  baseUrl: string;
  initial: DoneStatusResponse;
  fetcher?: typeof fetch;
}

type Fresh = { code: string; links: AppLink[]; chats: number };
const chatsOf = (s: DoneStatusResponse) => (s.connected_apps ?? []).reduce((n, a) => n + a.owners + a.staff, 0);
// Focus moves here after a new code arrives so screen readers read it; it is not a control, so no focus ring
// (inline because the global :focus-visible outline in app/globals.css is unlayered and beats utilities).
const NO_RING = { outline: "none" } as const;
const isLocalized = (d: unknown): d is { bg: string; en: string } =>
  typeof d === "object" && d !== null && typeof (d as { bg?: unknown }).bg === "string" && typeof (d as { en?: unknown }).en === "string";

/** App hand-off (deep links, raw code, QR), then a status line polled every 5 s until the site is live. */
export function DoneStatus({ id, slug, code, links, apps, adminKey, baseUrl, initial, fetcher = defaultFetch }: Props) {
  const { lang, t } = useLang();
  const [status, setStatus] = useState(initial);
  // "Connect another app": a fresh single-use owner code from POST /invite; cleared once one more chat links with it.
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [asking, setAsking] = useState(false);
  /** Chat count at which a fresh code closed because it was used (0 = never); drives the focus move below. */
  const [closedAt, setClosedAt] = useState(0);
  const [failed, setFailed] = useState<{ bg: string; en: string } | true | null>(null);
  const freshHeading = useRef<HTMLHeadingElement>(null);
  const connectedLine = useRef<HTMLParagraphElement>(null);
  const phase = phaseOf(status);
  const several = apps.length > 1;
  // Telegram-specific copy ("press Start in Telegram") only when Telegram is the one app (or none is configured, as before).
  const generic = several || (apps.length === 1 && apps[0] !== "telegram");
  const connected = status.connected_apps ?? [];
  const joined = !code || !!status.owner_joined || connected.length > 0;
  const chats = chatsOf(status);
  const watching = phase !== "live" || fresh !== null;

  useEffect(() => {
    if (!watching) return;
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
  }, [id, watching, fetcher]);

  // While publishing, nudge the tick with the owner's key so the deploy is polled and this page turns live promptly
  // (the background watch after /start and the 5-minute cron finish it too, with or without this page).
  useEffect(() => {
    if (phase !== "publishing") return;
    return startTickNudge({ adminKey, fetcher });
  }, [phase, adminKey, fetcher]);

  // The fresh code has been used once another chat shows up: close it and put focus on the connected line, which now
  // names the new app (focus would otherwise fall back to the page as the section disappears).
  if (fresh && chats > fresh.chats) {
    setFresh(null);
    setClosedAt(chats);
  }
  useEffect(() => {
    if (closedAt) connectedLine.current?.focus();
  }, [closedAt]);

  async function another() {
    setAsking(true);
    setFailed(null);
    try {
      const res = await fetcher(`/api/new/${encodeURIComponent(id)}/invite`, { method: "POST", cache: "no-store" });
      const data: unknown = await res.json().catch(() => null);
      const got = res.ok ? parseOwnerCode(data) : null;
      if (got) {
        setFresh({ code: got.code, links: got.links, chats });
        window.setTimeout(() => freshHeading.current?.focus(), 0);
      } else {
        const err = (data as { error?: unknown } | null)?.error;
        setFailed(isLocalized(err) ? { bg: err.bg, en: err.en } : true);
      }
    } catch {
      setFailed(true);
    }
    setAsking(false);
  }

  const hostedUrl = `${baseUrl}/${slug}`;
  const adminUrl = `/admin/${encodeURIComponent(slug)}?key=${encodeURIComponent(adminKey)}`;
  const liveUrl = status.site_url ?? status.deploy?.url ?? null;
  const dot = phase === "live" ? "bg-accent" : phase === "error" ? "bg-clay" : "bg-amber";
  const link = "flex min-h-11 flex-col justify-center rounded-2xl bg-card px-4 py-2 ring-1 ring-ink/10 transition-[box-shadow,transform] duration-150 hover:ring-accent/50 active:scale-[0.99]";
  const lead = generic ? (status.hosted ? "done.leadAppsHosted" : "done.leadApps") : status.hosted ? "done.leadHosted" : "done.lead";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-10">
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-base font-semibold tracking-tight text-ink/80">Site Manager</span>
        <LangToggle />
      </div>
      <h1 className="mt-6 text-3xl font-semibold leading-tight text-balance sm:mt-8 sm:text-4xl">{t("done.title")}</h1>
      <p className="mt-3 max-w-prose text-lg leading-snug text-ink-soft text-pretty">{t(lead)}</p>

      {code && !joined ? (
        <section aria-labelledby="connect" className="mt-7 rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-6">
          {/* One app: the block speaks for itself (heading for screen readers only). Several: name the choice. */}
          <h2 id="connect" className={several ? "mb-4 text-xl font-semibold" : "sr-only"}>{t("done.connectTitle")}</h2>
          <ConnectApps code={code} links={links} />
        </section>
      ) : (
        <div className="mt-7">
          <p id="connected" tabIndex={-1} ref={connectedLine} style={NO_RING} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-accent-soft px-4 py-3 font-semibold text-ink">
            {connected.length > 0 ? (
              <>
                <span>{t("done.connected")}</span>
                {connected.map((a) => (
                  <span key={a.app} className="inline-flex items-center gap-1.5">
                    <AppIcon app={a.app} className="size-4" />
                    {APP_NAMES[a.app]} ✓
                  </span>
                ))}
              </>
            ) : t("done.joined")}
          </p>
          {several && !fresh && (
            <div className="mt-3">
              <button type="button" onClick={() => void another()} disabled={asking} aria-busy={asking}
                className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition-[transform,background-color] duration-150 ease-out hover:bg-ink/5 active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none">
                {t("done.connectAnother")}
              </button>
              {failed && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{failed === true ? t("done.inviteFailed") : failed[lang]}</p>}
            </div>
          )}
        </div>
      )}

      {fresh && (
        <section aria-labelledby="another" className="mt-5 rounded-3xl bg-card p-4 ring-1 ring-ink/10 transition-[opacity,transform] duration-200 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none sm:p-6">
          <h2 id="another" ref={freshHeading} tabIndex={-1} style={NO_RING} className="text-xl font-semibold">{t("done.anotherTitle")}</h2>
          <p className="mb-4 mt-1 text-sm text-ink-soft text-pretty">{t("done.anotherLead")}</p>
          <ConnectApps key={fresh.code} code={fresh.code} links={fresh.links} />
        </section>
      )}

      <section aria-labelledby="status" aria-live="polite" className="mt-5 rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-6">
        <h2 id="status" className="text-base font-semibold text-ink-soft">{t("done.statusTitle")}</h2>
        <p data-phase={phase} className="mt-2 flex items-start gap-2.5 text-lg font-semibold leading-snug">
          <span aria-hidden="true" className={`mt-[0.45em] size-2.5 shrink-0 rounded-full ${dot} ${phase === "publishing" ? "animate-pulse" : ""}`} />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {phase === "waiting" && t(generic ? "done.waitingApps" : "done.waiting")}
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
