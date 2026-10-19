import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { WIZARD } from "@/src/i18n/wizard";
import { getServerDeps } from "@/src/server/deps";
import { readDraftFromCookies } from "@/src/server/draft-cookie";
import { sha256Hex } from "@/src/server/hash";
import { isOpenDraft } from "@/src/server/wizard";
import { enabledApps } from "@/src/server/connect-apps";
import { instagramConfigured } from "@/src/server/instagram";
import { emptyDraft } from "@/src/wizard/schema";
import { NoDraft } from "../components/NoDraft";
import type { IgReturn } from "../components/types";
import { Wizard } from "../components/Wizard";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** `?step=photos|look&ig=1|cancelled|error&reason=…`, as the Instagram callback redirects back. */
function readIgReturn(sp: Record<string, string | string[] | undefined>): IgReturn | null {
  const ig = one(sp.ig);
  const step = one(sp.step) === "look" ? "look" : "photos";
  if (ig === "1") return { status: "ok", step };
  if (ig === "cancelled") return { status: "cancelled", step };
  if (ig === "error") return { status: "error", step, reason: (one(sp.reason) ?? "").replace(/[^a-z]/g, "").slice(0, 20) };
  return null;
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${WIZARD.bg["chooser.title"]} · ${WIZARD.en["chooser.title"]}`, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page(props: PageProps<"/new/[id]">) {
  const { id } = await props.params;
  const deps = await getServerDeps((fn) => after(fn));
  const c = readDraftFromCookies(await cookies());
  const venue = c && c.id === id ? await deps.store.findVenueByDraftToken(sha256Hex(c.token)) : null;
  if (!venue || venue.id !== id) {
    return (
      <LangProvider defaultLang="bg"><NoDraft /></LangProvider>
    );
  }
  // A live venue with no open draft is finished; a live own-site/no-website venue whose owner started the website add-on carries a draft and stays here.
  if (!isOpenDraft(venue)) redirect(`/new/${id}/done`);
  const draft = venue.wizard_draft ?? emptyDraft(venue.template);
  const site = await deps.store.getSite(venue.id);
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this is the request time the preview ticks from
  const now = Date.now();
  const aiAvailable = deps.anthropic !== null;
  const instagramAvailable = instagramConfigured(deps.config);
  const igReturn = instagramAvailable ? readIgReturn(await props.searchParams) : null;
  return (
    <LangProvider defaultLang={draft.default_lang}>
      <Wizard id={id} initialDraft={draft} initialMedia={site.media} baseUrl={deps.config.publicBaseUrl} aiAvailable={aiAvailable} now={now} instagramAvailable={instagramAvailable} igReturn={igReturn} apps={enabledApps(deps.config)} slugLocked={venue.status === "live"} />
    </LangProvider>
  );
}
