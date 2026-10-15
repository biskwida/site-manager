// src/destinations/facebook.ts
// Publishes applied social_post rows to the venue's Facebook Page (Graph v25.0, Page access token): a feed photo post and/or a
// photo story. Never posts twice: before each publishing call the target is checkpointed as "attempted" on the sync row; a retry
// that finds an attempted target first looks for it among the Page's recent posts/stories and only posts again when it is not
// there (when the Page cannot be checked, it fails without retry and asks the owner to look). Undo deletes the feed post; a story
// cannot be deleted through the API and disappears on its own within 24 hours, so undo only says so.
import type { SocialPostRow, SocialTarget } from "../domain/types";
import { pushCommentChanges } from "./comment-push";
import { FB_GRAPH, GraphClient, MetaApiError, metaTime } from "./meta-graph";
import { commentNetworkOf, commentResultIn, deletedIn, entriesIn, networkTargets, publishedIn, relevantFor, safeLink, type SocialPublished } from "./social-common";
import type { DestinationAdapter, PushContext, PushResult } from "./types";

const LINES = {
  ok: { bg: "Facebook: публикувано ✅", en: "Facebook: published ✅" },
  retry: { bg: "Facebook: не успях да публикувам, ще опитам пак", en: "Facebook: publishing failed, will retry" },
  error: (msg: string) => ({ bg: `Facebook: грешка: ${msg}`, en: `Facebook: error: ${msg}` }),
};
/** A post found after an attempt counts as that attempt when it was created at most this long before it (clock skew). */
const MATCH_SKEW_MS = 2 * 60_000;

/** A failed push that keeps what this attempt already did, so the retry does not post it twice. */
export function socialFailure(e: unknown, lines: typeof LINES, partial: Record<string, unknown>): PushResult {
  const retry = e instanceof MetaApiError ? e.retryable : true;
  const msg = e instanceof Error ? e.message : String(e);
  return { ok: false, retry, error: msg, line: retry ? lines.retry : lines.error(msg), partial, ...(e instanceof MetaApiError ? { code: e.code } : {}) };
}

async function permalink(fb: GraphClient, id: string): Promise<string | null> {
  try {
    return safeLink((await fb.get<{ permalink_url?: unknown }>(`/${encodeURIComponent(id)}?fields=permalink_url`)).permalink_url);
  } catch {
    return null; // the post is out; a missing link is not worth a retry
  }
}

/** After an attempt whose answer was lost: the id of the post/story it created, or null when the Page shows none. */
async function findAttempt(fb: GraphClient, pageId: string, e: SocialPublished, row: SocialPostRow): Promise<string | null> {
  const since = Date.parse(e.attempted_at ?? "") - MATCH_SKEW_MS;
  try {
    if (e.target === "facebook_post") {
      const r = await fb.get<{ data?: { id?: unknown; created_time?: unknown; message?: unknown }[] }>(`/${pageId}/published_posts?fields=${encodeURIComponent("id,created_time,message")}&limit=10`);
      const hit = (r.data ?? []).find((p) => typeof p.id === "string" && metaTime(p.created_time) >= since && (row.caption ? p.message === row.caption : true));
      return hit ? (hit.id as string) : null;
    }
    const r = await fb.get<{ data?: { post_id?: unknown; creation_time?: unknown; media_id?: unknown }[] }>(`/${pageId}/stories?fields=${encodeURIComponent("post_id,creation_time,media_id,status")}&limit=10`);
    const rows = (r.data ?? []).filter((p) => typeof p.post_id === "string");
    const hit = (e.photo_id ? rows.find((p) => p.media_id === e.photo_id) : undefined) ?? rows.find((p) => (!e.photo_id || p.media_id === undefined) && metaTime(p.creation_time) >= since);
    return hit ? (hit.post_id as string) : null;
  } catch (err) {
    if (err instanceof MetaApiError && (err.code === "sm_meta_token" || err.code === "sm_meta_permission")) throw err;
    throw new MetaApiError(err instanceof MetaApiError ? err.status : 0, "sm_fb_check", "Could not check the Page for the earlier attempt; check the Page before asking again.", { retry: false });
  }
}

export const facebookAdapter: DestinationAdapter = {
  kind: "facebook",
  relevant: relevantFor("facebook"),
  async push(ctx: PushContext): Promise<PushResult> {
    const pageId = String(ctx.destination.config.page_id ?? "");
    const token = ctx.secrets.page_token;
    if (!/^\d{1,32}$/.test(pageId) || !token) return { ok: false, retry: false, error: "Facebook is not connected.", code: "sm_social_not_connected", line: LINES.error("not connected") };
    const fb = new GraphClient(FB_GRAPH, token, ctx.fetch ?? fetch);
    // A set holds post rows or comment rows (replies / moderation, 2026-10-15); each kind keeps its own part of the result.
    const posts = ctx.changes.filter((c) => c.entity === "social_post");
    const comments = ctx.changes.filter((c) => commentNetworkOf(c) === "facebook");
    const acc = commentResultIn(ctx.prior ?? []);
    const entries = new Map<string, SocialPublished>(entriesIn(ctx.prior ?? []).map((e) => [`${e.target}|${e.media_id}`, e]));
    const current = () => ({ ...(posts.length ? { published: [...entries.values()] } : {}), ...(comments.length ? acc : {}) });
    const save = async () => ctx.checkpoint?.(current());
    const deleted: { target: string; id: string }[] = [];
    const stories: { target: string; id: string | null }[] = [];
    const alreadyDeleted = new Set(deletedIn(ctx.prior ?? []));
    let undo = false;
    const outcome = () => ({ ...(posts.length ? (undo ? { undo: true, deleted, stories } : { published: [...entries.values()] }) : {}), ...(comments.length ? acc : {}) });
    try {
      for (const c of posts) {
        const targets = networkTargets(c, "facebook");
        if (c.after) {
          const row = c.after as unknown as SocialPostRow;
          for (const target of targets) {
            const key = `${target}|${c.entity_id}`;
            const prev = entries.get(key);
            if (prev?.state === "published") continue;
            if (prev?.state === "attempted") {
              const found = await findAttempt(fb, pageId, prev, row);
              if (found) {
                entries.set(key, { ...prev, state: "published", id: found, permalink: await permalink(fb, found) });
                continue;
              }
            }
            const id = await publish(fb, pageId, target, row, c.entity_id, prev, ctx.now, (e) => {
              entries.set(key, e);
              return save();
            });
            entries.set(key, { ...entries.get(key)!, state: "published", id, permalink: await permalink(fb, id) });
          }
        } else if (c.before) {
          undo = true;
          const original = ctx.changeSet.undoes_id && ctx.resultsOf ? publishedIn(await ctx.resultsOf(ctx.changeSet.undoes_id)) : [];
          for (const p of original.filter((x) => x.media_id === c.entity_id && targets.includes(x.target))) {
            if (p.target === "facebook_story") {
              stories.push({ target: p.target, id: p.id }); // no delete through the API; it expires within 24 hours
              continue;
            }
            if (p.id && !alreadyDeleted.has(p.id)) {
              try {
                await fb.delete(`/${encodeURIComponent(p.id)}`);
              } catch (e) {
                if (!(e instanceof MetaApiError && e.notFound)) throw e;
              }
            }
            if (p.id) deleted.push({ target: p.target, id: p.id });
          }
        }
      }
      if (comments.length) await pushCommentChanges(ctx, "facebook", fb, acc, save);
      return { ok: true, result: outcome(), line: LINES.ok };
    } catch (e) {
      return socialFailure(e, LINES, outcome());
    }
  },
};

/** Sends one target, checkpointing it as attempted right before the publishing call. Returns Meta's post id. */
async function publish(
  fb: GraphClient, pageId: string, target: SocialTarget, row: SocialPostRow, mediaId: string, prev: SocialPublished | undefined, now: Date,
  mark: (e: SocialPublished) => Promise<void>,
): Promise<string> {
  const attempted = (extra: Partial<SocialPublished> = {}): SocialPublished => ({ target, media_id: mediaId, state: "attempted", id: null, permalink: null, attempted_at: now.toISOString(), ...extra });
  if (target === "facebook_post") {
    await mark(attempted());
    const r = await fb.post<{ id?: string; post_id?: string }>(`/${pageId}/photos`, { url: row.image_url, ...(row.caption ? { caption: row.caption } : {}), published: true });
    const id = r.post_id ?? r.id;
    if (!id) throw new MetaApiError(0, "sm_fb_unknown", "Facebook did not say whether the post went out.", { retry: true });
    return String(id);
  }
  // A story: the unpublished photo from an earlier attempt is reused; uploading it twice would be harmless but wasteful.
  const photoId = prev?.photo_id ?? (await fb.post<{ id: string }>(`/${pageId}/photos`, { url: row.image_url, published: false })).id;
  await mark(attempted({ photo_id: String(photoId) }));
  const r = await fb.post<{ post_id?: string }>(`/${pageId}/photo_stories`, { photo_id: photoId });
  if (!r.post_id) throw new MetaApiError(0, "sm_fb_unknown", "Facebook did not say whether the story went out.", { retry: true });
  return String(r.post_id);
}
