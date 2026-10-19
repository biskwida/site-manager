import type { Metadata } from "next";
import { cookies } from "next/headers";
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { loadSite } from "@/src/server/site";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Shared by the home and menu pages: the live site, the draft preview when `?draft=&key=` (or `?draft=` with the owner signed in) is valid for this venue, or a wizard draft when the sm_draft cookie matches. */
export async function loadPage(slug: string, sp: Search) {
  const deps = await getServerDeps((fn) => after(fn));
  const cookie = (await cookies()).get("sm_draft")?.value ?? null;
  const draftToken = cookie && cookie.includes(".") ? cookie.slice(cookie.indexOf(".") + 1) : null;
  const draftId = one(sp.draft);
  const key = one(sp.key);
  // A draft preview opened on the account dashboard carries no key: the signed-in owner's session proves it instead.
  const userId = draftId && !key ? ((await getSessionUser())?.id ?? null) : null;
  return loadSite(deps.store, slug, { draftId, key, userId, draftToken });
}

export async function pageMetadata(slug: string, sp: Search): Promise<Metadata> {
  const site = await loadPage(slug, {});
  if (!site) return { title: "Claudia" };
  const v = site.state.venue;
  return {
    title: v.name,
    description: v.default_lang === "bg" ? v.tagline_bg : v.tagline_en,
    // A draft preview link may carry the admin key: keep it out of search engines.
    ...(one(sp.draft) ? { robots: { index: false, follow: false } } : {}),
  };
}
