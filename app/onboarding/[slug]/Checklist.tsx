"use client";
// app/onboarding/[slug]/Checklist.tsx — the onboarding checklist, the same for all three paths: business details, chat, Instagram and
// Facebook, the website (path B only), Google Business (coming soon) and the plan card. It can be left and resumed: the ticks come from
// the server (GET /api/onboarding/[slug], polled every 5 s until the chat is connected).
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectApps, parseOwnerCode, type AppLink } from "@/app/components/ConnectApps";
import { btnGhost, btnPrimary, btnSmall, cardCls, inputCls, pillCls } from "@/app/components/account-ui";
import type { PageLang } from "@/src/auth/page-lang";
import type { SiteMode, SitePlatform } from "@/src/domain/types";
import { fill, ONBOARDING } from "@/src/i18n/onboarding";
import type { OnboardingStatus } from "@/src/server/onboarding";

const POLL_MS = 5_000;
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

export interface ChecklistProps {
  lang: PageLang;
  slug: string;
  name: string;
  siteUrl: string | null;
  mode: SiteMode;
  platform: SitePlatform | null;
  initial: OnboardingStatus;
  /** The owner code to show while no chat is connected; null once one is. */
  code: string | null;
  links: AppLink[];
  /** Which Meta connects this server can start (their app ids and the secret key are set). */
  social: { facebook: boolean; instagram: boolean };
  /** getclaudia.app/<slug>/menu without the scheme, and with it. */
  menuUrl: string;
  menuHref: string;
  pluginHref: string;
  /** The address the WordPress plugin asks for ("Claudia address"). */
  appUrl: string;
  fetcher?: typeof fetch;
}

function Tick({ done, n, label }: { done: boolean; n: number; label: string }) {
  return (
    <span className={`grid size-7 shrink-0 place-items-center rounded-full border-2 text-sm font-extrabold ${done ? "border-[var(--cl-ok)] bg-[var(--cl-ok)] text-white" : "border-[var(--cl-line)] text-[var(--cl-ink-2)]"}`}>
      <span aria-hidden="true">{done ? "✓" : n}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Step({ n, done, title, pill, lang, children }: { n: number; done: boolean; title: string; pill?: string; lang: PageLang; children: ReactNode }) {
  const t = ONBOARDING[lang];
  return (
    <li className="grid grid-cols-[auto_1fr] items-start gap-3 rounded-2xl border border-[var(--cl-line)] bg-[var(--cl-card)] p-4">
      <Tick done={done} n={n} label={done ? t["list.done"] : t["list.todo"]} />
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-2 font-display text-xl">
          {title}
          {pill ? <span className={pillCls}>{pill}</span> : null}
        </h2>
        <div className="mt-1 text-[var(--cl-ink-2)]">{children}</div>
      </div>
    </li>
  );
}

export function Checklist(p: ChecklistProps) {
  const { lang, slug } = p;
  const t = ONBOARDING[lang];
  const f = p.fetcher ?? defaultFetch;
  const [status, setStatus] = useState(p.initial);
  const [fresh, setFresh] = useState<{ code: string; links: AppLink[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const [askFailed, setAskFailed] = useState(false);
  const [wpCode, setWpCode] = useState("");
  const [wpBusy, setWpBusy] = useState(false);
  const [wpError, setWpError] = useState<string | null>(null);
  const [wpSite, setWpSite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const freshHeading = useRef<HTMLHeadingElement>(null);
  const api = `/api/onboarding/${encodeURIComponent(slug)}`;

  // Until the chat is connected, ask the server every few seconds so the tick appears by itself.
  useEffect(() => {
    if (status.chat) return;
    let stop = false;
    const id = window.setInterval(async () => {
      try {
        const res = await f(api, { cache: "no-store" });
        if (res.ok && !stop) setStatus((await res.json()) as OnboardingStatus);
      } catch {
        // keep the last status; the next poll retries
      }
    }, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [status.chat, api, f]);

  async function another() {
    setAsking(true);
    setAskFailed(false);
    try {
      const res = await f(`${api}/invite`, { method: "POST", cache: "no-store" });
      const got = res.ok ? parseOwnerCode(await res.json().catch(() => null)) : null;
      if (got) {
        setFresh({ code: got.code, links: got.links });
        window.setTimeout(() => freshHeading.current?.focus(), 0);
      } else setAskFailed(true);
    } catch {
      setAskFailed(true);
    }
    setAsking(false);
  }

  async function connectWordPress(e: React.FormEvent) {
    e.preventDefault();
    if (wpBusy) return;
    setWpBusy(true);
    setWpError(null);
    try {
      const res = await f(`${api}/wordpress`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: wpCode }) });
      const data = (await res.json().catch(() => null)) as { connected?: boolean; site_name?: string; error?: { bg?: string; en?: string } } | null;
      if (res.ok && data?.connected) {
        setWpSite(data.site_name ?? "");
        setStatus((s) => ({ ...s, website: "connected" }));
        setWpCode("");
      } else setWpError(data?.error?.[lang] ?? t["list.wp.error"]);
    } catch {
      setWpError(t["list.wp.error"]);
    }
    setWpBusy(false);
  }

  async function copyMenu() {
    try {
      await navigator.clipboard.writeText(p.menuHref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the link is on screen to copy by hand
    }
  }

  const own = p.mode === "own";
  const wordpress = own && p.platform === "wordpress";
  let n = 1;
  const igHref = `/api/admin/${encodeURIComponent(slug)}/social/instagram/start`;
  const fbHref = `/api/admin/${encodeURIComponent(slug)}/social/facebook/start`;

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div>
        <h1 className="font-display text-4xl leading-tight">{t["list.title"]}</h1>
        <p className="mb-5 mt-2 text-[var(--cl-ink-2)]">{t["list.lead"]}</p>
        <ol className="grid gap-3">
          <Step n={n++} done title={t["list.step.details"]} lang={lang}>
            <p>{own && p.siteUrl ? fill(t["list.details.own"], { name: p.name, site: p.siteUrl.replace(/^https:\/\//, "") }) : fill(t["list.details.plain"], { name: p.name })}</p>
          </Step>

          <Step n={n++} done={status.chat} title={t["list.step.chat"]} pill={status.chat ? undefined : t["list.chat.start"]} lang={lang}>
            {status.chat ? (
              <p role="status">{t["list.chat.connected"]}</p>
            ) : (
              <>
                <p>{t["list.chat.text"]}</p>
                {p.code ? <div className="mt-3"><ConnectApps code={p.code} links={p.links} /></div> : null}
              </>
            )}
            {fresh ? (
              <div className="mt-4 border-t border-[var(--cl-line)] pt-4">
                <h3 ref={freshHeading} tabIndex={-1} className="mb-3 font-display text-lg outline-none">{t["list.chat.freshTitle"]}</h3>
                <ConnectApps code={fresh.code} links={fresh.links} />
              </div>
            ) : (
              <div className="mt-3">
                <button type="button" onClick={() => void another()} disabled={asking} className={btnSmall}>{asking ? t["list.chat.anotherLoading"] : t["list.chat.another"]}</button>
                {askFailed ? <p role="alert" className="mt-2 text-sm text-[var(--cl-error)]">{t["list.chat.anotherError"]}</p> : null}
              </div>
            )}
          </Step>

          <Step n={n++} done={status.instagram && status.facebook} title={t["list.step.social"]} lang={lang}>
            <p>{t["list.social.text"]}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {status.instagram ? <span className={pillCls}>{t["list.social.instagramDone"]}</span> : p.social.instagram ? <a href={igHref} className={btnSmall}>{t["list.social.instagram"]}</a> : <span aria-disabled="true" className={`${btnSmall} opacity-60`}>{t["list.social.instagram"]} · {t["list.social.soon"]}</span>}
              {status.facebook ? <span className={pillCls}>{t["list.social.facebookDone"]}</span> : p.social.facebook ? <a href={fbHref} className={btnSmall}>{t["list.social.facebook"]}</a> : <span aria-disabled="true" className={`${btnSmall} opacity-60`}>{t["list.social.facebook"]} · {t["list.social.soon"]}</span>}
            </div>
            <p className="mt-3 text-sm">{t["list.social.metaNote"]}</p>
          </Step>

          {wordpress ? (
            <Step n={n++} done={status.website === "connected"} title={t["list.step.wordpress"]} lang={lang}>
              {status.website === "connected" ? (
                <p role="status">{wpSite ? fill(t["list.wp.connectedAs"], { site: wpSite }) : t["list.wp.connected"]}</p>
              ) : (
                <>
                  <p>{fill(t["list.wp.text"], { base: p.appUrl, slug })}</p>
                  <div className="mt-3">
                    <a href={p.pluginHref} download className={btnSmall}>{t["list.wp.download"]}</a>
                  </div>
                  <form onSubmit={connectWordPress} className="mt-3 max-w-md">
                    <label htmlFor="wp-code" className="block text-sm font-medium text-[var(--cl-ink)]">{t["list.wp.codeLabel"]}</label>
                    <input id="wp-code" name="code" value={wpCode} onChange={(e) => setWpCode(e.target.value)} required autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby={wpError ? "wp-error wp-hint" : "wp-hint"} aria-invalid={wpError ? true : undefined} className={`${inputCls} font-mono tracking-wider`} />
                    <span id="wp-hint" className="mt-1 block text-sm">{t["list.wp.codeHint"]}</span>
                    {wpError ? <span id="wp-error" role="alert" className="mt-1 block text-sm text-[var(--cl-error)]">{wpError}</span> : null}
                    <button type="submit" disabled={wpBusy || !wpCode.trim()} className={`${btnPrimary} mt-3`}>{wpBusy ? t["list.wp.connecting"] : t["list.wp.connect"]}</button>
                  </form>
                </>
              )}
            </Step>
          ) : own ? (
            <Step n={n++} done={false} title={t["list.step.menuLink"]} lang={lang}>
              <p>{t["list.menu.text"].split("{url}")[0]}<a href={p.menuHref} className="break-all font-medium text-[var(--cl-ink)] underline underline-offset-4">{p.menuUrl}</a></p>
              <p className="mt-1 text-sm">{t["list.menu.hint"]}</p>
              <button type="button" onClick={() => void copyMenu()} aria-live="polite" className={`${btnSmall} mt-3`}>{copied ? t["list.menu.copied"] : t["list.menu.copy"]}</button>
            </Step>
          ) : null}

          <Step n={n++} done={false} title={t["list.step.google"]} pill={t["list.google.soon"]} lang={lang}>
            <p>{t["list.google.text"]}</p>
          </Step>
        </ol>
      </div>

      <aside aria-labelledby="plan-title" className={`${cardCls} grid gap-3 bg-[var(--cl-bg)]`}>
        <span className={`${pillCls} justify-self-start`}>{t["list.plan.pill"]}</span>
        <h2 id="plan-title" className="font-display text-2xl">{t["list.plan.title"]}</h2>
        <p className="text-[var(--cl-ink-2)]">{t["list.plan.text"]}</p>
        <Link href="/dashboard" className={btnGhost}>{t["list.plan.dashboard"]}</Link>
      </aside>
    </div>
  );
}
