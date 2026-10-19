import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadConfig } from "@/src/config";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { landingRedirect } from "@/src/server/host";
import { Landing } from "./components/Landing";

export const metadata: Metadata = { title: DICTS.en["landing.title"] };

/**
 * `/` sends visitors to the public landing (LANDING_URL, default https://getclaudia.app). When that is this very host, the
 * built-in fallback landing renders instead, so `/` never redirects to itself. Task 4 adds "signed in → /dashboard".
 */
export default async function Page() {
  const h = await headers();
  const target = landingRedirect(loadConfig(process.env, { lenient: true }).landingUrl, h.get("x-forwarded-host") ?? h.get("host"));
  if (target) redirect(target);
  return (
    <LangProvider defaultLang="en">
      <Landing demoSlug={process.env.DEMO_VENUE_SLUG?.trim() || "agala"} />
    </LangProvider>
  );
}
