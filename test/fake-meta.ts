// test/fake-meta.ts
// In-memory stand-in for the Meta endpoints social posting uses, served through `fetch`:
// - graph.facebook.com/v25.0: OAuth code/long-lived exchange, /me (app-scoped id), /me/accounts, /{page}/photos, /{page}/photo_stories,
//   GET /{post}?fields=permalink_url, DELETE /{post} (feed posts only: a story DELETE fails with 100/33 like Meta),
//   GET /{page}/published_posts, GET /{page}/stories (what a retry checks before posting again)
// - graph.instagram.com/v25.0: /me, /{ig}/media (containers with status polling), /{ig}/media_publish, GET /{media}?fields=permalink,
//   /access_token (ig_exchange_token), /refresh_access_token (ig_refresh_token)
// - comments (comment replies): Facebook GET /{post}/comments (filter=toplevel, since, limit), POST /{comment}/comments,
//   POST /{comment} {is_hidden}, DELETE /{comment}; Instagram GET /{media}/comments (top-level with a replies edge),
//   POST /{comment}/replies (top-level only), POST /{comment} {hide}, DELETE /{comment}. Seed with addFacebookComment/addInstagramComment.
// - api.instagram.com/oauth/access_token (form POST): the short-lived Instagram token
// Tokens are read from the bearer header or an access_token query parameter, exactly like Graph.
import { randomBytes } from "node:crypto";

export interface FakePage { id: string; name: string; access_token: string; tasks: string[] }
export interface FakeIgUser { user_id: string; username: string; account_type: "BUSINESS" | "MEDIA_CREATOR" | "PERSONAL"; token: string }
export interface FakeFbPost { post_id: string; page_id: string; kind: "photo" | "story"; photo_id: string; url: string; caption: string; deleted: boolean; created_time: string }
export interface FakeContainer { id: string; user_id: string; image_url: string; caption: string; media_type: "IMAGE" | "STORIES"; polls: number; published: boolean; media_id: string | null }
export interface FakeIgMedia { id: string; user_id: string; image_url: string; caption: string; media_type: "IMAGE" | "STORIES"; permalink: string }
export interface FakeFailure { status: number; code: number; message: string; transient?: boolean; subcode?: number }
export interface FakeCall { method: string; host: string; path: string; url: string; body: Record<string, unknown> | null; auth: boolean }
/** A comment under a Facebook post or Instagram media (comment replies, 2026-10-15). owner_id = the Page id / Instagram user id whose token may act on it. */
export interface FakeComment { id: string; network: "facebook" | "instagram"; post_ref: string; owner_id: string; parent_id: string | null; from_id: string; from_name: string; text: string; created_time: string; hidden: boolean; deleted: boolean }

type Json = Record<string, unknown>;
const tok = (p: string) => `${p}${randomBytes(12).toString("hex")}`;
const num = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));

function graphError(status: number, code: number, message: string, extra: Json = {}): Response {
  return Response.json({ error: { message, type: code === 190 ? "OAuthException" : "GraphMethodException", code, fbtrace_id: "fake", ...extra } }, { status });
}

export class FakeMeta {
  appId = "fb-app-1";
  appSecret = "fb-secret-1";
  igAppId = "ig-app-1";
  igAppSecret = "ig-secret-1";
  pages = new Map<string, FakePage>();
  /** Unpublished photos uploaded for stories, by photo id. */
  photos = new Map<string, { page_id: string; url: string; published: boolean }>();
  /** Facebook posts and stories, by post id. */
  posts = new Map<string, FakeFbPost>();
  igUsers = new Map<string, FakeIgUser>();
  containers = new Map<string, FakeContainer>();
  igMedia = new Map<string, FakeIgMedia>();
  comments = new Map<string, FakeComment>();
  addFacebookComment(postId: string, o: { message: string; from_id?: string; from_name?: string; parent_id?: string; created?: Date }): FakeComment {
    const post = this.posts.get(postId);
    if (!post) throw new Error(`no post ${postId}`);
    const c: FakeComment = { id: `${postId}_${num()}`, network: "facebook", post_ref: postId, owner_id: post.page_id, parent_id: o.parent_id ?? null, from_id: o.from_id ?? num(), from_name: o.from_name ?? "Customer", text: o.message, created_time: this.stampAt(o.created), hidden: false, deleted: false };
    this.comments.set(c.id, c);
    return c;
  }
  addInstagramComment(mediaId: string, o: { text: string; from_id?: string; username?: string; parent_id?: string; created?: Date }): FakeComment {
    const m = this.igMedia.get(mediaId);
    if (!m) throw new Error(`no media ${mediaId}`);
    const c: FakeComment = { id: `178${num()}`, network: "instagram", post_ref: mediaId, owner_id: m.user_id, parent_id: o.parent_id ?? null, from_id: o.from_id ?? num(), from_name: o.username ?? "customer", text: o.text, created_time: this.stampAt(o.created), hidden: false, deleted: false };
    this.comments.set(c.id, c);
    return c;
  }
  calls: FakeCall[] = [];
  revoked = new Set<string>();
  failNext: FakeFailure | null = null;
  /** Fails every matching call (until cleared). */
  failOn: ((c: FakeCall) => FakeFailure | null) | null = null;
  unreachable = false;
  /** GET status_code answers IN_PROGRESS this many times per container, then the outcome. */
  pollsUntilFinished = 0;
  containerOutcome: "FINISHED" | "ERROR" | "EXPIRED" = "FINISHED";
  /** The request reaches Meta and takes effect, but the answer is lost (a timeout after sending): fetch throws. */
  dropResponse: ((c: FakeCall) => boolean) | null = null;
  /** media_publish answers without an id. */
  publishWithoutId = false;
  /** /me answers in Meta's `data: [...]` wrapper. */
  wrapMe = false;
  /** /me leaves out user_id. */
  meWithoutUserId = false;
  /** The Facebook user's app-scoped id (GET /me with a user token). */
  fbAppUserId = num();
  /** GET /me with a Facebook user token fails. */
  fbMeFails = false;
  /** Clock for created_time / creation_time. */
  now: () => Date = () => new Date();
  private fbCodes = new Map<string, string[]>();
  private fbUserTokens = new Map<string, { long: boolean; pages: string[] }>();
  private igCodes = new Map<string, string>();
  private igShortTokens = new Map<string, string>();
  private igTokens = new Map<string, string>();

  addPage(name: string, tasks: string[] = ["MANAGE", "CREATE_CONTENT", "MODERATE", "ADVERTISE", "ANALYZE"]): FakePage {
    const page: FakePage = { id: num(), name, access_token: tok("EAAPage"), tasks };
    this.pages.set(page.id, page);
    return page;
  }
  /** A one-time Facebook Login code for a user who manages `pageIds` (default: every page). */
  issueFacebookCode(pageIds?: string[]): string {
    const code = tok("fbcode");
    this.fbCodes.set(code, pageIds ?? [...this.pages.keys()]);
    return code;
  }
  addInstagramUser(username: string, account_type: FakeIgUser["account_type"] = "BUSINESS"): FakeIgUser {
    const u: FakeIgUser = { user_id: num(), username, account_type, token: tok("IGAALong") };
    this.igUsers.set(u.user_id, u);
    this.igTokens.set(u.token, u.user_id);
    return u;
  }
  issueInstagramCode(userId: string): string {
    const code = tok("igcode");
    this.igCodes.set(code, userId);
    return code;
  }
  revoke(token: string): void {
    this.revoked.add(token);
  }
  /** Every token value this fake ever handed out (for leak checks). */
  allTokens(): string[] {
    return [...[...this.pages.values()].map((p) => p.access_token), ...this.fbUserTokens.keys(), ...this.igShortTokens.keys(), ...this.igTokens.keys()];
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    let body: Json | null = null;
    if (typeof init?.body === "string") body = headers.get("content-type")?.includes("json") ? (JSON.parse(init.body) as Json) : Object.fromEntries(new URLSearchParams(init.body));
    else if (init?.body instanceof URLSearchParams) body = Object.fromEntries(init.body);
    const bearer = headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
    const prefix = url.pathname.match(/^\/v\d+\.\d+/)?.[0] ?? "";
    const path = url.pathname.slice(prefix.length) || "/";
    const call: FakeCall = { method, host: url.hostname, path, url: url.toString(), body, auth: bearer !== null };
    this.calls.push(call);
    if (this.unreachable) throw new TypeError("fetch failed");
    const injected = this.failNext ?? this.failOn?.(call) ?? null;
    this.failNext = null;
    if (injected) return graphError(injected.status, injected.code, injected.message, { ...(injected.transient ? { is_transient: true } : {}), ...(injected.subcode ? { error_subcode: injected.subcode } : {}) });
    const token = bearer ?? url.searchParams.get("access_token");
    if (token && this.revoked.has(token)) return graphError(400, 190, "Error validating access token: The session has been invalidated.");
    const res =
      url.hostname === "graph.facebook.com" ? this.facebook(method, path, url.searchParams, body, token)
      : url.hostname === "graph.instagram.com" ? this.instagram(method, path, url.searchParams, body, token)
      : url.hostname === "api.instagram.com" && path === "/oauth/access_token" && method === "POST" ? this.igCode(body ?? {})
      : graphError(400, 100, "Unsupported request");
    if (this.dropResponse?.(call)) throw new TypeError("fetch failed (the answer was lost)");
    return res;
  };

  /** Meta's timestamp format: 2026-10-11T09:00:00+0000. */
  private stamp(): string {
    return this.stampAt();
  }
  private stampAt(d: Date = this.now()): string {
    return d.toISOString().replace(/\.\d{3}Z$/, "+0000");
  }

  /** Facebook: `{ id, message, from, created_time, parent }`; Instagram: `{ id, text, timestamp, username, from, replies }`. Deleted comments are never listed. */
  private commentJson(c: FakeComment, withReplies: boolean): Json {
    // A Facebook author who keeps their profile private comes without `from` (seed with from_id "").
    if (c.network === "facebook") return { id: c.id, message: c.text, ...(c.from_id ? { from: { id: c.from_id, name: c.from_name } } : {}), created_time: c.created_time, ...(c.parent_id ? { parent: { id: c.parent_id } } : {}) };
    const replies = withReplies ? [...this.comments.values()].filter((r) => r.parent_id === c.id && !r.deleted) : [];
    return { id: c.id, text: c.text, timestamp: c.created_time, username: c.from_name, from: { id: c.from_id, username: c.from_name }, ...(c.parent_id ? { parent_id: c.parent_id } : {}), ...(replies.length ? { replies: { data: replies.map((r) => this.commentJson(r, false)) } } : {}) };
  }
  private listComments(network: "facebook" | "instagram", postRef: string, q: URLSearchParams): Json {
    const since = q.get("since") ? Number(q.get("since")) * 1000 : null;
    const all = [...this.comments.values()].filter((c) => c.network === network && c.post_ref === postRef && !c.deleted);
    const top = q.get("filter") === "toplevel" || network === "instagram" ? all.filter((c) => c.parent_id === null) : all;
    const rows = top.filter((c) => since === null || Date.parse(c.created_time.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) >= since).sort((a, b) => b.created_time.localeCompare(a.created_time)).slice(0, Number(q.get("limit") ?? 25));
    return { data: rows.map((c) => this.commentJson(c, true)) };
  }

  private pageForToken(token: string | null): FakePage | null {
    return [...this.pages.values()].find((p) => p.access_token === token) ?? null;
  }

  private facebook(method: string, path: string, q: URLSearchParams, body: Json | null, token: string | null): Response {
    if (method === "GET" && path === "/oauth/access_token") {
      if (q.get("client_id") !== this.appId || q.get("client_secret") !== this.appSecret) return graphError(400, 101, "Error validating client secret.");
      if (q.get("grant_type") === "fb_exchange_token") {
        const short = q.get("fb_exchange_token") ?? "";
        const u = this.fbUserTokens.get(short);
        if (!u || this.revoked.has(short)) return graphError(400, 190, "Invalid OAuth access token.");
        const long = tok("EAAUserLong");
        this.fbUserTokens.set(long, { long: true, pages: u.pages });
        return Response.json({ access_token: long, token_type: "bearer", expires_in: 5_184_000 });
      }
      const pages = this.fbCodes.get(q.get("code") ?? "");
      if (!pages || !q.get("redirect_uri")) return graphError(400, 100, "Invalid verification code format.");
      this.fbCodes.delete(q.get("code")!);
      const short = tok("EAAUser");
      this.fbUserTokens.set(short, { long: false, pages });
      return Response.json({ access_token: short, token_type: "bearer", expires_in: 3600 });
    }
    if (method === "GET" && path === "/me") {
      const u = token ? this.fbUserTokens.get(token) : undefined;
      if (!u || this.fbMeFails) return graphError(400, 190, "Invalid OAuth access token.");
      return Response.json({ id: this.fbAppUserId });
    }
    if (method === "GET" && path === "/me/accounts") {
      const u = token ? this.fbUserTokens.get(token) : undefined;
      if (!u) return graphError(400, 190, "Invalid OAuth access token.");
      return Response.json({ data: u.pages.map((id) => this.pages.get(id)).filter((p): p is FakePage => !!p).map((p) => ({ id: p.id, name: p.name, access_token: p.access_token, tasks: p.tasks })) });
    }
    const parts = path.split("/").filter(Boolean);
    // Comments (comment replies, 2026-10-15): GET /{post}/comments, POST /{comment}/comments, POST /{comment} {is_hidden}, DELETE /{comment}.
    if (parts.length === 2 && parts[1] === "comments") {
      const post = this.posts.get(parts[0]);
      const parent = this.comments.get(parts[0]);
      const ownerId = post?.page_id ?? parent?.owner_id;
      if ((!post || post.deleted) && (!parent || parent.deleted || parent.network !== "facebook")) return graphError(400, 100, "Unsupported request. Object does not exist.", { error_subcode: 33 });
      const page = this.pageForToken(token);
      if (!page || page.id !== ownerId) return graphError(400, 190, "Invalid OAuth access token.");
      if (method === "GET") return Response.json(this.listComments("facebook", post ? post.post_id : (parent as FakeComment).id, q));
      if (method === "POST" && parent) {
        const c: FakeComment = { id: `${parent.post_ref}_${num()}`, network: "facebook", post_ref: parent.post_ref, owner_id: page.id, parent_id: parent.id, from_id: page.id, from_name: page.name, text: String(body?.message ?? ""), created_time: this.stamp(), hidden: false, deleted: false };
        this.comments.set(c.id, c);
        return Response.json({ id: c.id });
      }
      return graphError(400, 100, "Unsupported request");
    }
    if (parts.length === 1 && this.comments.has(parts[0]) && this.comments.get(parts[0])!.network === "facebook") {
      const c = this.comments.get(parts[0])!;
      if (c.deleted) return graphError(400, 100, "Unsupported request. Object does not exist.", { error_subcode: 33 });
      if (this.pageForToken(token)?.id !== c.owner_id) return graphError(400, 190, "Invalid OAuth access token.");
      if (method === "GET") return Response.json({ id: c.id, message: c.text, is_hidden: c.hidden });
      if (method === "POST" && typeof body?.is_hidden === "boolean") {
        c.hidden = body.is_hidden;
        return Response.json({ success: true });
      }
      if (method === "DELETE") {
        c.deleted = true;
        return Response.json({ success: true });
      }
      return graphError(400, 100, "Unsupported request");
    }
    if (parts.length === 2 && method === "POST") {
      const page = this.pages.get(parts[0]);
      if (!page) return graphError(400, 100, "Unsupported post request. Object does not exist.", { error_subcode: 33 });
      if (this.pageForToken(token)?.id !== page.id) return graphError(400, 190, "Invalid OAuth access token.");
      if (parts[1] === "photos") {
        const url = String(body?.url ?? "");
        if (!url.startsWith("https://")) return graphError(400, 324, "Missing or invalid image file");
        const photoId = num();
        const published = body?.published !== false;
        this.photos.set(photoId, { page_id: page.id, url, published });
        if (!published) return Response.json({ id: photoId });
        const postId = `${page.id}_${num()}`;
        this.posts.set(postId, { post_id: postId, page_id: page.id, kind: "photo", photo_id: photoId, url, caption: String(body?.caption ?? ""), deleted: false, created_time: this.stamp() });
        return Response.json({ id: photoId, post_id: postId });
      }
      if (parts[1] === "photo_stories") {
        const photo = this.photos.get(String(body?.photo_id ?? ""));
        if (!photo || photo.page_id !== page.id || photo.published) return graphError(400, 100, "Invalid photo_id");
        const postId = num();
        this.posts.set(postId, { post_id: postId, page_id: page.id, kind: "story", photo_id: String(body?.photo_id), url: photo.url, caption: "", deleted: false, created_time: this.stamp() });
        return Response.json({ success: true, post_id: postId });
      }
      return graphError(400, 100, "Unsupported request");
    }
    if (parts.length === 2 && method === "GET" && (parts[1] === "published_posts" || parts[1] === "stories")) {
      const page = this.pages.get(parts[0]);
      if (!page || this.pageForToken(token)?.id !== page.id) return graphError(400, 190, "Invalid OAuth access token.");
      const kind = parts[1] === "stories" ? "story" : "photo";
      const rows = [...this.posts.values()].filter((p) => p.page_id === page.id && p.kind === kind && !p.deleted).reverse().slice(0, Number(q.get("limit") ?? 25));
      return Response.json({
        data: kind === "photo"
          ? rows.map((p) => ({ id: p.post_id, created_time: p.created_time, ...(p.caption ? { message: p.caption } : {}) }))
          : rows.map((p) => ({ post_id: p.post_id, status: "PUBLISHED", creation_time: p.created_time, media_type: "photo", media_id: p.photo_id })),
      });
    }
    if (parts.length === 1) {
      const page = this.pages.get(parts[0]);
      if (page && method === "GET") return this.pageForToken(token)?.id === page.id ? Response.json({ id: page.id, name: page.name }) : graphError(400, 190, "Invalid OAuth access token.");
      const post = this.posts.get(parts[0]);
      if (!post || post.deleted) return graphError(400, 100, "Unsupported request. Object does not exist.", { error_subcode: 33 });
      if (this.pageForToken(token)?.id !== post.page_id) return graphError(400, 190, "Invalid OAuth access token.");
      if (method === "GET") return Response.json({ id: post.post_id, permalink_url: post.kind === "story" ? `https://www.facebook.com/stories/${post.page_id}/${post.post_id}/` : `https://www.facebook.com/${post.page_id}/posts/${post.post_id.split("_")[1]}` });
      if (method === "DELETE") {
        if (post.kind === "story") return graphError(400, 100, "Unsupported delete request. Object does not exist, cannot be loaded due to missing permissions, or does not support this operation.", { error_subcode: 33 });
        post.deleted = true;
        return Response.json({ success: true });
      }
    }
    return graphError(400, 100, "Unsupported request");
  }

  private igUserFor(token: string | null): FakeIgUser | null {
    const id = token ? this.igTokens.get(token) : undefined;
    return id ? (this.igUsers.get(id) ?? null) : null;
  }

  private containerStatus(c: FakeContainer): string {
    if (c.published) return "PUBLISHED";
    return c.polls <= this.pollsUntilFinished ? "IN_PROGRESS" : this.containerOutcome;
  }

  private instagram(method: string, path: string, q: URLSearchParams, body: Json | null, token: string | null): Response {
    if (method === "GET" && path === "/access_token") {
      const short = q.get("access_token") ?? "";
      const userId = this.igShortTokens.get(short);
      if (q.get("grant_type") !== "ig_exchange_token" || q.get("client_secret") !== this.igAppSecret || !userId) return graphError(400, 190, "Invalid OAuth access token.");
      const long = tok("IGAALong");
      this.igTokens.set(long, userId);
      return Response.json({ access_token: long, token_type: "bearer", expires_in: 5_183_944 });
    }
    if (method === "GET" && path === "/refresh_access_token") {
      const old = q.get("access_token") ?? "";
      const userId = this.igTokens.get(old);
      if (q.get("grant_type") !== "ig_refresh_token" || !userId) return graphError(400, 190, "Invalid OAuth access token.");
      const fresh = tok("IGAARefreshed");
      this.igTokens.set(fresh, userId);
      const u = this.igUsers.get(userId);
      if (u) u.token = fresh;
      return Response.json({ access_token: fresh, token_type: "bearer", expires_in: 5_183_944 });
    }
    const user = this.igUserFor(token);
    if (!user) return graphError(400, 190, "Invalid OAuth access token.");
    if (method === "GET" && path === "/me") {
      const me = { id: `app-scoped-${user.user_id}`, ...(this.meWithoutUserId ? {} : { user_id: user.user_id }), username: user.username, account_type: user.account_type };
      return Response.json(this.wrapMe ? { data: [me] } : me);
    }
    const parts = path.split("/").filter(Boolean);
    // Comments (comment replies, 2026-10-15): GET /{media}/comments, POST /{comment}/replies, POST /{comment} {hide}, DELETE /{comment}.
    if (parts.length === 2 && parts[1] === "comments" && method === "GET") {
      const m = this.igMedia.get(parts[0]);
      if (!m) return graphError(400, 100, "Unsupported get request. Object does not exist.", { error_subcode: 33 });
      if (m.user_id !== user.user_id) return graphError(400, 190, "Invalid OAuth access token.");
      return Response.json(this.listComments("instagram", m.id, q));
    }
    const ic = parts.length >= 1 ? this.comments.get(parts[0]) : undefined;
    if (ic && ic.network === "instagram") {
      if (ic.deleted) return graphError(400, 100, "Unsupported request. Object does not exist.", { error_subcode: 33 });
      if (ic.owner_id !== user.user_id) return graphError(400, 190, "Invalid OAuth access token.");
      if (parts.length === 2 && parts[1] === "replies" && method === "POST") {
        if (ic.parent_id !== null) return graphError(400, 100, "Instagram cannot reply to a reply.");
        const c: FakeComment = { id: `178${num()}`, network: "instagram", post_ref: ic.post_ref, owner_id: user.user_id, parent_id: ic.id, from_id: user.user_id, from_name: user.username, text: String(body?.message ?? ""), created_time: this.stamp(), hidden: false, deleted: false };
        this.comments.set(c.id, c);
        return Response.json({ id: c.id });
      }
      if (parts.length === 1 && method === "GET") return Response.json({ id: ic.id, text: ic.text, hidden: ic.hidden });
      if (parts.length === 1 && method === "POST" && typeof body?.hide === "boolean") {
        ic.hidden = body.hide;
        return Response.json({ success: true });
      }
      if (parts.length === 1 && method === "DELETE") {
        ic.deleted = true;
        return Response.json({ success: true });
      }
      return graphError(400, 100, "Unsupported request");
    }
    if (method === "POST" && parts.length === 2 && parts[0] === user.user_id) {
      if (parts[1] === "media") {
        const imageUrl = String(body?.image_url ?? "");
        if (!imageUrl.startsWith("https://")) return graphError(400, 9004, "The media could not be fetched from this uri");
        const c: FakeContainer = { id: num(), user_id: user.user_id, image_url: imageUrl, caption: String(body?.caption ?? ""), media_type: body?.media_type === "STORIES" ? "STORIES" : "IMAGE", polls: 0, published: false, media_id: null };
        this.containers.set(c.id, c);
        return Response.json({ id: c.id });
      }
      if (parts[1] === "media_publish") {
        const c = this.containers.get(String(body?.creation_id ?? ""));
        if (!c || c.user_id !== user.user_id || c.published || this.containerStatus(c) !== "FINISHED") return graphError(400, 9007, "The media is not ready for publishing, please wait for a moment");
        c.published = true;
        const id = num();
        c.media_id = id;
        const permalink = c.media_type === "STORIES" ? `https://www.instagram.com/stories/${user.username}/${id}/` : `https://www.instagram.com/p/C${id}/`;
        this.igMedia.set(id, { id, user_id: user.user_id, image_url: c.image_url, caption: c.caption, media_type: c.media_type, permalink });
        return Response.json(this.publishWithoutId ? { success: true } : { id });
      }
    }
    if (method === "GET" && parts.length === 1) {
      const c = this.containers.get(parts[0]);
      if (c && c.user_id === user.user_id) {
        c.polls++;
        const status_code = this.containerStatus(c);
        return Response.json({ id: c.id, status_code, status: status_code === "ERROR" ? "Error: The image's aspect ratio is not supported (2207009)" : status_code === "EXPIRED" ? "Expired" : status_code === "PUBLISHED" ? "Published" : status_code === "FINISHED" ? "Finished" : "In progress" });
      }
      const m = this.igMedia.get(parts[0]);
      if (m && m.user_id === user.user_id) return Response.json({ id: m.id, permalink: m.permalink });
      return graphError(400, 100, "Unsupported get request. Object does not exist.", { error_subcode: 33 });
    }
    return graphError(400, 100, "Unsupported request");
  }

  private igCode(body: Json): Response {
    const userId = this.igCodes.get(String(body.code ?? ""));
    if (body.client_id !== this.igAppId || body.client_secret !== this.igAppSecret || body.grant_type !== "authorization_code" || !body.redirect_uri || !userId) {
      return Response.json({ error_type: "OAuthException", code: 400, error_message: "Invalid authorization code" }, { status: 400 });
    }
    this.igCodes.delete(String(body.code));
    const short = tok("IGAAShort");
    this.igShortTokens.set(short, userId);
    return Response.json({ data: [{ access_token: short, user_id: Number(userId), permissions: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights" }] });
  }
}
