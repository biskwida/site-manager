import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { loadPage, pageMetadata } from "./load";
import { SiteView } from "./components/SiteView";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  return pageMetadata((await props.params).slug, await props.searchParams);
}

export default async function Page(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const site = await loadPage(slug, await props.searchParams);
  if (!site) notFound();
  return (
    <LangProvider defaultLang={site.state.venue.default_lang}>
      {/* keyed so leaving a draft preview (Apply/Reject → router.replace) remounts with the live state instead of keeping the draft */}
      <SiteView key={site.draft?.id ?? "live"} state={site.state} slug={slug} page="home" draft={site.draft} live={site.draft === null} />
    </LangProvider>
  );
}
