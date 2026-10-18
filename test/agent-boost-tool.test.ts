// test/agent-boost-tool.test.ts — propose_boost (src/agent/boost-tools.ts): which post, the ad plan Claudia proposes and its
// preview, and what ✅ does in phase 1 (saves the plan: no external call, no change used, undo works).
import { describe, expect, it } from "vitest";
import { instagramAccess } from "@/src/agent/boost-tools";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { adminAction } from "@/src/server/admin";
import { GraphClient, IG_GRAPH } from "@/src/destinations/meta-graph";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import type { BoostPlanRow, Change, SocialPostRow } from "@/src/domain/types";
import { DEMO_VENUE } from "@/src/seed/demo";
import type { Store } from "@/src/store/types";
import { changeUsage } from "@/src/store/usage";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-18T09:00:00.000Z");
const KEY = parseSecretKey("ab".repeat(32));
const DAY = 86_400_000;
const ago = (days: number) => new Date(T0.getTime() - days * DAY).toISOString().replace(/\.\d{3}Z$/, "+0000");

type Reply = { status?: number; body: unknown };
/** A faked graph.instagram.com: the first rule whose key the URL contains answers; anything else is Meta's code 100. */
function fakeGraph(rules: [string, Reply][]) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [key, r] of rules) if (url.includes(key)) return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    return new Response(JSON.stringify({ error: { message: "nope", code: 100 } }), { status: 400 });
  }) as typeof fetch;
  return { client: new GraphClient(IG_GRAPH, "TOKEN", f), calls };
}
const breakdown = (key: string, rows: [string, number][]) => ({
  data: [{ name: "follower_demographics", total_value: { breakdowns: [{ dimension_keys: [key], results: rows.map(([v, value]) => ({ dimension_values: [v], value })) }] } }],
});
const DEMOGRAPHICS: [string, Reply][] = [
  ["breakdown=age", { body: breakdown("age", [["18-24", 20], ["25-34", 50], ["35-44", 30]]) }],
  ["breakdown=gender", { body: breakdown("gender", [["F", 62], ["M", 36], ["U", 2]]) }],
  ["breakdown=city", { body: breakdown("city", [["Sofia, Sofia-Capital", 70], ["Plovdiv, Plovdiv", 30]]) }],
  ["fields=followers_count", { body: { followers_count: 240 } }],
];
const insightsOf = (n: number) => ({ body: { data: [{ name: "reach", values: [{ value: 500 }] }, { name: "saved", values: [{ value: n }] }, { name: "shares", values: [{ value: 1 }] }, { name: "views", values: [{ value: n * 150 }] }] } });
const MEDIA: [string, Reply][] = [
  ["/media?fields=", {
    body: {
      data: [
        { id: "m1", caption: "Брънч в неделя", media_type: "IMAGE", media_product_type: "FEED", timestamp: ago(3), permalink: "https://instagram.com/p/1", media_url: "https://cdn.example/m1.jpg" },
        { id: "m2", caption: "Нова торта", media_type: "IMAGE", media_product_type: "FEED", timestamp: ago(4), permalink: "https://instagram.com/p/2", media_url: "https://cdn.example/m2.jpg" },
      ],
    },
  }],
  ["/m1/insights", insightsOf(9)],
  ["/m2/insights", insightsOf(2)],
];

/** A place list as OpenStreetMap gave it, cached for the demo venue at T0 (no lookup happens). */
const PLACES = [
  { kind: "university" as const, name: "Софийски университет", meters: 400 },
  { kind: "park" as const, name: "Градска градина", meters: 600 },
  { kind: "park" as const, name: null, meters: 900 },
];

interface Opts {
  /**
   * "ok": cached places; "osm": OpenStreetMap failed a moment ago (the pin is known); "geocode": the address is not on the map;
   * "none": the café has no address; "fresh": nothing cached, so a lookup would call OpenStreetMap (through fetchSpy).
   */
  area?: "ok" | "osm" | "geocode" | "none" | "fresh";
  /** Faked Instagram replies; absent = Instagram is not connected. */
  graph?: [string, Reply][];
  member?: "tg:1001" | "tg:1002";
  /** false: the owner's photo was never posted. Default: it was posted on Instagram two days ago (an applied social_post with Meta's id). */
  posted?: boolean;
}

/**
 * An applied social_post set (on the plain store, so fetchSpy stays untouched) and, unless `published` is false, Meta's Instagram
 * post for it in a done sync row, as the push leaves it. The post's id is "ig-<media id>".
 */
async function publishPost(store: Store, venueId: string, media: { id: string; public_url: string }, caption: string, at: Date, chatRef = "tg:1001", published = true) {
  const row: SocialPostRow = { media_id: media.id, image_url: media.public_url, caption, targets: ["instagram_post"] };
  const change: Change = { position: 0, op: "social_post", entity: "social_post", entity_id: media.id, before: null, after: row as unknown as Change["after"] };
  const cs = await store.createChangeSet({ venue_id: venueId, chat_ref: chatRef, summary_bg: "Пост", summary_en: "Post", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [change] });
  await store.applyChangeSet(cs.id, at.toISOString());
  const post_ref = published ? `ig-${media.id}` : null;
  if (post_ref) {
    const dest = (await store.getDestination(venueId, "instagram"))!;
    const sync = await store.createSync({ venue_id: venueId, destination_id: dest.id, change_set_id: cs.id, payload: { kind: "instagram", changes: 1 }, next_at: at.toISOString() });
    await store.updateSync(sync.id, { status: "done", result: { published: [{ target: "instagram_post", media_id: media.id, state: "published", id: post_ref, permalink: `https://instagram.com/p/${media.id}` }] } });
  }
  return { cs, row, media, post_ref };
}

async function setup(o: Opts = {}, over: Partial<AgentDeps> = {}) {
  const demo = await makeDemo();
  const area = o.area ?? "ok";
  const address = demo.venue.address.trim();
  if (area === "ok") await demo.store.putSurroundings({ venue_id: demo.venue.id, address, lat: 42.69, lng: 23.33, places: PLACES, fetched_at: T0.toISOString(), failed_at: null });
  if (area === "osm") await demo.store.putSurroundings({ venue_id: demo.venue.id, address, lat: 42.69, lng: 23.33, places: [], fetched_at: null, failed_at: T0.toISOString() });
  if (area === "none") await demo.store.updateVenue(demo.venue.id, { address: "" });
  if (area === "geocode") await demo.store.putSurroundings({ venue_id: demo.venue.id, address, lat: null, lng: null, places: [], fetched_at: null, failed_at: T0.toISOString() });
  // Every outbound call is recorded and refused: the proposal must not need one (the area is cached) and ✅ must make none.
  const outbound: string[] = [];
  const fetchSpy = (async (input: RequestInfo | URL) => {
    outbound.push(String(input));
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  // Facebook and Instagram connected as destinations, so an apply would push a relevant row to Meta (through fetchSpy).
  await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "facebook", config: { page_id: "p1", page_name: "Ъгъла", connected_at: T0.toISOString() }, secrets: encryptSecrets({ page_token: "PT" }, KEY) });
  await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "instagram", config: { ig_user_id: "17841", username: "agala", connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString() }, secrets: encryptSecrets({ token: "IT" }, KEY) });
  const store = withDestinationSync(demo.store, { store: demo.store, secretKey: KEY, fetch: fetchSpy, log: () => undefined, sleep: async () => undefined }, () => T0);
  const graph = o.graph ? fakeGraph(o.graph) : null;
  const messenger = new FakeMessenger();
  const member = (await store.findMember(o.member ?? "tg:1001"))!;
  const deps: AgentDeps = {
    store, venueId: demo.venue.id, chatRef: member.chat_ref, member, messenger, now: () => T0, baseUrl: "https://site.example", fetch: fetchSpy,
    social: { facebook: false, instagram: graph !== null },
    instagramInsights: graph ? async () => ({ client: graph.client, igUserId: "17841" }) : null,
    ...over,
  };
  const photo = await store.saveMedia(demo.venue.id, new Uint8Array([1, 2, 3]), "image/jpeg");
  const post = o.posted === false ? null : await publishPost(demo.store, demo.venue.id, photo, "", new Date(T0.getTime() - 2 * DAY));
  return { ...demo, plain: demo.store, store, messenger, deps, photo, post, outbound, graph, tools: makeTools(deps) };
}

/** A newer post of this chat (or another), published on Instagram unless `published` is false. */
async function postedBefore(s: Awaited<ReturnType<typeof setup>>, caption: string, at: Date, chatRef = "tg:1001", published = true) {
  const m = await s.plain.saveMedia(s.venue.id, new Uint8Array([4, 5, 6]), "image/jpeg");
  return publishPost(s.plain, s.venue.id, { id: m.id, public_url: `https://media.example/${m.id}.jpg` }, caption, at, chatRef, published);
}

/** The venue's ad plan sets (other sets, like the published post, are fixtures). */
const boostSets = async (s: Awaited<ReturnType<typeof setup>>) => (await s.store.listChangeSets(s.venue.id, {})).filter((cs) => cs.changes.some((c) => c.op === "boost_plan"));

const lastSet = async (s: Awaited<ReturnType<typeof setup>>) => (await s.store.listChangeSets(s.venue.id, { limit: 1 }))[0];
const rowOf = (cs: { changes: Change[] }) => cs.changes[0].after as unknown as BoostPlanRow;

describe("propose_boost: a given photo, with the defaults", () => {
  it("sends the picture first, then one boost_plan proposal: 3 km, 18+, 20 € over 5 days, all day, automatic placements", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(r.status).toBe("proposed");
    expect(s.messenger.photos).toEqual([expect.objectContaining({ url: s.photo.public_url, caption: "Пост за реклама" })]);
    const proposal = s.messenger.sent.at(-1)!;
    expect(proposal.setId).toBe(r.change_set_id);
    expect(Number(s.messenger.photos[0].messageRef)).toBeLessThan(Number(proposal.messageRef)); // the picture is above the buttons
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.status).toBe("proposed");
    expect(cs.changes).toHaveLength(1);
    expect(cs.changes[0]).toMatchObject({ op: "boost_plan", entity: "boost_plan", before: null });
    const row = rowOf(cs);
    expect(row.plan).toMatchObject({ variant: "default", radiusKm: 3, ageMin: 18, schedule: { days: ["mon", "tue", "wed", "thu", "fri", "sat"], from: "00:00", to: "23:59" }, budgetEur: 20, days: 5, placements: "automatic", goal: "profile_visits" });
    expect(row).toMatchObject({ media_id: s.photo.id, post_ref: `ig-${s.photo.id}`, permalink: `https://instagram.com/p/${s.photo.id}`, image_url: s.photo.public_url, lat: 42.69, lng: 23.33 });
    expect(s.outbound).toEqual([]); // the area came from the cache; nothing else was asked
  });

  it("goal is reach when the café has a Facebook Page", async () => {
    const s = await setup({}, { social: { facebook: true, instagram: false } });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan.goal).toBe("reach");
  });

  it("passes the owner's budget, days and variant to the plan; the summary prints the money like the preview", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, budget_eur: 12.5, days: 3, variant: "weekend" });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(rowOf(cs).plan).toMatchObject({ budgetEur: 12.5, days: 3, variant: "weekend", radiusKm: 4.5, owner: { budgetEur: 12.5, days: 3, variant: "weekend" } });
    expect(cs.summary_bg).toBe("План за реклама: 12,50 €, 3 дни");
    expect(cs.summary_en).toBe("Ad plan: €12.50, 3 days");
  });

  it("refuses a photo of another venue or an unknown id", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", { media_id: "nope" });
    expect(String(r.error)).toMatch(/media_id "nope" not found/);
    expect(s.messenger.photos).toEqual([]);
  });
});

describe("propose_boost: which post", () => {
  it("without a photo, takes the owner's most recent published social_post in this conversation", async () => {
    const s = await setup();
    await postedBefore(s, "По-стар пост", new Date(T0.getTime() - 3 * DAY));
    const recent = await postedBefore(s, "Тиквена супа днес 🎃", new Date(T0.getTime() - DAY));
    await postedBefore(s, "От друг чат", new Date(T0.getTime() - 3_600_000), "tg:1002");
    const r = await call(s.tools, "propose_boost", {});
    const row = rowOf(await s.store.getChangeSet(r.change_set_id as string));
    expect(row).toMatchObject({ media_id: recent.media.id, post_ref: recent.post_ref, caption: "Тиквена супа днес 🎃", image_url: recent.row.image_url });
    expect(s.messenger.photos[0]).toMatchObject({ url: recent.row.image_url, caption: "Пост за реклама" });
  });

  it("then the best recent Instagram post (bestPost), with its permalink and picture", async () => {
    const s = await setup({ graph: [...MEDIA], posted: false });
    const r = await call(s.tools, "propose_boost", {});
    const row = rowOf(await s.store.getChangeSet(r.change_set_id as string));
    expect(row).toMatchObject({ post_ref: "m1", permalink: "https://instagram.com/p/1", caption: "Брънч в неделя", image_url: "https://cdn.example/m1.jpg", media_id: null });
    expect(s.messenger.photos[0]).toMatchObject({ url: "https://cdn.example/m1.jpg" });
    // The post's own numbers are a fact; the brunch caption picks the weekend variant.
    expect(row.plan.variant).toBe("weekend");
    expect(row.plan.reasons).toContainEqual(expect.objectContaining({ kind: "fact", bg: "този пост има 9 запазвания и 1 споделяне при обхват 500" }));
  });

  it("a named post_ref is found among the account's recent posts", async () => {
    const s = await setup({ graph: [...MEDIA] });
    const r = await call(s.tools, "propose_boost", { post_ref: "https://instagram.com/p/2" });
    expect(rowOf(await s.store.getChangeSet(r.change_set_id as string))).toMatchObject({ post_ref: "m2", caption: "Нова торта" });
  });

  it("a post_ref that is nowhere is an error, not another post", async () => {
    const s = await setup({ graph: [...MEDIA] });
    const r = await call(s.tools, "propose_boost", { post_ref: "m404" });
    expect(String(r.error)).toMatch(/post_ref "m404" not found/);
    expect(await boostSets(s)).toEqual([]);
  });

  it("with no post at all, asks which post", async () => {
    const s = await setup({ posted: false });
    const r = await call(s.tools, "propose_boost", {});
    expect(r.error).toBe("Which post should I boost? Send it or name it.");
    expect(s.messenger.photos).toEqual([]);
    expect(s.messenger.sent).toEqual([]);
  });
});

describe("propose_boost: only a published post can be boosted", () => {
  const UNPUBLISHED = /not published yet.*social_post first.*propose_boost/;
  it("a fresh photo (never posted) is not proposed: the error says to post it with social_post first", async () => {
    const s = await setup({ posted: false, area: "fresh" });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(String(r.error)).toMatch(UNPUBLISHED);
    expect(s.messenger.photos).toEqual([]);
    expect(s.messenger.sent).toEqual([]);
    expect(await boostSets(s)).toEqual([]);
    expect(s.outbound).toEqual([]); // refused before OpenStreetMap is asked
  });

  it("the owner's last post whose publishing never went through is not proposed either", async () => {
    const s = await setup({ posted: false });
    await postedBefore(s, "Не стигна до Instagram", new Date(T0.getTime() - DAY), "tg:1001", false);
    const r = await call(s.tools, "propose_boost", {});
    expect(String(r.error)).toMatch(UNPUBLISHED);
    expect(await boostSets(s)).toEqual([]);
  });
});

describe("propose_boost: ✏️ keeps the post", () => {
  it("a correction with only a new budget keeps the corrected plan's post, even when a newer post exists", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", {});
    expect(rowOf(await s.store.getChangeSet(first.change_set_id as string)).post_ref).toBe(`ig-${s.photo.id}`);
    await postedBefore(s, "По-нов пост", new Date(T0.getTime() - 3_600_000));
    const again = makeTools({ ...s.deps, turnSets: new Set(), correctionFor: first.change_set_id as string });
    const r = await call(again, "propose_boost", { budget_eur: 30 });
    expect(r.status).toBe("proposed");
    const row = rowOf(await s.store.getChangeSet(r.change_set_id as string));
    expect(row).toMatchObject({ post_ref: `ig-${s.photo.id}`, media_id: s.photo.id, caption: "", image_url: s.photo.public_url, permalink: `https://instagram.com/p/${s.photo.id}` });
    expect(row.plan.budgetEur).toBe(30);
    expect((await s.store.getChangeSet(first.change_set_id as string)).status).toBe("cancelled"); // replaced
  });
});

describe("propose_boost: the inputs it could not read are missing, never invented", () => {
  it("without Instagram the follower line is missing", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const row = rowOf(await s.store.getChangeSet(r.change_set_id as string));
    expect(row.plan.reasons).toContainEqual({ kind: "missing", bg: "демографията на последователите ще се вижда при 100+ последователи и свързан Instagram", en: "follower demographics will show with 100+ followers and a connected Instagram" });
    expect(String(r.preview)).toContain("— демографията на последователите ще се вижда при 100+ последователи и свързан Instagram");
  });

  it("with Instagram and 100+ followers, the follower line is a fact, with the city in Bulgarian in the Bulgarian preview", async () => {
    const s = await setup({ graph: [...DEMOGRAPHICS, ...MEDIA] });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg).toContain("• 62% от последователите са жени, най-много 25–34 г., 70% от София");
    expect(cs.preview_en).toContain("• 62% of followers are women, most are 25–34, 70% from Sofia");
  });

  it("when OpenStreetMap is down the area line reads \"couldn't check the area\" and the plan keeps the defaults", async () => {
    const s = await setup({ area: "osm" });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg).toContain("— не успях да проверя района");
    expect(cs.preview_en).toContain("— I couldn't check the area");
    expect(rowOf(cs).plan).toMatchObject({ radiusKm: 3, budgetEur: 20, days: 5 });
    expect(cs.preview_bg).not.toContain("местоположението");
  });

  it("a café with no address is told to add it", async () => {
    const s = await setup({ area: "none" });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg).toContain("— липсва адрес на ⟦Кафене „Ъгъла“⟧ — добавете го, за да проверя района");
    expect(cs.preview_en).toContain("— ⟦Кафене „Ъгъла“⟧ has no address — add it so I can check the area");
    expect(cs.preview_bg).not.toContain("не беше намерен на картата");
    expect(s.outbound).toEqual([]);
    expect(s.messenger.sent.at(-1)!.text).toContain("— липсва адрес на Кафене „Ъгъла“ —");
  });

  it("when the address is not on the map, the proposal also says the location needs checking", async () => {
    const s = await setup({ area: "geocode" });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg).toContain("— не успях да проверя района");
    expect(cs.preview_bg).toContain("— местоположението на ⟦Кафене „Ъгъла“⟧ трябва да се провери: адресът не беше намерен на картата");
    expect(cs.preview_en).toContain("— ⟦Кафене „Ъгъла“⟧'s location needs checking: its address wasn't found on the map");
    expect(rowOf(cs)).toMatchObject({ lat: null, lng: null });
  });
});

describe("propose_boost: refusals", () => {
  it("the budget-range error passes through with the allowed range, and nothing is sent", async () => {
    const s = await setup();
    const low = await call(s.tools, "propose_boost", { media_id: s.photo.id, budget_eur: 4 });
    expect(String(low.error)).toMatch(/5–200 €/);
    const long = await call(s.tools, "propose_boost", { media_id: s.photo.id, days: 30 });
    expect(String(long.error)).toMatch(/1–14 days/);
    expect(s.messenger.photos).toEqual([]);
    expect(s.messenger.sent).toEqual([]);
    expect(await boostSets(s)).toEqual([]);
  });

  it("staff are refused", async () => {
    const s = await setup({ member: "tg:1002" });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(String(r.error)).toMatch(/only the owner's decision/);
    expect(s.messenger.photos).toEqual([]);
    expect(await boostSets(s)).toEqual([]);
  });

  it("an earlier pending proposal blocks it before OpenStreetMap or Instagram is read", async () => {
    const s = await setup({ area: "fresh", graph: [...DEMOGRAPHICS, ...MEDIA] });
    await call(s.tools, "propose_changes", { summary_bg: "Цена", summary_en: "Price", changes: [{ op: "set_price", item_id: Object.values(s.items)[0].id, price_eur: 3.3 }] });
    const again = makeTools({ ...s.deps, turnSets: new Set() });
    const r = await call(again, "propose_boost", { media_id: s.photo.id });
    expect(String(r.error)).toMatch(/already waiting for a decision/);
    expect(s.outbound).toEqual([]);
    expect(s.graph!.calls).toEqual([]);
  });
});

describe("propose_boost: the preview", () => {
  const CAPTION = "Тиквена супа с джинджифил и печени семки, само тази седмица при нас на Раковски 🎃 #кафе";
  it("is exact in Bulgarian: no reach number, the save-only line, reasons facts → hypotheses → missing", async () => {
    const s = await setup();
    await postedBefore(s, CAPTION, new Date(T0.getTime() - DAY));
    const r = await call(s.tools, "propose_boost", {});
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg).toBe([
      "📣 Реклама: ⟦Тиквена супа с джинджифил и печени семки, само тази седмица…⟧",
      "Къде: до 3 км от ⟦Кафене „Ъгъла“⟧",
      "Кой: 18+",
      "Кога: 5 дни, пон–съб, по цял ден",
      "Бюджет: 20 € общо · Цел: посещения на профила · Показва се: автоматично (Instagram + Facebook)",
      "Обхват: ще го видите, щом рекламите са свързани",
      "Защо:",
      "• в радиус 1 км: ⟦Софийски университет⟧ (400 м), 2 парка",
      "• по-широката аудитория обикновено е по-евтина; Meta сама намира кой да види рекламата в радиуса",
      "• смесен район — 3 км",
      "• в дните, в които сте отворени",
      "• 20 € за 5 дни е малък тест — достатъчен Meta да научи кой реагира",
      "— демографията на последователите ще се вижда при 100+ последователи и свързан Instagram",
      "✏️ Всичко може да се промени: радиус, място, възраст, пол, клиенти, дни и часове, продължителност, бюджет, цел, къде се показва.",
      "(Сега само записвам плана — ще може да се пусне, щом Meta одобри рекламите в Claudia.)",
    ].join("\n"));
    expect(s.messenger.sent.at(-1)!.text).toBe(`${cs.preview_bg.replace(/[⟦⟧]/g, "")}\n\nДа запазя ли плана?`);
  });

  it("is exact in English", async () => {
    const s = await setup();
    await postedBefore(s, CAPTION, new Date(T0.getTime() - DAY));
    const r = await call(s.tools, "propose_boost", {});
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_en).toBe([
      "📣 Ad: ⟦Тиквена супа с джинджифил и печени семки, само тази седмица…⟧",
      "Where: within 3 km of ⟦Кафене „Ъгъла“⟧",
      "Who: 18+",
      "When: 5 days, Mon–Sat, all day",
      "Budget: 20 € total · Goal: profile visits · Shows on: automatic (Instagram + Facebook)",
      "Reach: you'll see it once ads are connected",
      "Why:",
      "• within 1 km: ⟦Софийски университет⟧ (400 m), 2 parks",
      "• a broader audience is usually cheaper; Meta itself finds who sees the ad within the radius",
      "• a mixed area — 3 km",
      "• on the days you're open",
      "• 20 € over 5 days is a small test — enough for Meta to learn who responds",
      "— follower demographics will show with 100+ followers and a connected Instagram",
      "✏️ You can change anything: radius, place, age, gender, customers, days and hours, length, budget, goal, where it shows.",
      "(For now I only save the plan — it can run once Meta approves ads in Claudia.)",
    ].join("\n"));
  });

  it("an English-speaking owner gets the English picture caption and preview", async () => {
    const s = await setup();
    const owner = await s.store.upsertMember({ venue_id: s.venue.id, chat_ref: "tg:2001", role: "owner", lang: "en" });
    const tools = makeTools({ ...s.deps, member: owner, chatRef: "tg:2001" });
    const r = await call(tools, "propose_boost", { media_id: s.photo.id });
    expect(s.messenger.photos[0].caption).toBe("Post to boost");
    expect(String(r.preview)).toMatch(/^📣 Ad: \(post without text\)\n/);
    expect(s.messenger.sent.at(-1)!.text).toMatch(/\n\nSave the plan\?$/);
  });
});

describe("propose_boost: ✅ only saves the plan", () => {
  it("apply makes no external call and uses no change of the month; undo removes it", async () => {
    const s = await setup();
    // Two changes a month: the published post (a fixture) used one; the price change below uses the other.
    await s.store.setChangeLimit(s.venue.id, 2);
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const before = await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0);
    const decided = await handleDecision({ store: s.store, messenger: new FakeMessenger(), now: () => T0 }, "tg:1001", "apply", r.change_set_id as string);
    // Saved, not applied, and no usage line: the plan used no change.
    const saved = "✅ Планът е запазен — ще може да се пусне, щом рекламите са свързани.";
    expect(decided.toast).toBe(saved);
    expect(decided.edit).toEqual({ full: expect.stringMatching(/\n\n✅ Планът е запазен — ще може да се пусне, щом рекламите са свързани\.$/), short: saved });
    expect(decided.edit!.full).not.toMatch(/Приложено|Промени този месец/);
    expect((await s.store.getChangeSet(r.change_set_id as string)).status).toBe("applied");
    expect(s.outbound).toEqual([]);
    expect(await s.store.listSyncs({ changeSetId: r.change_set_id as string })).toEqual([]);
    const after = await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0);
    expect(after.used).toBe(before.used);
    expect(after.reached).toBe(false);
    // A second plan in a month whose only change is used up still proposes and applies.
    await call(s.tools, "propose_changes", { summary_bg: "Цена", summary_en: "Price", changes: [{ op: "set_price", item_id: Object.values(s.items)[0].id, price_eur: 3.3 }] });
    const priceSet = await lastSet(s);
    await s.store.applyChangeSet(priceSet.id, T0.toISOString());
    expect((await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0)).reached).toBe(true);
    const tools = makeTools({ ...s.deps, turnSets: new Set() });
    const second = await call(tools, "propose_boost", { media_id: s.photo.id, budget_eur: 30, days: 3 });
    expect(second.status).toBe("proposed");
    expect(second.change_set_id).toBeTruthy();
    // From the dashboard: saved, no "applied", no usage line, on the owner's chat message.
    const chat = new FakeMessenger();
    expect(await adminAction({ store: s.store, messenger: chat, now: () => T0, baseUrl: "https://site.example" }, await s.store.getVenue(s.venue.id), "apply", second.change_set_id as string)).toEqual({ ok: true, status: "applied", change_set_id: second.change_set_id });
    expect(chat.concluded.at(-1)!.short).toBe("✅ Планът е запазен от таблото — ще може да се пусне, щом рекламите са свързани.");

    // Undo the first plan: the inverse removes it.
    const undoTools = makeTools({ ...s.deps, turnSets: new Set() });
    const u = await call(undoTools, "undo", { change_set_id: r.change_set_id });
    expect(String(u.preview)).toBe("• Премахва плана за реклама: (пост без текст)");
    // ✅ on the undo says the plan is removed: no "applied", no usage line.
    const removed = await handleDecision({ store: s.store, messenger: new FakeMessenger(), now: () => T0 }, "tg:1001", "apply", u.change_set_id as string);
    expect(removed.toast).toBe("✅ Планът е премахнат.");
    expect(removed.edit!.short).toBe("✅ Планът е премахнат.");
    expect(removed.edit!.full).not.toMatch(/Приложено|Промени този месец/);
    expect((await s.store.getChangeSet(r.change_set_id as string)).status).toBe("reverted");

    // The second plan's undo, approved on the dashboard: removed, no "applied", no usage line.
    const undo2 = await call(makeTools({ ...s.deps, turnSets: new Set() }), "undo", { change_set_id: second.change_set_id });
    const chat2 = new FakeMessenger();
    expect(await adminAction({ store: s.store, messenger: chat2, now: () => T0, baseUrl: "https://site.example" }, await s.store.getVenue(s.venue.id), "apply", undo2.change_set_id as string)).toMatchObject({ ok: true, status: "applied" });
    expect(chat2.concluded.at(-1)!.short).toBe("✅ Планът е премахнат от таблото.");
    expect((await s.store.getChangeSet(second.change_set_id as string)).status).toBe("reverted");
    expect(s.outbound).toEqual([]);
  });
});

describe("propose_boost: wiring", () => {
  it("an Instagram access that fails is a missing input, never an error", async () => {
    const s = await setup({}, { instagramInsights: async () => { throw new Error("secrets unreadable"); } });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(r.status).toBe("proposed");
    expect(String(r.preview)).toContain("— демографията на последователите");
  });

  it("instagramAccess: a client for a connected account; null without the key, the destination or a token", async () => {
    const s = await setup();
    const access = await instagramAccess({ store: s.plain, secretKey: KEY }, s.venue.id);
    expect(access).toMatchObject({ igUserId: "17841" });
    expect(access!.client).toBeInstanceOf(GraphClient);
    expect(await instagramAccess({ store: s.plain, secretKey: null }, s.venue.id)).toBeNull();
    expect(await instagramAccess({ store: s.plain, secretKey: parseSecretKey("cd".repeat(32)) }, s.venue.id)).toBeNull(); // undecryptable
    const bare = await makeDemo();
    expect(await instagramAccess({ store: bare.store, secretKey: KEY }, bare.venue.id)).toBeNull();
  });

  it("the boost_plan entity is allowed in SQL, in the integrations schema and in its migration", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["supabase/schema-integrations.sql", "supabase/migrations/2026-10-18-boost-plan-entity.sql"]) {
      const checks = readFileSync(file, "utf8").match(/add constraint changes_entity_check\s*check \(entity in \(([^)]*)\)\);/g) ?? [];
      expect(checks.at(-1)).toContain("'boost_plan'");
      expect(checks.at(-1)).toContain("'social_moderate'");
    }
  });
});

/** A Nominatim that knows one place (the NDK, in Sofia) and counts its questions; any other place is not on the map. */
function fakeNominatim() {
  const asked: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(new URL(url).searchParams.get("q") ?? "");
    const known = url.includes("%D0%9D%D0%94%D0%9A");
    return new Response(JSON.stringify(known ? [{ lat: "42.6859", lon: "23.3188", display_name: "НДК, бул. България, София, България" }] : []), { status: 200 });
  }) as typeof fetch;
  return { f, asked };
}

describe("propose_boost: the owner can change every field", () => {
  /** ✏️ on the plan of `first`: the same chat, correctionFor = that set. */
  const correcting = (s: Awaited<ReturnType<typeof setup>>, first: Record<string, unknown>, over: Partial<AgentDeps> = {}) =>
    makeTools({ ...s.deps, turnSets: new Set(), correctionFor: first.change_set_id as string, ...over });

  it("✏️ keeps every earlier owner choice: 5 km, then 30 € gives 5 km and 30 €", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, radius_km: 5 });
    const r = await call(correcting(s, first), "propose_boost", { budget_eur: 30 });
    expect(r.status).toBe("proposed");
    const plan = rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan;
    expect(plan).toMatchObject({ radiusKm: 5, budgetEur: 30, owner: { radiusKm: 5, budgetEur: 30 } });
  });

  it("weekdays / from / to make the schedule; a missing part comes from the carried schedule, else mon–sun 00:00–23:59", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, weekdays: ["mon", "tue"] });
    expect(rowOf(await s.store.getChangeSet(first.change_set_id as string)).plan.schedule).toEqual({ days: ["mon", "tue"], from: "00:00", to: "23:59" });
    const second = await call(correcting(s, first), "propose_boost", { from: "09:00", to: "12:00" });
    expect(rowOf(await s.store.getChangeSet(second.change_set_id as string)).plan.schedule).toEqual({ days: ["mon", "tue"], from: "09:00", to: "12:00" });
    const fresh = await setup();
    const hours = await call(fresh.tools, "propose_boost", { media_id: fresh.photo.id, from: "10:00" });
    expect(rowOf(await fresh.store.getChangeSet(hours.change_set_id as string)).plan.schedule).toEqual({ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], from: "10:00", to: "23:59" });
  });

  it("age_min / age_max / gender / audience / goal / placements reach the plan and its owner record; age_max null is 65+", async () => {
    const s = await setup({}, { social: { facebook: true, instagram: false } });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, age_min: 30, age_max: null, gender: "men", audience: "студенти от университета", goal: "profile_visits", placements: "facebook" });
    const plan = rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan;
    expect(plan).toMatchObject({ ageMin: 30, ageMax: null, gender: "men", audience: "студенти от университета", goal: "profile_visits", placements: "facebook" });
    expect(plan.owner).toMatchObject({ ageMin: 30, ageMax: null, gender: "men", audience: "студенти от университета", goal: "profile_visits", placements: "facebook" });
  });

  it("reset brings back the analysis for exactly the named fields and keeps the other choices", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, radius_km: 5, budget_eur: 30, gender: "women" });
    const r = await call(correcting(s, first), "propose_boost", { reset: ["radius", "gender"] });
    const plan = rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan;
    expect(plan).toMatchObject({ radiusKm: 3, gender: "all", budgetEur: 30 });
    expect(plan.owner).toEqual({ budgetEur: 30 });
    // A reset and a new value for the same field in one call: the new value stays.
    const again = await call(correcting(s, r), "propose_boost", { reset: ["budget"], budget_eur: 40, days: 2 });
    expect(rowOf(await s.store.getChangeSet(again.change_set_id as string)).plan.owner).toEqual({ budgetEur: 40, days: 2 });
  });

  it("an out-of-range owner value is the tool error, with nothing proposed", async () => {
    const s = await setup();
    expect(String((await call(s.tools, "propose_boost", { media_id: s.photo.id, radius_km: 80 })).error)).toMatch(/1–50 km/);
    expect(String((await call(s.tools, "propose_boost", { media_id: s.photo.id, age_min: 16 })).error)).toMatch(/18–65/);
    expect(await boostSets(s)).toEqual([]);
  });
});

describe("propose_boost: around another place", () => {
  it("a place that is not on the map is a tool error asking for an address; no change set, no message, the old plan stays", async () => {
    const geo = fakeNominatim();
    const s = await setup({}, { fetch: geo.f });
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const sent = s.messenger.sent.length;
    const photos = s.messenger.photos.length;
    const r = await call(makeTools({ ...s.deps, turnSets: new Set(), correctionFor: first.change_set_id as string }), "propose_boost", { place: "Нигдеград" });
    expect(r.error).toBe('I couldn\'t find "Нигдеград" on the map; ask the owner for a street address near it.');
    expect(geo.asked).toEqual(["Нигдеград"]);
    expect(await boostSets(s)).toHaveLength(1);
    expect((await s.store.getChangeSet(first.change_set_id as string)).status).toBe("proposed");
    expect(s.messenger.sent).toHaveLength(sent);
    expect(s.messenger.photos).toHaveLength(photos);
  });

  it("a found place: the row's pin is that place, place_label is the owner's text, and the preview says the area was analysed around the business", async () => {
    const geo = fakeNominatim();
    const s = await setup({}, { fetch: geo.f });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, place: "НДК" });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(rowOf(cs)).toMatchObject({ lat: 42.6859, lng: 23.3188, place_label: "НДК" });
    expect(rowOf(cs).plan).toMatchObject({ place: "НДК", owner: { place: "НДК" } });
    expect(cs.preview_bg).toContain("Къде: до 3 км от ⟦НДК⟧ ✎");
    expect(cs.preview_bg).toContain("• районът е анализиран около ⟦Кафене „Ъгъла“⟧, рекламата е около ⟦НДК⟧");
    expect(cs.preview_en).toContain("• the area was analysed around ⟦Кафене „Ъгъла“⟧, the ad is around ⟦НДК⟧");
    expect(rowOf(cs).plan.reasons).toContainEqual(expect.objectContaining({ kind: "hypothesis" }));
    // The business's own area is still what was analysed.
    expect(cs.preview_bg).toContain("⟦Софийски университет⟧ (400 м)");
  });

  it("without a place the label is the business name; a carried place keeps its pin without asking the map again", async () => {
    const geo = fakeNominatim();
    const s = await setup({}, { fetch: geo.f });
    const plain = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(rowOf(await s.store.getChangeSet(plain.change_set_id as string))).toMatchObject({ place_label: "Кафене „Ъгъла“", lat: 42.69, lng: 23.33 });
    const first = await call(makeTools({ ...s.deps, turnSets: new Set(), correctionFor: plain.change_set_id as string }), "propose_boost", { place: "НДК" });
    const asked = geo.asked.length;
    const second = await call(makeTools({ ...s.deps, turnSets: new Set(), correctionFor: first.change_set_id as string }), "propose_boost", { budget_eur: 30 });
    expect(rowOf(await s.store.getChangeSet(second.change_set_id as string))).toMatchObject({ place_label: "НДК", lat: 42.6859, lng: 23.3188 });
    expect(geo.asked).toHaveLength(asked);
    // Claudia deciding the place again brings the business back.
    const back = await call(makeTools({ ...s.deps, turnSets: new Set(), correctionFor: second.change_set_id as string }), "propose_boost", { reset: ["place"] });
    expect(rowOf(await s.store.getChangeSet(back.change_set_id as string))).toMatchObject({ place_label: "Кафене „Ъгъла“", lat: 42.69, lng: 23.33 });
  });
});

describe("propose_boost: goal and placement checks", () => {
  it("website_visits needs a website: a draft venue with no site_url is refused; a site_url or a live venue is fine", async () => {
    const s = await setup();
    await s.plain.updateVenue(s.venue.id, { status: "draft" });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, goal: "website_visits" });
    expect(r.error).toBe("This business has no website yet; offer reach or profile visits.");
    expect(await boostSets(s)).toEqual([]);
    await s.plain.updateVenue(s.venue.id, { site_url: "https://agala.example" });
    const ok = await call(s.tools, "propose_boost", { media_id: s.photo.id, goal: "website_visits" });
    expect(rowOf(await s.store.getChangeSet(ok.change_set_id as string)).plan.goal).toBe("website_visits");
    const live = await setup();
    const liveOk = await call(live.tools, "propose_boost", { media_id: live.photo.id, goal: "website_visits" });
    expect(liveOk.status).toBe("proposed");
  });

  it("placements facebook needs a connected Facebook Page", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, placements: "facebook" });
    expect(r.error).toBe("No Facebook Page is connected; offer Instagram or automatic.");
    expect(await boostSets(s)).toEqual([]);
    const fb = await setup({}, { social: { facebook: true, instagram: false } });
    const ok = await call(fb.tools, "propose_boost", { media_id: fb.photo.id, placements: "facebook" });
    expect(rowOf(await fb.store.getChangeSet(ok.change_set_id as string)).plan.placements).toBe("facebook");
  });
});

describe("propose_boost: the preview shows the analysis and marks the owner's choices", () => {
  it("is exact in Bulgarian: suggestions to Meta, the owner's choices marked ✎, the owner's words kept", async () => {
    const s = await setup({ graph: [...DEMOGRAPHICS, ...MEDIA] });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, radius_km: 2, gender: "women", audience: "студенти", budget_eur: 30 });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg.split("\n").slice(0, 7)).toEqual([
      "📣 Реклама: (пост без текст)",
      "Къде: до 2 км ✎ от ⟦Кафене „Ъгъла“⟧",
      "Кой: 18+ · предложение към Meta: 25–44 г., жени ✎ · клиенти: ⟦студенти⟧ ✎",
      "Кога: 5 дни, пон–съб, по цял ден",
      "Бюджет: 30 € ✎ общо · Цел: посещения на профила · Показва се: автоматично (Instagram + Facebook)",
      "Обхват: ще го видите, щом рекламите са свързани",
      "Защо:",
    ]);
    expect(cs.preview_bg).toContain("• най-много от последователите са 25–44 → предлагам 25–44 на Meta");
  });

  it("in English", async () => {
    const s = await setup({ graph: [...DEMOGRAPHICS, ...MEDIA] });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, radius_km: 2, gender: "women", audience: "students", goal: "reach" , placements: "instagram" });
    const lines = (await s.store.getChangeSet(r.change_set_id as string)).preview_en.split("\n");
    expect(lines[1]).toBe("Where: within 2 km ✎ of ⟦Кафене „Ъгъла“⟧");
    expect(lines[2]).toBe("Who: 18+ · suggested to Meta: 25–44, women ✎ · customers: ⟦students⟧ ✎");
    expect(lines[4]).toBe("Budget: 20 € total · Goal: people nearby ✎ · Shows on: Instagram only ✎");
    expect(lines.at(-2)).toBe("✏️ You can change anything: radius, place, age, gender, customers, days and hours, length, budget, goal, where it shows.");
  });

  it("the owner's audience reaches the chat message kept as written", async () => {
    const s = await setup();
    await call(s.tools, "propose_boost", { media_id: s.photo.id, audience: "млади майки" });
    expect(s.messenger.raw.at(-1)).toContain("клиенти: ⟦млади майки⟧");
  });
});

describe("propose_boost: the old row without the new fields", () => {
  it("is corrected on ✏️ with no owner choices carried, and the new plan has a label", async () => {
    const s = await setup();
    const old = { plan: { variant: "default", radiusKm: 3, ageMin: 18, schedule: null, budgetEur: 20, days: 5, placements: "automatic", goal: "reach", reasons: [] }, post_ref: `ig-${s.photo.id}`, permalink: null, media_id: s.photo.id, caption: "", image_url: s.photo.public_url, lat: 42.69, lng: 23.33 };
    const change: Change = { position: 0, op: "boost_plan", entity: "boost_plan", entity_id: "old-1", before: null, after: old as unknown as Change["after"] };
    const cs = await s.store.createChangeSet({ venue_id: s.venue.id, chat_ref: "tg:1001", summary_bg: "План", summary_en: "Plan", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [change] });
    const r = await call(makeTools({ ...s.deps, turnSets: new Set(), correctionFor: cs.id }), "propose_boost", { budget_eur: 25 });
    expect(r.status).toBe("proposed");
    const row = rowOf(await s.store.getChangeSet(r.change_set_id as string));
    expect(row.plan.owner).toEqual({ budgetEur: 25 });
    expect(row.place_label).toBe("Кафене „Ъгъла“");
  });
});

describe("propose_boost: fix round 1", () => {
  const correcting = (s: Awaited<ReturnType<typeof setup>>, first: Record<string, unknown>) => makeTools({ ...s.deps, turnSets: new Set(), correctionFor: first.change_set_id as string });

  it("reset [schedule] also drops the owner's morning/weekend variant", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, variant: "weekend", budget_eur: 30 });
    expect(rowOf(await s.store.getChangeSet(first.change_set_id as string)).plan).toMatchObject({ variant: "weekend", radiusKm: 4.5 });
    const r = await call(correcting(s, first), "propose_boost", { reset: ["schedule"] });
    const plan = rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan;
    expect(plan).toMatchObject({ variant: "default", radiusKm: 3, budgetEur: 30 });
    expect(plan.owner).toEqual({ budgetEur: 30 });
  });

  it("reset [all] drops every owner choice and keeps the post: \"само сутрин\" then \"ти реши за всичко\" is the analysis plan with no ✎", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, variant: "morning", radius_km: 2, gender: "women", audience: "студенти", budget_eur: 30 });
    expect(rowOf(await s.store.getChangeSet(first.change_set_id as string)).plan.variant).toBe("morning");
    const r = await call(correcting(s, first), "propose_boost", { reset: ["all"] });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    const row = rowOf(cs);
    expect(row.plan.owner).toEqual({});
    expect(row.plan).toMatchObject({ variant: "default", radiusKm: 3, gender: "all", audience: null, budgetEur: 20, days: 5, schedule: { days: ["mon", "tue", "wed", "thu", "fri", "sat"], from: "00:00", to: "23:59" } });
    expect(row).toMatchObject({ post_ref: `ig-${s.photo.id}`, media_id: s.photo.id, place_label: "Кафене „Ъгъла“" });
    expect(cs.preview_bg).not.toContain("✎");
    expect(cs.preview_en).not.toContain("✎");
  });

  it("a ✏️ on another venue's plan carries nothing", async () => {
    const s = await setup();
    const other = await s.plain.createVenue({ ...DEMO_VENUE, slug: "drugo" });
    const foreign: BoostPlanRow = { plan: { variant: "default", radiusKm: 7, place: null, ageMin: 40, ageMax: 50, suggestedAge: null, gender: "men", audience: "чужди", schedule: null, budgetEur: 99, days: 9, placements: "automatic", goal: "reach", reasons: [], owner: { radiusKm: 7, gender: "men", budgetEur: 99 } }, post_ref: "foreign-post", permalink: null, media_id: null, caption: "чужд", image_url: null, lat: 1, lng: 1, place_label: "Чуждо", place_display: null };
    const change: Change = { position: 0, op: "boost_plan", entity: "boost_plan", entity_id: "f-1", before: null, after: foreign as unknown as Change["after"] };
    const cs = await s.store.createChangeSet({ venue_id: other.id, chat_ref: "tg:9", summary_bg: "План", summary_en: "Plan", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [change] });
    const r = await call(correcting(s, { change_set_id: cs.id }), "propose_boost", { budget_eur: 25 });
    expect(r.status).toBe("proposed");
    const row = rowOf(await s.store.getChangeSet(r.change_set_id as string));
    expect(row.plan.owner).toEqual({ budgetEur: 25 });
    expect(row.plan).toMatchObject({ radiusKm: 3, gender: "all", audience: null });
    expect(row).toMatchObject({ post_ref: `ig-${s.photo.id}`, caption: "" });
    expect((await s.store.getChangeSet(cs.id)).status).toBe("proposed"); // theirs is untouched
  });

  it("a place and a radius together: the radius is around the owner's place", async () => {
    const geo = fakeNominatim();
    const s = await setup({}, { fetch: geo.f });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, place: "НДК", radius_km: 1.5 });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(rowOf(cs)).toMatchObject({ lat: 42.6859, lng: 23.3188, place_label: "НДК" });
    expect(rowOf(cs).plan).toMatchObject({ radiusKm: 1.5, place: "НДК", owner: { place: "НДК", radiusKm: 1.5 } });
    expect(cs.preview_bg).toContain("Къде: до 1,5 км ✎ от ⟦НДК⟧ ✎");
  });

  it("age_max null (65+) survives a ✏️ chain", async () => {
    const s = await setup({ graph: [...DEMOGRAPHICS, ...MEDIA] });
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, age_min: 30, age_max: null });
    const second = await call(correcting(s, first), "propose_boost", { budget_eur: 30 });
    const third = await call(correcting(s, second), "propose_boost", { radius_km: 2 });
    const plan = rowOf(await s.store.getChangeSet(third.change_set_id as string)).plan;
    expect(plan.owner).toEqual({ ageMin: 30, ageMax: null, budgetEur: 30, radiusKm: 2 });
    expect(plan).toMatchObject({ ageMin: 30, ageMax: null, suggestedAge: null });
  });

  it("an owner place that pins the ad skips the location-check line even when the business's address is not on the map", async () => {
    const geo = fakeNominatim();
    const s = await setup({ area: "geocode" }, { fetch: geo.f });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, place: "НДК" });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg).not.toContain("трябва да се провери");
    expect(rowOf(cs)).toMatchObject({ lat: 42.6859, lng: 23.3188 });
  });

  it("the preview's age: hard limits with ✎, and the suggestion to Meta from the analysis", async () => {
    const s = await setup({ graph: [...DEMOGRAPHICS, ...MEDIA] });
    const plain = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect((await s.store.getChangeSet(plain.change_set_id as string)).preview_bg).toContain("Кой: 18+ · предложение към Meta: 25–44 г.");
    const owned = await call(correcting(s, plain), "propose_boost", { age_min: 30, age_max: 40 });
    expect((await s.store.getChangeSet(owned.change_set_id as string)).preview_bg).toContain("Кой: 30–40 ✎\n");
  });
});

describe("propose_boost: final fix wave", () => {
  const correcting = (s: Awaited<ReturnType<typeof setup>>, first: Record<string, unknown>) => makeTools({ ...s.deps, turnSets: new Set(), correctionFor: first.change_set_id as string });

  it("a partial schedule change keeps the analysed days (the demo café is closed on Sunday) and the morning window", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(rowOf(await s.store.getChangeSet(first.change_set_id as string)).plan.schedule).toEqual({ days: ["mon", "tue", "wed", "thu", "fri", "sat"], from: "00:00", to: "23:59" });
    const second = await call(correcting(s, first), "propose_boost", { from: "09:00", to: "12:00" });
    expect(rowOf(await s.store.getChangeSet(second.change_set_id as string)).plan.schedule).toEqual({ days: ["mon", "tue", "wed", "thu", "fri", "sat"], from: "09:00", to: "12:00" });
    const morning = await call(correcting(s, second), "propose_boost", { reset: ["schedule"], variant: "morning" });
    const m = rowOf(await s.store.getChangeSet(morning.change_set_id as string)).plan.schedule!;
    const later = await call(correcting(s, morning), "propose_boost", { to: "12:00" });
    expect(rowOf(await s.store.getChangeSet(later.change_set_id as string)).plan.schedule).toEqual({ ...m, to: "12:00" });
  });

  it("a text change after the owner's earlier proposal was cancelled keeps the earlier choices and the post, without ✏️", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, radius_km: 5 });
    // The pending proposal blocks a new one; the agent cancels it first, as its error says.
    const blocked = await call(makeTools({ ...s.deps, turnSets: new Set() }), "propose_boost", { budget_eur: 30 });
    expect(String(blocked.error)).toMatch(/already waiting/);
    const tools = makeTools({ ...s.deps, turnSets: new Set() });
    await call(tools, "cancel_change_set", { change_set_id: first.change_set_id });
    await postedBefore(s, "По-нов пост", new Date(T0.getTime() - 3_600_000));
    const r = await call(tools, "propose_boost", { budget_eur: 30 });
    expect(r.status).toBe("proposed");
    const row = rowOf(await s.store.getChangeSet(r.change_set_id as string));
    expect(row.plan).toMatchObject({ radiusKm: 5, budgetEur: 30, owner: { radiusKm: 5, budgetEur: 30 } });
    expect(row).toMatchObject({ post_ref: `ig-${s.photo.id}`, media_id: s.photo.id }); // the same post, not the newer one
    expect((await s.store.getChangeSet(first.change_set_id as string)).status).toBe("cancelled");
  });

  it("a plan the owner rejected with ❌ carries nothing into the next ad", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, radius_km: 5, gender: "women" });
    await handleDecision({ store: s.store, messenger: new FakeMessenger(), now: () => T0 }, "tg:1001", "cancel", first.change_set_id as string);
    expect((await s.store.getChangeSet(first.change_set_id as string)).status).toBe("cancelled");
    const newer = await postedBefore(s, "Нов пост", new Date(T0.getTime() - 3_600_000));
    const r = await call(makeTools({ ...s.deps, turnSets: new Set() }), "propose_boost", { budget_eur: 30 });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(rowOf(cs).plan).toMatchObject({ radiusKm: 3, gender: "all", owner: { budgetEur: 30 } });
    expect(rowOf(cs).post_ref).toBe(newer.post_ref); // chosen fresh: the owner's latest post
    expect(cs.preview_bg.replace("Бюджет: 30 € ✎", "")).not.toContain("✎");
  });

  it("a saved plan carries nothing", async () => {
    const s = await setup();
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, radius_km: 5 });
    await handleDecision({ store: s.store, messenger: new FakeMessenger(), now: () => T0 }, "tg:1001", "apply", first.change_set_id as string);
    const r = await call(makeTools({ ...s.deps, turnSets: new Set() }), "propose_boost", { media_id: s.photo.id, budget_eur: 30 });
    expect(rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan.owner).toEqual({ budgetEur: 30 });
  });

  it("the owner sees where the place is on the map, fresh and carried", async () => {
    const geo = fakeNominatim();
    const s = await setup({}, { fetch: geo.f });
    const first = await call(s.tools, "propose_boost", { media_id: s.photo.id, place: "НДК" });
    const cs = await s.store.getChangeSet(first.change_set_id as string);
    expect(rowOf(cs).place_display).toBe("НДК, бул. България, София, България");
    expect(cs.preview_bg).toContain("• на картата: ⟦НДК, бул. България, София, България⟧");
    expect(cs.preview_en).toContain("• on the map: ⟦НДК, бул. България, София, България⟧");
    const asked = geo.asked.length;
    const second = await call(correcting(s, first), "propose_boost", { budget_eur: 30 });
    const again = await s.store.getChangeSet(second.change_set_id as string);
    expect(geo.asked).toHaveLength(asked);
    expect(rowOf(again).place_display).toBe("НДК, бул. България, София, България");
    expect(again.preview_bg).toContain("• на картата: ⟦НДК, бул. България, София, България⟧");
  });

  it("an input variant \"default\" is not stored as an owner choice", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, variant: "default", budget_eur: 25 });
    expect(rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan.owner).toEqual({ budgetEur: 25 });
  });

  it("an owner gender \"all\" shows as everyone ✎", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, gender: "all" });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg).toContain("Кой: 18+ · предложение към Meta: всички ✎");
    expect(cs.preview_en).toContain("Who: 18+ · suggested to Meta: everyone ✎");
  });
});
