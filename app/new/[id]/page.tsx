import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { WIZARD } from "@/src/i18n/wizard";
import { getServerDeps } from "@/src/server/deps";
import { readDraftFromCookies } from "@/src/server/draft-cookie";
import { sha256Hex } from "@/src/server/hash";
import { emptyDraft } from "@/src/wizard/schema";
import { NoDraft } from "../components/NoDraft";
import { Wizard } from "../components/Wizard";

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
  if (venue.status === "live") redirect(`/new/${id}/done`);
  const draft = venue.wizard_draft ?? emptyDraft(venue.template);
  const site = await deps.store.getSite(venue.id);
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this is the request time the preview ticks from
  const now = Date.now();
  const aiAvailable = deps.anthropic !== null;
  return (
    <LangProvider defaultLang={draft.default_lang}>
      <Wizard id={id} initialDraft={draft} initialMedia={site.media} baseUrl={deps.config.publicBaseUrl} aiAvailable={aiAvailable} now={now} />
    </LangProvider>
  );
}
