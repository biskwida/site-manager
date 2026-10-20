import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { startPath } from "@/src/auth/start-links";
import { LangProvider } from "@/src/i18n";
import { WIZARD } from "@/src/i18n/wizard";
import { getServerDeps } from "@/src/server/deps";
import { DRAFT_COOKIE, venueFromDraftCookie } from "@/src/server/draft-cookie";
import { readPageLang } from "@/src/server/request-lang";
import { getSessionUser } from "@/src/server/session";
import { isOpenDraft } from "@/src/server/wizard";
import { demoSiteState } from "@/src/wizard/demo-state";
import type { Resume } from "./components/ResumeDraft";
import { TemplateChooser } from "./components/TemplateChooser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${WIZARD.bg["chooser.title"]} · ${WIZARD.en["chooser.title"]}`, robots: { index: false, follow: false } };

export default async function Page({ searchParams }: PageProps<"/new">) {
  // With billing on, a new business needs an account (it owns the trial). Billing off: the open wizard, as before.
  const deps = await getServerDeps((fn) => after(fn));
  if (deps.config.billingEnabled && !(await getSessionUser())) redirect(startPath("/start", { lang: await readPageLang((await searchParams).lang) }));
  const demo = await demoSiteState();
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this is the request time the preview ticks from
  const now = Date.now();
  // Coming back to /new keeps the draft: the cookie this browser already holds is offered first (starting anew replaces it).
  const venue = await venueFromDraftCookie(deps.store, (await cookies()).get(DRAFT_COOKIE)?.value).catch(() => null);
  const resume: Resume | null = venue
    ? { id: venue.id, kind: isOpenDraft(venue) ? "draft" : "live", name: isOpenDraft(venue) ? (venue.wizard_draft?.name ?? "") : venue.name }
    : null;
  return (
    <LangProvider defaultLang="bg">
      <TemplateChooser demo={demo} now={now} resume={resume} />
    </LangProvider>
  );
}
