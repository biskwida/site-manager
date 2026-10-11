// test/fake-meta.ts
// In-memory stand-in for the Meta endpoints social posting uses, served through `fetch`:
// - graph.facebook.com/v25.0: OAuth code/long-lived exchange, /me/accounts, /{page}/photos, /{page}/photo_stories,
//   GET /{post}?fields=permalink_url, DELETE /{post}
// - graph.instagram.com/v25.0: /me, /{ig}/media (containers with status polling), /{ig}/media_publish, GET /{media}?fields=permalink,
//   /access_token (ig_exchange_token), /refresh_access_token (ig_refresh_token)
// - api.instagram.com/oauth/access_token (form POST): the short-lived Instagram token
// Tokens are read from the bearer header or an access_token query parameter, exactly like Graph.
import { randomBytes } from "node:crypto";

export interface FakePage { id: string; name: string; access_token: string; tasks: string[] }
export interface FakeIgUser { user_id: string; username: string; account_type: "BUSINESS" | "MEDIA_CREATOR" | "PERSONAL"; token: string }
export interface FakeFbPost { post_id: string; page_id: string; kind: "photo" | "story"; photo_id: string; url: string; caption: string; deleted: boolean }
export interface FakeContainer { id: string; user_id: string; image_url: string; caption: string; media_type: "IMAGE" | "STORIES"; polls: number; published: boolean }
export interface FakeIgMedia { id: string; user_id: string; image_url: string; caption: string; media_type: "IMAGE" | "STORIES"; permalink: string }
export interface FakeFailure { status: number; code: number; message: string; transient?: boolean; subcode?: number }
export interface FakeCall { method: string; host: string; path: string; url: string; body: Record<string, unknown> | null; auth: boolean }

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
  calls: FakeCall[] = [];
  revoked = new Set<string>();
  failNext: FakeFailure | null = null;
  /** Fails every matching call (until cleared). */
  failOn: ((c: FakeCall) => FakeFailure | null) | null = null;
  unreachable = false;
  /** GET status_code answers IN_PROGRESS this many times per container, then the outcome. */
  pollsUntilFinished = 0;
  containerOutcome: "FINISHED" | "ERROR" | "EXPIRED" = "FINISHED";
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
    if (url.hostname === "graph.facebook.com") return this.facebook(method, path, url.searchParams, body, token);
    if (url.hostname === "graph.instagram.com") return this.instagram(method, path, url.searchParams, body, token);
    if (url.hostname === "api.instagram.com" && path === "/oauth/access_token" && method === "POST") return this.igCode(body ?? {});
    return graphError(400, 100, "Unsupported request");
  };

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
    if (method === "GET" && path === "/me/accounts") {
      const u = token ? this.fbUserTokens.get(token) : undefined;
      if (!u) return graphError(400, 190, "Invalid OAuth access token.");
      return Response.json({ data: u.pages.map((id) => this.pages.get(id)).filter((p): p is FakePage => !!p).map((p) => ({ id: p.id, name: p.name, access_token: p.access_token, tasks: p.tasks })) });
    }
    const parts = path.split("/").filter(Boolean);
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
        this.posts.set(postId, { post_id: postId, page_id: page.id, kind: "photo", photo_id: photoId, url, caption: String(body?.caption ?? ""), deleted: false });
        return Response.json({ id: photoId, post_id: postId });
      }
      if (parts[1] === "photo_stories") {
        const photo = this.photos.get(String(body?.photo_id ?? ""));
        if (!photo || photo.page_id !== page.id || photo.published) return graphError(400, 100, "Invalid photo_id");
        const postId = num();
        this.posts.set(postId, { post_id: postId, page_id: page.id, kind: "story", photo_id: String(body?.photo_id), url: photo.url, caption: "", deleted: false });
        return Response.json({ success: true, post_id: postId });
      }
      return graphError(400, 100, "Unsupported request");
    }
    if (parts.length === 1) {
      const page = this.pages.get(parts[0]);
      if (page && method === "GET") return this.pageForToken(token)?.id === page.id ? Response.json({ id: page.id, name: page.name }) : graphError(400, 190, "Invalid OAuth access token.");
      const post = this.posts.get(parts[0]);
      if (!post || post.deleted) return graphError(400, 100, "Unsupported request. Object does not exist.", { error_subcode: 33 });
      if (this.pageForToken(token)?.id !== post.page_id) return graphError(400, 190, "Invalid OAuth access token.");
      if (method === "GET") return Response.json({ id: post.post_id, permalink_url: post.kind === "story" ? `https://www.facebook.com/stories/${post.page_id}/${post.post_id}/` : `https://www.facebook.com/${post.page_id}/posts/${post.post_id.split("_")[1]}` });
      if (method === "DELETE") {
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
    if (method === "GET" && path === "/me") return Response.json({ id: user.user_id, user_id: user.user_id, username: user.username, account_type: user.account_type });
    const parts = path.split("/").filter(Boolean);
    if (method === "POST" && parts.length === 2 && parts[0] === user.user_id) {
      if (parts[1] === "media") {
        const imageUrl = String(body?.image_url ?? "");
        if (!imageUrl.startsWith("https://")) return graphError(400, 9004, "The media could not be fetched from this uri");
        const c: FakeContainer = { id: num(), user_id: user.user_id, image_url: imageUrl, caption: String(body?.caption ?? ""), media_type: body?.media_type === "STORIES" ? "STORIES" : "IMAGE", polls: 0, published: false };
        this.containers.set(c.id, c);
        return Response.json({ id: c.id });
      }
      if (parts[1] === "media_publish") {
        const c = this.containers.get(String(body?.creation_id ?? ""));
        if (!c || c.user_id !== user.user_id || c.published || this.containerStatus(c) !== "FINISHED") return graphError(400, 9007, "The media is not ready for publishing, please wait for a moment");
        c.published = true;
        const id = num();
        const permalink = c.media_type === "STORIES" ? `https://www.instagram.com/stories/${user.username}/${id}/` : `https://www.instagram.com/p/C${id}/`;
        this.igMedia.set(id, { id, user_id: user.user_id, image_url: c.image_url, caption: c.caption, media_type: c.media_type, permalink });
        return Response.json({ id });
      }
    }
    if (method === "GET" && parts.length === 1) {
      const c = this.containers.get(parts[0]);
      if (c && c.user_id === user.user_id) {
        c.polls++;
        return Response.json({ id: c.id, status_code: this.containerStatus(c) });
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
    return Response.json({ data: [{ access_token: short, user_id: Number(userId), permissions: "instagram_business_basic,instagram_business_content_publish" }] });
  }
}
