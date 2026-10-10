import type { Metadata } from "next";
import { LangProvider } from "@/src/i18n";
import { WIZARD } from "@/src/i18n/wizard";
import { demoSiteState } from "@/src/wizard/demo-state";
import { TemplateChooser } from "./components/TemplateChooser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${WIZARD.bg["chooser.title"]} · ${WIZARD.en["chooser.title"]}`, robots: { index: false, follow: false } };

export default async function Page() {
  const demo = await demoSiteState();
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this is the request time the preview ticks from
  const now = Date.now();
  return (
    <LangProvider defaultLang="bg">
      <TemplateChooser demo={demo} now={now} />
    </LangProvider>
  );
}
