import type { Media } from "@/src/domain/types";

const SUPABASE_HOST = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null;
  } catch {
    return null;
  }
})();

/**
 * The media's public URL when it may be shown: https on a Supabase host (next.config remotePatterns), plus `blob:` and
 * `data:` URLs in the wizard preview only. Anything else (memory store `memory://`, http, foreign hosts) is null.
 */
export function mediaUrl(m: Media | null | undefined, opts: { preview?: boolean } = {}): string | null {
  if (!m) return null;
  const url = m.public_url;
  if (opts.preview && (url.startsWith("blob:") || url.startsWith("data:"))) return url;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname.endsWith(".supabase.co") || u.hostname === SUPABASE_HOST) ? url : null;
  } catch {
    return null;
  }
}

export function findMedia(media: readonly Media[], id: string | null | undefined): Media | null {
  return id ? media.find((m) => m.id === id) ?? null : null;
}
