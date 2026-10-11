"use client";
// app/components/ConnectApps.tsx: hands an owner code to the messaging apps this server answers (done page and dashboard).
// One "Open <app>" button per enabled app, the code to copy, and a QR for the app picked in a small radio group (Telegram
// first). With Telegram alone it is the original Telegram block: one accent button, "/start CODE", one QR.
// Types only from src/server/connect-apps (server code never reaches the client bundle).
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState, type KeyboardEvent } from "react";
import { useLang } from "@/src/i18n";
import type { AppChannel, OwnerCode } from "@/src/server/connect-apps";

export type AppLink = { app: AppChannel; url: string };

export const APP_NAMES: Record<AppChannel, string> = { telegram: "Telegram", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram" };
const META_APPS: readonly AppChannel[] = ["whatsapp", "messenger", "instagram"];

/** Line glyphs in currentColor (no brand fills). Decorative next to the app's name; pass `label` where the icon stands alone. */
export function AppIcon({ app, label, className = "size-5" }: { app: AppChannel; label?: string; className?: string }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} focusable="false" data-app-icon={app} {...a11y}>
      {app === "telegram" && <path d="M21 4 3 11.2l6.2 2.3M21 4l-3.2 16-8.6-6.5M21 4 9.2 13.5V19l2.9-3.1" />}
      {app === "whatsapp" && (
        <>
          <path d="M4.2 19.8 5.4 16A8.2 8.2 0 1 1 8.2 18.7z" />
          <path d="M9.2 8.4c-.4 2.9 2.6 6.3 5.8 6l.9-1.4-1.9-.9-.9.8a5 5 0 0 1-2.5-2.5l.8-.9-.9-1.9z" />
        </>
      )}
      {app === "messenger" && (
        <>
          <path d="M12 3.2c-4.9 0-8.8 3.6-8.8 8.1 0 2.5 1.2 4.8 3.2 6.2v3.3l3-1.7c.8.2 1.7.4 2.6.4 4.9 0 8.8-3.6 8.8-8.2S16.9 3.2 12 3.2z" />
          <path d="m7.6 13.6 3-3.4 2.4 2.1 3.4-3.6" />
        </>
      )}
      {app === "instagram" && (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.9" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** The JSON from POST /api/new/[id]/invite or the dashboard's new_owner_code; null when it is not a code. */
export function parseOwnerCode(data: unknown): OwnerCode | null {
  const d = data as Partial<OwnerCode> | null;
  if (!d || typeof d.code !== "string" || !Array.isArray(d.links) || typeof d.expires_at !== "string") return null;
  return { code: d.code, links: d.links, expires_at: d.expires_at };
}

const press = "transition-[transform,background-color,box-shadow,filter] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100";

/** Radio group (arrow keys move and select, one tab stop) choosing which app's link the QR carries. */
function QrPicker({ links, selected, onSelect }: { links: AppLink[]; selected: AppChannel; onSelect: (a: AppChannel) => void }) {
  const { t } = useLang();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : step ? (i + step + links.length) % links.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onSelect(links[to].app);
    refs.current[to]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={t("apps.qrFor")} className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-card p-1 ring-1 ring-ink/10">
      {links.map((l, i) => {
        const on = l.app === selected;
        return (
          <button key={l.app} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            onClick={() => onSelect(l.app)} onKeyDown={(e) => onKey(e, i)}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold ${press} ${on ? "bg-ink text-paper" : "text-ink/75 hover:bg-ink/5 hover:text-ink"}`}>
            <AppIcon app={l.app} className="size-4" />
            {APP_NAMES[l.app]}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  code: string;
  /** One per enabled app, in display order (Telegram first); empty when no app is configured (the QR then carries the bare code). */
  links: AppLink[];
}

/** Buttons, code and QR for one owner code. Renders no card of its own: the caller's section is the surface. */
export function ConnectApps({ code, links }: Props) {
  const { t } = useLang();
  const [selected, setSelected] = useState<AppChannel | null>(links[0]?.app ?? null);
  const [copied, setCopied] = useState(false);
  const several = links.length > 1;
  const current = links.find((l) => l.app === selected) ?? links[0] ?? null;
  // Telegram alone: the deep link's "/start CODE" form, as before. Several apps: the bare code, which every app's bot reads.
  const shown = several ? code : `/start ${code}`;
  const metaNote = links.some((l) => META_APPS.includes(l.app));

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the code is still visible to copy by hand
    }
  }

  return (
    <div className={`grid gap-5 ${several ? "sm:grid-cols-[14rem_1fr]" : "sm:grid-cols-[auto_1fr]"} sm:gap-6`}>
      {/* The QR is for the owner reading this on a laptop; on a phone the buttons are the way in, so they come first there. */}
      <figure className="order-last flex flex-col items-center gap-2.5 sm:order-first sm:items-start">
        {several && current && <QrPicker links={links} selected={current.app} onSelect={setSelected} />}
        <div className="rounded-2xl bg-white p-2 ring-1 ring-ink/10">
          <QRCodeSVG value={current?.url ?? code} size={168} marginSize={2} level="M" role="img"
            aria-label={current && several ? `${t("apps.qr")}: ${APP_NAMES[current.app]}` : t("apps.qr")} />
        </div>
        <figcaption className="max-w-48 text-center text-xs leading-snug text-ink-soft sm:text-left">{t("apps.qr")}</figcaption>
      </figure>
      <div className="min-w-0">
        {links.length === 1 && (
          <a href={links[0].url} className={`flex min-h-12 w-full items-center justify-center rounded-full bg-accent px-6 text-base font-semibold text-white hover:brightness-110 sm:inline-flex sm:w-auto ${press}`}>
            {t("apps.open", { app: APP_NAMES[links[0].app] })}
          </a>
        )}
        {several && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {links.map((l) => (
              <li key={l.app}>
                <a href={l.url} data-app={l.app} className={`flex min-h-12 items-center gap-2.5 rounded-full bg-card px-4 text-base font-semibold text-ink ring-1 ring-ink/15 hover:ring-accent/60 ${press}`}>
                  <AppIcon app={l.app} className="size-5 text-accent" />
                  {t("apps.open", { app: APP_NAMES[l.app] })}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className={`text-sm text-ink-soft text-pretty ${links.length ? "mt-5" : ""}`}>{t(several ? "apps.codeLabelBare" : "apps.codeLabel")}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code className="rounded-xl bg-paper-deep px-3 py-2 font-mono text-lg tracking-wider text-ink">{shown}</code>
          <button type="button" onClick={() => void copy()} aria-live="polite"
            className={`min-h-11 rounded-full px-4 text-sm font-semibold text-ink ring-1 ring-ink/25 hover:bg-ink/5 ${press}`}>
            {copied ? t("apps.copied") : t("apps.copy")}
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-soft">{t("apps.expires")}</p>
        {metaNote && <p className="mt-1.5 text-xs text-ink-soft text-pretty">{t("apps.meta24h")}</p>}
      </div>
    </div>
  );
}
