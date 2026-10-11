// src/destinations/facebook.ts
// Publishes applied social_post rows to the venue's Facebook Page (Graph v25.0, Page access token): a feed photo post and/or a
// photo story. Idempotent per target: what an earlier attempt of the same set published (stored in the sync row's result, also on
// failure) is skipped. Undo deletes each post/story the reverted set published; one that is already gone counts as deleted.
import type { SocialPostRow } from "../domain/types";
import { FB_GRAPH, GraphClient, MetaApiError } from "./meta-graph";
import { deletedIn, networkTargets, publishedIn, relevantFor, safeLink, type SocialPublished } from "./social-common";
import type { DestinationAdapter, PushContext, PushResult } from "./types";

const LINES = {
  ok: { bg: "Facebook: публикувано ✅", en: "Facebook: published ✅" },
  retry: { bg: "Facebook: не успях да публикувам, ще опитам пак", en: "Facebook: publishing failed, will retry" },
  error: (msg: string) => ({ bg: `Facebook: грешка: ${msg}`, en: `Facebook: error: ${msg}` }),
};

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

export const facebookAdapter: DestinationAdapter = {
  kind: "facebook",
  relevant: relevantFor("facebook"),
  async push(ctx: PushContext): Promise<PushResult> {
    const pageId = String(ctx.destination.config.page_id ?? "");
    const token = ctx.secrets.page_token;
    if (!/^\d{1,32}$/.test(pageId) || !token) return { ok: false, retry: false, error: "Facebook is not connected.", code: "sm_social_not_connected", line: LINES.error("not connected") };
    const fb = new GraphClient(FB_GRAPH, token, ctx.fetch ?? fetch);
    const published: SocialPublished[] = publishedIn(ctx.prior ?? []);
    const deleted: { target: string; id: string }[] = [];
    const alreadyDeleted = new Set(deletedIn(ctx.prior ?? []));
    let undo = false;
    try {
      for (const c of ctx.changes) {
        const targets = networkTargets(c, "facebook");
        if (c.after) {
          const row = c.after as unknown as SocialPostRow;
          for (const target of targets) {
            if (published.some((p) => p.target === target && p.media_id === c.entity_id)) continue;
            let id: string;
            if (target === "facebook_post") {
              const r = await fb.post<{ id: string; post_id?: string }>(`/${pageId}/photos`, { url: row.image_url, ...(row.caption ? { caption: row.caption } : {}), published: true });
              id = String(r.post_id ?? r.id);
            } else {
              const photo = await fb.post<{ id: string }>(`/${pageId}/photos`, { url: row.image_url, published: false });
              const r = await fb.post<{ post_id: string }>(`/${pageId}/photo_stories`, { photo_id: photo.id });
              id = String(r.post_id);
            }
            const entry: SocialPublished = { target, media_id: c.entity_id, id, permalink: null };
            published.push(entry);
            entry.permalink = await permalink(fb, id);
          }
        } else if (c.before) {
          undo = true;
          const original = ctx.changeSet.undoes_id && ctx.resultsOf ? publishedIn(await ctx.resultsOf(ctx.changeSet.undoes_id)) : [];
          for (const p of original.filter((x) => x.media_id === c.entity_id && targets.includes(x.target))) {
            if (!alreadyDeleted.has(p.id)) {
              try {
                await fb.delete(`/${encodeURIComponent(p.id)}`);
              } catch (e) {
                if (!(e instanceof MetaApiError && e.notFound)) throw e;
              }
            }
            deleted.push({ target: p.target, id: p.id });
          }
        }
      }
      return { ok: true, result: undo ? { undo: true, deleted } : { published }, line: LINES.ok };
    } catch (e) {
      return socialFailure(e, LINES, undo ? { undo: true, deleted } : { published });
    }
  },
};
