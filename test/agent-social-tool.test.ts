// test/agent-social-tool.test.ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "@/src/agent/prompt";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { SocialPostSchema, socialConnections } from "@/src/agent/social-tools";
import { FakeMeta } from "./fake-meta";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-11T09:00:00.000Z");
const KEY = parseSecretKey("ab".repeat(32));
const jpeg = async (width: number, height: number, background = { r: 180, g: 40, b: 30 }) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer());
const JPEG = await jpeg(800, 800);

async function setup(over: Partial<AgentDeps> = {}, connect: { facebook?: boolean; instagram?: boolean } = { facebook: true, instagram: true }) {
  const demo = await makeDemo();
  const meta = new FakeMeta();
  const page = meta.addPage("Кафе Агала");
  const ig = meta.addInstagramUser("agala.cafe");
  if (connect.facebook) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "facebook", config: { page_id: page.id, page_name: page.name, connected_at: T0.toISOString() }, secrets: encryptSecrets({ page_token: page.access_token }, KEY) });
  if (connect.instagram) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "instagram", config: { ig_user_id: ig.user_id, username: ig.username, connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString() }, secrets: encryptSecrets({ token: ig.token }, KEY) });
  // The memory store serves photos from memory://; production storage URLs are https (Supabase Storage). `files` serves them.
  const files = new Map<string, Uint8Array>();
  const https = <T extends { public_url: string }>(m: T): T => ({ ...m, public_url: m.public_url.replace("memory://media/", "https://media.example/storage/") });
  const getMedia = demo.store.getMedia.bind(demo.store);
  const saveMedia = demo.store.saveMedia.bind(demo.store);
  demo.store.getMedia = async (id: string) => {
    const m = await getMedia(id);
    return m && https(m);
  };
  demo.store.saveMedia = async (venueId: string, bytes: Uint8Array, type: string) => {
    const m = https(await saveMedia(venueId, bytes, type));
    files.set(m.public_url, bytes);
    return m;
  };
  const mediaFetch = (async (input: RequestInfo | URL) => {
    const b = files.get(String(input));
    return b ? new Response(b as BodyInit, { headers: { "content-type": "image/jpeg" } }) : new Response("nope", { status: 404 });
  }) as typeof fetch;
  const store = withDestinationSync(demo.store, { store: demo.store, secretKey: KEY, fetch: meta.fetch, log: () => undefined, sleep: async () => undefined }, () => T0);
  const messenger = new FakeMessenger();
  const member = (await store.findMember("tg:1001"))!;
  const social = await socialConnections(demo.store, demo.venue.id);
  const deps: AgentDeps = { store, venueId: demo.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: "https://site.example", social, source: "photo", fetch: mediaFetch, ...over };
  const photo = await store.saveMedia(demo.venue.id, JPEG, "image/jpeg");
  return { ...demo, store, meta, messenger, deps, photo, files, tools: makeTools(deps) };
}
const input = (media_id: string, extra: Record<string, unknown> = {}) => ({ summary_bg: "Публикация: днешното предложение", summary_en: "Post: today's special", media_id, caption: "Днешното предложение: тиквена супа 🎃 #кафе", targets: ["facebook_post", "instagram_post"], ...extra });

describe("social_post availability", () => {
  it("is registered only when Facebook or Instagram is connected", async () => {
    const none = await setup({}, {});
    expect(none.deps.social).toEqual({ facebook: false, instagram: false });
    expect(none.tools.map((t) => t.name)).not.toContain("social_post");
    const fb = await setup({}, { facebook: true });
    expect(fb.deps.social).toEqual({ facebook: true, instagram: false });
    expect(fb.tools.map((t) => t.name)).toContain("social_post");
  });
  it("the prompt tells the agent when and how to use it", () => {
    expect(SYSTEM_PROMPT).toMatch(/social_post/);
    expect(SYSTEM_PROMPT).toMatch(/история/);
    expect(SYSTEM_PROMPT).toMatch(/default language/i);
  });
  it("the prompt and the targets description spell out story vs post", () => {
    // The live case: "смени водата на 1.50 и прати стори само в инстаграм" must become instagram_story only.
    expect(SYSTEM_PROMPT).toContain(`"прати стори само в инстаграм" → ["instagram_story"]`);
    expect(SYSTEM_PROMPT).toMatch(/"само стори".*only the \*_story targets/);
    expect(SYSTEM_PROMPT).toMatch(/"само пост".*"в профила".*"във фийда".*only the \*_post targets/);
    expect(SYSTEM_PROMPT).toMatch(/names neither story nor post.*feed post/);
    const targets = SocialPostSchema.shape.targets.description ?? "";
    expect(targets).toMatch(/"само стори".*only \*_story/);
    expect(targets).toMatch(/"само пост".*only \*_post/);
    expect(targets).toMatch(/"и стори, и пост".*both/);
    expect(targets).toMatch(/"в инстаграм".*only that network/);
    expect(targets).toMatch(/neither story nor post.*feed post/);
  });
});

describe("social_post", () => {
  it("proposes one social_post row with the photo, caption and targets, and sends the preview with buttons", async () => {
    const { tools, store, photo, messenger, meta } = await setup();
    const r = await call(tools, "social_post", input(photo.id));
    expect(r).toMatchObject({ status: "proposed" });
    expect(r.preview).toBe("• Публикация: Facebook (пост), Instagram (пост)\n  „Днешното предложение: тиквена супа 🎃 #кафе“");
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs).toMatchObject({ status: "proposed", source: "photo", summary_bg: "Публикация: днешното предложение", chat_ref: "tg:1001" });
    expect(cs.changes).toEqual([{ position: 0, op: "social_post", entity: "social_post", entity_id: photo.id, before: null, after: { media_id: photo.id, image_url: expect.stringMatching(/^https:\/\/media\.example\/storage\/.+\.jpg$/), caption: "Днешното предложение: тиквена супа 🎃 #кафе", targets: ["facebook_post", "instagram_post"] } }]);
    expect(messenger.sent[0]).toMatchObject({ setId: cs.id, lang: "bg" });
    expect(meta.calls).toEqual([]); // nothing published before ✅
  });

  it("on ✅ publishes through the destination sync and the confirmation lists each network with its link", async () => {
    const { tools, store, photo, meta } = await setup();
    const r = await call(tools, "social_post", input(photo.id, { targets: ["facebook_post", "facebook_story", "instagram_post"] }));
    const decision = await handleDecision({ store, messenger: new FakeMessenger(), now: () => T0 }, "tg:1001", "apply", r.change_set_id as string);
    expect(meta.posts.size).toBe(2);
    expect(meta.igMedia.size).toBe(1);
    const full = decision.edit?.full ?? "";
    expect(full).toContain("✅ Приложено");
    expect(full).toMatch(/Facebook: публикувано ✅ https:\/\/www\.facebook\.com\/\S+ https:\/\/www\.facebook\.com\/stories\//);
    expect(full).toContain(`Instagram: публикувано ✅ ${[...meta.igMedia.values()][0].permalink}`);
  });

  it("a story-only request (\"прати стори само в инстаграм\") proposes only the Instagram story, and the preview says story, not post", async () => {
    const { tools, store, photo } = await setup();
    const r = await call(tools, "social_post", input(photo.id, { summary_bg: "История в Instagram", summary_en: "Instagram story", caption: "", targets: ["instagram_story"] }));
    expect(r.status).toBe("proposed");
    expect(r.preview).toBe("• Публикуване: Instagram (история)");
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes[0].after).toMatchObject({ targets: ["instagram_story"] });
    expect(cs.changes[0].after).not.toHaveProperty("ig_feed_image_url");
  });

  it("is the owner's decision only", async () => {
    const { tools: staffTools, photo } = await setup({ chatRef: "tg:1002", member: { venue_id: "", chat_ref: "tg:1002", role: "staff", lang: "en", last_seen_at: null, created_at: "" } });
    expect((await call(staffTools, "social_post", input(photo.id))).error).toMatch(/only the owner/);
  });

  it("refuses an unknown media id and another venue's photo", async () => {
    const { tools, store } = await setup();
    expect((await call(tools, "social_post", input("nope"))).error).toMatch(/media_id "nope" not found/);
    const other = await store.createVenue({ slug: "other-venue", name: "Other" });
    const foreign = await store.saveMedia(other.id, JPEG, "image/jpeg");
    expect((await call(tools, "social_post", input(foreign.id))).error).toMatch(/not found for this venue/);
  });

  it("refuses a non-JPEG photo for Instagram but allows it for Facebook", async () => {
    const { tools, store, venue } = await setup();
    const png = await store.saveMedia(venue.id, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
    expect((await call(tools, "social_post", input(png.id))).error).toMatch(/Instagram accepts only JPEG/);
    expect((await call(tools, "social_post", input(png.id, { targets: ["instagram_story"] }))).error).toMatch(/JPEG/);
    expect((await call(tools, "social_post", input(png.id, { targets: ["facebook_post"] }))).status).toBe("proposed");
  });

  it("refuses targets on a network that is not connected", async () => {
    const { tools, photo } = await setup({}, { facebook: true });
    const r = await call(tools, "social_post", input(photo.id));
    expect(r.error).toMatch(/Instagram is not connected/);
    expect(r.error).toMatch(/facebook_post, facebook_story/);
  });

  it("enforces Instagram's caption limits (2,200 characters, 30 hashtags) only when an Instagram post is targeted", async () => {
    const { tools, photo, store } = await setup();
    const long = "а".repeat(2201);
    expect((await call(tools, "social_post", input(photo.id, { caption: long }))).error).toMatch(/2,200/);
    const tags = Array.from({ length: 31 }, (_, i) => `#таг${i}`).join(" ");
    expect((await call(tools, "social_post", input(photo.id, { caption: tags }))).error).toMatch(/30 hashtags/);
    const r = await call(tools, "social_post", input(photo.id, { caption: tags, targets: ["facebook_post", "instagram_story"] }));
    expect(r.status).toBe("proposed");
    await store.updateChangeSet(r.change_set_id as string, { status: "cancelled" });
  });

  it("refuses while a proposal from an earlier message is pending, but allows several from the same message", async () => {
    const { tools, photo, deps } = await setup();
    expect((await call(tools, "social_post", input(photo.id))).status).toBe("proposed");
    expect((await call(tools, "social_post", input(photo.id, { targets: ["facebook_post"] }))).status).toBe("proposed");
    expect((await call(makeTools(deps), "social_post", input(photo.id))).error).toMatch(/already waiting for a decision/);
  });

  it("refuses a photo without a public https address, and drops duplicate targets", async () => {
    const memory = await setup();
    const fresh = await setup();
    memory.store.getMedia = async () => ({ ...memory.photo, public_url: "memory://media/x.jpg" });
    expect((await call(memory.tools, "social_post", input(memory.photo.id))).error).toMatch(/public https/);
    const r = await call(fresh.tools, "social_post", input(fresh.photo.id, { targets: ["facebook_post", "facebook_post"] }));
    expect(r.status).toBe("proposed");
    expect((await fresh.store.getChangeSet(r.change_set_id as string)).changes[0].after?.targets).toEqual(["facebook_post"]);
  });

  it("refuses more than 20 @-mentions for an Instagram post", async () => {
    const { tools, photo } = await setup();
    const caption = Array.from({ length: 21 }, (_, i) => `@friend${i}`).join(" ");
    expect((await call(tools, "social_post", input(photo.id, { caption }))).error).toMatch(/20 @-mentions/);
  });
});

describe("Instagram feed aspect ratio", () => {
  const dims = async (bytes: Uint8Array) => {
    const m = await sharp(bytes).metadata();
    return [m.width, m.height];
  };
  it("pads a tall photo to 4:5 with an edge colour, stores it, and the Instagram feed post uses it (Facebook keeps the original)", async () => {
    const { tools, store, venue, files, meta } = await setup();
    const tall = await store.saveMedia(venue.id, await jpeg(600, 1200, { r: 20, g: 120, b: 200 }), "image/jpeg");
    const r = await call(tools, "social_post", input(tall.id, { targets: ["facebook_post", "instagram_post", "instagram_story"] }));
    expect(r.status).toBe("proposed");
    const cs = await store.getChangeSet(r.change_set_id as string);
    const row = cs.changes[0].after as Record<string, unknown>;
    expect(row.image_url).toBe(tall.public_url);
    expect(row.ig_feed_ratio).toBe("4:5");
    expect(row.ig_feed_image_url).toMatch(/^https:\/\/media\.example\/storage\/.+\.jpg$/);
    expect(row.ig_feed_image_url).not.toBe(tall.public_url);
    const padded = files.get(String(row.ig_feed_image_url))!;
    expect(await dims(padded)).toEqual([960, 1200]);
    const { data } = await sharp(padded).extract({ left: 2, top: 600, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0] - 20) + Math.abs(data[1] - 120) + Math.abs(data[2] - 200)).toBeLessThan(30);
    expect(r.preview).toContain("за Instagram снимката е допълнена до формат 4:5");
    await handleDecision({ store, messenger: new FakeMessenger(), now: () => T0 }, "tg:1001", "apply", cs.id);
    const containers = [...meta.containers.values()];
    expect(containers.map((c) => [c.media_type, c.image_url])).toEqual([["IMAGE", row.ig_feed_image_url], ["STORIES", tall.public_url]]);
    expect([...meta.posts.values()][0].url).toBe(tall.public_url);
  });
  it("pads a wide photo to 1.91:1", async () => {
    const { tools, store, venue, files } = await setup();
    const wide = await store.saveMedia(venue.id, await jpeg(2000, 800), "image/jpeg");
    const r = await call(tools, "social_post", input(wide.id, { targets: ["instagram_post"] }));
    const row = (await store.getChangeSet(r.change_set_id as string)).changes[0].after as Record<string, unknown>;
    expect(row.ig_feed_ratio).toBe("1.91:1");
    expect(await dims(files.get(String(row.ig_feed_image_url))!)).toEqual([2000, 1048]);
    expect(r.preview).toContain("1.91:1");
  });
  it("leaves photos inside 4:5..1.91:1, Facebook-only and story-only posts alone", async () => {
    const square = await setup();
    const r1 = await call(square.tools, "social_post", input(square.photo.id));
    expect((await square.store.getChangeSet(r1.change_set_id as string)).changes[0].after).not.toHaveProperty("ig_feed_image_url");
    const tallFb = await setup();
    const t1 = await tallFb.store.saveMedia(tallFb.venue.id, await jpeg(600, 1200), "image/jpeg");
    const r2 = await call(tallFb.tools, "social_post", input(t1.id, { targets: ["facebook_post", "instagram_story"] }));
    expect((await tallFb.store.getChangeSet(r2.change_set_id as string)).changes[0].after).not.toHaveProperty("ig_feed_image_url");
  });
});

describe("social_post and the monthly change limit", () => {
  it("refuses at the limit without creating a set", async () => {
    const { tools, store, venue, photo } = await setup();
    await store.setChangeLimit(venue.id, 0);
    expect((await call(tools, "social_post", input(photo.id))).error).toMatch(/Monthly change limit reached.*Лимитът от 0 промени/);
    expect(await store.listChangeSets(venue.id)).toEqual([]);
  });
});
