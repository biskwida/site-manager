// app/billing/[slug]/page.tsx — "Choose your plan", for the signed-in owner of this venue only. 404 while BILLING_ENABLED is off (the page does
// not exist then). Signed out: sign in and come back here. Signed in but not the owner (or no such venue): the same not-found page.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { AccountShell, otherLangHref } from "@/app/components/AccountShell";
import { PlanPicker } from "./PlanPicker";
import { addonMode, trialDaysLeft } from "@/src/billing/plans";
import { BILLING } from "@/src/i18n/billing";
import { authorizeAdminAccess } from "@/src/server/admin-auth";
import { getServerDeps } from "@/src/server/deps";
import { firstParam, readPageLang } from "@/src/server/request-lang";
import { getSessionUser } from "@/src/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Claudia", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page(props: PageProps<"/billing/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const deps = await getServerDeps((fn) => after(fn));
  if (!deps.config.billingEnabled) notFound();
  const lang = await readPageLang(sp.lang);
  const queryLang = firstParam(sp.lang);
  const required = firstParam(sp.required) === "1";
  const user = await getSessionUser();
  if (!user) {
    const q = new URLSearchParams();
    if (required) q.set("required", "1");
    if (queryLang === "bg" || queryLang === "en") q.set("lang", queryLang);
    redirect(`/login?next=${encodeURIComponent(`/billing/${slug}${q.size ? `?${q}` : ""}`)}`);
  }
  const access = await authorizeAdminAccess(null, slug, { store: deps.store, sessionUser: async () => user });
  if (!access) notFound();
  const { venue } = access;
  const now = new Date();
  const days = trialDaysLeft(venue, now);
  const startsOn = days > 0 && venue.trial_ends_at ? new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", { day: "numeric", month: "long", timeZone: venue.tz }).format(new Date(venue.trial_ends_at)) : null;
  const subscribed = venue.stripe_subscription_id !== null && (venue.billing_status === "trialing" || venue.billing_status === "active" || venue.billing_status === "past_due");
  return (
    <AccountShell lang={lang} wide otherLangHref={otherLangHref(`/billing/${encodeURIComponent(slug)}`, { required: required ? "1" : undefined }, lang)}>
      <PlanPicker
        lang={lang}
        slug={venue.slug}
        name={venue.name}
        trialDaysLeft={days}
        startsOn={startsOn}
        addon={addonMode(venue)}
        initialPlan={venue.plan ?? "both"}
        required={required}
        subscribed={subscribed}
        testMode={deps.config.stripeSecretKey?.startsWith("sk_test_") ?? false}
      />
      <p className="mt-8">
        <Link href={`/dashboard/${encodeURIComponent(venue.slug)}`} className="text-sm text-[var(--cl-ink-2)] underline underline-offset-4 hover:text-[var(--cl-ink)]">{BILLING[lang].back}</Link>
      </p>
    </AccountShell>
  );
}
