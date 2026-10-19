import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { getTemplate } from "@/src/templates";
import { templatePageProps } from "../props";
import { DraftBanner } from "../components/DraftBanner";
import { loadPage, pageMetadata } from "../load";
import { ownSiteRedirect } from "@/src/server/site";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/[slug]/menu">): Promise<Metadata> {
  return pageMetadata((await props.params).slug, await props.searchParams);
}

export default async function Page(props: PageProps<"/[slug]/menu">) {
  const { slug } = await props.params;
  const site = await loadPage(slug, await props.searchParams);
  if (!site) notFound();
  // An own-site venue (site_mode "own") lives elsewhere: send visitors there, so the hosted template is not a second public site.
  const own = ownSiteRedirect(site);
  if (own) redirect(own);
  const { Component } = getTemplate(site.state.venue.template);
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this is the request time templates tick from
  const now = Date.now();
  return (
    <LangProvider defaultLang={site.state.venue.default_lang}>
      {site.draft && <DraftBanner draft={site.draft} slug={slug} />}
      {/* keyed so leaving a draft preview (Apply/Reject → router.replace) remounts with the live state instead of keeping the draft */}
      <Component key={site.draft?.id ?? "live"} {...templatePageProps(site, slug, "menu", now)} />
    </LangProvider>
  );
}
