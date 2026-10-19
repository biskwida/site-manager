"use client";
import Link from "next/link";
import { useState } from "react";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import type { BillingOverview } from "@/src/server/admin";
import { Chip, Section } from "./bits";

const defaultGo = (url: string) => window.location.assign(url);

/**
 * "Plan and payment" (account dashboard only, and only while billing is on): the trial days left or the plan, a link to choose a plan,
 * "Manage billing" (the Stripe Customer Portal) and, once the website add-on is paid, "Build your website" (the wizard on this venue).
 * `justPaid` is the ?billing=success return from Checkout; `go` and `fetcher` are for tests.
 */
export function BillingCard({ billing: b, slug, justPaid = false, go = defaultGo, fetcher }: { billing: BillingOverview; slug: string; justPaid?: boolean; go?: (url: string) => void; fetcher?: typeof fetch }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState<"portal" | "website" | null>(null);
  const [failed, setFailed] = useState(false);
  const f = fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function open(kind: "portal" | "website") {
    if (busy) return;
    setBusy(kind);
    setFailed(false);
    try {
      const res =
        kind === "portal"
          ? await f("/api/billing/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, lang }) })
          : await f(`/api/onboarding/${encodeURIComponent(slug)}/website`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (res.ok && data?.url) {
        go(data.url);
        return; // leaving the page; keep the button busy
      }
    } catch {
      // fall through to the error line
    }
    setFailed(true);
    setBusy(null);
  }

  const days = b.trial_days_left;
  let status: string;
  if (b.status === "trialing" && !b.subscribed) status = days === null || days <= 0 ? t("admin.billing.trialEnded") : days === 1 ? t("admin.billing.trialOne") : t("admin.billing.trial", { n: String(days) });
  else if (b.status === "past_due") status = t("admin.billing.pastDue");
  else if (b.status === "paused") status = t("admin.billing.paused");
  else if (b.status === "canceled") status = t("admin.billing.canceled");
  else if (b.status === "active" || b.status === "trialing") status = t("admin.billing.active");
  else status = t("admin.billing.noPlan");

  const choose = !b.subscribed || b.status === "paused" || b.status === "canceled";
  const btn = "inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-ink/15 hover:bg-paper-deep disabled:opacity-60";
  return (
    <Section id="billing" title={t("admin.billing.title")}>
      <div className="rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
        {justPaid ? <p role="status" className="mb-3 rounded-2xl bg-accent-soft px-3 py-2 text-sm">{t("admin.billing.success")}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {b.plan ? <Chip tone="good">{t("admin.billing.plan", { plan: t(`admin.billing.plan.${b.plan}` as MessageKey) })}</Chip> : null}
          <p>{status}</p>
        </div>
        {b.can_build_website ? <p className="mt-3 text-sm text-ink-soft">{t("admin.billing.buildHint")}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {b.can_build_website ? (
            <button type="button" onClick={() => void open("website")} disabled={busy !== null} className={`${btn} bg-accent text-white`}>{busy === "website" ? t("admin.billing.opening") : t("admin.billing.build")}</button>
          ) : null}
          {choose ? (
            <Link href={`/billing/${encodeURIComponent(slug)}?lang=${lang}`} className={btn}>{t("admin.billing.choose")}</Link>
          ) : null}
          <button type="button" onClick={() => void open("portal")} disabled={busy !== null} className={btn}>{busy === "portal" ? t("admin.billing.opening") : t("admin.billing.manage")}</button>
        </div>
        {failed ? <p role="alert" className="mt-2 text-sm text-clay">{t("admin.billing.error")}</p> : null}
      </div>
    </Section>
  );
}
