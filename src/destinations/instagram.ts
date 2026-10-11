// src/destinations/instagram.ts
// Publishes applied social_post rows to the venue's Instagram professional account (Instagram API with Instagram Login,
// graph.instagram.com v25.0, long-lived Instagram User token): container → poll status_code until FINISHED → media_publish.
// Idempotent per target like the Facebook adapter. Instagram media cannot be deleted through the API: an undo publishes nothing
// and returns the links so the owner deletes them by hand. A token older than 30 days is refreshed first and stored again.
import type { SocialPostRow } from "../domain/types";
import { socialFailure } from "./facebook";
import { GraphClient, IG_GRAPH, MetaApiError, metaFetch } from "./meta-graph";
import { networkTargets, publishedIn, relevantFor, safeLink, type SocialPublished } from "./social-common";
import type { DestinationAdapter, PushContext, PushResult } from "./types";

const LINES = {
  ok: { bg: "Instagram: публикувано ✅", en: "Instagram: published ✅" },
  retry: { bg: "Instagram: не успях да публикувам, ще опитам пак", en: "Instagram: publishing failed, will retry" },
  error: (msg: string) => ({ bg: `Instagram: грешка: ${msg}`, en: `Instagram: error: ${msg}` }),
};
export const IG_REFRESH_AFTER_MS = 30 * 24 * 3_600_000;
export const IG_MAX_POLLS = 10;
export const IG_POLL_MS = 2000;
/** Token refresh lives on the unversioned host root (developers.facebook.com/docs/instagram-platform/reference/refresh_access_token). */
const IG_REFRESH_URL = "https://graph.instagram.com/refresh_access_token";

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFinished(ig: GraphClient, container: string, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let i = 0; i < IG_MAX_POLLS; i++) {
    const { status_code } = await ig.get<{ status_code?: string }>(`/${encodeURIComponent(container)}?fields=status_code`);
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new MetaApiError(400, "sm_ig_container", `Instagram could not process the photo (${status_code}).`, { retry: false });
    await sleep(IG_POLL_MS);
  }
  throw new MetaApiError(0, "sm_ig_processing", "Instagram is still processing the photo.", { retry: true });
}

async function permalink(ig: GraphClient, id: string): Promise<string | null> {
  try {
    return safeLink((await ig.get<{ permalink?: unknown }>(`/${encodeURIComponent(id)}?fields=permalink`)).permalink);
  } catch {
    return null;
  }
}

/** The token to publish with: refreshed (and stored) when the stored one is older than 30 days. An invalid token fails the push. */
async function freshToken(ctx: PushContext, token: string): Promise<string> {
  const cfg = ctx.destination.config;
  const since = Date.parse(String(cfg.token_refreshed_at ?? cfg.connected_at ?? ""));
  if (Number.isFinite(since) && ctx.now.getTime() - since <= IG_REFRESH_AFTER_MS) return token;
  try {
    // This endpoint takes the token only as a query parameter; metaFetch never logs or stores the URL.
    const r = await metaFetch<{ access_token?: unknown }>(ctx.fetch ?? fetch, `${IG_REFRESH_URL}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    if (typeof r.access_token !== "string" || !r.access_token) return token;
    await ctx.saveConnection?.({ ...cfg, token_refreshed_at: ctx.now.toISOString() }, { ...ctx.secrets, token: r.access_token });
    return r.access_token;
  } catch (e) {
    if (e instanceof MetaApiError && e.code === "sm_meta_token") throw e;
    return token; // a refresh hiccup: the old token is still valid for weeks
  }
}

export const instagramAdapter: DestinationAdapter = {
  kind: "instagram",
  relevant: relevantFor("instagram"),
  async push(ctx: PushContext): Promise<PushResult> {
    const igId = String(ctx.destination.config.ig_user_id ?? "");
    if (!/^\d{1,32}$/.test(igId) || !ctx.secrets.token) return { ok: false, retry: false, error: "Instagram is not connected.", code: "sm_social_not_connected", line: LINES.error("not connected") };
    const published: SocialPublished[] = publishedIn(ctx.prior ?? []);
    const manual: { target: string; id: string; permalink: string | null }[] = [];
    const sleep = ctx.sleep ?? realSleep;
    try {
      // An undo needs no API call (and no token): Instagram media cannot be deleted through the API.
      if (ctx.changes.every((c) => c.after === null)) {
        const original = ctx.changeSet.undoes_id && ctx.resultsOf ? publishedIn(await ctx.resultsOf(ctx.changeSet.undoes_id)) : [];
        for (const c of ctx.changes) {
          const targets = networkTargets(c, "instagram");
          for (const p of original.filter((x) => x.media_id === c.entity_id && targets.includes(x.target))) manual.push({ target: p.target, id: p.id, permalink: p.permalink });
        }
        return { ok: true, result: { undo: true, manual_delete: manual }, line: LINES.ok };
      }
      const ig = new GraphClient(IG_GRAPH, await freshToken(ctx, ctx.secrets.token), ctx.fetch ?? fetch);
      for (const c of ctx.changes) {
        if (!c.after) continue;
        const row = c.after as unknown as SocialPostRow;
        for (const target of networkTargets(c, "instagram")) {
          if (published.some((p) => p.target === target && p.media_id === c.entity_id)) continue;
          const body = target === "instagram_post" ? { image_url: row.image_url, ...(row.caption ? { caption: row.caption } : {}) } : { image_url: row.image_url, media_type: "STORIES" };
          const { id: container } = await ig.post<{ id: string }>(`/${igId}/media`, body);
          await waitFinished(ig, container, sleep);
          const { id } = await ig.post<{ id: string }>(`/${igId}/media_publish`, { creation_id: container });
          const entry: SocialPublished = { target, media_id: c.entity_id, id: String(id), permalink: null };
          published.push(entry);
          entry.permalink = await permalink(ig, entry.id);
        }
      }
      return { ok: true, result: { published }, line: LINES.ok };
    } catch (e) {
      return socialFailure(e, LINES, { published });
    }
  },
};
