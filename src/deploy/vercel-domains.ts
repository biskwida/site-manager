// src/deploy/vercel-domains.ts
// Pure helpers for the optional custom domain. The provider calls live in VercelDeployer.addDomain (src/deploy/vercel.ts);
// this module has no network and no secrets, so the dashboard client may import it for instant input feedback.

/** Hostname: 2+ labels of letters, digits and inner hyphens (max 63 each), a letter-only TLD, 253 chars at most. No IPs, localhost or underscores. */
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Lowercases and strips surrounding whitespace, an http(s) scheme, a path/query/fragment, a port and the trailing dot;
 * null unless what remains is a plain public hostname (IDN labels must already be in punycode).
 */
export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
  return DOMAIN_RE.test(s) ? s : null;
}
