// In the main app a venue lives at /<slug> and /<slug>/menu; a deployed venue site serves the same template at / and /menu.
// The shell's next.config.ts inlines NEXT_PUBLIC_SITE_STANDALONE=1 at build time, so this is a compile-time constant there.
const STANDALONE = process.env.NEXT_PUBLIC_SITE_STANDALONE === "1";

/** Internal link to a template page. Templates must use this for their Home/Menu links (never `/${slug}` literals). */
export function pageHref(slug: string, page: "home" | "menu"): string {
  if (STANDALONE) return page === "home" ? "/" : "/menu";
  return page === "home" ? `/${slug}` : `/${slug}/menu`;
}
