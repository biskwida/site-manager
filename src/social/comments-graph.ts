// src/social/comments-graph.ts
// Server-only. Reads and writes customer comments under the venue's posts through GraphClient (bearer token, never in a URL):
// Instagram API with Instagram Login (graph.instagram.com) and the Facebook Page token (graph.facebook.com), both v25.0.
// Facts verified 2026-10-14/15: Instagram lists at most 50 comments per call, newest first, no time filter, replies ride under
// their parent (`replies` edge); Facebook takes filter=toplevel, order=reverse_chronological and since (unix seconds).
// Instagram can reply to top-level comments only; both return the new comment id; DELETE /{id} removes our own reply.
import { GraphClient, MetaApiError, metaTime } from "../destinations/meta-graph";
import type { CommentNetwork, ModerateAction } from "../domain/types";

export const COMMENTS_PER_CALL = 50;
const IG_FIELDS = encodeURIComponent("id,text,timestamp,username,from,parent_id,replies{id,text,timestamp,username,from}");
const FB_FIELDS = encodeURIComponent("id,message,from,created_time,parent");

/** One comment as both networks are normalised to: Meta ids as strings, the author's platform id and display name, ISO time. */
export interface IncomingComment {
  network: CommentNetwork;
  post_ref: string;
  comment_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  text: string;
  created_at: string;
}

type Raw = Record<string, unknown>;
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object") : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const enc = (id: string) => encodeURIComponent(id);
/** Meta's "+0000" timestamps → ISO; null when unreadable (such a row is skipped: the 30-day rules need a time). */
function isoOf(raw: unknown): string | null {
  const ms = metaTime(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function igComment(raw: Raw, mediaId: string, parentId: string | null): IncomingComment | null {
  const id = str(raw.id);
  const created_at = isoOf(raw.timestamp);
  if (!id || !created_at) return null;
  const from = (raw.from ?? {}) as Raw;
  return { network: "instagram", post_ref: mediaId, comment_id: id, parent_id: parentId ?? (str(raw.parent_id) || null), author_id: str(from.id), author_name: str(from.username) || str(raw.username), text: str(raw.text), created_at };
}

/** Top-level comments of one Instagram media and their replies (parent_id set), as Meta orders them (newest first). */
export async function fetchInstagramComments(client: GraphClient, mediaId: string): Promise<IncomingComment[]> {
  const r = await client.get<{ data?: unknown }>(`/${enc(mediaId)}/comments?fields=${IG_FIELDS}&limit=${COMMENTS_PER_CALL}`);
  const out: IncomingComment[] = [];
  for (const raw of rows(r.data)) {
    const top = igComment(raw, mediaId, null);
    if (!top) continue;
    out.push(top);
    for (const rep of rows((raw.replies as Raw | undefined)?.data)) {
      const nested = igComment(rep, mediaId, top.comment_id);
      if (nested) out.push(nested);
    }
  }
  return out;
}

/** Top-level comments of one Facebook post, newest first; `since` (ISO) limits to comments created at or after it. */
export async function fetchFacebookComments(client: GraphClient, postId: string, since?: string): Promise<IncomingComment[]> {
  const s = since ? Date.parse(since) : NaN;
  const sinceParam = Number.isFinite(s) ? `&since=${Math.floor(s / 1000)}` : ""; // an unreadable since is dropped, never sent as NaN
  const r = await client.get<{ data?: unknown }>(`/${enc(postId)}/comments?filter=toplevel&order=reverse_chronological&fields=${FB_FIELDS}&limit=${COMMENTS_PER_CALL}${sinceParam}`);
  const out: IncomingComment[] = [];
  for (const raw of rows(r.data)) {
    const id = str(raw.id);
    const created_at = isoOf(raw.created_time);
    if (!id || !created_at) continue;
    const from = (raw.from ?? {}) as Raw;
    const parent = (raw.parent ?? null) as Raw | null;
    out.push({ network: "facebook", post_ref: postId, comment_id: id, parent_id: parent ? str(parent.id) || null : null, author_id: str(from.id), author_name: str(from.name), text: str(raw.message), created_at });
  }
  return out;
}

function idOf(r: { id?: unknown }, what: string): string {
  if (typeof r.id === "string" && r.id) return r.id;
  if (typeof r.id === "number") return String(r.id);
  throw new MetaApiError(0, "sm_reply_unknown", `${what} did not confirm the reply.`, { retry: true });
}

/** POST /{ig-comment-id}/replies → the new comment's id. Top-level comments only (Instagram refuses a reply to a reply). */
export async function replyInstagram(client: GraphClient, commentId: string, message: string): Promise<string> {
  return idOf(await client.post<{ id?: unknown }>(`/${enc(commentId)}/replies`, { message }), "Instagram");
}

/** POST /{comment-id}/comments with the Page token → the new comment's id. */
export async function replyFacebook(client: GraphClient, commentId: string, message: string): Promise<string> {
  return idOf(await client.post<{ id?: unknown }>(`/${enc(commentId)}/comments`, { message }), "Facebook");
}

const OWN_REPLY_FIELDS = { instagram: encodeURIComponent("id,text,from,username"), facebook: encodeURIComponent("id,message,from") };

/**
 * After a reply call whose answer was lost or came without an id: the id of a reply under `commentId` by the venue's own
 * account (`ownId` = the Instagram user id / Page id) with the same text, or null when there is none. Instagram reads
 * GET /{comment-id}/replies, Facebook GET /{comment-id}/comments (newest first). Errors propagate (a gone comment is notFound).
 */
export async function findOwnReply(client: GraphClient, network: CommentNetwork, commentId: string, ownId: string, message: string): Promise<string | null> {
  const path = network === "instagram"
    ? `/${enc(commentId)}/replies?fields=${OWN_REPLY_FIELDS.instagram}&limit=${COMMENTS_PER_CALL}`
    : `/${enc(commentId)}/comments?fields=${OWN_REPLY_FIELDS.facebook}&order=reverse_chronological&limit=${COMMENTS_PER_CALL}`;
  const r = await client.get<{ data?: unknown }>(path);
  const want = message.trim();
  for (const raw of rows(r.data)) {
    const id = str(raw.id);
    const from = (raw.from ?? {}) as Raw;
    const text = str(network === "instagram" ? raw.text : raw.message);
    if (id && str(from.id) === ownId && text.trim() === want) return id;
  }
  return null;
}

/** hide/unhide: POST /{ig-comment-id} { hide }; delete: DELETE /{ig-comment-id}. */
export async function moderateInstagram(client: GraphClient, commentId: string, action: ModerateAction): Promise<void> {
  if (action === "delete") await client.delete(`/${enc(commentId)}`);
  else await client.post(`/${enc(commentId)}`, { hide: action === "hide" });
}

/** hide/unhide: POST /{comment-id} { is_hidden }; delete: DELETE /{comment-id}. */
export async function moderateFacebook(client: GraphClient, commentId: string, action: ModerateAction): Promise<void> {
  if (action === "delete") await client.delete(`/${enc(commentId)}`);
  else await client.post(`/${enc(commentId)}`, { is_hidden: action === "hide" });
}

/** DELETE /{reply-id} on either host; a reply that is already gone counts as deleted. */
export async function deleteReply(client: GraphClient, replyId: string): Promise<void> {
  try {
    await client.delete(`/${enc(replyId)}`);
  } catch (e) {
    if (!(e instanceof MetaApiError && e.notFound)) throw e;
  }
}
