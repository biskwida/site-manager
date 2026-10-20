// Public privacy policy (Meta App Review: Privacy Policy URL). BG by default, EN with ?lang=en.
import type { Metadata } from "next";
import { PrivacyPolicy } from "@/app/components/Legal";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { resolveAppHost } from "@/src/server/host";
import { pageLang, privacyContactEmail } from "@/src/server/legal";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${resolveAppHost(process.env)}`),
  title: `${DICTS.bg["privacy.title"]} · ${DICTS.en["privacy.title"]} · Claudia`,
  description: "How Claudia stores and uses data, and how to delete it. Как Клаудия съхранява и използва данни и как да ги изтриете.",
  alternates: { canonical: "/privacy" },
};

export default async function Page(props: PageProps<"/privacy">) {
  const sp = await props.searchParams;
  return (
    <LangProvider defaultLang={pageLang(sp.lang)}>
      <PrivacyPolicy contactEmail={privacyContactEmail()} />
    </LangProvider>
  );
}
