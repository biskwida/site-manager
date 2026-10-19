import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadConfig } from "@/src/config";
import { DICTS } from "@/src/i18n/dicts";

export const metadata: Metadata = { title: DICTS.en["landing.title"] };

/** `/` sends visitors to the public landing (LANDING_URL, default https://getclaudia.app). Task 4 adds "signed in → /dashboard". */
export default function Page() {
  redirect(loadConfig(process.env, { lenient: true }).landingUrl);
}
