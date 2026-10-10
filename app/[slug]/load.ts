import type { Metadata } from "next";
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { loadSite } from "@/src/server/site";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Shared by the home and menu pages: the live site, or the draft preview when `?draft=&key=` is valid for this venue. */
export async function loadPage(slug: string, sp: Search) {
  const deps = await getServerDeps((fn) => after(fn));
  return loadSite(deps.store, slug, { draftId: one(sp.draft), key: one(sp.key) });
}

export async function pageMetadata(slug: string, sp: Search): Promise<Metadata> {
  const site = await loadPage(slug, {});
  if (!site) return { title: "Site Manager" };
  const v = site.state.venue;
  return {
    title: v.name,
    description: v.default_lang === "bg" ? v.tagline_bg : v.tagline_en,
    // A draft preview link carries the admin key: keep it out of search engines.
    ...(one(sp.draft) ? { robots: { index: false, follow: false } } : {}),
  };
}
