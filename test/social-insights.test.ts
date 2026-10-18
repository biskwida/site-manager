// test/social-insights.test.ts — Instagram follower demographics and recent post performance through a faked Graph host.
import { describe, expect, it } from "vitest";
import { GraphClient, IG_GRAPH } from "@/src/destinations/meta-graph";
import { bestPost, followerProfile, recentPostStats, type PostStat } from "@/src/social/insights-graph";

type Reply = { status?: number; body: unknown } | "hang";
/** Routes by "path?query" substring: the first rule whose key the request URL contains answers; anything else is a 404-style error. */
function fakeGraph(rules: [string, Reply | (() => Reply)][]) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [key, r] of rules) {
      if (!url.includes(key)) continue;
      const reply = typeof r === "function" ? r() : r;
      if (reply === "hang") return new Promise<Response>(() => undefined);
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: { message: "nope", code: 100 } }), { status: 400 });
  }) as typeof fetch;
  return { client: new GraphClient(IG_GRAPH, "TOKEN", f), calls };
}

const breakdown = (key: string, rows: [string[], number][]) => ({
  data: [{ name: "follower_demographics", period: "lifetime", total_value: { breakdowns: [{ dimension_keys: [key], results: rows.map(([dimension_values, value]) => ({ dimension_values, value })) }] } }],
});
const AGE = breakdown("age", [[["18-24"], 20], [["25-34"], 50], [["35-44"], 30]]);
const GENDER = breakdown("gender", [[["F"], 62], [["M"], 36], [["U"], 2]]);
const CITY = breakdown("city", [[["Sofia, Sofia-Capital"], 70], [["Plovdiv, Plovdiv"], 15], [["Varna, Varna"], 10], [["Burgas, Burgas"], 5]]);
const demographics = (over: [string, Reply][] = []): [string, Reply | (() => Reply)][] => [
  ...over,
  ["breakdown=age", { body: AGE }],
  ["breakdown=gender", { body: GENDER }],
  ["breakdown=city", { body: CITY }],
  ["fields=followers_count", { body: { followers_count: 240, id: "17841" } }],
];

describe("followerProfile", () => {
  it("asks the three breakdowns with the lifetime total_value metric and parses age, gender and the top 3 cities as shares", async () => {
    const { client, calls } = fakeGraph(demographics());
    const p = await followerProfile(client, "17841");
    for (const b of ["age", "gender", "city"]) {
      const u = calls.map((c) => new URL(c)).find((c) => c.searchParams.get("breakdown") === b)!;
      expect(u.pathname).toBe("/v25.0/17841/insights");
      expect(u.searchParams.get("metric")).toBe("follower_demographics");
      expect(u.searchParams.get("period")).toBe("lifetime");
      expect(u.searchParams.get("metric_type")).toBe("total_value");
    }
    expect(p).not.toBeNull();
    expect(p!.followers).toBe(240);
    expect(p!.age).toEqual({ "18-24": 0.2, "25-34": 0.5, "35-44": 0.3 });
    expect(p!.gender).toEqual({ F: 0.62, M: 0.36, U: 0.02 });
    expect(p!.cities).toEqual([
      { name: "Sofia, Sofia-Capital", share: 0.7 },
      { name: "Plovdiv, Plovdiv", share: 0.15 },
      { name: "Varna, Varna", share: 0.1 },
    ]);
  });
  it("never puts the token in a URL", async () => {
    const { client, calls } = fakeGraph(demographics());
    await followerProfile(client, "17841");
    expect(calls.every((c) => !c.includes("TOKEN"))).toBe(true);
  });
  it("is null on a Meta error (under 100 followers answers with one)", async () => {
    const { client } = fakeGraph(demographics([["breakdown=age", { status: 400, body: { error: { message: "not enough followers", code: 100 } } }]]));
    expect(await followerProfile(client, "17841")).toBeNull();
  });
  it("is null on a missing permission", async () => {
    const { client } = fakeGraph([["insights", { status: 400, body: { error: { message: "(#10) Application does not have permission", code: 10 } } }]]);
    expect(await followerProfile(client, "17841")).toBeNull();
  });
  it("is null on an expired token", async () => {
    const { client } = fakeGraph([["", { status: 401, body: { error: { message: "Invalid OAuth access token.", code: 190 } } }]]);
    expect(await followerProfile(client, "17841")).toBeNull();
  });
  it("is null on empty data and on garbage", async () => {
    const empty = { data: [] };
    expect(await followerProfile(fakeGraph([["breakdown=", { body: empty }], ["fields=followers_count", { body: { followers_count: 500 } }]]).client, "1")).toBeNull();
    expect(await followerProfile(fakeGraph([["", { body: { data: "x" } }]]).client, "1")).toBeNull();
  });
  it("is null under 100 followers even when the API answers", async () => {
    const { client } = fakeGraph(demographics([["fields=followers_count", { body: { followers_count: 80 } }]]));
    expect(await followerProfile(client, "17841")).toBeNull();
  });
  it("never infers the follower count: null when followers_count cannot be read or is missing", async () => {
    const { client } = fakeGraph([["breakdown=age", { body: AGE }], ["breakdown=gender", { body: GENDER }], ["breakdown=city", { body: CITY }]]);
    expect(await followerProfile(client, "17841")).toBeNull();
    const noCount = fakeGraph(demographics([["fields=followers_count", { body: { id: "17841" } }]]));
    expect(await followerProfile(noCount.client, "17841")).toBeNull();
  });
  it("is null when the 8 s overall cap (here shortened) is hit, and asks nothing more", async () => {
    const { client, calls } = fakeGraph([["breakdown=", "hang"], ["fields=followers_count", { body: { followers_count: 500 } }]]);
    const t0 = Date.now();
    expect(await followerProfile(client, "17841", undefined, { totalMs: 40 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.some((c) => c.includes("followers_count"))).toBe(false);
  });
  it("has an 8 s default overall cap", async () => {
    const { PROFILE_TIMEOUT_MS } = await import("@/src/social/insights-graph");
    expect(PROFILE_TIMEOUT_MS).toBe(8000);
  });
  it("never throws, even when the network does", async () => {
    const client = new GraphClient(IG_GRAPH, "t", (async () => { throw new Error("boom"); }) as typeof fetch);
    expect(await followerProfile(client, "1")).toBeNull();
  });
});

const NOW = new Date("2026-10-18T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString().replace("Z", "+0000");
const MEDIA = {
  data: [
    { id: "m1", caption: "Брънч", media_type: "IMAGE", media_product_type: "FEED", timestamp: ago(3), permalink: "https://instagram.com/p/1" },
    { id: "m2", caption: "Рийл", media_type: "VIDEO", media_product_type: "REELS", timestamp: ago(5), permalink: "https://instagram.com/reel/2" },
    { id: "m3", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", timestamp: ago(40), permalink: "https://instagram.com/p/3" },
    { id: "s1", media_type: "IMAGE", media_product_type: "STORY", timestamp: ago(1), permalink: "https://instagram.com/s/1" },
    { id: "m4", caption: "Карусел", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", timestamp: ago(10), permalink: "https://instagram.com/p/4" },
  ],
};
const insights = (m: Record<string, number>) => ({ data: Object.entries(m).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }], title: name })) });
const SINCE = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();

describe("recentPostStats", () => {
  it("lists the last 30 days (no stories, at most 25) and reads reach, saved, shares and views for each post", async () => {
    const { client, calls } = fakeGraph([
      ["/m1/insights", { body: insights({ reach: 400, saved: 20, shares: 8, views: 900 }) }],
      ["/m2/insights", { body: insights({ reach: 1000, saved: 10, shares: 30, views: 3000 }) }],
      ["/m4/insights", { body: insights({ reach: 200, saved: 1, shares: 0, views: 250 }) }],
      ["/media?", { body: MEDIA }],
    ]);
    const out = await recentPostStats(client, "17841", SINCE);
    const list = new URL(calls.find((c) => c.includes("/media?"))!);
    expect(list.pathname).toBe("/v25.0/17841/media");
    expect(list.searchParams.get("fields")).toBe("id,caption,media_type,media_product_type,timestamp,permalink,media_url,thumbnail_url");
    expect(list.searchParams.get("limit")).toBe("25");
    const ins = new URL(calls.find((c) => c.includes("/m1/insights"))!);
    expect(ins.searchParams.get("metric")).toBe("reach,saved,shares,views");
    expect(out.map((p) => p.id)).toEqual(["m1", "m2", "m4"]);
    expect(out[0]).toEqual({ id: "m1", caption: "Брънч", type: "image", at: new Date(Date.parse(ago(3).replace("+0000", "Z"))).toISOString(), permalink: "https://instagram.com/p/1", reach: 400, saved: 20, shares: 8, views: 900 });
    expect(out[1].type).toBe("video");
    expect(out[2].type).toBe("carousel");
  });
  it("keeps the post's https picture: media_url, or a video's thumbnail_url", async () => {
    const data = [
      { ...MEDIA.data[0], media_url: "https://cdn.example/1.jpg" },
      { ...MEDIA.data[1], media_url: "https://cdn.example/2.mp4", thumbnail_url: "https://cdn.example/2.jpg" },
      { ...MEDIA.data[4], media_url: "http://cdn.example/4.jpg" },
    ];
    const { client } = fakeGraph([["/media?", { body: { data } }]]);
    const out = await recentPostStats(client, "17841", SINCE);
    expect(out.map((p) => p.image_url)).toEqual(["https://cdn.example/1.jpg", "https://cdn.example/2.jpg", undefined]);
  });
  it("leaves a metric the API refuses undefined and keeps the rest", async () => {
    const { client, calls } = fakeGraph([
      ["metric=reach,saved,shares,views", { status: 400, body: { error: { message: "metric[3] must be one of the allowed values", code: 100 } } }],
      ["metric=reach", { body: insights({ reach: 300 }) }],
      ["metric=saved", { body: insights({ saved: 12 }) }],
      ["metric=shares", { body: insights({ shares: 4 }) }],
      ["metric=views", { status: 400, body: { error: { message: "unsupported", code: 100 } } }],
      ["/media?", { body: { data: [MEDIA.data[0]] } }],
    ]);
    const out = await recentPostStats(client, "17841", SINCE);
    expect(out).toHaveLength(1);
    expect(out[0].reach).toBe(300);
    expect(out[0].saved).toBe(12);
    expect(out[0].shares).toBe(4);
    expect(out[0].views).toBeUndefined();
    expect(calls.some((c) => c.includes("metric=views"))).toBe(true);
  });
  it("keeps a post whose insights are all refused, with no numbers", async () => {
    const { client } = fakeGraph([["/media?", { body: { data: [MEDIA.data[0]] } }]]);
    const out = await recentPostStats(client, "17841", SINCE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "m1", type: "image" });
    expect(out[0].reach).toBeUndefined();
  });
  it("stops asking after a missing permission or token and returns the posts without numbers", async () => {
    const { client, calls } = fakeGraph([
      ["/insights", { status: 400, body: { error: { message: "(#10) no permission", code: 10 } } }],
      ["/media?", { body: MEDIA }],
    ]);
    const out = await recentPostStats(client, "17841", SINCE);
    expect(out.map((p) => p.reach)).toEqual([undefined, undefined, undefined]);
    expect(calls.filter((c) => c.includes("/insights")).length).toBeLessThanOrEqual(3);
  });
  it("is [] when the media list fails or is empty, and never throws", async () => {
    expect(await recentPostStats(fakeGraph([["/media?", { status: 400, body: { error: { code: 10, message: "x" } } }]]).client, "1", SINCE)).toEqual([]);
    expect(await recentPostStats(fakeGraph([["/media?", { body: { data: [] } }]]).client, "1", SINCE)).toEqual([]);
    expect(await recentPostStats(new GraphClient(IG_GRAPH, "t", (async () => { throw new Error("x"); }) as typeof fetch), "1", SINCE)).toEqual([]);
  });
  it("gives one hanging post 4 s at most (here shortened) and still returns the others", async () => {
    const { client } = fakeGraph([
      ["/m1/insights", "hang"],
      ["/m2/insights", { body: insights({ reach: 100, saved: 5, shares: 5, views: 10 }) }],
      ["/media?", { body: { data: [MEDIA.data[0], MEDIA.data[1]] } }],
    ]);
    const out = await recentPostStats(client, "17841", SINCE, { perPostMs: 40, totalMs: 1000 });
    expect(out.map((p) => [p.id, p.reach])).toEqual([["m1", undefined], ["m2", 100]]);
  });
  it("returns what it has when the whole call passes its cap", async () => {
    const { client } = fakeGraph([
      ["/insights", "hang"],
      ["/media?", { body: MEDIA }],
    ]);
    const t0 = Date.now();
    const out = await recentPostStats(client, "17841", SINCE, { perPostMs: 5000, totalMs: 60 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(out).toHaveLength(3);
  });
  it("starts no request once the total cap has fired: the lanes take no more posts", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, caption: "", media_type: "IMAGE", media_product_type: "FEED", timestamp: ago(2), permalink: `https://instagram.com/p/${i}` }));
    const { client, calls } = fakeGraph([["/insights", "hang"], ["/media?", { body: { data: many } }]]);
    const insightCalls = () => calls.filter((c) => c.includes("/insights")).length;
    // 5 lanes; a hung post frees its lane after 25 ms, so a second wave of 5 starts before the cap (40 ms) and the last 2 posts
    // would be asked at ~50 ms if nothing stopped the lanes.
    const out = await recentPostStats(client, "17841", SINCE, { perPostMs: 25, totalMs: 40 });
    expect(out).toHaveLength(12);
    const atCap = insightCalls();
    expect(atCap).toBeLessThan(12);
    await new Promise((r) => setTimeout(r, 150));
    expect(insightCalls()).toBe(atCap);
  });
  it("starts no per-metric retry once that post's cap has fired", async () => {
    const calls: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/media?")) return new Response(JSON.stringify({ data: [MEDIA.data[0]] }), { status: 200 });
      await new Promise((r) => setTimeout(r, 60)); // slower than the 20 ms post cap, then refuses with code 100
      return new Response(JSON.stringify({ error: { message: "unsupported", code: 100 } }), { status: 400 });
    }) as typeof fetch;
    const out = await recentPostStats(new GraphClient(IG_GRAPH, "t", f), "17841", SINCE, { perPostMs: 20, totalMs: 1000 });
    expect(out[0].reach).toBeUndefined();
    await new Promise((r) => setTimeout(r, 150));
    expect(calls.filter((c) => c.includes("/insights"))).toHaveLength(1); // the combined request only, no retry per metric
  });
  it("reads the total_value.value shape and ignores metric names it did not ask for", async () => {
    const { client } = fakeGraph([
      ["/m1/insights", { body: { data: [{ name: "reach", total_value: { value: 77 } }, { name: "impressions", values: [{ value: 999 }] }, { name: "saved", values: [{ value: 6 }] }, { name: "profile_visits", total_value: { value: 5 } }, { name: "shares", values: [{ value: "x" }] }] } }],
      ["/media?", { body: { data: [MEDIA.data[0]] } }],
    ]);
    const [p] = await recentPostStats(client, "17841", SINCE);
    expect(p.reach).toBe(77);
    expect(p.saved).toBe(6);
    expect(p.shares).toBeUndefined();
    expect(p).not.toHaveProperty("impressions");
    expect(p).not.toHaveProperty("profile_visits");
  });
  it("logs only error codes, never messages, tokens, ids or data", async () => {
    const logs: string[] = [];
    const { client } = fakeGraph([
      ["breakdown=age", { status: 400, body: { error: { message: "SECRET-MESSAGE for 17841", code: 100 } } }],
      ["/m1/insights", { status: 400, body: { error: { message: "SECRET-MESSAGE", code: 100 } } }],
      ["/media?", { body: { data: [MEDIA.data[0]] } }],
    ]);
    await followerProfile(client, "17841", (l) => logs.push(l));
    await recentPostStats(client, "17841", SINCE, {}, (l) => logs.push(l));
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).toMatch(/^insights [a-z_ ]+: [a-z_0-9]+$/);
    expect(logs.join("\n")).not.toMatch(/SECRET|TOKEN|17841|m1/);
  });
  it("exposes the default caps of 4 s per post and 12 s overall", async () => {
    const { POST_TIMEOUT_MS, TOTAL_TIMEOUT_MS } = await import("@/src/social/insights-graph");
    expect([POST_TIMEOUT_MS, TOTAL_TIMEOUT_MS]).toEqual([4000, 12000]);
  });
});

const stat = (id: string, days: number, o: Partial<PostStat> = {}): PostStat => ({ id, caption: id, type: "image", at: new Date(NOW.getTime() - days * 86_400_000).toISOString(), permalink: `https://instagram.com/p/${id}`, ...o });

describe("bestPost", () => {
  it("picks the highest (saved + shares) / reach among posts 1 to 14 days old with reach of at least 50", () => {
    const stats = [
      stat("a", 3, { reach: 400, saved: 20, shares: 8 }), // 0.07
      stat("b", 5, { reach: 100, saved: 10, shares: 5 }), // 0.15
      stat("c", 7, { reach: 1000, saved: 30, shares: 30 }), // 0.06
    ];
    expect(bestPost(stats, NOW)?.id).toBe("b");
  });
  it("ignores posts under 1 day old, over 14 days old and under 50 reach", () => {
    const stats = [
      stat("fresh", 0.5, { reach: 1000, saved: 500, shares: 400 }),
      stat("old", 15, { reach: 1000, saved: 500, shares: 400 }),
      stat("tiny", 3, { reach: 49, saved: 40, shares: 5 }),
      stat("ok", 2, { reach: 50, saved: 1, shares: 0 }),
    ];
    expect(bestPost(stats, NOW)?.id).toBe("ok");
  });
  it("counts the boundaries: exactly 1 and exactly 14 days old are in", () => {
    expect(bestPost([stat("one", 1, { reach: 100, saved: 5, shares: 0 })], NOW)?.id).toBe("one");
    expect(bestPost([stat("fourteen", 14, { reach: 100, saved: 5, shares: 0 })], NOW)?.id).toBe("fourteen");
  });
  it("is null without data: empty list, no reach, or saved or shares unknown", () => {
    expect(bestPost([], NOW)).toBeNull();
    expect(bestPost([stat("a", 3), stat("b", 4, { saved: 3 })], NOW)).toBeNull();
    expect(bestPost([stat("c", 3, { reach: 200 })], NOW)).toBeNull();
  });
  it("never reads an unknown metric as 0: a post missing saved or shares is not scored, even if it would win", () => {
    const stats = [stat("unknown-shares", 3, { reach: 100, saved: 90 }), stat("unknown-saved", 3, { reach: 100, shares: 90 }), stat("known", 4, { reach: 1000, saved: 1, shares: 1 })];
    expect(bestPost(stats, NOW)?.id).toBe("known");
    expect(bestPost(stats.slice(0, 2), NOW)).toBeNull();
  });
  it("needs a score above 0: a post nobody saved or shared is not worth boosting", () => {
    expect(bestPost([stat("flat", 3, { reach: 500, saved: 0, shares: 0 })], NOW)).toBeNull();
  });
  it("breaks a tie by the newer post and ignores an unreadable date", () => {
    const stats = [stat("older", 6, { reach: 100, saved: 10, shares: 0 }), stat("newer", 2, { reach: 100, saved: 10, shares: 0 }), { ...stat("bad", 3, { reach: 100, saved: 99, shares: 0 }), at: "nonsense" }];
    expect(bestPost(stats, NOW)?.id).toBe("newer");
  });
});
