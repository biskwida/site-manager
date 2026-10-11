import type { Metadata } from "next";
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { adminOverview } from "@/src/server/admin";
import { getServerDeps } from "@/src/server/deps";
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
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) {
    return (
      <LangProvider defaultLang="bg"><InvalidKey /></LangProvider>
    );
  }
  const overview = await adminOverview(deps.store, venue, new Date(), deps.config.publicBaseUrl, { hosted: deps.deployer === null });
  return (
    <LangProvider defaultLang={venue.default_lang}>
      <AdminPanel slug={slug} adminKey={key} initial={overview} />
    </LangProvider>
  );
}
