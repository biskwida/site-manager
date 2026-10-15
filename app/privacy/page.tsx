// Public privacy policy (Meta App Review: Privacy Policy URL). BG by default, EN with ?lang=en.
import type { Metadata } from "next";
import { PrivacyPolicy } from "@/app/components/Legal";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { pageLang, privacyContactEmail } from "@/src/server/legal";

export const metadata: Metadata = { title: `${DICTS.bg["privacy.title"]} · ${DICTS.en["privacy.title"]} · Site Manager` };

export default async function Page(props: PageProps<"/privacy">) {
  const sp = await props.searchParams;
  return (
    <LangProvider defaultLang={pageLang(sp.lang)}>
      <PrivacyPolicy contactEmail={privacyContactEmail()} />
    </LangProvider>
  );
}
