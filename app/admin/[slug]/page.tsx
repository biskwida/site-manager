import type { Metadata } from "next";
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { adminOverview } from "@/src/server/admin";
import { authorizeAdminAccess } from "@/src/server/admin-auth";
import { getServerDeps } from "@/src/server/deps";
import { socialAvailability } from "@/src/server/social-connect";
import { AdminPanel } from "./components/AdminPanel";
import { InvalidKey } from "./components/InvalidKey";

export const dynamic = "force-dynamic";

// The key sits in this page's URL: keep the page out of search engines and never send it on in a Referer header.
export const metadata: Metadata = {
  title: `${DICTS.bg["admin.title"]} · ${DICTS.en["admin.title"]}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page(props: PageProps<"/admin/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const key = (Array.isArray(sp.key) ? sp.key[0] : sp.key) ?? "";
  const deps = await getServerDeps((fn) => after(fn));
  // This page is the legacy key link: only a key for this slug opens it (no key, or a wrong one, is never helped by a session).
  const access = key ? await authorizeAdminAccess(key, slug, { store: deps.store }) : null;
  const venue = access?.venue;
  if (!venue) {
    return (
      <LangProvider defaultLang="bg"><InvalidKey /></LangProvider>
    );
  }
  const overview = await adminOverview(deps.store, venue, new Date(), deps.config.publicBaseUrl, { hosted: deps.deployer === null, social: socialAvailability(deps.config, deps.destinationSecretKey) });
  // Until an owner account is linked, offer "log in with your email next time".
  const hasAccount = await deps.store.hasOwnerAccount(venue.id);
  return (
    <LangProvider defaultLang={venue.default_lang}>
      <AdminPanel slug={slug} adminKey={key} initial={overview} showAccountBanner={!hasAccount} />
    </LangProvider>
  );
}
