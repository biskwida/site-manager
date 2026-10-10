import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { Landing } from "./components/Landing";

export const metadata: Metadata = { title: DICTS.en["landing.title"] };

/** The public landing is built in Lovable; when its URL is set, `/` sends visitors there. Otherwise this page is the fallback. */
function lovableLandingUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_LANDING_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export default function Page() {
  const landing = lovableLandingUrl();
  if (landing) redirect(landing);
  return (
    <LangProvider defaultLang="en">
      <Landing demoSlug={process.env.DEMO_VENUE_SLUG?.trim() || "agala"} />
    </LangProvider>
  );
}
