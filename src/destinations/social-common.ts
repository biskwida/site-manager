// src/destinations/social-common.ts
// Pure helpers shared by the Facebook and Instagram adapters and the owner-facing sync lines.
import type { Change, ModerateAction, SocialTarget } from "../domain/types";
import { SOCIAL_TARGETS } from "../domain/types";
import type { Store } from "../store/types";

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

/** The network of a social_reply / social_moderate row (from `after`, or `before` for an undo row); null for every other row. */
export function commentNetworkOf(c: Change): SocialNetwork | null {
  if (c.entity !== "social_reply" && c.entity !== "social_moderate") return null;
  const n = (c.after ?? c.before ?? {}).network;
  return n === "facebook" || n === "instagram" ? n : null;
}

/** social_post rows with at least one target on `network`, and comment rows of `network`, in position order. */
export function relevantFor(network: SocialNetwork) {
  return (changes: Change[]) => changes.filter((c) => networkTargets(c, network).length > 0 || commentNetworkOf(c) === network).sort((a, b) => a.position - b.position);
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

/** A feed post Site Manager published, as the comment poller needs it (comment replies, 2026-10-15). */
export interface PublishedTarget {
  network: SocialNetwork;
  target: SocialTarget;
  /** Meta's post id (Facebook) or media id (Instagram). */
  post_ref: string;
  change_set_id: string;
  caption: string;
  permalink: string | null;
  /** When the sync row was created (ISO): the publish. */
  published_at: string;
}

/** At most this many sync rows are read per poll (newest first): a bounded query, never a scan of the venue's history. */
export const PUBLISHED_TARGETS_MAX_ROWS = 200;

/**
 * Feed posts (never stories: they take no comments) with a Meta id, from the venue's done sync rows created at or after
 * `sinceIso` (newest first, at most PUBLISHED_TARGETS_MAX_ROWS rows), one entry per post id. The caption comes from the set's
 * social_post row.
 */
export async function publishedTargets(store: Pick<Store, "listSyncs" | "getChangeSet">, venueId: string, sinceIso: string): Promise<PublishedTarget[]> {
  const rows = await store.listSyncs({ venueId, status: ["done"], createdSince: sinceIso, order: "desc", limit: PUBLISHED_TARGETS_MAX_ROWS });
  const seen = new Set<string>();
  const out: PublishedTarget[] = [];
  for (const s of rows) {
    if (s.payload.kind !== "facebook" && s.payload.kind !== "instagram") continue;
    const network: SocialNetwork = s.payload.kind;
    const published = publishedIn([s.result]).filter((p) => p.id !== null && p.target === `${network}_post` && !seen.has(p.id));
    if (published.length === 0) continue;
    let captions = new Map<string, string>();
    try {
      const cs = await store.getChangeSet(s.change_set_id);
      captions = new Map(cs.changes.filter((c) => c.entity === "social_post" && c.after).map((c) => [c.entity_id, typeof c.after?.caption === "string" ? c.after.caption : ""]));
    } catch {
      // the set is gone (venue content cleared): the post is still readable, without its caption
    }
    for (const p of published) {
      const id = p.id as string;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ network, target: p.target, post_ref: id, change_set_id: s.change_set_id, caption: captions.get(p.media_id) ?? "", permalink: p.permalink, published_at: s.created_at });
    }
  }
  return out;
}

// --- Comment replies (2026-10-15): what a push stores for social_reply / social_moderate rows ---
export interface CommentResult {
  replied: { comment_id: string; reply_id: string }[];
  moderated: { comment_id: string; action: ModerateAction }[];
  /** Undo of a reply: our reply deleted (reply_id "" when the original result had none). */
  deleted_replies: { comment_id: string; reply_id: string }[];
  /** Comments Meta no longer has: nothing was posted, never retried. */
  gone: string[];
  /** Undo of a delete: nothing can be done. */
  kept: string[];
  /**
   * Comments whose reply call was sent but not confirmed (checkpointed right before the call, whose answer may be lost):
   * a retry looks for our reply under the comment before replying again.
   */
  attempted: string[];
}
export function emptyCommentResult(): CommentResult {
  return { replied: [], moderated: [], deleted_replies: [], gone: [], kept: [], attempted: [] };
}
/** Whether the result says anything to the owner (an attempt alone does not). */
export function hasCommentResult(r: CommentResult): boolean {
  return r.replied.length + r.moderated.length + r.deleted_replies.length + r.gone.length + r.kept.length > 0;
}
const ACTIONS = new Set(["hide", "unhide", "delete"]);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** Merges the comment parts of the given sync results (oldest first), one entry per comment id and list. */
export function commentResultIn(results: readonly (Record<string, unknown> | null | undefined)[]): CommentResult {
  const out = emptyCommentResult();
  const seen = { replied: new Set<string>(), moderated: new Set<string>(), deleted_replies: new Set<string>(), gone: new Set<string>(), kept: new Set<string>(), attempted: new Set<string>() };
  for (const r of results) {
    for (const x of Array.isArray(r?.replied) ? r.replied : []) {
      const o = (x ?? {}) as { comment_id?: unknown; reply_id?: unknown };
      if (typeof o.comment_id === "string" && typeof o.reply_id === "string" && !seen.replied.has(o.comment_id)) { seen.replied.add(o.comment_id); out.replied.push({ comment_id: o.comment_id, reply_id: o.reply_id }); }
    }
    for (const x of Array.isArray(r?.moderated) ? r.moderated : []) {
      const o = (x ?? {}) as { comment_id?: unknown; action?: unknown };
      if (typeof o.comment_id === "string" && typeof o.action === "string" && ACTIONS.has(o.action) && !seen.moderated.has(o.comment_id)) { seen.moderated.add(o.comment_id); out.moderated.push({ comment_id: o.comment_id, action: o.action as ModerateAction }); }
    }
    for (const x of Array.isArray(r?.deleted_replies) ? r.deleted_replies : []) {
      const o = (x ?? {}) as { comment_id?: unknown; reply_id?: unknown };
      if (typeof o.comment_id === "string" && !seen.deleted_replies.has(o.comment_id)) { seen.deleted_replies.add(o.comment_id); out.deleted_replies.push({ comment_id: o.comment_id, reply_id: typeof o.reply_id === "string" ? o.reply_id : "" }); }
    }
    for (const k of ["gone", "kept", "attempted"] as const) {
      for (const id of ids(r?.[k])) if (!seen[k].has(id)) { seen[k].add(id); out[k].push(id); }
    }
  }
  return out;
}
