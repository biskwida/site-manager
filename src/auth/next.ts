// src/auth/next.ts
// Client-safe and pure: where a sign-in may send the browser afterwards. Used by /auth/callback (server) and the /login form (client).

/** Where a sign-in ends when `next` is missing or not acceptable. */
export const DEFAULT_NEXT = "/dashboard";

/**
 * `next` only when it is a same-origin relative path: a single leading "/", no backslash, no control character, and nothing that
 * a browser or URL parser could read as another host ("//evil", "/\evil", "/%2Fevil", "https://evil", "javascript:"). Anything
 * else (including non-strings) is `fallback`. Dot segments are resolved first: "/.//evil" and "/%2e%2e//evil" are refused too.
 */
export function safeNext(next: unknown, fallback: string = DEFAULT_NEXT): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(next) || /^\/(%2f|%5c)/i.test(next)) return fallback;
  try {
    // The path must resolve on the same origin as whatever it is joined to, and its normalised path (dot segments, %2e%2e) must not
    // start with "//": "/.//evil" and "/a/..//evil" are read by a browser as the host "evil".
    const resolved = new URL(next, "http://same-origin.invalid");
    return resolved.origin === "http://same-origin.invalid" && !resolved.pathname.startsWith("//") ? next : fallback;
  } catch {
    return fallback;
  }
}

/** The link an email or Google sign-in returns to: `<origin>/auth/callback?next=<safe next>`. */
export function callbackUrl(origin: string, next: unknown): string {
  return `${origin.replace(/\/+$/, "")}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}
