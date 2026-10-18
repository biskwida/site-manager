// src/social/comments-poll.ts
// Server-only. Reads the comments under the venue's posts of the last 14 days: the ones Site Manager published
// (destination_syncs results) and the account's own recent posts listed from Meta (one more call per network: a reconnect drops
// the sync rows, and owners also post by hand). Stores the comments not seen before (social_comments) and marks the venue's own
// comments and nested replies so they are never proposed. Per venue at most every 15 minutes (last_comment_poll_at in the destination config); v1 polls, webhooks come in
// phase 2 (docs/CHANNELS.md). Instagram tokens are refreshed by tick step 8 (refreshInstagramTokens), which runs before this.
// Logs carry venue ids, counts and error codes only: never comment text, never tokens.
import { FB_GRAPH, GraphClient, IG_GRAPH, MetaApiError } from "../destinations/meta-graph";
import { decryptSecrets } from "../destinations/secrets";
import { publishedTargets, type PublishedTarget } from "../destinations/social-common";
import { CONNECTION_CODES, type SyncDeps } from "../destinations/sync";
import { formatSyncError } from "../destinations/wp-errors";
import type { CommentNetwork, Venue } from "../domain/types";
import type { DestinationPatch, DestinationWithSecrets, NewSocialComment, SocialComment, Store } from "../store/types";
import { fetchFacebookComments, fetchInstagramComments, listFacebookPosts, listInstagramMedia, type AccountPost, type IncomingComment } from "./comments-graph";

export const COMMENT_POLL_EVERY_MS = 15 * 60_000;
/** An owner's question about comments reads Meta right then, but not again within this long after the last read of the venue. */
export const COMMENT_ON_DEMAND_MIN_GAP_MS = 60_000;
/** The overall cap of that live read (list_comments answers from the saved comments when it runs out). */
export const COMMENT_ON_DEMAND_TIMEOUT_MS = 10_000;
export const COMMENT_POST_WINDOW_MS = 14 * 24 * 3_600_000;
export const COMMENT_RETENTION_MS = 30 * 24 * 3_600_000;
/** The blanked rows stay this long (the monthly comment count reads replied_at), then they are deleted. */
export const COMMENT_ROW_RETENTION_MS = 60 * 24 * 3_600_000;
/** Facebook `since` on a repeat poll: the last poll minus this margin (the unique comment_id makes the overlap harmless). */
const SINCE_MARGIN_MS = 3_600_000;
const NETWORKS: readonly CommentNetwork[] = ["instagram", "facebook"];
/**
 * Errors that a retry cannot fix: the destination is marked `error` (the owner connects again) and polled, so it is neither
 * re-read nor logged every tick. CONNECTION_CODES (token, permission) plus a destination saved without its token or account id.
 */
const STOP_CODES: ReadonlySet<string> = new Set([...CONNECTION_CODES, "sm_social_not_connected"]);

export interface PollReport {
  polled: CommentNetwork[];
  inserted: SocialComment[];
  errors: { network: CommentNetwork; code: string }[];
}

const log = (d: SyncDeps, s: string) => (d.log ?? ((x: string) => console.log(x)))(s);
const codeOf = (e: unknown) => (e instanceof MetaApiError ? e.code : e instanceof Error ? e.name : "error");

function isDue(dest: DestinationWithSecrets, now: Date, minGapMs: number): boolean {
  const last = Date.parse(String(dest.config.last_comment_poll_at ?? ""));
  return !Number.isFinite(last) || now.getTime() - last >= minGapMs;
}

/** A post whose comments are read: what toRow needs of a published target or of a listed account post. */
type CommentTarget = Pick<PublishedTarget, "post_ref" | "caption" | "permalink">;

/**
 * Our published posts first (their caption comes from the change set), then the listed posts not among them, one per post_ref.
 * A listed post fills in what ours lacks (a caption when the change set is gone).
 */
export function mergeTargets(published: readonly PublishedTarget[], listed: readonly AccountPost[]): CommentTarget[] {
  const byRef = new Map(listed.map((p) => [p.post_ref, p]));
  const out: CommentTarget[] = published.map((t) => {
    const l = byRef.get(t.post_ref);
    return { post_ref: t.post_ref, caption: t.caption || l?.caption || "", permalink: t.permalink ?? l?.permalink ?? null };
  });
  const seen = new Set(out.map((t) => t.post_ref));
  for (const p of listed) {
    if (seen.has(p.post_ref)) continue;
    seen.add(p.post_ref);
    out.push({ post_ref: p.post_ref, caption: p.caption, permalink: p.permalink });
  }
  return out;
}

function toRow(c: IncomingComment, t: CommentTarget, ownId: string, now: Date): NewSocialComment {
  // An author without an id (a private Facebook profile) is a customer: an empty id never matches the venue's own.
  const status = c.parent_id !== null ? "nested" : c.author_id !== "" && c.author_id === ownId ? "own" : "new";
  return { network: c.network, post_ref: c.post_ref, comment_id: c.comment_id, parent_id: c.parent_id, author_id: c.author_id, author_name: c.author_name, text: c.text, created_at: c.created_at, seen_at: now.toISOString(), status, post_caption: t.caption, post_permalink: t.permalink };
}

async function readNetwork(d: SyncDeps, dest: DestinationWithSecrets, network: CommentNetwork, published: PublishedTarget[], now: Date): Promise<NewSocialComment[]> {
  const secrets = decryptSecrets(dest.secrets, d.secretKey as Buffer);
  const token = (network === "instagram" ? secrets.token : secrets.page_token) ?? "";
  const ownId = String((network === "instagram" ? dest.config.ig_user_id : dest.config.page_id) ?? "");
  if (!token || !ownId) throw new MetaApiError(0, "sm_social_not_connected", `${network} is not connected.`, { retry: false });
  const client = new GraphClient(network === "instagram" ? IG_GRAPH : FB_GRAPH, token, d.fetch ?? fetch);
  const last = Date.parse(String(dest.config.last_comment_poll_at ?? ""));
  const since = Number.isFinite(last) ? new Date(last - SINCE_MARGIN_MS).toISOString() : undefined;
  const oldest = now.getTime() - COMMENT_RETENTION_MS;
  const windowStart = new Date(now.getTime() - COMMENT_POST_WINDOW_MS).toISOString();
  let listed: AccountPost[] = [];
  try {
    listed = network === "instagram" ? await listInstagramMedia(client, ownId, windowStart) : await listFacebookPosts(client, ownId, windowStart);
  } catch (e) {
    // token/permission: the destination is marked; transient (or an abort/timeout): the network is retried, never stamped as polled
    // with nothing read. Any other refusal of the list falls back to the posts we published.
    if (e instanceof MetaApiError && (CONNECTION_CODES.has(e.code) || e.retryable)) throw e;
    log(d, `[comments] ${network} post list for venue ${dest.venue_id} failed: ${codeOf(e)}`);
  }
  const targets = mergeTargets(published, listed);
  const rows: NewSocialComment[] = [];
  for (const t of targets) {
    let comments: IncomingComment[];
    try {
      comments = network === "instagram" ? await fetchInstagramComments(client, t.post_ref) : await fetchFacebookComments(client, t.post_ref, since);
    } catch (e) {
      if (e instanceof MetaApiError && e.notFound) continue; // the post was deleted (an undo, or by hand): nothing to read
      if (e instanceof MetaApiError && !CONNECTION_CODES.has(e.code) && !e.retryable) {
        log(d, `[comments] ${network} read for venue ${dest.venue_id} skipped a post: ${e.code}`);
        continue; // this post refuses to be read (e.g. a 4xx of its own); the others still are
      }
      throw e; // token/permission (STOP_CODES): the destination is marked; transient: the whole network is retried on the next tick
    }
    for (const c of comments) if (Date.parse(c.created_at) >= oldest) rows.push(toRow(c, t, ownId, now)); // never store > 30 days
  }
  return rows;
}

/** Re-reads the destination and writes the patch onto its current config, so a concurrent writer (token refresh) is never reverted. */
async function markPolled(d: SyncDeps, venueId: string, network: CommentNetwork, now: Date, extra: Omit<DestinationPatch, "config"> = {}): Promise<void> {
  const fresh = await d.store.getDestination(venueId, network);
  if (!fresh) return; // disconnected meanwhile
  await d.store.updateDestination(fresh.id, { ...extra, config: { ...fresh.config, last_comment_poll_at: now.toISOString() } });
}

/**
 * One venue's poll: each connected network at most every 15 min. A token/permission error (or a destination saved without its
 * token or account id) marks the destination `error`
 * (the owner reconnects); any other error is logged and the network is tried again on the next tick (no last_comment_poll_at).
 * Never throws. `o.onDemand` (the owner asked about comments, src/agent/comment-tools.ts) uses the same reads and the same storing but
 * ignores the 15-minute throttle: a network is skipped only when it was read less than COMMENT_ON_DEMAND_MIN_GAP_MS ago.
 */
export async function pollVenueComments(d: SyncDeps, venue: Venue, now: Date, o: { onDemand?: boolean } = {}): Promise<PollReport> {
  const minGap = o.onDemand ? COMMENT_ON_DEMAND_MIN_GAP_MS : COMMENT_POLL_EVERY_MS;
  const report: PollReport = { polled: [], inserted: [], errors: [] };
  if (!d.secretKey) return report;
  let targets: PublishedTarget[] | null = null;
  for (const network of NETWORKS) {
    let dest: DestinationWithSecrets | null;
    try {
      dest = await d.store.getDestination(venue.id, network);
    } catch (e) {
      log(d, `[comments] ${network} destination read for venue ${venue.id} failed: ${codeOf(e)}`);
      continue;
    }
    if (!dest || dest.status !== "connected" || !isDue(dest, now, minGap)) continue;
    try {
      targets ??= await publishedTargets(d.store, venue.id, new Date(now.getTime() - COMMENT_POST_WINDOW_MS).toISOString());
      const mine = targets.filter((t) => t.network === network);
      const rows = await readNetwork(d, dest, network, mine, now);
      const inserted = await d.store.upsertComments(venue.id, rows);
      report.inserted.push(...inserted);
      report.polled.push(network);
      await markPolled(d, venue.id, network, now);
      if (inserted.length) log(d, `[comments] ${network} poll for venue ${venue.id}: ${inserted.length} new of ${rows.length} read`);
    } catch (e) {
      const code = codeOf(e);
      report.errors.push({ network, code });
      log(d, `[comments] ${network} poll for venue ${venue.id} failed: ${code}`);
      if (e instanceof MetaApiError && STOP_CODES.has(e.code)) {
        await markPolled(d, venue.id, network, now, { status: "error", last_error: formatSyncError(e.code, e.message) }).catch(() => undefined);
      }
    }
  }
  return report;
}

/**
 * Customer content is kept for 30 days at most (Meta policy): blanks the text, author name and author id of every venue's older comments and
 * of the comment change sets older than that. The blanked rows stay until 60 days so a reply made early in the month still
 * counts toward comment_limit (countCommentActions reads replied_at), then they are deleted. Returns how many rows were
 * deleted. Logs nothing of the text.
 */
export async function purgeOldComments(store: Pick<Store, "purgeComments" | "redactComments" | "redactCommentSets">, now: Date): Promise<number> {
  const before = new Date(now.getTime() - COMMENT_RETENTION_MS).toISOString();
  await store.redactComments(before);
  await store.redactCommentSets(before);
  return store.purgeComments(new Date(now.getTime() - COMMENT_ROW_RETENTION_MS).toISOString());
}

/** What list_comments needs to read Meta right then (AgentDeps.liveComments). */
export interface LiveComments {
  /** One on-demand poll of the venue; aborting `signal` stops its Graph calls. Never throws. An error without a network is not one network's. */
  poll(venueId: string, signal: AbortSignal): Promise<{ polled: CommentNetwork[]; errors: { network: CommentNetwork | null; code: string }[] }>;
  /**
   * When the venue's connected networks were last read successfully: `at` is the oldest of those that ever were (null when none),
   * `never` the connected networks that never were.
   */
  lastCheckedAt(venueId: string): Promise<{ at: string | null; never: CommentNetwork[] }>;
}

/** The on-demand poll over the same deps as the tick: every Graph call also stops when the caller's signal aborts. */
export function makeLiveComments(d: SyncDeps, now: () => Date): LiveComments {
  return {
    async poll(venueId, signal) {
      const base = d.fetch ?? fetch;
      const f: typeof fetch = (input, init) => base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
      try {
        return await pollVenueComments({ ...d, fetch: f }, await d.store.getVenue(venueId), now(), { onDemand: true });
      } catch (e) {
        log(d, `[comments] on-demand poll for venue ${venueId} failed: ${codeOf(e)}`);
        return { polled: [], errors: [{ network: null, code: codeOf(e) }] };
      }
    },
    async lastCheckedAt(venueId) {
      const times: number[] = [];
      const never: CommentNetwork[] = [];
      for (const network of NETWORKS) {
        const dest = await d.store.getDestination(venueId, network);
        if (!dest || dest.status !== "connected") continue; // an `error` destination's stamp is the failed attempt
        const t = Date.parse(String(dest.config.last_comment_poll_at ?? ""));
        if (Number.isFinite(t)) times.push(t);
        else never.push(network);
      }
      return { at: times.length ? new Date(Math.min(...times)).toISOString() : null, never };
    },
  };
}
