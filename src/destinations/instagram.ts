// src/destinations/instagram.ts
// Publishes applied social_post rows to the venue's Instagram professional account (Instagram API with Instagram Login,
// graph.instagram.com v25.0, long-lived Instagram User token): container → poll status_code until FINISHED → media_publish.
// Never publishes twice: the container id is checkpointed on the sync row before media_publish; a retry asks the container for its
// status first (PUBLISHED: done, FINISHED: publish the same creation_id, EXPIRED/gone: a new container). Instagram media cannot be
// deleted through the API: an undo publishes nothing and returns the links so the owner deletes them by hand. Tokens older than
// 30 days are refreshed (here before publishing, and by the tick); a refresh failure never stops a publish.
import { publishedUrl } from "../domain/social-preview";
import type { SocialPostRow } from "../domain/types";
import { pushCommentChanges } from "./comment-push";
import { socialFailure } from "./facebook";
import { GraphClient, IG_GRAPH, MetaApiError, metaFetch } from "./meta-graph";
import { decryptSecrets, encryptSecrets } from "./secrets";
import { commentNetworkOf, commentResultIn, entriesIn, networkTargets, publishedIn, relevantFor, safeLink, type SocialPublished } from "./social-common";
import type { SyncDeps } from "./sync";
import type { DestinationAdapter, PushContext, PushResult } from "./types";

const LINES = {
  ok: { bg: "Instagram: публикувано ✅", en: "Instagram: published ✅" },
  retry: { bg: "Instagram: не успях да публикувам, ще опитам пак", en: "Instagram: publishing failed, will retry" },
  error: (msg: string) => ({ bg: `Instagram: грешка: ${msg}`, en: `Instagram: error: ${msg}` }),
};
export const IG_REFRESH_AFTER_MS = 30 * 24 * 3_600_000;
/** Meta refuses to refresh a token younger than 24 hours. */
export const IG_MIN_REFRESH_AGE_MS = 24 * 3_600_000;
export const IG_MAX_POLLS = 10;
export const IG_POLL_MS = 2000;
/** Token refresh lives on the unversioned host root (developers.facebook.com/docs/instagram-platform/reference/refresh_access_token). */
const IG_REFRESH_URL = "https://graph.instagram.com/refresh_access_token";
const STATUS_FIELDS = encodeURIComponent("status_code,status");

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function containerStatus(ig: GraphClient, container: string): Promise<{ code: string; text: string }> {
  const r = await ig.get<{ status_code?: unknown; status?: unknown }>(`/${encodeURIComponent(container)}?fields=${STATUS_FIELDS}`);
  return { code: typeof r.status_code === "string" ? r.status_code : "", text: typeof r.status === "string" ? r.status.slice(0, 200) : "" };
}

function containerFailed(s: { code: string; text: string }): MetaApiError {
  return new MetaApiError(400, "sm_ig_container", `Instagram could not process the photo (${s.code}${s.text ? `: ${s.text}` : ""}).`, { retry: false });
}

/** Polls until FINISHED (or PUBLISHED, when an earlier attempt's publish went through). */
async function waitReady(ig: GraphClient, container: string, sleep: (ms: number) => Promise<void>): Promise<"FINISHED" | "PUBLISHED"> {
  for (let i = 0; i < IG_MAX_POLLS; i++) {
    const s = await containerStatus(ig, container);
    if (s.code === "FINISHED" || s.code === "PUBLISHED") return s.code;
    if (s.code === "ERROR" || s.code === "EXPIRED") throw containerFailed(s);
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

/** Age rule shared by the publish path and the tick: "fresh" (no refresh), "stale" (refresh), "unknown" (no readable timestamp). */
function tokenAge(cfg: Record<string, unknown>, now: Date): "fresh" | "stale" | "unknown" {
  const since = Date.parse(String(cfg.token_refreshed_at ?? cfg.connected_at ?? ""));
  if (!Number.isFinite(since)) return "unknown";
  const age = now.getTime() - since;
  return age >= IG_MIN_REFRESH_AGE_MS && age > IG_REFRESH_AFTER_MS ? "stale" : "fresh";
}

/** GET refresh_access_token: the new long-lived token, or null. The endpoint takes the token only as a query parameter; nothing logs the URL. */
async function refreshToken(f: typeof fetch, token: string): Promise<string | null> {
  const r = await metaFetch<{ access_token?: unknown }>(f, `${IG_REFRESH_URL}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
  return typeof r.access_token === "string" && r.access_token ? r.access_token : null;
}

/** The token to publish with: refreshed (and stored) when older than 30 days. Any refresh failure keeps the old token. */
async function freshToken(ctx: PushContext, token: string): Promise<string> {
  const cfg = ctx.destination.config;
  const age = tokenAge(cfg, ctx.now);
  if (age === "unknown") {
    // No readable timestamp: count it as fresh from now, so the 30 days start somewhere.
    await ctx.saveConnection?.({ ...cfg, token_refreshed_at: ctx.now.toISOString() }, ctx.secrets).catch(() => undefined);
    return token;
  }
  if (age === "fresh") return token;
  try {
    const next = await refreshToken(ctx.fetch ?? fetch, token);
    if (!next) return token;
    await ctx.saveConnection?.({ ...cfg, token_refreshed_at: ctx.now.toISOString() }, { ...ctx.secrets, token: next });
    return next;
  } catch {
    return token; // the publish call itself reports a token that really stopped working (190)
  }
}

export const instagramAdapter: DestinationAdapter = {
  kind: "instagram",
  relevant: relevantFor("instagram"),
  async push(ctx: PushContext): Promise<PushResult> {
    const igId = String(ctx.destination.config.ig_user_id ?? "");
    if (!/^\d{1,32}$/.test(igId) || !ctx.secrets.token) return { ok: false, retry: false, error: "Instagram is not connected.", code: "sm_social_not_connected", line: LINES.error("not connected") };
    // A set holds post rows or comment rows (replies / moderation, 2026-10-15); each kind keeps its own part of the result.
    const posts = ctx.changes.filter((c) => c.entity === "social_post");
    const comments = ctx.changes.filter((c) => commentNetworkOf(c) === "instagram");
    const acc = commentResultIn(ctx.prior ?? []);
    const entries = new Map<string, SocialPublished>(entriesIn(ctx.prior ?? []).map((e) => [`${e.target}|${e.media_id}`, e]));
    const current = () => ({ ...(posts.length ? { published: [...entries.values()] } : {}), ...(comments.length ? acc : {}) });
    const sleep = ctx.sleep ?? realSleep;
    try {
      // An undo needs no API call (and no token): Instagram media cannot be deleted through the API.
      if (comments.length === 0 && posts.every((c) => c.after === null)) {
        const manual: { target: string; id: string | null; permalink: string | null }[] = [];
        const original = ctx.changeSet.undoes_id && ctx.resultsOf ? publishedIn(await ctx.resultsOf(ctx.changeSet.undoes_id)) : [];
        for (const c of posts) {
          const targets = networkTargets(c, "instagram");
          for (const p of original.filter((x) => x.media_id === c.entity_id && targets.includes(x.target))) manual.push({ target: p.target, id: p.id, permalink: p.permalink });
        }
        return { ok: true, result: { undo: true, manual_delete: manual }, line: LINES.ok };
      }
      const ig = new GraphClient(IG_GRAPH, await freshToken(ctx, ctx.secrets.token), ctx.fetch ?? fetch);
      for (const c of posts) {
        if (!c.after) continue;
        const row = c.after as unknown as SocialPostRow;
        for (const target of networkTargets(c, "instagram")) {
          const key = `${target}|${c.entity_id}`;
          const prev = entries.get(key);
          if (prev?.state === "published") continue;
          let container = prev?.container;
          if (container) {
            let s: { code: string; text: string } | null = null;
            try {
              s = await containerStatus(ig, container);
            } catch (e) {
              if (!(e instanceof MetaApiError && e.notFound)) throw e;
            }
            if (s?.code === "PUBLISHED") {
              entries.set(key, { ...prev!, state: "published" }); // went out; Meta does not tell the media id from here
              continue;
            }
            if (s?.code === "ERROR") throw containerFailed(s);
            if (!s || s.code === "EXPIRED") container = undefined; // never published: a new container is safe
          }
          if (!container) {
            // The file the owner saw in the proposal (publishedUrl, shared with the preview): the feed post its padded copy, the story Claudia's 9:16 copy.
            const imageUrl = publishedUrl(row, target);
            const body = target === "instagram_post" ? { image_url: imageUrl, ...(row.caption ? { caption: row.caption } : {}) } : { image_url: imageUrl, media_type: "STORIES" };
            container = String((await ig.post<{ id: string }>(`/${igId}/media`, body)).id);
            entries.set(key, { target, media_id: c.entity_id, state: "attempted", id: null, permalink: null, container, attempted_at: ctx.now.toISOString() });
            await ctx.checkpoint?.(current());
          }
          if ((await waitReady(ig, container, sleep)) === "PUBLISHED") {
            entries.set(key, { ...entries.get(key)!, state: "published" });
            continue;
          }
          const r = await ig.post<{ id?: unknown }>(`/${igId}/media_publish`, { creation_id: container });
          if (typeof r.id !== "string" && typeof r.id !== "number") throw new MetaApiError(0, "sm_ig_publish_unknown", "Instagram did not say whether the post went out.", { retry: true });
          const id = String(r.id);
          entries.set(key, { ...entries.get(key)!, state: "published", id, permalink: await permalink(ig, id) });
        }
      }
      if (comments.length) await pushCommentChanges(ctx, "instagram", ig, acc, async () => ctx.checkpoint?.(current()));
      return { ok: true, result: current(), line: LINES.ok };
    } catch (e) {
      return socialFailure(e, LINES, current());
    }
  },
};

/**
 * Tick step: refreshes each Instagram token older than 30 days (never one younger than 24 hours) and stores it encrypted, so a
 * venue that posts rarely keeps a working token (long-lived tokens expire after 60 days). Returns the venue ids refreshed.
 */
export async function refreshInstagramTokens(d: SyncDeps, o: { venueId?: string; now: Date }): Promise<string[]> {
  const log = d.log ?? ((s: string) => console.log(s));
  if (!d.secretKey) return [];
  const venueIds = o.venueId ? [o.venueId] : (await d.store.listVenues({ status: "live" })).map((v) => v.id);
  const out: string[] = [];
  for (const venueId of venueIds) {
    try {
      const dest = await d.store.getDestination(venueId, "instagram");
      if (!dest || dest.status === "disconnected") continue;
      const age = tokenAge(dest.config, o.now);
      if (age === "fresh") continue;
      const secrets = decryptSecrets(dest.secrets, d.secretKey);
      const next = age === "stale" && secrets.token ? await refreshToken(d.fetch ?? fetch, secrets.token) : null;
      if (age === "stale" && !next) continue;
      await d.store.upsertDestination({ venue_id: venueId, kind: "instagram", config: { ...dest.config, token_refreshed_at: o.now.toISOString() }, secrets: encryptSecrets(next ? { ...secrets, token: next } : secrets, d.secretKey), status: dest.status });
      if (next) out.push(venueId);
    } catch (e) {
      log(`[destinations] instagram token refresh for venue ${venueId} failed: ${e instanceof MetaApiError ? e.code : e instanceof Error ? e.name : "error"}`);
    }
  }
  return out;
}
