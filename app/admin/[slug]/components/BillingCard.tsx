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
  const [busy, setBusy] = useState<"portal" | "website" | "buy" | null>(null);
  const [failed, setFailed] = useState<string | true | false>(false);
  const f = fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function open(kind: "portal" | "website" | "buy") {
    if (busy) return;
    setBusy(kind);
    setFailed(false);
    let reason: string | true = true;
    try {
      const res =
        kind === "portal"
          ? await f("/api/billing/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, lang }) })
          : kind === "buy"
            ? await f("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, kind: "website_setup", lang }) })
            : await f(`/api/onboarding/${encodeURIComponent(slug)}/website`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: { bg?: string; en?: string } } | null;
      if (res.ok && data?.url) {
        go(data.url);
        return; // leaving the page; keep the button busy
      }
      // The server's own line (for example a 409 "there is nothing to manage yet") says more than a generic error.
      const line = data?.error?.[lang];
      if (res.status === 409 && line) reason = line;
    } catch {
      // fall through to the error line
    }
    setFailed(reason);
    setBusy(null);
  }

  const days = b.trial_days_left;
  let status: string;
  if (b.status === "trialing" && !b.subscribed) status = days === null || days <= 0 ? t("admin.billing.trialEnded") : days === 1 ? t("admin.billing.trialOne") : t("admin.billing.trial", { n: String(days) });
  else if (b.status === "past_due") status = t("admin.billing.pastDue");
  else if (b.status === "paused") status = b.subscribed ? t("admin.billing.pausedCard") : t("admin.billing.paused");
  else if (b.status === "canceled") status = t("admin.billing.canceled");
  else if (b.status === "active" || b.status === "trialing") status = b.subscribed ? t("admin.billing.active") : t("admin.billing.included"); // active with no subscription: a venue billing never touched (grandfathered)
  else status = t("admin.billing.noPlan");

  // A subscription that is not canceled is changed, resumed or given a card in the Customer Portal; a new plan is chosen only without one.
  const choose = !b.subscribed;
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
        {b.website_note ? <p className="mt-3 text-sm text-ink-soft">{t("admin.billing.websiteNote")}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {b.can_build_website ? (
            <button type="button" onClick={() => void open("website")} disabled={busy !== null} className={`${btn} bg-accent text-white`}>{busy === "website" ? t("admin.billing.opening") : t("admin.billing.build")}</button>
          ) : null}
          {b.can_buy_website ? (
            <button type="button" onClick={() => void open("buy")} disabled={busy !== null} className={btn}>{busy === "buy" ? t("admin.billing.opening") : t("admin.billing.addWebsite")}</button>
          ) : null}
          {choose ? (
            <Link href={`/billing/${encodeURIComponent(slug)}?lang=${lang}`} className={btn}>{t("admin.billing.choose")}</Link>
          ) : null}
          {b.has_customer ? (
            <button type="button" onClick={() => void open("portal")} disabled={busy !== null} className={btn}>{busy === "portal" ? t("admin.billing.opening") : t("admin.billing.manage")}</button>
          ) : null}
        </div>
        {failed ? <p role="alert" className="mt-2 text-sm text-clay">{failed === true ? t("admin.billing.error") : failed}</p> : null}
      </div>
    </Section>
  );
}
