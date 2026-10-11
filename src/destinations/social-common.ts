// src/destinations/social-common.ts
// Pure helpers shared by the Facebook and Instagram adapters and the owner-facing sync lines.
import type { Change, SocialTarget } from "../domain/types";
import { SOCIAL_TARGETS } from "../domain/types";

export type SocialNetwork = "facebook" | "instagram";
/** One target that went out: our media id, Meta's id for it (post id / media id) and its public link when Meta gave one. */
export interface SocialPublished {
  target: SocialTarget;
  media_id: string;
  id: string;
  permalink: string | null;
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

function isPublished(x: unknown): x is SocialPublished {
  const o = x as Partial<SocialPublished> | null;
  return !!o && typeof o.target === "string" && typeof o.media_id === "string" && typeof o.id === "string";
}

/** Every `published` entry of the given sync results (deduplicated by target + media id, first wins). */
export function publishedIn(results: readonly (Record<string, unknown> | null | undefined)[]): SocialPublished[] {
  const out: SocialPublished[] = [];
  for (const r of results) {
    const list = Array.isArray(r?.published) ? r.published : [];
    for (const p of list) if (isPublished(p) && !out.some((x) => x.target === p.target && x.media_id === p.media_id)) out.push({ target: p.target, media_id: p.media_id, id: p.id, permalink: typeof p.permalink === "string" ? p.permalink : null });
  }
  return out;
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
