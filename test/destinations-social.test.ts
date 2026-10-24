// test/destinations-social.test.ts
import { describe, expect, it } from "vitest";
import { facebookAdapter } from "@/src/destinations/facebook";
import { instagramAdapter, IG_REFRESH_AFTER_MS } from "@/src/destinations/instagram";
import { decryptSecrets, encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { socialErrorText } from "@/src/destinations/social-errors";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { BACKOFF_MS, enqueueForChangeSet, runPendingSyncs, syncLines } from "@/src/destinations/sync";
import { invertChanges } from "@/src/domain/changes";
import { previewPictures } from "@/src/domain/social-preview";
import { NETWORK_NAMES, type Change, type SocialPostRow, type SocialTarget } from "@/src/domain/types";
import { FakeMeta } from "./fake-meta";
import { makeDemo } from "./helpers";

const KEY = parseSecretKey("ab".repeat(32));
const T0 = new Date("2026-10-11T09:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const IMAGE = "https://media.example/v1/m-1.jpg";
/** The copies a proposal makes (Instagram feed padded to 4:5, the 9:16 story): other files in our storage. */
const FEED = "https://media.example/v1/m-1-feed.jpg";
const STORY = "https://media.example/v1/m-1-story.jpg";

const post = (targets: SocialTarget[], caption = "Днешното предложение: тиквена супа", copies: Partial<SocialPostRow> = {}): Change => ({
  position: 0, op: "social_post", entity: "social_post", entity_id: "m-1", before: null,
  after: { media_id: "m-1", image_url: IMAGE, caption, targets, ...copies },
});
const ALL: SocialTarget[] = ["facebook_post", "facebook_story", "instagram_post", "instagram_story"];

async function connected(opts: { facebook?: boolean; instagram?: boolean; igRefreshedAt?: string } = {}) {
  const demo = await makeDemo();
  const meta = new FakeMeta();
  const page = meta.addPage("Кафе Агала");
  const ig = meta.addInstagramUser("agala.cafe");
  if (opts.facebook !== false) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "facebook", config: { page_id: page.id, page_name: page.name, connected_at: T0.toISOString() }, secrets: encryptSecrets({ page_token: page.access_token }, KEY) });
  if (opts.instagram !== false) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "instagram", config: { ig_user_id: ig.user_id, username: ig.username, connected_at: T0.toISOString(), token_refreshed_at: opts.igRefreshedAt ?? T0.toISOString() }, secrets: encryptSecrets({ token: ig.token }, KEY) });
  const logs: string[] = [];
  const sleeps: number[] = [];
  const d = { store: demo.store, secretKey: KEY, fetch: meta.fetch, log: (s: string) => logs.push(s), sleep: async (ms: number) => void sleeps.push(ms) };
  const store = withDestinationSync(demo.store, d, () => T0);
  const set = (changes: Change[], extra: { undoes_id?: string; source?: "photo" | "undo" } = {}) =>
    store.createChangeSet({ venue_id: demo.venue.id, chat_ref: "tg:1001", summary_bg: "Публикация", summary_en: "Post", preview_bg: "p", preview_en: "p", source: extra.source ?? "photo", status: "proposed", changes, undoes_id: extra.undoes_id ?? null });
  return { ...demo, store, meta, page, ig, d, logs, sleeps, set };
}

describe("relevant()", () => {
  it("each adapter takes only social_post rows with a target on its network", () => {
    expect(facebookAdapter.relevant([post(["instagram_post"])])).toEqual([]);
    expect(instagramAdapter.relevant([post(["instagram_post"])])).toHaveLength(1);
    expect(facebookAdapter.relevant([post(["facebook_story"])])).toHaveLength(1);
    const [undo] = invertChanges([post(["facebook_post"])]);
    expect(facebookAdapter.relevant([undo])).toHaveLength(1);
    expect(instagramAdapter.relevant([undo])).toEqual([]);
    expect(facebookAdapter.relevant([{ position: 0, op: "wp_edit_page", entity: "wp_page", entity_id: "1", before: {}, after: {} }])).toEqual([]);
  });
  it("enqueues one row per network that has a target", async () => {
    const { set, d } = await connected();
    const cs = await set([post(["instagram_post"])]);
    const rows = await enqueueForChangeSet(d.store, cs, T0);
    expect(rows.map((r) => r.payload.kind)).toEqual(["instagram"]);
  });
});

describe("Instagram is_ai_generated", () => {
  const igBodies = (meta: { calls: { path: string; body: Record<string, unknown> | null }[] }) => meta.calls.filter((c) => c.path.endsWith("/media")).map((c) => c.body!);
  it("is sent as true in both container shapes (post and story) when the row says ai_generated", async () => {
    const { store, set, meta } = await connected();
    const cs = await set([post(["instagram_post", "instagram_story"], "Нова чаша · създадено с AI", { ai_generated: true })]);
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("applied");
    expect(igBodies(meta)).toEqual([
      { image_url: IMAGE, caption: "Нова чаша · създадено с AI", is_ai_generated: true },
      { image_url: IMAGE, media_type: "STORIES", is_ai_generated: true },
    ]);
  });
  it("is absent from both container shapes when the row has no ai_generated", async () => {
    const { store, set, meta } = await connected();
    const cs = await set([post(["instagram_post", "instagram_story"])]);
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("applied");
    const bodies = igBodies(meta);
    expect(bodies).toHaveLength(2);
    for (const b of bodies) expect(b).not.toHaveProperty("is_ai_generated");
  });
});

describe("publishing", () => {
  it("publishes all four targets once, stores ids and permalinks, and reports each network with links", async () => {
    const { store, set, meta, page, ig } = await connected();
    const cs = await set([post(ALL)]);
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("applied");
    const fbPosts = [...meta.posts.values()];
    expect(fbPosts.map((p) => [p.kind, p.page_id, p.url, p.caption])).toEqual([["photo", page.id, IMAGE, "Днешното предложение: тиквена супа"], ["story", page.id, IMAGE, ""]]);
    const igMedia = [...meta.igMedia.values()];
    expect(igMedia.map((m) => [m.media_type, m.user_id, m.image_url, m.caption])).toEqual([["IMAGE", ig.user_id, IMAGE, "Днешното предложение: тиквена супа"], ["STORIES", ig.user_id, IMAGE, ""]]);
    const rows = await store.listSyncs({ changeSetId: cs.id });
    expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
    const fb = rows.find((r) => r.payload.kind === "facebook")!;
    expect(fb.result).toMatchObject({ published: [{ target: "facebook_post", media_id: "m-1", id: fbPosts[0].post_id, permalink: expect.stringMatching(/^https:\/\/www\.facebook\.com\//) }, { target: "facebook_story", id: fbPosts[1].post_id }] });
    const lines = await syncLines(store, cs.id, "bg");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Facebook: публикувано ✅ https:\/\/www\.facebook\.com\/\S+ https:\/\/www\.facebook\.com\/stories\/\S+$/);
    expect(lines[1]).toBe(`Instagram: публикувано ✅ ${igMedia[0].permalink} ${igMedia[1].permalink}`);
    expect((await syncLines(store, cs.id, "en"))[1]).toMatch(/^Instagram: published ✅ https:\/\/www\.instagram\.com\/p\//);
  });

  it("polls an Instagram container until FINISHED, sleeping 2 s between polls", async () => {
    const { store, set, meta, sleeps } = await connected({ facebook: false });
    meta.pollsUntilFinished = 3;
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect(meta.igMedia.size).toBe(1);
    expect(sleeps).toEqual([2000, 2000, 2000]);
  });

  it("an Instagram container that ends in ERROR fails without retry, with a clear line", async () => {
    const { store, set, meta } = await connected({ facebook: false });
    meta.containerOutcome = "ERROR";
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect((await store.listSyncs({ changeSetId: cs.id }))[0]).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/^sm_ig_container: /) });
    expect(await syncLines(store, cs.id, "bg")).toEqual(["Instagram: грешка: Instagram не прие снимката (трябва да е JPEG, до 8 MB)"]);
  });

  it("a retry after a failure does not publish a target twice (partial results are kept on the failed attempt)", async () => {
    const { store, set, meta, d } = await connected();
    meta.failOn = (c) => (c.path.endsWith("/photo_stories") || (c.path.endsWith("/media") && c.body?.media_type === "STORIES") ? { status: 503, code: 2, message: "Service temporarily unavailable" } : null);
    const cs = await set([post(ALL)]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const rows = await store.listSyncs({ changeSetId: cs.id });
    expect(rows.map((r) => [r.payload.kind, r.status, r.attempts])).toEqual([["facebook", "pending", 1], ["instagram", "pending", 1]]);
    expect(rows[0].result).toMatchObject({ published: [{ target: "facebook_post", state: "published" }, { target: "facebook_story", state: "attempted" }] });
    expect(rows[1].result).toMatchObject({ published: [{ target: "instagram_post" }] });
    const retryLines = await syncLines(store, cs.id, "bg");
    expect(retryLines[0]).toMatch(/^Facebook: не успях да публикувам, ще опитам пак \(вече публикувано: https:\/\/www\.facebook\.com\/\S+\)$/);
    expect(retryLines[1]).toMatch(/^Instagram: не успях да публикувам, ще опитам пак \(вече публикувано: https:\/\/www\.instagram\.com\/p\/\S+\)$/);
    meta.failOn = null;
    const r = await runPendingSyncs(d, { venueId: rows[0].venue_id, now: at(BACKOFF_MS[0]) });
    expect(r.done).toHaveLength(2);
    expect([...meta.posts.values()].map((p) => p.kind)).toEqual(["photo", "story"]);
    expect([...meta.igMedia.values()].map((m) => m.media_type)).toEqual(["IMAGE", "STORIES"]);
    const done = await store.listSyncs({ changeSetId: cs.id });
    expect((done[0].result as { published: unknown[] }).published).toHaveLength(2);
    expect((done[1].result as { published: unknown[] }).published).toHaveLength(2);
  });

  it("a token that no longer works fails at once, marks the destination and tells the owner to reconnect", async () => {
    const { store, set, meta, page, venue } = await connected({ instagram: false });
    meta.revoke(page.access_token);
    const cs = await set([post(["facebook_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect((await store.listSyncs({ changeSetId: cs.id }))[0]).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/^sm_meta_token: /) });
    expect(await store.getDestination(venue.id, "facebook")).toMatchObject({ status: "error" });
    expect(await syncLines(store, cs.id, "bg")).toEqual(["Facebook: грешка: връзката вече не е валидна; свържете отново от таблото"]);
    expect(await syncLines(store, cs.id, "en")).toEqual(["Facebook: error: the connection is no longer valid; reconnect from the dashboard"]);
  });

  it("refreshes an Instagram token older than 30 days before publishing and stores the new one encrypted", async () => {
    const old = new Date(T0.getTime() - IG_REFRESH_AFTER_MS - 60_000).toISOString();
    const { store, set, meta, venue, ig } = await connected({ facebook: false, igRefreshedAt: old });
    const oldToken = ig.token;
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect(meta.calls.some((c) => c.path === "/refresh_access_token")).toBe(true);
    const dest = (await store.getDestination(venue.id, "instagram"))!;
    expect(dest.config).toMatchObject({ token_refreshed_at: T0.toISOString(), ig_user_id: ig.user_id, username: "agala.cafe" });
    const secrets = decryptSecrets(dest.secrets, KEY);
    expect(secrets.token).not.toBe(oldToken);
    expect(secrets.token).toBe(meta.igUsers.get(ig.user_id)!.token);
    expect(dest.secrets).not.toContain(secrets.token);
    expect(meta.igMedia.size).toBe(1);
  });

  it("does not refresh a fresh token", async () => {
    const { store, set, meta } = await connected({ facebook: false });
    const cs = await set([post(["instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect(meta.calls.some((c) => c.path === "/refresh_access_token")).toBe(false);
  });

  it("says a network is not connected when a set targets it without a connection", async () => {
    const { store, set } = await connected({ instagram: false });
    const cs = await set([post(["facebook_post", "instagram_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const lines = await syncLines(store, cs.id, "en");
    expect(lines[0]).toMatch(/^Facebook: published ✅ /);
    expect(lines[1]).toBe("Instagram: not connected, the post was not sent");
    expect((await syncLines(store, cs.id, "bg"))[1]).toBe("Instagram: не е свързан, публикацията не е изпратена");
  });

  it("never stores or logs a token", async () => {
    const { store, set, meta, logs } = await connected();
    meta.failOn = (c) => (c.path.endsWith("/media_publish") ? { status: 500, code: 1, message: "Unknown error" } : null);
    const cs = await set([post(ALL)]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const dump = JSON.stringify({ rows: await store.listSyncs({ changeSetId: cs.id }), logs, dests: await store.listDestinations(cs.venue_id) });
    for (const t of meta.allTokens()) expect(dump).not.toContain(t);
  });
});

/** The file each place was made from, as Meta received it: Facebook posts and stories by their photo, Instagram media by its container. */
function publishedFiles(meta: FakeMeta): Record<SocialTarget, unknown> {
  const fb = [...meta.posts.values()];
  const ig = [...meta.igMedia.values()];
  return {
    facebook_post: fb.find((p) => p.kind === "photo")?.url,
    facebook_story: fb.find((p) => p.kind === "story")?.url,
    instagram_post: ig.find((m) => m.media_type === "IMAGE")?.image_url,
    instagram_story: ig.find((m) => m.media_type === "STORIES")?.image_url,
  };
}

/** The file the owner was shown for one place: the picture whose label names that network and format ("Instagram + Facebook story"). */
function shownFor(row: SocialPostRow, target: SocialTarget): string {
  const [network, format] = target.split("_") as [keyof typeof NETWORK_NAMES, "post" | "story"];
  const shown = previewPictures(row, "en").filter((pic) => pic.label.split(", ").some((part) => part.endsWith(` ${format}`) && part.slice(0, -format.length - 1).split(" + ").includes(NETWORK_NAMES[network])));
  expect(shown, `${target} is shown on exactly one picture`).toHaveLength(1);
  return shown[0].url;
}

describe("what is approved is what is published (stories publish Claudia's 9:16 copy)", () => {
  it("Instagram publishes the story copy", async () => {
    const { store, set, meta } = await connected({ facebook: false });
    const cs = await set([post(["instagram_story"], "", { story_image_url: STORY })]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    // The STORIES container request carries the copy, and so does the media that went out.
    expect([...meta.containers.values()].map((c) => [c.media_type, c.image_url])).toEqual([["STORIES", STORY]]);
    expect([...meta.igMedia.values()].map((m) => [m.media_type, m.image_url])).toEqual([["STORIES", STORY]]);
  });

  it("Facebook uploads the story copy", async () => {
    const { store, set, meta } = await connected({ instagram: false });
    const cs = await set([post(["facebook_story"], "", { story_image_url: STORY })]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    // The unpublished /photos upload that becomes the story carries the copy, and the story is made from that photo.
    expect([...meta.photos.values()].map((p) => [p.published, p.url])).toEqual([[false, STORY]]);
    expect([...meta.posts.values()].map((p) => [p.kind, p.url])).toEqual([["story", STORY]]);
  });

  it("an older row without a story copy publishes the original for stories (never the Instagram feed copy), as before", async () => {
    const { store, set, meta } = await connected();
    // Proposed before stories had a copy: it may have the padded feed copy, but no story_image_url.
    const cs = await set([post(ALL, "Днешното предложение: тиквена супа", { ig_feed_image_url: FEED, ig_feed_ratio: "4:5" })]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect(publishedFiles(meta)).toEqual({ facebook_post: IMAGE, facebook_story: IMAGE, instagram_post: FEED, instagram_story: IMAGE });
  });

  it("every place sends exactly the file the preview shows for it", async () => {
    const { store, set, meta } = await connected();
    const change = post(ALL, "Днешното предложение: тиквена супа", { ig_feed_image_url: FEED, ig_feed_ratio: "4:5", story_image_url: STORY });
    const cs = await set([change]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const row = change.after as unknown as SocialPostRow;
    const sent = publishedFiles(meta);
    for (const target of ALL) expect({ target, file: sent[target] }).toEqual({ target, file: shownFor(row, target) });
    // Three different files, so the comparison above cannot pass by every place sending the same one.
    expect(new Set(Object.values(sent))).toEqual(new Set([IMAGE, FEED, STORY]));
  });
});

describe("undo", () => {
  it("deletes the Facebook post (the story expires by itself) and tells the owner to delete the Instagram ones by hand, with the links", async () => {
    const { store, set, meta } = await connected();
    const cs = await set([post(ALL)]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    const igLinks = [...meta.igMedia.values()].map((m) => m.permalink);
    const undo = await set(invertChanges(cs.changes), { undoes_id: cs.id, source: "undo" });
    expect(await store.applyChangeSet(undo.id, T0.toISOString())).toBe("applied");
    expect([...meta.posts.values()].map((p) => [p.kind, p.deleted])).toEqual([["photo", true], ["story", false]]);
    expect(meta.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(await syncLines(store, undo.id, "bg")).toEqual(["Facebook: изтрито ✅; историята изчезва сама до 24 часа", `Instagram: изтрийте публикацията ръчно: ${igLinks.join(" ")}`]);
    expect(await syncLines(store, undo.id, "en")).toEqual(["Facebook: deleted ✅; the story disappears on its own within 24 hours", `Instagram: delete the post by hand: ${igLinks.join(" ")}`]);
    const igRow = (await store.listSyncs({ changeSetId: undo.id })).find((r) => r.payload.kind === "instagram")!;
    expect(igRow.result).toMatchObject({ manual_delete: [{ target: "instagram_post", permalink: igLinks[0] }, { target: "instagram_story", permalink: igLinks[1] }] });
  });

  it("treats a Facebook post that is already gone as deleted", async () => {
    const { store, set, meta } = await connected({ instagram: false });
    const cs = await set([post(["facebook_post"])]);
    await store.applyChangeSet(cs.id, T0.toISOString());
    for (const p of meta.posts.values()) p.deleted = true; // the owner deleted it on Facebook
    const undo = await set(invertChanges(cs.changes), { undoes_id: cs.id, source: "undo" });
    await store.applyChangeSet(undo.id, T0.toISOString());
    expect(await syncLines(store, undo.id, "en")).toEqual(["Facebook: deleted ✅"]);
  });
});

describe("socialErrorText", () => {
  it("maps the stored codes to BG/EN and falls back to the message", () => {
    expect(socialErrorText("sm_meta_token: The access token is no longer valid.", "bg")).toBe("връзката вече не е валидна; свържете отново от таблото");
    expect(socialErrorText("sm_meta_permission: (#200) missing", "en")).toBe("permission to publish is missing; reconnect from the dashboard and allow publishing");
    expect(socialErrorText("meta_100: Invalid parameter", "en")).toBe("Invalid parameter");
    expect(socialErrorText(null, "en")).toBe("");
  });
});
