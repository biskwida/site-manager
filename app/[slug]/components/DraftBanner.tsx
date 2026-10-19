"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import type { DraftInfo } from "@/src/domain/types";
import { adminApiUrl } from "@/app/admin/[slug]/components/useAdminOverview";
import { draftBackHref } from "./draft-links";

/** Sticky "not live" bar over a draft preview; Apply/Reject call the admin API, then show the live site. */
export function DraftBanner({ draft, slug }: { draft: DraftInfo; slug: string }) {
  const { lang, t } = useLang();
  const router = useRouter();
  const key = draft.key;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const summary = lang === "bg" ? draft.summary_bg : draft.summary_en;

  async function decide(action: "apply" | "reject") {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(adminApiUrl(slug, key), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, change_set_id: draft.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.replace(`/${slug}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  const pending = draft.status === "proposed";
  const statusText = draft.status === "applied" ? t("site.draftApplied") : t("site.draftStatus", { status: t(`admin.status.${draft.status}` as MessageKey) });
  return (
    <div role="region" aria-label={t("site.draft")} className="sticky top-0 z-30 bg-ink text-paper shadow-md">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="min-w-0 text-sm">
          <span className="mr-2 inline-block rounded-full bg-amber-soft px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber">{t("site.draft")}</span>
          <span className="break-words">{pending ? summary : `${summary} · ${statusText}`}</span>
          {failed && <span role="alert" className="mt-1 block text-amber-soft">{t("site.draftFailed")}</span>}
        </p>
        {pending ? (
          <div className="flex shrink-0 gap-2">
            <button type="button" disabled={busy} onClick={() => void decide("apply")} className="min-h-10 rounded-full bg-paper px-4 text-sm font-semibold text-ink transition hover:bg-white disabled:opacity-60">
              {busy ? t("site.draftBusy") : t("site.draftApply")}
            </button>
            <button type="button" disabled={busy} onClick={() => void decide("reject")} className="min-h-10 rounded-full px-4 text-sm font-semibold text-paper ring-1 ring-paper/40 transition hover:bg-paper/10 disabled:opacity-60">
              {t("site.draftReject")}
            </button>
          </div>
        ) : (
          <Link href={draftBackHref(slug, key)} className="shrink-0 text-sm font-semibold underline underline-offset-4">{t("site.draftBack")}</Link>
        )}
      </div>
    </div>
  );
}
