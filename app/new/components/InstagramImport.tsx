"use client";
import { useEffect, useId, useState } from "react";
import { wizardText, type WizardKey } from "@/src/i18n/wizard";
import type { WizardDraft } from "@/src/wizard/schema";
import { api, type IgItem, type IgTarget } from "./api";
import { Button, Note, Status } from "./Field";
import type { IgReturn, StepProps } from "./types";
import { useT } from "./useWizardText";

/** Same as IG_MAX_PICKS on the server (src/server/instagram.ts, server-only). */
export const IG_PICKS_MAX = 12;

/** The select's value for a target: "gallery" | "cover" | "logo" | "item:<categoryKey>/<itemKey>". */
type TargetValue = string;
const toTarget = (v: TargetValue): IgTarget => (v.startsWith("item:") ? { item: v.slice(5) } : (v as "cover" | "logo" | "gallery"));

export interface DishOption { ref: string; label: string }

/** Every dish on the current menu, as "Category · Dish" in the wizard's language (the other language when one is empty). */
export function dishOptions(d: WizardDraft, lang: "bg" | "en"): DishOption[] {
  const name = (bg: string, en: string) => (lang === "bg" ? bg || en : en || bg).trim();
  return d.categories.flatMap((c) => c.items.filter((it) => name(it.name_bg, it.name_en)).map((it) => ({ ref: `${c.key}/${it.key}`, label: [name(c.name_bg, c.name_en), name(it.name_bg, it.name_en)].filter(Boolean).join(" · ") })));
}

const SELECT = "min-h-11 w-full min-w-0 rounded-xl bg-panel px-3 text-sm text-fg ring-1 ring-line outline-none transition-shadow duration-150 ease-out focus-visible:ring-2 focus-visible:ring-brand";

/** The picking grid: one labelled checkbox per photo (the caption is the label) and, once ticked, where it goes. */
export function InstagramGrid({ items, username, picks, dishes, onToggle, onTarget, busy = false }: {
  items: IgItem[];
  username?: string;
  picks: Record<string, TargetValue>;
  dishes: DishOption[];
  onToggle: (id: string, on: boolean) => void;
  onTarget: (id: string, v: TargetValue) => void;
  busy?: boolean;
}) {
  const { t } = useT();
  const headingId = useId();
  const full = Object.keys(picks).length >= IG_PICKS_MAX;
  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="grid gap-1">
        <h2 id={headingId} className="text-base font-semibold text-fg">{username ? t("ig.titleUser", { user: username }) : t("ig.title")}</h2>
        <p className="max-w-[60ch] text-sm leading-snug text-fg-soft">{t("ig.pickHint", { n: IG_PICKS_MAX })}</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((it, i) => {
          const on = it.id in picks;
          const label = it.caption || t("ig.untitled", { n: i + 1 });
          return (
            <li key={it.id} className={`grid content-start gap-2 rounded-xl bg-panel p-2 transition-shadow duration-150 ease-out ${on ? "ring-2 ring-brand" : "ring-1 ring-line"}`}>
              <label className="grid cursor-pointer gap-1.5">
                <span className="relative block aspect-square overflow-hidden rounded-lg bg-sunken">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Instagram CDN URLs are signed and short-lived: not next/image material */}
                  <img src={it.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
                </span>
                <span className="flex min-h-11 items-start gap-2 py-1 text-sm leading-snug text-fg">
                  <input type="checkbox" checked={on} disabled={busy || (!on && full)} onChange={(e) => onToggle(it.id, e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
                  <span className="line-clamp-3 [overflow-wrap:anywhere]">{label}</span>
                </span>
              </label>
              {on && (
                <select aria-label={`${t("ig.target")}: ${label}`} value={picks[it.id]} disabled={busy} onChange={(e) => onTarget(it.id, e.target.value)} className={SELECT}>
                  <option value="gallery">{t("ig.target.gallery")}</option>
                  <option value="cover">{t("ig.target.cover")}</option>
                  <option value="logo">{t("ig.target.logo")}</option>
                  {dishes.length > 0 && (
                    <optgroup label={t("ig.target.dish")}>
                      {dishes.map((d) => <option key={d.ref} value={`item:${d.ref}`}>{d.label}</option>)}
                    </optgroup>
                  )}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The fields of the server's draft that the import changed, merged into the local draft (other local edits stay). */
export function importPatch(local: WizardDraft, server: WizardDraft, targets: IgTarget[]): Partial<WizardDraft> {
  const patch: Partial<WizardDraft> = {};
  if (targets.includes("cover")) patch.cover_media_id = server.cover_media_id;
  if (targets.includes("logo")) patch.logo_media_id = server.logo_media_id;
  if (targets.includes("gallery")) patch.gallery_media_ids = [...local.gallery_media_ids, ...server.gallery_media_ids.filter((m) => !local.gallery_media_ids.includes(m))];
  const refs = new Set(targets.flatMap((x) => (typeof x === "object" ? [x.item] : [])));
  if (refs.size) {
    const serverImage = new Map<string, string | null>(server.categories.flatMap((c) => c.items.map((it) => [`${c.key}/${it.key}`, it.image_media_id] as const)));
    patch.categories = local.categories.map((c) => ({ ...c, items: c.items.map((it) => { const ref = `${c.key}/${it.key}`; const img = serverImage.get(ref); return refs.has(ref) && img ? { ...it, image_media_id: img } : it; }) }));
  }
  return patch;
}

/** A status line in both languages, so it follows the language toggle. */
type Message = { tone: "soft" | "danger"; bg: string; en: string };
const msg = (tone: Message["tone"], key: WizardKey, vars?: Record<string, string | number>): Message => ({ tone, bg: wizardText("bg", key, vars), en: wizardText("en", key, vars) });
const IG_REASONS = ["state", "session", "token", "media"];

type Phase = { kind: "idle" } | { kind: "loading" } | { kind: "list"; items: IgItem[]; username?: string } | { kind: "expired" } | { kind: "empty" } | { kind: "failed" };

/**
 * "Import photos from Instagram": the entry button and hint; after the sign-in came back to this step (`?ig=1`), the grid.
 * `from` is the step it lives in; in the Look step a ticked photo goes to the cover by default.
 */
export function InstagramImport({ id, draft, update, addMedia, flush, igReturn, instagramAvailable, from }: Pick<StepProps, "id" | "draft" | "update" | "addMedia" | "flush" | "igReturn" | "instagramAvailable"> & { from: "photos" | "look" }) {
  const { t, lang } = useT();
  const here: IgReturn | null = igReturn && igReturn.step === from ? igReturn : null;
  const [phase, setPhase] = useState<Phase>(here?.status === "ok" ? { kind: "loading" } : { kind: "idle" });
  const [picks, setPicks] = useState<Record<string, TargetValue>>({});
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(() => {
    if (here?.status === "cancelled") return msg("soft", "ig.cancelled");
    if (here?.status === "error") return msg("danger", IG_REASONS.includes(here.reason ?? "") ? (`ig.error.${here.reason}` as WizardKey) : "ig.failed");
    return null;
  });

  useEffect(() => {
    if (!instagramAvailable || here?.status !== "ok") return;
    let live = true;
    void api.igList(id).then((r) => {
      if (!live) return;
      if (!r.ok) setPhase({ kind: "failed" });
      else if (r.data.expired) setPhase({ kind: "expired" });
      else if (!r.data.items.length) setPhase({ kind: "empty" });
      else setPhase({ kind: "list", items: r.data.items, ...(r.data.username ? { username: r.data.username } : {}) });
    });
    return () => { live = false; };
  }, [id, instagramAvailable, here?.status]);

  if (!instagramAvailable) return null;

  async function start() {
    setLeaving(true);
    await flush?.();
    window.location.assign(api.igStartUrl(id, from));
  }

  async function doImport() {
    const list = Object.entries(picks).map(([pid, v]) => ({ id: pid, target: toTarget(v) }));
    if (!list.length) return;
    setBusy(true);
    setMessage(msg("soft", "ig.importing"));
    await flush?.();
    const r = await api.igImport(id, list);
    setBusy(false);
    if (!r.ok) {
      if (r.error.code === "instagram_expired") { setPhase({ kind: "expired" }); setMessage(null); return; }
      setMessage(r.status === 400 || r.status === 429 || r.status === 502 ? { tone: "danger", bg: r.error.bg, en: r.error.en } : msg("danger", "ig.failed"));
      return;
    }
    for (const m of r.data.media) addMedia(m);
    update(importPatch(draft, r.data.draft, list.filter((p) => !r.data.failed.some((f) => f.id === p.id)).map((p) => p.target)));
    setPicks({});
    const failed = r.data.failed.length;
    const done = msg(failed ? "danger" : "soft", "ig.imported", { n: r.data.media.length });
    if (failed) {
      const more = msg("danger", "ig.someFailed", { n: failed });
      setMessage({ tone: "danger", bg: `${done.bg} ${more.bg}`, en: `${done.en} ${more.en}` });
    } else setMessage(done);
  }

  const count = Object.keys(picks).length;
  const signIn = (
    <Button variant={phase.kind === "list" ? "quiet" : "secondary"} disabled={leaving || busy} onClick={() => void start()}>
      {leaving ? t("ig.going") : phase.kind === "idle" ? t(from === "look" ? "ig.lookButton" : "ig.button") : t("ig.again")}
    </Button>
  );

  return (
    <div className="grid gap-3">
      {phase.kind === "list" ? (
        <>
          <InstagramGrid items={phase.items} username={phase.username} picks={picks} busy={busy} dishes={dishOptions(draft, lang)}
            onToggle={(pid, on) => setPicks((p) => { const next = { ...p }; if (on) next[pid] = from === "look" ? "cover" : "gallery"; else delete next[pid]; return next; })}
            onTarget={(pid, v) => setPicks((p) => ({ ...p, [pid]: v }))} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!count || busy} onClick={() => void doImport()}>{busy ? t("ig.importing") : t("ig.import", { n: count })}</Button>
            {signIn}
          </div>
        </>
      ) : (
        <>
          <div>{signIn}</div>
          {phase.kind === "idle" && <p className="max-w-[60ch] text-sm leading-snug text-fg-soft">{t("ig.hint")}</p>}
          {phase.kind === "expired" && <Note>{t("ig.expired")}</Note>}
          {phase.kind === "empty" && <Note>{t("ig.empty")}</Note>}
        </>
      )}
      <Status tone={phase.kind === "failed" ? "danger" : message?.tone ?? "soft"}>{phase.kind === "loading" ? t("ig.loading") : phase.kind === "failed" ? t("ig.error.media") : (message ? message[lang] : "")}</Status>
    </div>
  );
}
