// test/agent-boost-tool.test.ts — propose_boost (src/agent/boost-tools.ts): which post, the ad plan Claudia proposes and its
// preview, and what ✅ does in phase 1 (saves the plan: no external call, no change used, undo works).
import { describe, expect, it } from "vitest";
import { instagramAccess } from "@/src/agent/boost-tools";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { GraphClient, IG_GRAPH } from "@/src/destinations/meta-graph";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import type { BoostPlanRow, Change, SocialPostRow } from "@/src/domain/types";
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
  /** "ok": cached places; "osm": OpenStreetMap failed a moment ago (the pin is known); "geocode": the address is not on the map. */
  area?: "ok" | "osm" | "geocode";
  /** Faked Instagram replies; absent = Instagram is not connected. */
  graph?: [string, Reply][];
  member?: "tg:1001" | "tg:1002";
}

async function setup(o: Opts = {}, over: Partial<AgentDeps> = {}) {
  const demo = await makeDemo();
  const area = o.area ?? "ok";
  const address = demo.venue.address.trim();
  if (area === "ok") await demo.store.putSurroundings({ venue_id: demo.venue.id, address, lat: 42.69, lng: 23.33, places: PLACES, fetched_at: T0.toISOString(), failed_at: null });
  if (area === "osm") await demo.store.putSurroundings({ venue_id: demo.venue.id, address, lat: 42.69, lng: 23.33, places: [], fetched_at: null, failed_at: T0.toISOString() });
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
  return { ...demo, plain: demo.store, store, messenger, deps, photo, outbound, graph, tools: makeTools(deps) };
}

/** An applied social_post set of this chat (or another), as the owner's ✅ left it. */
async function postedBefore(s: Awaited<ReturnType<typeof setup>>, caption: string, at: Date, chatRef = "tg:1001") {
  const m = await s.store.saveMedia(s.venue.id, new Uint8Array([4, 5, 6]), "image/jpeg");
  const row: SocialPostRow = { media_id: m.id, image_url: `https://media.example/${m.id}.jpg`, caption, targets: ["instagram_post"] };
  const change: Change = { position: 0, op: "social_post", entity: "social_post", entity_id: m.id, before: null, after: row as unknown as Change["after"] };
  const cs = await s.store.createChangeSet({ venue_id: s.venue.id, chat_ref: chatRef, summary_bg: "Пост", summary_en: "Post", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [change] });
  // The plain store: this test is about the boost, not about publishing the post (and fetchSpy must stay untouched).
  await s.plain.applyChangeSet(cs.id, at.toISOString());
  return { cs, row, media: m };
}

const lastSet = async (s: Awaited<ReturnType<typeof setup>>) => (await s.store.listChangeSets(s.venue.id, { limit: 1 }))[0];
const rowOf = (cs: { changes: Change[] }) => cs.changes[0].after as unknown as BoostPlanRow;

describe("propose_boost: a given photo, with the defaults", () => {
  it("sends the picture first, then one boost_plan proposal: 2 km, 18+, 20 € over 5 days, all day, automatic placements", async () => {
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
    expect(row.plan).toMatchObject({ variant: "default", radiusKm: 2, ageMin: 18, schedule: null, budgetEur: 20, days: 5, placements: "automatic", goal: "profile_visits" });
    expect(row).toMatchObject({ media_id: s.photo.id, post_ref: null, permalink: null, image_url: s.photo.public_url, lat: 42.69, lng: 23.33 });
    expect(s.outbound).toEqual([]); // the area came from the cache; nothing else was asked
  });

  it("goal is reach when the café has a Facebook Page", async () => {
    const s = await setup({}, { social: { facebook: true, instagram: false } });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan.goal).toBe("reach");
  });

  it("passes the owner's budget, days and variant to the plan", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id, budget_eur: 30, days: 3, variant: "weekend" });
    expect(rowOf(await s.store.getChangeSet(r.change_set_id as string)).plan).toMatchObject({ budgetEur: 30, days: 3, variant: "weekend", radiusKm: 3 });
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
    expect(row).toMatchObject({ media_id: recent.media.id, caption: "Тиквена супа днес 🎃", image_url: recent.row.image_url });
    expect(s.messenger.photos[0]).toMatchObject({ url: recent.row.image_url, caption: "Пост за реклама" });
  });

  it("then the best recent Instagram post (bestPost), with its permalink and picture", async () => {
    const s = await setup({ graph: [...MEDIA] });
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
    expect(await s.store.listChangeSets(s.venue.id, {})).toEqual([]);
  });

  it("with no post at all, asks which post", async () => {
    const s = await setup();
    const r = await call(s.tools, "propose_boost", {});
    expect(r.error).toBe("Which post should I boost? Send it or name it.");
    expect(s.messenger.photos).toEqual([]);
    expect(s.messenger.sent).toEqual([]);
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
    expect(rowOf(cs).plan).toMatchObject({ radiusKm: 2, budgetEur: 20, days: 5 });
    expect(cs.preview_bg).not.toContain("местоположението");
  });

  it("when the address is not on the map, the proposal also says the location needs checking", async () => {
    const s = await setup({ area: "geocode" });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_bg).toContain("— не успях да проверя района");
    expect(cs.preview_bg).toContain("— местоположението на кафенето трябва да се провери: адресът не беше намерен на картата");
    expect(cs.preview_en).toContain("— the café's location needs checking: its address wasn't found on the map");
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
    expect(await s.store.listChangeSets(s.venue.id, {})).toEqual([]);
  });

  it("staff are refused", async () => {
    const s = await setup({ member: "tg:1002" });
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    expect(String(r.error)).toMatch(/only the owner's decision/);
    expect(s.messenger.photos).toEqual([]);
    expect(await s.store.listChangeSets(s.venue.id, {})).toEqual([]);
  });

  it("an earlier pending proposal blocks it, as for any proposal", async () => {
    const s = await setup();
    await call(s.tools, "propose_changes", { summary_bg: "Цена", summary_en: "Price", changes: [{ op: "set_price", item_id: Object.values(s.items)[0].id, price_eur: 3.3 }] });
    const again = makeTools({ ...s.deps, turnSets: new Set() });
    const r = await call(again, "propose_boost", { media_id: s.photo.id });
    expect(String(r.error)).toMatch(/already waiting for a decision/);
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
      "Къде: до 2 км от кафенето · Кой: 18+ · Кога: 5 дни, по цял ден",
      "Бюджет: 20 € общо · Обхват: ще го видите, щом рекламите са свързани",
      "Защо:",
      "• в радиус 1 км: Софийски университет (400 м), 2 парка",
      "• по-широката аудитория обикновено е по-евтина; Meta сама намира кой да види рекламата в радиуса",
      "— демографията на последователите ще се вижда при 100+ последователи и свързан Instagram",
      "(Сега само записвам плана — ще може да се пусне, щом Meta одобри рекламите в Claudia.)",
    ].join("\n"));
    expect(s.messenger.sent.at(-1)!.text).toBe(`${cs.preview_bg.replace(/[⟦⟧]/g, "")}\n\nДа приложа ли?`);
  });

  it("is exact in English", async () => {
    const s = await setup();
    await postedBefore(s, CAPTION, new Date(T0.getTime() - DAY));
    const r = await call(s.tools, "propose_boost", {});
    const cs = await s.store.getChangeSet(r.change_set_id as string);
    expect(cs.preview_en).toBe([
      "📣 Ad: ⟦Тиквена супа с джинджифил и печени семки, само тази седмица…⟧",
      "Where: within 2 km of the café · Who: 18+ · When: 5 days, all day",
      "Budget: 20 € total · Reach: you'll see it once ads are connected",
      "Why:",
      "• within 1 km: Софийски университет (400 m), 2 parks",
      "• a broader audience is usually cheaper; Meta itself finds who sees the ad within the radius",
      "— follower demographics will show with 100+ followers and a connected Instagram",
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
  });
});

describe("propose_boost: ✅ only saves the plan", () => {
  it("apply makes no external call and uses no change of the month; undo removes it", async () => {
    const s = await setup();
    await s.store.setChangeLimit(s.venue.id, 1);
    const r = await call(s.tools, "propose_boost", { media_id: s.photo.id });
    const before = await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0);
    const decided = await handleDecision({ store: s.store, messenger: new FakeMessenger(), now: () => T0 }, "tg:1001", "apply", r.change_set_id as string);
    expect(decided.toast).toBe("✅ Приложено");
    expect((await s.store.getChangeSet(r.change_set_id as string)).status).toBe("applied");
    expect(s.outbound).toEqual([]);
    expect(await s.store.listSyncs({ venueId: s.venue.id })).toEqual([]);
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
    expect(await s.store.applyChangeSet(second.change_set_id as string, T0.toISOString())).toBe("applied");

    // Undo the first plan: the inverse removes it.
    const undoTools = makeTools({ ...s.deps, turnSets: new Set() });
    const u = await call(undoTools, "undo", { change_set_id: r.change_set_id });
    expect(String(u.preview)).toBe("• Премахва плана за реклама: (пост без текст)");
    expect(await s.store.applyChangeSet(u.change_set_id as string, T0.toISOString())).toBe("applied");
    expect((await s.store.getChangeSet(r.change_set_id as string)).status).toBe("reverted");
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
