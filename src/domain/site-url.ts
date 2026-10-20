// src/domain/site-url.ts
// Pure. The one check for an own site's address (scripts/venue-create.mts and the onboarding form).

/** A plain https URL with a real hostname (no credentials, query or fragment), without a trailing slash; null otherwise. */
export function parseSiteUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !u.hostname.includes(".")) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/**
 * What an owner types in the "website address" box: "coffique.bg" is read as https://coffique.bg. An explicit http:// (or any other
 * scheme) is not accepted. Same result as parseSiteUrl otherwise; null when it is not a usable https address.
 */
export function parseTypedSiteUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return parseSiteUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
}
