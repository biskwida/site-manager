"use client";
import { useRef, useState } from "react";
import { AppIcon, APP_NAMES, ConnectApps, parseOwnerCode } from "@/app/components/ConnectApps";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import type { ConnectedApp, OwnerCode } from "@/src/server/connect-apps";
import { Section } from "./bits";
import type { Post } from "./useAdminOverview";

// Focus moves here after a new code arrives so screen readers read it; it is not a control, so no focus ring
// (inline because the global :focus-visible outline in app/globals.css is unlayered and beats utilities).
const NO_RING = { outline: "none" } as const;
const isLocalized = (d: unknown): d is { bg: string; en: string } =>
  typeof d === "object" && d !== null && typeof (d as { bg?: unknown }).bg === "string" && typeof (d as { en?: unknown }).en === "string";

/**
 * "Your apps": the chats linked to this venue per messaging app (owners and staff), and "Connect another", which asks the
 * server for a fresh single-use owner code (action new_owner_code) and shows its links, QR and code. A code also serves a
 * second phone on the same app. `initialCode` is for tests and screenshots.
 */
export function AppsCard({ apps, post, initialCode = null }: { apps: ConnectedApp[]; post: Post; initialCode?: OwnerCode | null }) {
  const { lang, t } = useLang();
  const [fresh, setFresh] = useState<OwnerCode | null>(initialCode);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ bg: string; en: string } | true | null>(null);
  const lead = useRef<HTMLParagraphElement>(null);

  const count = (n: number, one: MessageKey, other: MessageKey) => (n === 1 ? t(one) : t(other, { n: String(n) }));
  const counts = (a: ConnectedApp) =>
    [a.owners ? count(a.owners, "admin.apps.owners.one", "admin.apps.owners.other") : null, a.staff ? count(a.staff, "admin.apps.staff.one", "admin.apps.staff.other") : null].filter(Boolean).join(", ");

  async function another() {
    setBusy(true);
    setFailed(null);
    const r = await post({ action: "new_owner_code" });
    const got = r.ok ? parseOwnerCode(r.data) : null;
    if (got) {
      setFresh(got);
      window.setTimeout(() => lead.current?.focus(), 0);
    } else setFailed(isLocalized(r.data) ? { bg: r.data.bg, en: r.data.en } : true);
    setBusy(false);
  }

  return (
    <Section id="apps" title={t("admin.apps.title")}>
      <div className="rounded-3xl bg-card ring-1 ring-ink/10">
        {apps.length === 0 ? (
          <p className="px-4 py-3 text-ink-soft text-pretty sm:px-5">{t("admin.apps.none")}</p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {apps.map((a) => (
              <li key={a.app} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <span className="inline-flex items-center gap-2.5 font-semibold">
                  <AppIcon app={a.app} className="size-5 text-accent" />
                  {APP_NAMES[a.app]}
                </span>
                <span className="text-sm text-ink-soft">{counts(a)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-ink/10 px-4 py-4 sm:px-5">
          {fresh ? (
            <div className="transition-[opacity,transform] duration-200 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none">
              <p ref={lead} tabIndex={-1} style={NO_RING} className="mb-4 text-sm text-ink-soft text-pretty">{t("admin.apps.anotherLead")}</p>
              <ConnectApps key={fresh.code} code={fresh.code} links={fresh.links} />
              <button type="button" onClick={() => setFresh(null)}
                className="mt-5 min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition-[transform,background-color] duration-150 ease-out hover:bg-ink/5 active:scale-[0.98] motion-reduce:transition-none">{t("admin.apps.hide")}</button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => void another()} disabled={busy} aria-busy={busy}
                className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition-[transform,background-color] duration-150 ease-out hover:bg-ink/5 active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none">
                {busy ? t("admin.busy") : t("admin.apps.another")}
              </button>
              {failed && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{failed === true ? t("admin.failed") : failed[lang]}</p>}
            </>
          )}
        </div>
      </div>
    </Section>
  );
}
