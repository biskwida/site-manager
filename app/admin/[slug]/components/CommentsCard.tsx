"use client";
// The dashboard's "Comments" card (comment replies, 2026-10-15): owner's key only, like the whole dashboard.
import { useState } from "react";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import type { CommentsOverview, CommentView } from "@/src/server/admin-comments";
import { NETWORK_NAMES, type CommentMode } from "@/src/domain/types";
import { formatDateTime } from "@/src/time";
import { Chip, Section } from "./bits";
import type { Post } from "./useAdminOverview";

const MODES: CommentMode[] = ["each", "digest", "off"];
const TONE: Record<CommentView["status"], "plain" | "good" | "warn"> = { new: "warn", proposed: "warn", replied: "good", ignored: "plain", expired: "plain", hidden: "plain", deleted: "plain", own: "plain", nested: "plain" };

/** Customers' comments under the bot's posts: pending ones with an editable draft (Reply / Ignore), the last answered, the notification mode. */
export function CommentsCard({ overview, post, tz }: { overview: CommentsOverview | null; post: Post; tz: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!overview) return null;
  const o = overview;

  async function run(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setFailed(null);
    const r = await post(body);
    if (!r.ok) setFailed(key);
    setBusy(null);
  }
  const draftOf = (c: CommentView) => drafts[c.id] ?? c.draft_text ?? "";
  const statusKey = (s: CommentView["status"]) => `admin.comments.status.${s}` as MessageKey;

  const row = (c: CommentView, pending: boolean) => (
    <li key={c.id} className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 [overflow-wrap:anywhere] font-semibold">{c.author_name || "—"} · {NETWORK_NAMES[c.network]}</span>
        <span className="flex items-center gap-2 text-sm text-ink-soft">
          <span suppressHydrationWarning>{formatDateTime(c.created_at, lang, tz)}</span>
          <Chip tone={TONE[c.status]}>{t(statusKey(c.status))}</Chip>
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-ink">{c.text}</p>
      {(c.post_caption || c.post_permalink) && (
        <p className="mt-1 text-sm text-ink-soft">
          {c.post_caption && <span className="[overflow-wrap:anywhere]">„{c.post_caption}“ </span>}
          {c.post_permalink && (
            <a href={c.post_permalink} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-2 hover:text-accent">
              {t("admin.comments.openPost")}<span className="sr-only"> {t("admin.newTab")}</span>
            </a>
          )}
        </p>
      )}
      {pending ? (
        <div className="mt-3">
          {(c.draft_kind === "spam" || c.draft_kind === "abuse") && <p className="mb-2 text-sm font-semibold text-amber">{t("admin.comments.spam")}</p>}
          <textarea value={draftOf(c)} onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })} rows={2} maxLength={500} placeholder={t("admin.comments.replyPlaceholder")} aria-label={t("admin.comments.reply")}
            className="w-full rounded-2xl bg-paper-deep px-4 py-3 text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-2 focus:ring-accent" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy !== null || draftOf(c).trim() === ""} aria-busy={busy === `reply:${c.id}`} onClick={() => void run(`reply:${c.id}`, { action: "reply_comment", comment_id: c.id, reply_text: draftOf(c).trim() })}
              className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60">
              {busy === `reply:${c.id}` ? t("admin.busy") : t("admin.comments.reply")}
            </button>
            <button type="button" disabled={busy !== null} aria-busy={busy === `ignore:${c.id}`} onClick={() => void run(`ignore:${c.id}`, { action: "ignore_comment", comment_id: c.id })}
              className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5 disabled:opacity-60">
              {busy === `ignore:${c.id}` ? t("admin.busy") : t("admin.comments.ignore")}
            </button>
          </div>
          {(failed === `reply:${c.id}` || failed === `ignore:${c.id}`) && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{t("admin.failed")}</p>}
        </div>
      ) : (
        c.reply_text && <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-ink">→ {c.reply_text}</p>
      )}
    </li>
  );

  return (
    <Section id="comments" title={t("admin.comments.title")}>
      <div className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
        <p className="max-w-prose text-ink-soft">{t("admin.comments.intro")}</p>
        {(["facebook", "instagram"] as const).filter((k) => o.needs_reconnect[k]).map((k) => (
          <p key={k} role="status" className="mt-3 rounded-2xl bg-amber-soft px-4 py-3 text-sm font-semibold text-ink">{t("admin.comments.reconnect", { network: NETWORK_NAMES[k] })}</p>
        ))}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.comments.modeLabel")}</span>
          {MODES.map((m) => (
            <button key={m} type="button" disabled={busy !== null} aria-pressed={o.mode === m} onClick={() => void run(`mode:${m}`, { action: "set_comment_mode", mode: m, digest_hour: o.digest_hour })}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold transition disabled:opacity-60 ${o.mode === m ? "bg-accent text-white" : "text-ink ring-1 ring-ink/25 hover:bg-ink/5"}`}>
              {t(`admin.comments.mode.${m}` as MessageKey)}
            </button>
          ))}
          {o.mode === "digest" && (
            <label className="text-sm text-ink-soft">
              {t("admin.comments.digestHour", { hour: String(o.digest_hour).padStart(2, "0") })}
              <select value={o.digest_hour} disabled={busy !== null} aria-label={t("admin.comments.digestHour", { hour: String(o.digest_hour).padStart(2, "0") })} onChange={(e) => void run("mode:hour", { action: "set_comment_mode", mode: "digest", digest_hour: Number(e.target.value) })} className="ml-2 rounded-full bg-paper-deep px-3 py-2 ring-1 ring-ink/10">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </label>
          )}
          {o.limit.limit !== null && <span className="ml-auto text-sm text-ink-soft">{t("admin.comments.limit", { used: String(o.limit.used), limit: String(o.limit.limit) })}</span>}
        </div>
        {failed?.startsWith("mode:") && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{t("admin.failed")}</p>}

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.comments.pending")}</h3>
        {o.pending.length === 0 ? <p className="mt-2 text-sm text-ink-soft">{t("admin.comments.nonePending")}</p> : <ul className="mt-2 divide-y divide-ink/10">{o.pending.map((c) => row(c, true))}</ul>}
        <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.comments.answered")}</h3>
        {o.answered.length === 0 ? <p className="mt-2 text-sm text-ink-soft">{t("admin.comments.noneAnswered")}</p> : <ul className="mt-2 divide-y divide-ink/10">{o.answered.map((c) => row(c, false))}</ul>}
      </div>
    </Section>
  );
}
