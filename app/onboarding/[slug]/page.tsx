// app/onboarding/[slug]/page.tsx — the checklist after sign-up, for the signed-in owner of this venue only. Signed out: sign in and come
// back here. Signed in but not the owner (or no such venue): the same not-found page.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { AccountShell, otherLangHref } from "@/app/components/AccountShell";
import { Checklist } from "./Checklist";
import { LangProvider } from "@/src/i18n";
import { authorizeAdminAccess } from "@/src/server/admin-auth";
import { connectLinks } from "@/src/server/connect-apps";
import { getServerDeps } from "@/src/server/deps";
import { onboardingStatus } from "@/src/server/onboarding";
import { firstParam, readPageLang } from "@/src/server/request-lang";
import { getSessionUser } from "@/src/server/session";
import { socialAvailability } from "@/src/server/social-connect";
import { doneInviteCode } from "@/src/server/wizard";

const SOCIAL_RESULTS = ["facebook_connected", "facebook_no_pages", "facebook_error", "instagram_connected", "instagram_personal", "instagram_error"];

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Claudia", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page(props: PageProps<"/onboarding/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const lang = await readPageLang(sp.lang);
  const queryLang = firstParam(sp.lang);
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/onboarding/${slug}${queryLang === "bg" || queryLang === "en" ? `?lang=${queryLang}` : ""}`)}`);
  const deps = await getServerDeps((fn) => after(fn));
  const access = await authorizeAdminAccess(null, slug, { store: deps.store, sessionUser: async () => user });
  if (!access) notFound();
  const { venue } = access;
  const status = await onboardingStatus(deps.store, venue, { billing: deps.config.billingEnabled });
  // The owner code is shown until a chat is connected; it is the newest open one, a new one only when none is open.
  const code = status.chat ? null : await doneInviteCode(deps.store, venue.id, null, new Date());
  const base = deps.config.publicBaseUrl;
  return (
    <AccountShell lang={lang} wide otherLangHref={otherLangHref(`/onboarding/${encodeURIComponent(slug)}`, {}, lang)}>
      <LangProvider defaultLang={lang}>
        <Checklist
          lang={lang}
          slug={venue.slug}
          name={venue.name}
          siteUrl={venue.site_url}
          mode={venue.site_mode}
          platform={venue.site_platform}
          initial={status}
          code={code}
          links={code ? connectLinks(deps.config, code) : []}
          social={socialAvailability(deps.config, deps.destinationSecretKey)}
          menuUrl={`${base.replace(/^https?:\/\//, "")}/${venue.slug}/menu`}
          menuHref={`${base}/${venue.slug}/menu`}
          socialResult={SOCIAL_RESULTS.includes(firstParam(sp.social_result) ?? "") ? (firstParam(sp.social_result) ?? null) : null}
          pluginHref="/wp/site-manager.zip"
          appUrl={base}
        />
      </LangProvider>
    </AccountShell>
  );
}
