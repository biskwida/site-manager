"use client";
// app/billing/[slug]/PlanPicker.tsx — "Choose your plan": three plans, the 199 € "Build me a website" add-on (greyed out with Social media) and
// the summary, then on to Stripe Checkout. Subscribers get "Manage billing" (the Customer Portal) instead.
import { useState } from "react";
import { btnGhost, btnPrimary, cardCls, eyebrowCls, pillCls } from "@/app/components/account-ui";
import type { PageLang } from "@/src/auth/page-lang";
import { PLAN_PRICE_EUR, WEBSITE_SETUP_EUR, planHasWebsite, type AddonMode } from "@/src/billing/plans";
import { PLAN_IDS, type Plan } from "@/src/domain/types";
import { BILLING, formatEuro, type BillingKey } from "@/src/i18n/billing";
import { fill } from "@/src/i18n/onboarding";

export interface PlanPickerProps {
  lang: PageLang;
  slug: string;
  name: string;
  /** Whole days of free trial left; 0 when it ended. */
  trialDaysLeft: number;
  /** The day the plan starts charging, already written for the reader ("2 November"); null when the trial is over. */
  startsOn: string | null;
  addon: AddonMode;
  initialPlan: Plan;
  /** For an optional add-on: start with the box ticked (a deep link, and tests). */
  initialTicked?: boolean;
  /** TRIAL_REQUIRES_CARD: the owner was sent here before the checklist. */
  required: boolean;
  /** A Stripe subscription exists that is not canceled (live, paused or unpaid): change it, add a card or resume it in the Customer Portal. */
  subscribed: boolean;
  /** A live Admin or Both subscriber with no Claudia site and an unpaid fee: "Add a website — €199 once" (a one-off Checkout). */
  canBuyWebsite?: boolean;
  /** A Social media subscriber with no Claudia site: a website comes with Admin or Both. */
  socialWebsiteNote?: boolean;
  /** The Stripe key is a test key. */
  testMode: boolean;
  fetcher?: typeof fetch;
  /** Where the browser goes after Stripe answers; tests inject one. */
  go?: (url: string) => void;
}

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);
const defaultGo = (url: string) => window.location.assign(url);

export function PlanPicker(p: PlanPickerProps) {
  const { lang } = p;
  const t = BILLING[lang];
  const f = p.fetcher ?? defaultFetch;
  const go = p.go ?? defaultGo;
  const [plan, setPlan] = useState<Plan>(p.addon === "locked" && p.initialPlan === "social" ? "both" : p.initialPlan);
  const [ticked, setTicked] = useState(p.initialTicked ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const websiteOk = planHasWebsite(plan);
  const addonOn = p.addon === "locked" || (p.addon === "optional" && ticked && websiteOk);
  const todayAmount = (addonOn ? WEBSITE_SETUP_EUR : 0) + (p.trialDaysLeft > 0 ? 0 : PLAN_PRICE_EUR[plan]);
  const eyebrow =
    p.trialDaysLeft === 1 ? fill(t["plan.eyebrowTrialOne"], { name: p.name }) : p.trialDaysLeft > 1 ? fill(t["plan.eyebrowTrial"], { name: p.name, days: p.trialDaysLeft }) : fill(t["plan.eyebrowPlain"], { name: p.name });

  async function send(path: "checkout" | "portal" | "website") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = path === "checkout" ? { slug: p.slug, plan, website: p.addon === "optional" && addonOn, lang } : path === "website" ? { slug: p.slug, kind: "website_setup", lang } : { slug: p.slug, lang };
      const res = await f(`/api/billing/${path === "website" ? "checkout" : path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: { bg?: string; en?: string } } | null;
      if (res.ok && data?.url) {
        go(data.url);
        return; // the page is leaving; keep the button busy
      }
      setError(data?.error?.[lang] ?? t["error.generic"]);
    } catch {
      setError(t["error.generic"]);
    }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl">
      <span className={eyebrowCls}>{eyebrow}</span>
      <h1 className="mt-1.5 font-display text-4xl leading-tight">{t["plan.title"]}</h1>
      {p.required ? (
        <p role="note" className="mt-3 rounded-2xl bg-[var(--cl-accent-soft)] px-4 py-3 text-[var(--cl-ink)]">
          {addonOn ? fill(t["plan.requiredSetup"], { price: formatEuro(lang, WEBSITE_SETUP_EUR) }) : t["plan.required"]}
        </p>
      ) : null}

      {p.subscribed ? (
        <div className={`${cardCls} mt-6 grid gap-3`}>
          <p>{t.already}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void send("portal")} disabled={busy} className={btnPrimary}>{busy ? t["cta.busy"] : t["cta.manage"]}</button>
            {p.canBuyWebsite ? <button type="button" onClick={() => void send("website")} disabled={busy} className={btnGhost}>{fill(t["addon.add"], { price: formatEuro(lang, WEBSITE_SETUP_EUR) })}</button> : null}
          </div>
          {p.socialWebsiteNote ? <p className="text-sm text-[var(--cl-ink-2)]">{t["addon.socialNote"]}</p> : null}
          {error ? <p role="alert" className="text-sm text-[var(--cl-error)]">{error}</p> : null}
        </div>
      ) : (
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void send("checkout");
          }}
        >
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="sr-only">{t["plan.legend"]}</legend>
            {PLAN_IDS.map((id) => {
              const disabled = p.addon === "locked" && !planHasWebsite(id);
              return (
                <label key={id} className={`${cardCls} relative grid cursor-pointer content-start gap-1 has-[:checked]:border-[var(--cl-accent)] has-[:checked]:shadow-[inset_0_0_0_1px_var(--cl-accent)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55`}>
                  <input type="radio" name="plan" value={id} checked={plan === id} disabled={disabled} onChange={() => setPlan(id)} className="absolute right-4 top-4 size-5 accent-[var(--cl-accent)]" />
                  <strong className="pr-8 text-lg">{t[`plan.${id}.name` as BillingKey]}</strong>
                  <span>
                    <span className="font-display text-3xl">{formatEuro(lang, PLAN_PRICE_EUR[id])}</span>
                    <span className="text-sm text-[var(--cl-ink-2)]">{t["price.month"]}</span>
                  </span>
                  <span className="text-sm text-[var(--cl-ink-2)]">{t[`plan.${id}.note` as BillingKey]}</span>
                </label>
              );
            })}
          </fieldset>

          {p.addon === "locked" || p.addon === "optional" ? (
            <label className={`${cardCls} mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-3 ${p.addon === "locked" ? "" : "cursor-pointer"} ${!websiteOk ? "opacity-55" : ""}`} aria-disabled={!websiteOk || undefined}>
              <input type="checkbox" checked={addonOn} disabled={p.addon === "locked" || !websiteOk} onChange={(e) => setTicked(e.target.checked)} className="size-5 accent-[var(--cl-accent)]" />
              <span>
                <strong>{t["addon.title"]}</strong>
                <br />
                <span className="text-sm text-[var(--cl-ink-2)]">{t["addon.text"]}</span>
                {p.addon === "locked" ? <><br /><span className="text-sm text-[var(--cl-ink-2)]">{t["addon.locked"]}</span></> : null}
                {!websiteOk ? <><br /><span role="status" className="text-sm text-[var(--cl-ink-2)]">{t["addon.warn"]}</span></> : null}
              </span>
              <span>
                <span className="font-display text-2xl">{formatEuro(lang, WEBSITE_SETUP_EUR)}</span>
                <small className="font-sans text-sm text-[var(--cl-ink-2)]">{t["price.once"]}</small>
              </span>
            </label>
          ) : p.addon === "paid" ? (
            <p className="mt-3 text-sm text-[var(--cl-ink-2)]">{t["addon.paid"]}</p>
          ) : null}

          <section aria-labelledby="summary-title" aria-live="polite" className={`${cardCls} mt-4 grid max-w-xl gap-2`}>
            <h2 id="summary-title" className="sr-only">{t["sum.title"]}</h2>
            <div className="flex justify-between gap-3 tabular-nums">
              <span>{fill(t["sum.plan"], { plan: t[`plan.${plan}.name` as BillingKey] })}</span>
              <span>{formatEuro(lang, PLAN_PRICE_EUR[plan])}</span>
            </div>
            {p.addon === "locked" || p.addon === "optional" ? (
              <div className="flex justify-between gap-3 tabular-nums">
                <span>{t["sum.setup"]}</span>
                <span>{fill(t[addonOn ? "sum.setupOnce" : "sum.setupNone"], { price: formatEuro(lang, addonOn ? WEBSITE_SETUP_EUR : 0) })}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 border-t border-[var(--cl-line)] pt-2 font-extrabold tabular-nums">
              <span>{t["sum.today"]}</span>
              <span>{formatEuro(lang, todayAmount)} {t["sum.vat"]}</span>
            </div>
            <p className="text-sm text-[var(--cl-ink-2)]">{p.startsOn ? fill(t["sum.startsOn"], { date: p.startsOn, price: formatEuro(lang, PLAN_PRICE_EUR[plan]) }) : t["sum.startsNow"]}</p>
            {p.trialDaysLeft > 0 ? <p className="text-sm text-[var(--cl-ink-2)]">{t["sum.fullNow"]}</p> : null}
            {addonOn ? <p className="text-sm text-[var(--cl-ink-2)]">{t["sum.siteNext"]}</p> : null}
            {error ? <p role="alert" className="text-sm text-[var(--cl-error)]">{error}</p> : null}
            <div className="mt-1">
              <button type="submit" disabled={busy} className={btnPrimary}>{busy ? t["cta.busy"] : t.cta}</button>
            </div>
            <p className="text-sm text-[var(--cl-ink-2)]">
              {t["stripe.note"]}
              {p.testMode ? <> · <span className={pillCls}>{t["stripe.test"]}</span></> : null}
            </p>
          </section>
        </form>
      )}
    </div>
  );
}
