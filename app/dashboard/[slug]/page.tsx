// app/dashboard/[slug]/page.tsx — the same dashboard as /admin/[slug], opened on the signed-in owner's account instead of a key.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { AdminPanel } from "@/app/admin/[slug]/components/AdminPanel";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { adminOverview } from "@/src/server/admin";
import { authorizeAdminAccess } from "@/src/server/admin-auth";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { socialAvailability } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${DICTS.bg["admin.title"]} · ${DICTS.en["admin.title"]}`, robots: { index: false, follow: false } };

export default async function Page(props: PageProps<"/dashboard/[slug]">) {
  const { slug } = await props.params;
  // Signed out: sign in, then come back here.
  if (!(await getSessionUser())) redirect(`/login?next=${encodeURIComponent(`/dashboard/${slug}`)}`);
  const deps = await getServerDeps((fn) => after(fn));
  // Signed in but not an owner of this slug: the same not-found page as for a slug that does not exist.
  const access = await authorizeAdminAccess(null, slug, { store: deps.store });
  if (!access) notFound();
  const overview = await adminOverview(deps.store, access.venue, new Date(), deps.config.publicBaseUrl, { hosted: deps.deployer === null, social: socialAvailability(deps.config, deps.destinationSecretKey) });
  return (
    <LangProvider defaultLang={access.venue.default_lang}>
      <AdminPanel slug={slug} initial={overview} />
    </LangProvider>
  );
}
