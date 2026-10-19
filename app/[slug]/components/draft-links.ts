// Client-safe link helpers for the draft preview bar.

/** Where the bar's "back to the dashboard" goes: the key page when the preview carried a key, else the account dashboard. */
export function draftBackHref(slug: string, key: string): string {
  return key ? `/admin/${slug}?key=${encodeURIComponent(key)}` : `/dashboard/${slug}`;
}
