// app/new/[id]/done/page.tsx: the hand-off after publish. Proof of ownership is the wizard cookie alone; ?code= and ?key=
// (from the publish redirect) only save a round trip. The slug comes from the venue, never from the (now empty) draft.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { connectedApps, connectLinks, enabledApps } from "@/src/server/connect-apps";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { socialAvailability } from "@/src/server/social-connect";
import { afterSignupPath } from "@/src/server/onboarding";
import { DRAFT_COOKIE, venueFromDraftCookie } from "@/src/server/draft-cookie";
import { claimVenueForSession, doneInviteCode, DRAFT_ACCOUNT_COOKIE } from "@/src/server/wizard";
import { DoneStatus, type DoneStatusResponse } from "./DoneStatus";

export const dynamic = "force-dynamic";

// The admin key and the invite code sit in this page's URL: no indexing, no Referer. next.config.ts already keeps ?key= out of the request log.
export const metadata: Metadata = {
  title: `${DICTS.bg["done.title"]} · ${DICTS.en["done.title"]}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function Page(props: PageProps<"/new/[id]/done">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const deps = await getServerDeps((fn) => after(fn));
  const jar = await cookies();
  const venue = await venueFromDraftCookie(deps.store, jar.get(DRAFT_COOKIE)?.value, id);
  if (!venue) notFound();
  if (venue.status !== "live" || venue.wizard_draft) redirect(`/new/${encodeURIComponent(id)}`);
  // The publish redirect carries the fresh invite code; a reload without it shows the newest open one (a new one only when
  // none is open). No code once the owner pressed Start.
  const code = await doneInviteCode(deps.store, venue.id, one(sp.code), new Date());
  const joined = code === null;
  const adminKey = one(sp.key) || (await deps.store.getAdminToken(venue.id));
  const hosted = deps.deployer === null;
  const deploy = hosted ? null : venue.deploy;
  const initial: DoneStatusResponse = {
    status: venue.status,
    deploy,
    site_url: deploy?.status === "ready" ? deploy.url : hosted ? `${deps.config.publicBaseUrl}/${venue.slug}` : null,
    owner_joined: joined,
    hosted,
    connected_apps: connectedApps(await deps.store.listMembers(venue.id)),
  };
  // This draft was started signed in (the second cookie, bound to this venue id). If the publish found no session, the venue has no owner
  // account yet: signed out, offer "Log in to save this business"; back here signed in, link it. The link needs the draft cookie (this page
  // is not reachable without it), that hint and a session, and claimVenueForSession refuses a venue that already has an owner account.
  const user = await getSessionUser();
  const startedSignedIn = jar.get(DRAFT_ACCOUNT_COOKIE)?.value === venue.id;
  if (user && startedSignedIn) await claimVenueForSession(deps.store, venue, user).catch((e) => console.error(`[done] claiming the venue failed: ${e instanceof Error ? e.message : "error"}`));
  // The "Continue setup" link only for the signed-in account that owns this venue (the checklist is owner-only).
  const onboardingHref = user && (await deps.store.isVenueOwner(venue.id, user.id)) ? afterSignupPath(venue.slug, venue.stripe_subscription_id ? {} : deps.config) : undefined; // with TRIAL_REQUIRES_CARD the plan page comes first (not for a venue that already subscribes)
  const loginHref = !user && startedSignedIn && !(await deps.store.hasOwnerAccount(venue.id)) ? `/login?next=${encodeURIComponent(`/new/${id}/done`)}` : undefined;
  return (
    <LangProvider defaultLang={venue.default_lang}>
      <DoneStatus id={id} slug={venue.slug} code={code} links={code ? connectLinks(deps.config, code) : []} apps={enabledApps(deps.config)} adminKey={adminKey} baseUrl={deps.config.publicBaseUrl} initial={initial} onboardingHref={onboardingHref} loginHref={loginHref} social={Object.values(socialAvailability(deps.config, deps.destinationSecretKey)).some(Boolean)} />
    </LangProvider>
  );
}
