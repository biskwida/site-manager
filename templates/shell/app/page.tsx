import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { def } from "@/src/templates/current";
import { FEED_URL, loadFeed, loadFeedOrNull, siteUrl, SLUG } from "./feed";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const state = await loadFeedOrNull();
  if (!state) return { title: "Site" };
  const v = state.venue;
  return { metadataBase: new URL(siteUrl()), title: v.name, description: v.default_lang === "bg" ? v.tagline_bg : v.tagline_en };
}

export default async function Page() {
  const state = await loadFeed();
  if (!state) notFound();
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this is the request time templates tick from
  const now = Date.now();
  return (
    <LangProvider defaultLang={state.venue.default_lang}>
      <def.Component state={state} now={now} slug={SLUG} page="home" draft={null} live feedUrl={FEED_URL} />
    </LangProvider>
  );
}
