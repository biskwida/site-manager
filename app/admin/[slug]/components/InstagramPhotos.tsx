"use client";
import { useRef, useState } from "react";
import { InstagramGrid, type DishOption } from "@/app/new/components/InstagramImport";
import type { IgItem } from "@/app/new/components/api";
import { useLang } from "@/src/i18n";
import { DICTS, type MessageKey } from "@/src/i18n/dicts";

/** Where a picked photo goes, as the import route takes it: a dish is its item id on the live menu. */
export type ImportTarget = "gallery" | "cover" | "logo" | { item: string };

/** The wizard grid's select value ("gallery" | "cover" | "logo" | "item:<ref>") → the route's target. Our dish ref is the item id. */
export function toImportTarget(v: string): ImportTarget {
  return v.startsWith("item:") ? { item: v.slice(5) } : (v as "gallery" | "cover" | "logo");
}

interface ListItem { id: string; url: string; caption: string; permalink: string; date: string }
interface Dish { ref: string; bg: string; en: string }
interface ListResponse { username?: string; items: ListItem[]; dishes: Dish[] }
interface ApiError { code?: string; bg?: string; en?: string }
type Message = { tone: "soft" | "good" | "danger"; bg: string; en: string };
/** A status line in both languages, so it follows the language toggle. */
const pair = (key: MessageKey, n?: number) => ({ bg: DICTS.bg[key].replace("{n}", String(n ?? "")), en: DICTS.en[key].replace("{n}", String(n ?? "")) });
type Phase = { kind: "idle" } | { kind: "loading" } | { kind: "list"; items: IgItem[]; username?: string; dishes: Dish[] } | { kind: "empty" };

/** The wizard grid's item shape from the dashboard list (the thumbnail is the same signed CDN URL). */
const toGridItem = (i: ListItem): IgItem => ({ id: i.id, thumb: i.url, caption: i.caption, permalink: i.permalink, taken_at: i.date });

/**
 * "Import photos from Instagram" inside the Facebook and Instagram card: reads the connected account's photos with the stored
 * connection (no new sign-in), lets the owner tick photos and pick a slot for each, and imports them as one change set that is
 * live at once and can be undone from the change log.
 */
export function InstagramPhotos({ slug, adminKey, connected }: { slug: string; adminKey: string; connected: boolean }) {
  const { lang, t } = useLang();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [focusGrid, setFocusGrid] = useState(false);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const url = `/api/admin/${encodeURIComponent(slug)}/instagram-import?key=${encodeURIComponent(adminKey)}`;
  const both = (key: MessageKey, n?: number): Message => ({ tone: "danger", ...pair(key, n) });

  /** A server error in both languages when it sent one, else the generic line. */
  const fromError = (e: ApiError | undefined): Message => (e?.bg && e?.en ? { tone: "danger", bg: e.bg, en: e.en } : both("admin.igImport.failed"));

  async function load() {
    setPhase({ kind: "loading" });
    setMessage(null);
    setPicks({});
    try {
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as (ListResponse & { error?: ApiError }) | null;
      if (!res.ok || !data || !Array.isArray(data.items)) {
        setPhase({ kind: "idle" });
        setMessage(fromError(data?.error));
        statusLine.current?.focus();
        return;
      }
      if (!data.items.length) return setPhase({ kind: "empty" });
      setPhase({ kind: "list", items: data.items.map(toGridItem), ...(data.username ? { username: data.username } : {}), dishes: Array.isArray(data.dishes) ? data.dishes : [] });
      setFocusGrid(true);
    } catch {
      setPhase({ kind: "idle" });
      setMessage(both("admin.igImport.failed"));
    }
  }

  async function doImport() {
    const list = Object.entries(picks).map(([id, v]) => ({ id, target: toImportTarget(v) }));
    if (!list.length) return;
    setBusy(true);
    setMessage({ tone: "soft", ...pair("admin.igImport.importing") });
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ picks: list }) });
      const data = (await res.json().catch(() => null)) as { imported?: number; failed?: { id: string; code: string }[]; error?: ApiError } | null;
      if (!res.ok || !data || typeof data.imported !== "number") setMessage(fromError(data?.error));
      else {
        setPicks({});
        const done = pair("admin.igImport.done", data.imported);
        const failed = data.failed?.length ?? 0;
        if (failed) {
          const more = pair("admin.igImport.someFailed", failed);
          setMessage({ tone: "danger", bg: `${done.bg} ${more.bg}`, en: `${done.en} ${more.en}` });
        } else setMessage({ tone: "good", ...done });
      }
    } catch {
      setMessage(both("admin.igImport.failed"));
    }
    setBusy(false);
    statusLine.current?.focus();
  }

  const count = Object.keys(picks).length;
  const dishes: DishOption[] = phase.kind === "list" ? phase.dishes.map((d) => ({ ref: d.ref, label: (lang === "bg" ? d.bg : d.en) || d.bg || d.en })) : [];
  const quiet = "min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5 disabled:opacity-60";
  const primary = "min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60";

  return (
    <div className="mt-5 border-t border-ink/10 pt-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.igImport.title")}</h3>
      {!connected ? (
        <p className="mt-2 max-w-prose text-sm text-ink-soft">{t("admin.igImport.connectFirst")}</p>
      ) : (
        <div className="mt-2 grid gap-3">
          {phase.kind === "list" ? (
            <>
              <InstagramGrid items={phase.items} username={phase.username} picks={picks} dishes={dishes} busy={busy} focusHeading={focusGrid}
                onToggle={(id, on) => setPicks((p) => { const next = { ...p }; if (on) next[id] = "gallery"; else delete next[id]; return next; })}
                onTarget={(id, v) => setPicks((p) => ({ ...p, [id]: v }))} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={primary} disabled={!count || busy} aria-busy={busy} onClick={() => void doImport()}>
                  {busy ? t("admin.igImport.importing") : t("admin.igImport.import", { n: count })}
                </button>
                <button type="button" className={quiet} disabled={busy} onClick={() => void load()}>{t("admin.igImport.refresh")}</button>
                <button type="button" className={quiet} disabled={busy} onClick={() => { setPhase({ kind: "idle" }); setPicks({}); }}>{t("admin.igImport.close")}</button>
              </div>
            </>
          ) : (
            <>
              <p className="max-w-prose text-sm text-ink-soft">{t("admin.igImport.hint")}</p>
              <div>
                <button type="button" className={quiet} disabled={phase.kind === "loading"} aria-busy={phase.kind === "loading"} onClick={() => void load()}>
                  {phase.kind === "loading" ? t("admin.igImport.loading") : t("admin.igImport.button")}
                </button>
              </div>
              {phase.kind === "empty" && <p className="text-sm text-ink-soft">{t("admin.igImport.empty")}</p>}
            </>
          )}
          <p ref={statusLine} tabIndex={-1} aria-live="polite" className={`min-h-5 text-sm outline-none ${message?.tone === "danger" ? "font-semibold text-clay" : message?.tone === "good" ? "font-semibold text-ink" : "text-ink-soft"}`}>
            {message ? message[lang] : ""}
          </p>
        </div>
      )}
    </div>
  );
}
