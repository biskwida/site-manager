import type { Metadata } from "next";
import { cookies } from "next/headers";
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { loadSite } from "@/src/server/site";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Shared by the home and menu pages: the live site, the draft preview when `?draft=&key=` is valid for this venue, or a wizard draft when the sm_draft cookie matches. */
export async function loadPage(slug: string, sp: Search) {
  const deps = await getServerDeps((fn) => after(fn));
  const cookie = (await cookies()).get("sm_draft")?.value ?? null;
  const draftToken = cookie && cookie.includes(".") ? cookie.slice(cookie.indexOf(".") + 1) : null;
  return loadSite(deps.store, slug, { draftId: one(sp.draft), key: one(sp.key), draftToken });
}

export async function pageMetadata(slug: string, sp: Search): Promise<Metadata> {
  const site = await loadPage(slug, {});
  if (!site) return { title: "Claudia" };
  const v = site.state.venue;
  return {
    title: v.name,
    description: v.default_lang === "bg" ? v.tagline_bg : v.tagline_en,
    // A draft preview link carries the admin key: keep it out of search engines.
    ...(one(sp.draft) ? { robots: { index: false, follow: false } } : {}),
  };
}
