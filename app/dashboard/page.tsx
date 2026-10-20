// app/dashboard/page.tsx — the signed-in owner's businesses. Signed out: to /login, back here afterwards.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { VenueList } from "./VenueList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Claudia", robots: { index: false, follow: false } };

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/dashboard")}`);
  const deps = await getServerDeps((fn) => after(fn));
  const venues = await deps.store.listVenuesForUser(user.id);
  return (
    <LangProvider defaultLang="bg">
      <VenueList venues={venues.map((v) => ({ slug: v.slug, name: v.name, site_mode: v.site_mode }))} />
    </LangProvider>
  );
}
