import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { getTemplate } from "@/src/templates";
import { templatePageProps } from "./props";
import { DraftBanner } from "./components/DraftBanner";
import { loadPage, pageMetadata } from "./load";
import { ownSiteLink, ownSiteRedirect } from "@/src/server/site";
import { OwnSiteLink } from "./components/OwnSiteLink";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  return pageMetadata((await props.params).slug, await props.searchParams);
}

export default async function Page(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const site = await loadPage(slug, await props.searchParams);
  if (!site) notFound();
  // An own-site venue (site_mode "own") lives elsewhere: send visitors there, so the hosted template is not a second public site.
  const own = ownSiteRedirect(site);
  if (own) redirect(own);
  // A self-serve own site never redirects (open-redirect risk); the hosted page links to it.
  const visit = ownSiteLink(site);
  const { Component } = getTemplate(site.state.venue.template);
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this is the request time templates tick from
  const now = Date.now();
  return (
    <LangProvider defaultLang={site.state.venue.default_lang}>
      {visit && <OwnSiteLink href={visit} />}
      {site.draft && <DraftBanner draft={site.draft} slug={slug} />}
      {/* keyed so leaving a draft preview (Apply/Reject → router.replace) remounts with the live state instead of keeping the draft */}
      <Component key={site.draft?.id ?? "live"} {...templatePageProps(site, slug, "home", now)} />
    </LangProvider>
  );
}
