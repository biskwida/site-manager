// test/comments-graph.test.ts — reading and writing comments on both networks: real payload shapes, then the fake Meta server.
import { describe, expect, it } from "vitest";
import { FB_GRAPH, GraphClient, IG_GRAPH, MetaApiError } from "@/src/destinations/meta-graph";
import { ACCOUNT_POSTS_PER_CALL, COMMENTS_PER_CALL, deleteReply, fetchFacebookComments, fetchInstagramComments, listFacebookPosts, listInstagramMedia, moderateFacebook, moderateInstagram, replyFacebook, replyInstagram } from "@/src/social/comments-graph";
import { FakeMeta } from "./fake-meta";

/** Answers every call with `body`; records the requests. */
function scripted(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

// Shapes as Meta returns them (verified 2026-10-14/15): Instagram with Instagram Login, Facebook Page token.
const IG_PAYLOAD = {
  data: [
    { id: "17890000000000001", text: "Имате ли безглутенови?", timestamp: "2026-10-15T08:00:00+0000", username: "maria.k", from: { id: "1784000000000001", username: "maria.k" },
      replies: { data: [{ id: "17890000000000002", text: "Да, всеки ден!", timestamp: "2026-10-15T08:30:00+0000", username: "agala.cafe", from: { id: "9999", username: "agala.cafe" }, parent_id: "17890000000000001" }] } },
    { id: "17890000000000003", text: "🔥🔥", timestamp: "2026-10-15T07:00:00+0000", username: "ivan", from: { id: "1784000000000002", username: "ivan" } },
    { id: "17890000000000004", text: "no time" },
  ],
  paging: { cursors: { before: "QVFI", after: "QVFJ" } },
};
const FB_PAYLOAD = {
  data: [
    { id: "123_456", message: "Great place!", from: { id: "77", name: "Ivan Petrov" }, created_time: "2026-10-15T08:00:00+0000" },
    { id: "123_457", message: "private author", created_time: "2026-10-15T07:59:00+0000" },
  ],
  paging: { cursors: { before: "x", after: "y" } },
};

describe("fetchInstagramComments", () => {
  it("asks /{media}/comments with the fields and the 50 limit, flattens replies with parent_id, skips rows without a time", async () => {
    const { f, calls } = scripted(IG_PAYLOAD);
    const out = await fetchInstagramComments(new GraphClient(IG_GRAPH, "IGTOKEN", f), "17950000000000009");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${IG_GRAPH}/17950000000000009/comments?fields=${encodeURIComponent("id,text,timestamp,username,from,parent_id,replies{id,text,timestamp,username,from}")}&limit=${COMMENTS_PER_CALL}`);
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer IGTOKEN");
    expect(calls[0].url).not.toContain("IGTOKEN");
    expect(out).toEqual([
      { network: "instagram", post_ref: "17950000000000009", comment_id: "17890000000000001", parent_id: null, author_id: "1784000000000001", author_name: "maria.k", text: "Имате ли безглутенови?", created_at: "2026-10-15T08:00:00.000Z" },
      { network: "instagram", post_ref: "17950000000000009", comment_id: "17890000000000002", parent_id: "17890000000000001", author_id: "9999", author_name: "agala.cafe", text: "Да, всеки ден!", created_at: "2026-10-15T08:30:00.000Z" },
      { network: "instagram", post_ref: "17950000000000009", comment_id: "17890000000000003", parent_id: null, author_id: "1784000000000002", author_name: "ivan", text: "🔥🔥", created_at: "2026-10-15T07:00:00.000Z" },
    ]);
    expect(COMMENTS_PER_CALL).toBe(50);
  });
  it("returns [] for an empty or missing data array", async () => {
    expect(await fetchInstagramComments(new GraphClient(IG_GRAPH, "t", scripted({ data: [] }).f), "1")).toEqual([]);
    expect(await fetchInstagramComments(new GraphClient(IG_GRAPH, "t", scripted({}).f), "1")).toEqual([]);
  });
  it("passes Meta errors through as MetaApiError", async () => {
    const { f } = scripted({ error: { message: "Invalid OAuth access token.", code: 190 } }, 400);
    await expect(fetchInstagramComments(new GraphClient(IG_GRAPH, "t", f), "1")).rejects.toMatchObject({ name: "MetaApiError", code: "sm_meta_token" });
  });
});

describe("fetchFacebookComments", () => {
  it("asks for top-level comments newest first, with since as unix seconds, and tolerates a missing from", async () => {
    const { f, calls } = scripted(FB_PAYLOAD);
    const out = await fetchFacebookComments(new GraphClient(FB_GRAPH, "PAGETOKEN", f), "123", "2026-10-01T00:00:00.000Z");
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v25.0/123/comments");
    expect(url.searchParams.get("filter")).toBe("toplevel");
    expect(url.searchParams.get("order")).toBe("reverse_chronological");
    expect(url.searchParams.get("fields")).toBe("id,message,from,created_time,parent");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("since")).toBe(String(Math.floor(Date.parse("2026-10-01T00:00:00.000Z") / 1000)));
    expect(out).toEqual([
      { network: "facebook", post_ref: "123", comment_id: "123_456", parent_id: null, author_id: "77", author_name: "Ivan Petrov", text: "Great place!", created_at: "2026-10-15T08:00:00.000Z" },
      { network: "facebook", post_ref: "123", comment_id: "123_457", parent_id: null, author_id: "", author_name: "", text: "private author", created_at: "2026-10-15T07:59:00.000Z" },
    ]);
  });
  it("sends no since when none is given", async () => {
    const { f, calls } = scripted({ data: [] });
    await fetchFacebookComments(new GraphClient(FB_GRAPH, "t", f), "123");
    expect(new URL(calls[0].url).searchParams.has("since")).toBe(false);
  });
  it("drops an unreadable since instead of sending since=NaN", async () => {
    const { f, calls } = scripted({ data: [] });
    await fetchFacebookComments(new GraphClient(FB_GRAPH, "t", f), "123", "not a date");
    expect(calls[0].url).not.toContain("NaN");
    expect(new URL(calls[0].url).searchParams.has("since")).toBe(false);
  });
});

describe("listInstagramMedia", () => {
  it("asks /{ig-user}/media for one page of 25 and keeps feed media since the given time (not stories, not rows without id or time)", async () => {
    const { f, calls } = scripted({
      data: [
        { id: "m-story", caption: "", permalink: "https://www.instagram.com/stories/agala.cafe/1/", timestamp: "2026-10-15T08:00:00+0000", media_product_type: "STORY" },
        { id: "m-new", caption: "Тиквена супа", permalink: "https://www.instagram.com/p/Cnew/", timestamp: "2026-10-14T08:00:00+0000", media_product_type: "FEED" },
        { id: "m-reel", permalink: "https://www.instagram.com/reel/Creel/", timestamp: "2026-10-10T08:00:00+0000", media_product_type: "REELS" },
        { id: "m-notime", caption: "?", media_product_type: "FEED" },
        { caption: "no id", timestamp: "2026-10-12T08:00:00+0000", media_product_type: "FEED" },
        { id: "m-old", caption: "Старо", permalink: "https://www.instagram.com/p/Cold/", timestamp: "2026-09-30T08:00:00+0000", media_product_type: "FEED" },
      ],
      paging: { cursors: { after: "x" }, next: "https://graph.instagram.com/next" },
    });
    const out = await listInstagramMedia(new GraphClient(IG_GRAPH, "IGTOKEN", f), "1784", "2026-10-01T09:00:00.000Z");
    expect(calls).toHaveLength(1); // one page only
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v25.0/1784/media");
    expect(url.searchParams.get("fields")).toBe("id,caption,permalink,timestamp,media_product_type");
    expect(url.searchParams.get("limit")).toBe(String(ACCOUNT_POSTS_PER_CALL));
    expect(calls[0].url).not.toContain("IGTOKEN");
    expect(out).toEqual([
      { post_ref: "m-new", caption: "Тиквена супа", permalink: "https://www.instagram.com/p/Cnew/", published_at: "2026-10-14T08:00:00.000Z" },
      { post_ref: "m-reel", caption: "", permalink: "https://www.instagram.com/reel/Creel/", published_at: "2026-10-10T08:00:00.000Z" },
    ]);
    expect(ACCOUNT_POSTS_PER_CALL).toBe(25);
  });
  it("passes Meta errors through as MetaApiError", async () => {
    const { f } = scripted({ error: { message: "Invalid OAuth access token.", code: 190 } }, 400);
    await expect(listInstagramMedia(new GraphClient(IG_GRAPH, "t", f), "1", "2026-10-01T00:00:00.000Z")).rejects.toMatchObject({ name: "MetaApiError", code: "sm_meta_token" });
  });
});

describe("listFacebookPosts", () => {
  it("asks /{page}/posts since the given time (unix seconds) for one page of 25, the message as caption", async () => {
    const { f, calls } = scripted({
      data: [
        { id: "123_1", message: "Днес: баница", permalink_url: "https://www.facebook.com/123/posts/1", created_time: "2026-10-15T07:00:00+0000" },
        { id: "123_2", permalink_url: "https://www.facebook.com/123/posts/2", created_time: "2026-10-13T07:00:00+0000" },
        { id: "123_3", message: "no time" },
        { id: "123_4", message: "older than since", created_time: "2026-09-01T07:00:00+0000" },
      ],
    });
    const out = await listFacebookPosts(new GraphClient(FB_GRAPH, "PAGETOKEN", f), "123", "2026-10-01T09:00:00.000Z");
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v25.0/123/posts");
    expect(url.searchParams.get("fields")).toBe("id,message,permalink_url,created_time");
    expect(url.searchParams.get("since")).toBe(String(Math.floor(Date.parse("2026-10-01T09:00:00.000Z") / 1000)));
    expect(url.searchParams.get("limit")).toBe("25");
    expect(out).toEqual([
      { post_ref: "123_1", caption: "Днес: баница", permalink: "https://www.facebook.com/123/posts/1", published_at: "2026-10-15T07:00:00.000Z" },
      { post_ref: "123_2", caption: "", permalink: "https://www.facebook.com/123/posts/2", published_at: "2026-10-13T07:00:00.000Z" },
    ]);
  });
  it("lists the fake's feed posts (not stories, not deleted) newest first, and its Instagram feed media", async () => {
    const meta = new FakeMeta();
    const page = meta.addPage("Кафе");
    const ig = meta.addInstagramUser("kafe");
    const a = meta.addFacebookPost(page.id, { message: "стар", created: new Date("2026-10-02T09:00:00.000Z") });
    const b = meta.addFacebookPost(page.id, { message: "нов", created: new Date("2026-10-14T09:00:00.000Z") });
    const gone = meta.addFacebookPost(page.id, { message: "изтрит", created: new Date("2026-10-14T10:00:00.000Z") });
    gone.deleted = true;
    meta.addFacebookPost(page.id, { message: "", created: new Date("2026-10-14T11:00:00.000Z"), story: true });
    meta.addFacebookPost(page.id, { message: "твърде стар", created: new Date("2026-09-01T09:00:00.000Z") });
    const fb = await listFacebookPosts(new GraphClient(FB_GRAPH, page.access_token, meta.fetch), page.id, "2026-10-01T09:00:00.000Z");
    expect(fb.map((p) => [p.post_ref, p.caption])).toEqual([[b.post_id, "нов"], [a.post_id, "стар"]]);
    expect(fb[0].permalink).toMatch(/^https:\/\/www\.facebook\.com\//);
    const m = meta.addInstagramMedia(ig.user_id, { caption: "ръчно", timestamp: new Date("2026-10-14T09:00:00.000Z") });
    meta.addInstagramMedia(ig.user_id, { timestamp: new Date("2026-10-14T10:00:00.000Z"), story: true });
    const media = await listInstagramMedia(new GraphClient(IG_GRAPH, ig.token, meta.fetch), ig.user_id, "2026-10-01T09:00:00.000Z");
    expect(media).toEqual([{ post_ref: m.id, caption: "ръчно", permalink: m.permalink, published_at: "2026-10-14T09:00:00.000Z" }]);
    await expect(listFacebookPosts(new GraphClient(FB_GRAPH, "wrong", meta.fetch), page.id, "2026-10-01T09:00:00.000Z")).rejects.toMatchObject({ code: "sm_meta_token" });
  });
});

describe("replies and moderation against the fake Meta server", () => {
  function setup() {
    const meta = new FakeMeta();
    const page = meta.addPage("Кафе Агала");
    const ig = meta.addInstagramUser("agala.cafe");
    const fb = new GraphClient(FB_GRAPH, page.access_token, meta.fetch);
    const igc = new GraphClient(IG_GRAPH, ig.token, meta.fetch);
    return { meta, page, ig, fb, igc };
  }
  async function fbPost(meta: FakeMeta, page: { id: string; access_token: string }) {
    const r = (await (await meta.fetch(`${FB_GRAPH}/${page.id}/photos`, { method: "POST", headers: { authorization: `Bearer ${page.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://m.example/a.jpg", published: true }) })).json()) as { post_id: string };
    return r.post_id;
  }
  async function igMedia(meta: FakeMeta, ig: { user_id: string; token: string }) {
    const h = { authorization: `Bearer ${ig.token}`, "content-type": "application/json" };
    const c = (await (await meta.fetch(`${IG_GRAPH}/${ig.user_id}/media`, { method: "POST", headers: h, body: JSON.stringify({ image_url: "https://m.example/a.jpg" }) })).json()) as { id: string };
    await meta.fetch(`${IG_GRAPH}/${c.id}?fields=status_code`, { headers: h }); // the fake answers IN_PROGRESS until one status read
    const m = (await (await meta.fetch(`${IG_GRAPH}/${ig.user_id}/media_publish`, { method: "POST", headers: h, body: JSON.stringify({ creation_id: c.id }) })).json()) as { id: string };
    return m.id;
  }

  it("lists the comments the fake holds, replies as the Page / account and deletes the reply", async () => {
    const { meta, page, ig, fb, igc } = setup();
    const postId = await fbPost(meta, page);
    const mediaId = await igMedia(meta, ig);
    const c1 = meta.addFacebookComment(postId, { message: "Great place!", from_id: "77", from_name: "Ivan Petrov" });
    meta.addFacebookComment(postId, { message: "nested", parent_id: c1.id });
    const c2 = meta.addInstagramComment(mediaId, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k" });
    const fbList = await fetchFacebookComments(fb, postId);
    expect(fbList.map((c) => [c.comment_id, c.parent_id, c.author_name])).toEqual([[c1.id, null, "Ivan Petrov"]]); // toplevel only
    const igList = await fetchInstagramComments(igc, mediaId);
    expect(igList.map((c) => [c.comment_id, c.parent_id])).toEqual([[c2.id, null]]);

    const fbReply = await replyFacebook(fb, c1.id, "Thank you!");
    expect(meta.comments.get(fbReply)).toMatchObject({ parent_id: c1.id, from_id: page.id, from_name: page.name, text: "Thank you!", post_ref: postId });
    const igReply = await replyInstagram(igc, c2.id, "Да, всеки ден!");
    expect(meta.comments.get(igReply)).toMatchObject({ parent_id: c2.id, from_id: ig.user_id, from_name: ig.username, text: "Да, всеки ден!" });
    expect((await fetchInstagramComments(igc, mediaId)).map((c) => c.comment_id)).toEqual([c2.id, igReply]); // the reply rides under its parent

    await deleteReply(fb, fbReply);
    expect(meta.comments.get(fbReply)?.deleted).toBe(true);
    await deleteReply(fb, fbReply); // already gone: no throw
    await deleteReply(igc, igReply);
    expect(meta.comments.get(igReply)?.deleted).toBe(true);
  });

  it("hides, un-hides and deletes on both networks", async () => {
    const { meta, page, ig, fb, igc } = setup();
    const c1 = meta.addFacebookComment(await fbPost(meta, page), { message: "spam" });
    const c2 = meta.addInstagramComment(await igMedia(meta, ig), { text: "spam" });
    await moderateFacebook(fb, c1.id, "hide");
    expect(meta.comments.get(c1.id)?.hidden).toBe(true);
    await moderateFacebook(fb, c1.id, "unhide");
    expect(meta.comments.get(c1.id)?.hidden).toBe(false);
    await moderateInstagram(igc, c2.id, "hide");
    expect(meta.comments.get(c2.id)?.hidden).toBe(true);
    await moderateInstagram(igc, c2.id, "unhide");
    expect(meta.comments.get(c2.id)?.hidden).toBe(false);
    await moderateFacebook(fb, c1.id, "delete");
    await moderateInstagram(igc, c2.id, "delete");
    expect(meta.comments.get(c1.id)?.deleted).toBe(true);
    expect(meta.comments.get(c2.id)?.deleted).toBe(true);
    const fbBody = meta.calls.filter((c) => c.path === `/${c1.id}` && c.method === "POST").map((c) => c.body);
    expect(fbBody).toEqual([{ is_hidden: true }, { is_hidden: false }]);
    const igBody = meta.calls.filter((c) => c.path === `/${c2.id}` && c.method === "POST").map((c) => c.body);
    expect(igBody).toEqual([{ hide: true }, { hide: false }]);
  });

  it("a reply to a deleted comment is a not-found error (no retry); a wrong token is sm_meta_token", async () => {
    const { meta, page, ig, fb, igc } = setup();
    const postId = await fbPost(meta, page);
    const c1 = meta.addFacebookComment(postId, { message: "bye" });
    meta.comments.get(c1.id)!.deleted = true;
    const e = await replyFacebook(fb, c1.id, "x").catch((x) => x);
    expect(e).toBeInstanceOf(MetaApiError);
    expect((e as MetaApiError).notFound).toBe(true);
    expect((e as MetaApiError).retryable).toBe(false);
    const c2 = meta.addInstagramComment(await igMedia(meta, ig), { text: "hi" });
    meta.revoke(ig.token);
    await expect(replyInstagram(igc, c2.id, "x")).rejects.toMatchObject({ code: "sm_meta_token" });
    const other = meta.addPage("Other");
    const c3 = meta.addFacebookComment(postId, { message: "still here" });
    await expect(replyFacebook(new GraphClient(FB_GRAPH, other.access_token, meta.fetch), c3.id, "x")).rejects.toMatchObject({ code: "sm_meta_token" });
  });

  it("a reply without an id in the answer is a retryable sm_reply_unknown", async () => {
    const { f } = scripted({ success: true });
    await expect(replyInstagram(new GraphClient(IG_GRAPH, "t", f), "1", "x")).rejects.toMatchObject({ code: "sm_reply_unknown", retryable: true });
  });
});
