// src/destinations/social-common.ts
// Pure helpers shared by the Facebook and Instagram adapters and the owner-facing sync lines.
import type { Change, SocialTarget } from "../domain/types";
import { SOCIAL_TARGETS } from "../domain/types";

export type SocialNetwork = "facebook" | "instagram";
/**
 * One target of a post as the sync row remembers it. "attempted" is written before the call that publishes (its answer may be
 * lost); "published" once Meta confirmed it. Meta's id may be null when a retry only learned that it went out.
 */
export interface SocialPublished {
  target: SocialTarget;
  media_id: string;
  state: "attempted" | "published";
  id: string | null;
  permalink: string | null;
  /** ISO: when the publishing call was sent (Facebook: a retry looks for a post after it). */
  attempted_at?: string;
  /** Instagram container id (creation_id), reused by a retry. */
  container?: string;
  /** Facebook story: the unpublished photo uploaded for it, reused by a retry. */
  photo_id?: string;
}

/** The targets of a social_post row (from `after`, or from `before` for an undo row). */
export function socialTargets(c: Change): SocialTarget[] {
  if (c.entity !== "social_post") return [];
  const row = c.after ?? c.before ?? {};
  const raw = Array.isArray(row.targets) ? row.targets : [];
  return SOCIAL_TARGETS.filter((t) => raw.includes(t));
}

export function networkTargets(c: Change, network: SocialNetwork): SocialTarget[] {
  return socialTargets(c).filter((t) => t.startsWith(`${network}_`));
}

/** social_post rows with at least one target on `network`, in position order. */
export function relevantFor(network: SocialNetwork) {
  return (changes: Change[]) => changes.filter((c) => networkTargets(c, network).length > 0).sort((a, b) => a.position - b.position);
}

function asEntry(x: unknown): SocialPublished | null {
  const o = x as Partial<SocialPublished> | null;
  if (!o || typeof o.target !== "string" || typeof o.media_id !== "string") return null;
  const id = typeof o.id === "string" && o.id ? o.id : null;
  // Rows written before the attempted/published states: an entry with an id was published.
  const state = o.state === "attempted" || o.state === "published" ? o.state : id ? "published" : null;
  if (!state) return null;
  return {
    target: o.target, media_id: o.media_id, state, id, permalink: typeof o.permalink === "string" ? o.permalink : null,
    ...(typeof o.attempted_at === "string" ? { attempted_at: o.attempted_at } : {}),
    ...(typeof o.container === "string" ? { container: o.container } : {}),
    ...(typeof o.photo_id === "string" ? { photo_id: o.photo_id } : {}),
  };
}

/** One entry per target + media id from the given sync results (oldest first): a published entry wins over an attempted one. */
export function entriesIn(results: readonly (Record<string, unknown> | null | undefined)[]): SocialPublished[] {
  const out = new Map<string, SocialPublished>();
  for (const r of results) {
    for (const raw of Array.isArray(r?.published) ? r.published : []) {
      const e = asEntry(raw);
      if (!e) continue;
      const key = `${e.target}|${e.media_id}`;
      const had = out.get(key);
      if (had?.state === "published" && e.state !== "published") continue;
      out.set(key, e);
    }
  }
  return [...out.values()];
}

/** The entries Meta confirmed. */
export function publishedIn(results: readonly (Record<string, unknown> | null | undefined)[]): SocialPublished[] {
  return entriesIn(results).filter((e) => e.state === "published");
}

/** Ids already deleted by earlier attempts of an undo. */
export function deletedIn(results: readonly (Record<string, unknown> | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const r of results) for (const d of Array.isArray(r?.deleted) ? r.deleted : []) if (d && typeof (d as { id?: unknown }).id === "string") out.add((d as { id: string }).id);
  return [...out];
}

/** https links only (never echo anything else Meta returned into a chat message). */
export function safeLink(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 500) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
