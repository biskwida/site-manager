// test/meta-graph.test.ts
import { describe, expect, it } from "vitest";
import { FB_GRAPH, GraphClient, IG_GRAPH, MetaApiError, metaFetch } from "@/src/destinations/meta-graph";
import { IG_GRAPH_URL } from "@/src/server/instagram";
import { FakeMeta } from "./fake-meta";

describe("MetaApiError", () => {
  it("retries network failures, 429 and 5xx; not other 4xx; never an invalid token", () => {
    expect(new MetaApiError(0, "sm_meta_unreachable", "x").retryable).toBe(true);
    expect(new MetaApiError(429, "http_429", "x").retryable).toBe(true);
    expect(new MetaApiError(503, "http_503", "x").retryable).toBe(true);
    expect(new MetaApiError(400, "meta_100", "x").retryable).toBe(false);
    expect(new MetaApiError(500, "sm_meta_token", "x", { metaCode: 190 }).retryable).toBe(false);
    expect(new MetaApiError(400, "sm_ig_processing", "x", { retry: true }).retryable).toBe(true);
  });
});

describe("metaFetch / GraphClient", () => {
  it("uses Graph v25.0 on both hosts (the Instagram base is the wizard import's constant)", () => {
    expect(FB_GRAPH).toBe("https://graph.facebook.com/v25.0");
    expect(IG_GRAPH).toBe("https://graph.instagram.com/v25.0");
    expect(IG_GRAPH).toBe(IG_GRAPH_URL);
  });

  it("maps Meta error code 190 to a non-retryable sm_meta_token and keeps the token out of the message", async () => {
    const meta = new FakeMeta();
    const page = meta.addPage("Кафе Агала");
    meta.revoke(page.access_token);
    const fb = new GraphClient(FB_GRAPH, page.access_token, meta.fetch);
    const e = await fb.post(`/${page.id}/photos`, { url: "https://cdn.example/a.jpg", published: true }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MetaApiError);
    expect(e).toMatchObject({ code: "sm_meta_token", metaCode: 190, retryable: false });
    expect(String((e as Error).message)).not.toContain(page.access_token);
  });

  it("maps network failures, 5xx and other Meta errors", async () => {
    const meta = new FakeMeta();
    const page = meta.addPage("Кафе");
    const fb = new GraphClient(FB_GRAPH, page.access_token, meta.fetch);
    meta.unreachable = true;
    await expect(fb.get(`/${page.id}`)).rejects.toMatchObject({ status: 0, code: "sm_meta_unreachable", retryable: true });
    meta.unreachable = false;
    meta.failNext = { status: 500, code: 2, message: "An unexpected error has occurred." };
    await expect(fb.get(`/${page.id}`)).rejects.toMatchObject({ status: 500, retryable: true });
    meta.failNext = { status: 400, code: 100, message: "Invalid parameter" };
    await expect(fb.get(`/${page.id}`)).rejects.toMatchObject({ status: 400, code: "meta_100", message: "Invalid parameter", retryable: false });
    meta.failNext = { status: 400, code: 4, message: "Application request limit reached", transient: true };
    await expect(fb.get(`/${page.id}`)).rejects.toMatchObject({ retryable: true });
    await expect(fb.delete("/123_456")).rejects.toMatchObject({ code: "meta_100", metaCode: 100, subcode: 33, retryable: false });
  });

  it("sends the token as a bearer header, never in the URL, and parses JSON", async () => {
    const meta = new FakeMeta();
    const page = meta.addPage("Кафе");
    const fb = new GraphClient(FB_GRAPH, page.access_token, meta.fetch);
    const r = await fb.post<{ id: string; post_id: string }>(`/${page.id}/photos`, { url: "https://cdn.example/a.jpg", caption: "Здравейте", published: true });
    expect(r.post_id).toMatch(new RegExp(`^${page.id}_`));
    expect(meta.calls.every((c) => !c.url.includes(page.access_token))).toBe(true);
    expect(meta.calls.at(-1)).toMatchObject({ method: "POST", host: "graph.facebook.com", path: `/${page.id}/photos`, auth: true });
  });

  it("metaFetch reads a public OAuth endpoint without a token", async () => {
    const meta = new FakeMeta();
    const code = meta.issueFacebookCode();
    const r = await metaFetch<{ access_token: string }>(meta.fetch, `${FB_GRAPH}/oauth/access_token?client_id=${meta.appId}&redirect_uri=x&client_secret=${meta.appSecret}&code=${code}`);
    expect(typeof r.access_token).toBe("string");
  });
});

describe("FakeMeta Instagram containers", () => {
  it("reports IN_PROGRESS until the configured number of polls, then FINISHED; publish returns a media id with a permalink", async () => {
    const meta = new FakeMeta();
    const ig = meta.addInstagramUser("agala.cafe");
    meta.pollsUntilFinished = 2;
    const c = new GraphClient(IG_GRAPH, ig.token, meta.fetch);
    const { id } = await c.post<{ id: string }>(`/${ig.user_id}/media`, { image_url: "https://cdn.example/a.jpg", caption: "Здравейте" });
    expect((await c.get<{ status_code: string }>(`/${id}?fields=status_code`)).status_code).toBe("IN_PROGRESS");
    expect((await c.get<{ status_code: string }>(`/${id}?fields=status_code`)).status_code).toBe("IN_PROGRESS");
    expect((await c.get<{ status_code: string }>(`/${id}?fields=status_code`)).status_code).toBe("FINISHED");
    const media = await c.post<{ id: string }>(`/${ig.user_id}/media_publish`, { creation_id: id });
    expect((await c.get<{ permalink: string }>(`/${media.id}?fields=permalink`)).permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
    expect(meta.igMedia.get(media.id)).toMatchObject({ caption: "Здравейте", media_type: "IMAGE" });
  });
});
