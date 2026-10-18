// test/boost-plan.test.ts — the boost recommendation: defaults, variants, limits, and reasons that are only ever fact, hypothesis or missing.
import { describe, expect, it } from "vitest";
import { planBoost, type BoostInput, type BoostPlan } from "@/src/boost/plan";
import type { BoostOwnerChoices } from "@/src/domain/types";
import type { Surroundings } from "@/src/geo/surroundings";
import type { FollowerProfile } from "@/src/social/insights-graph";
import { HOURS, TZ } from "./fixtures";

const SURROUNDINGS: Surroundings = {
  status: "ok",
  lat: 42.69,
  lng: 23.33,
  places: [
    { kind: "university", name: "Софийски университет", meters: 400 },
    { kind: "government", name: "Министерски съвет", meters: 300 },
    { kind: "government", name: null, meters: 450 },
    { kind: "government", name: "Общината", meters: 900 },
    { kind: "park", name: "Борисова градина", meters: 950 },
    { kind: "park", name: "Градинка", meters: 80 },
  ],
};
/** n places in the park kind within 1 km: the density the radius is chosen from. */
const AREA = (n: number): Surroundings => ({ status: "ok", places: Array.from({ length: n }, (_, i) => ({ kind: "park" as const, name: null, meters: 100 + i })) });
const OPEN_7: typeof HOURS = { ...HOURS, sat: { open: "09:00", close: "16:00" }, sun: { open: "10:00", close: "16:00" } };
const MISSING: Surroundings = { status: "missing", reason: "osm_unavailable", places: [] };
const FOLLOWERS: FollowerProfile = {
  followers: 540,
  age: { "18-24": 0.2, "25-34": 0.5, "35-44": 0.3 },
  gender: { F: 0.62, M: 0.38 },
  cities: [{ name: "Sofia, Sofia-Capital", share: 0.71 }, { name: "Plovdiv, Plovdiv", share: 0.1 }],
};

const input = (over: Partial<BoostInput> = {}): BoostInput => ({
  venue: { name: "Кафе Тест", hours: HOURS, tz: TZ },
  surroundings: SURROUNDINGS,
  followers: FOLLOWERS,
  post: null,
  ownerWords: "",
  owner: {},
  hasFacebookPage: true,
  ...over,
});
/** An input with these owner choices. */
const owned = (owner: BoostOwnerChoices, over: Partial<BoostInput> = {}): BoostInput => input({ owner, ...over });
const plan = (over: Partial<BoostInput> = {}): BoostPlan => {
  const r = planBoost(input(over));
  if ("error" in r) throw new Error(`unexpected ${r.error}`);
  return r;
};
const allText = (p: BoostPlan) => p.reasons.map((r) => `${r.bg}\n${r.en}`).join("\n");

describe("planBoost defaults", () => {
  it("3 km for a mixed area, ages 25–44 from the followers, 20 EUR over 5 days, automatic placements, reach, open days", () => {
    const p = plan();
    expect(p).toMatchObject({ variant: "default", radiusKm: 3, ageMin: 25, ageMax: 44, gender: "all", budgetEur: 20, days: 5, placements: "automatic", goal: "reach", owner: {}, place: null, audience: null });
    // The test café is closed on Sunday: ads on the open days only.
    expect(p.schedule).toEqual({ days: ["mon", "tue", "wed", "thu", "fri", "sat"], from: "00:00", to: "23:59" });
  });
  it("the goal is profile_visits without a Facebook Page", () => {
    expect(plan({ hasFacebookPage: false }).goal).toBe("profile_visits");
  });
});

describe("variants", () => {
  it("morning by keyword: 2.5 km, Monday to Friday, clipped to the opening hours", () => {
    const p = plan({ ownerWords: "оферта за закуска до 11" });
    expect(p.variant).toBe("morning");
    expect(p.radiusKm).toBe(2.5);
    // HOURS opens 08:00 Mon-Fri, so 07:30 is clipped to 08:00; 11:00 is inside the hours.
    expect(p.schedule).toEqual({ days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "11:00" });
  });
  it("morning is also found in the caption and in English", () => {
    expect(plan({ post: { id: "1", caption: "Fresh breakfast deal", type: "image" } }).variant).toBe("morning");
  });
  it("morning keeps 07:30 when the café opens earlier", () => {
    const early = { ...HOURS, mon: { open: "07:00", close: "18:00" }, tue: { open: "07:00", close: "18:00" }, wed: { open: "07:00", close: "18:00" }, thu: { open: "07:00", close: "18:00" }, fri: { open: "07:00", close: "18:00" } };
    expect(plan({ venue: { name: "К", hours: early, tz: TZ }, ownerWords: "сутрин" }).schedule).toEqual({ days: ["mon", "tue", "wed", "thu", "fri"], from: "07:30", to: "11:00" });
  });
  it("morning drops the days the café is closed", () => {
    const hours = { ...HOURS, wed: null };
    expect(plan({ venue: { name: "К", hours, tz: TZ }, ownerWords: "сутрин" }).schedule?.days).toEqual(["mon", "tue", "thu", "fri"]);
  });
  it("morning falls back to the default when the café is closed Monday to Friday", () => {
    const hours = { ...HOURS, mon: null, tue: null, wed: null, thu: null, fri: null };
    const p = plan({ venue: { name: "К", hours, tz: TZ }, ownerWords: "закуска" });
    expect(p).toMatchObject({ variant: "default", radiusKm: 3, schedule: { days: ["sat"], from: "00:00", to: "23:59" } });
    expect(allText(p)).not.toContain("делнични сутрини");
  });
  it("morning falls back when the café opens only after 11:00", () => {
    const late = { ...HOURS, mon: { open: "12:00", close: "20:00" }, tue: { open: "12:00", close: "20:00" }, wed: { open: "12:00", close: "20:00" }, thu: { open: "12:00", close: "20:00" }, fri: { open: "12:00", close: "20:00" } };
    expect(plan({ venue: { name: "К", hours: late, tz: TZ }, ownerWords: "сутрин" }).variant).toBe("default");
  });
  it("morning keeps a window every kept day shares when one day opens late", () => {
    const hours = { ...HOURS, tue: { open: "10:00", close: "18:00" } };
    const p = plan({ venue: { name: "К", hours, tz: TZ }, ownerWords: "сутрин" });
    expect(p.variant).toBe("morning");
    for (const d of p.schedule!.days) {
      expect(hours[d]!.open <= p.schedule!.from).toBe(true);
      expect(hours[d]!.close >= p.schedule!.to).toBe(true);
    }
  });
  it("weekend by keyword: 4.5 km, Friday to Sunday", () => {
    const p = plan({ ownerWords: "бранч в неделя с концерт" });
    expect(p.variant).toBe("weekend");
    expect(p.radiusKm).toBe(4.5);
    expect(p.schedule?.days).toEqual(["fri", "sat", "sun"]);
    expect(p.schedule).toMatchObject({ from: "00:00", to: "23:59" });
  });
  it("weekend in English", () => {
    expect(plan({ ownerWords: "live music this weekend" }).variant).toBe("weekend");
  });
  it("an explicit variant wins over keywords", () => {
    expect(plan({ owner: { variant: "weekend" }, ownerWords: "закуска" }).variant).toBe("weekend");
    expect(plan({ owner: { variant: "default" }, ownerWords: "закуска" }).variant).toBe("default");
  });
  it("there is no student variant: студенти leaves the default", () => {
    const p = plan({ ownerWords: "искам да стигна до студенти" });
    expect(p).toMatchObject({ variant: "default", radiusKm: 3 });
  });
  it("does not match keywords inside other words", () => {
    expect(plan({ ownerWords: "deliver and alive" }).variant).toBe("default");
  });
  it("\"event\" and \"live\" count only as whole words (\"events\" too), never inside eventually, liver or lively", () => {
    expect(plan({ ownerWords: "events this week" }).variant).toBe("weekend");
    expect(plan({ ownerWords: "an event on Friday" }).variant).toBe("weekend");
    expect(plan({ ownerWords: "live music" }).variant).toBe("weekend");
    for (const words of ["eventually we open earlier", "chicken liver pâté", "a lively place"]) expect(plan({ ownerWords: words }).variant).toBe("default");
    // Bulgarian stems still match as prefixes.
    expect(plan({ ownerWords: "в събота и неделята" }).variant).toBe("weekend");
    expect(plan({ ownerWords: "сутринта" }).variant).toBe("morning");
  });
  it("morning drops the day with the least room first, wherever it is in the week", () => {
    // Thursday opens at 10:00 (60 min to 11:00), Friday closes at 08:45 (45 min): Friday is the tightest, so it goes, not Monday.
    const hours = { ...HOURS, thu: { open: "10:00", close: "18:00" }, fri: { open: "08:00", close: "08:45" } };
    const p = plan({ venue: { name: "К", hours, tz: TZ }, ownerWords: "сутрин" });
    expect(p.schedule).toEqual({ days: ["mon", "tue", "wed", "thu"], from: "10:00", to: "11:00" });
  });
});

describe("owner limits", () => {
  it("refuses a budget under 5 or over 200 EUR", () => {
    expect(planBoost(owned({ budgetEur: 4 }))).toEqual({ error: "budget_range" });
    expect(planBoost(owned({ budgetEur: 201 }))).toEqual({ error: "budget_range" });
    expect(planBoost(owned({ budgetEur: Number.NaN }))).toEqual({ error: "budget_range" });
  });
  it("refuses 0 or more than 14 days", () => {
    expect(planBoost(owned({ days: 15 }))).toEqual({ error: "days_range" });
    expect(planBoost(owned({ days: 0 }))).toEqual({ error: "days_range" });
    expect(planBoost(owned({ days: 2.5 }))).toEqual({ error: "days_range" });
  });
  it("accepts the edges and 30 EUR over 3 days", () => {
    expect(plan({ owner: { budgetEur: 30, days: 3 } })).toMatchObject({ budgetEur: 30, days: 3 });
    expect(plan({ owner: { budgetEur: 5, days: 1 } })).toMatchObject({ budgetEur: 5, days: 1 });
    expect(plan({ owner: { budgetEur: 200, days: 14 } })).toMatchObject({ budgetEur: 200, days: 14 });
  });
});

describe("reasons", () => {
  it("come in order: surroundings, followers, hypothesis, with the right kinds", () => {
    const r = plan().reasons;
    // surroundings, followers, the broad-audience line, the area (6 places → 3 km), the age, the open days, the budget
    expect(r.map((x) => x.kind)).toEqual(["fact", "fact", "hypothesis", "hypothesis", "hypothesis", "hypothesis", "hypothesis"]);
    expect(r[0].bg).toBe("в радиус 1 км: ⟦Софийски университет⟧ (400 м), 3 държавни институции, 2 парка");
    expect(r[0].en).toBe("within 1 km: ⟦Софийски университет⟧ (400 m), 3 government buildings, 2 parks");
    // The place name is kept as written: the translation wrapper never translates it.
    expect(r[1].bg).toBe("62% от последователите са жени, най-много 25–34 г., 71% от София");
    expect(r[1].en).toBe("62% of followers are women, most are 25–34, 71% from Sofia");
    expect(r[2].bg).toContain("по-широката аудитория обикновено е по-евтина");
    expect(r[3]).toMatchObject({ bg: "смесен район — 3 км", en: "a mixed area — 3 km" });
    expect(r[4]).toMatchObject({ bg: "най-много от последователите са 25–44 → предлагам 25–44 на Meta" });
    expect(r[5]).toMatchObject({ bg: "в дните, в които сте отворени", en: "on the days you're open" });
    expect(r[6]).toMatchObject({ bg: "20 € за 5 дни е малък тест — достатъчен Meta да научи кой реагира", en: "20 € over 5 days is a small test — enough for Meta to learn who responds" });
  });
  it("names Meta's English city names in Bulgarian in the Bulgarian line; any other city as Meta gave it", () => {
    const city = (name: string) => plan({ followers: { followers: 300, age: {}, gender: {}, cities: [{ name, share: 0.5 }] } }).reasons[1];
    expect(city("Stara Zagora, Stara Zagora").bg).toBe("50% от Стара Загора");
    expect(city("Stara Zagora, Stara Zagora").en).toBe("50% from Stara Zagora");
    expect(city("Ruse, Ruse").bg).toBe("50% от Русе");
    expect(city("Gabrovo, Gabrovo").bg).toBe("50% от Gabrovo");
  });
  it("adds the variant hypothesis last, only when chosen", () => {
    const r = plan({ ownerWords: "закуска" }).reasons;
    expect(r[r.length - 1]).toMatchObject({ kind: "hypothesis", bg: "сутрешна оферта → делнични сутрини" });
    expect(plan().reasons.some((x) => x.bg.includes("делнични сутрини"))).toBe(false);
  });
  it("surroundings missing: says it could not check the area", () => {
    const r = plan({ surroundings: MISSING }).reasons[0];
    expect(r).toMatchObject({ kind: "missing", bg: "не успях да проверя района" });
    expect(r.en).toBe("I couldn't check the area");
  });
  it("followers null: the demographics are missing", () => {
    const r = plan({ followers: null }).reasons[1];
    expect(r).toMatchObject({ kind: "missing", bg: "демографията на последователите ще се вижда при 100+ последователи и свързан Instagram" });
  });
  it("stale surroundings are still a fact but say the data is old", () => {
    const r = plan({ surroundings: { ...SURROUNDINGS, stale: true } }).reasons[0];
    expect(r.kind).toBe("fact");
    expect(r.bg).toContain("(данни отпреди време)");
    expect(r.en).toContain("(older data)");
    expect(plan().reasons[0].bg).not.toContain("отпреди време");
  });
  it("uses a 2 km window when nothing is within 1 km", () => {
    const far: Surroundings = { status: "ok", places: [{ kind: "park", name: "Парк", meters: 1500 }, { kind: "park", name: null, meters: 1900 }] };
    expect(plan({ surroundings: far }).reasons[0].bg).toBe("в радиус 2 км: 2 парка");
  });
  it("a checked area with nothing in it is a fact that says nothing was found", () => {
    const r = plan({ surroundings: { status: "ok", places: [] } }).reasons[0];
    expect(r.kind).toBe("fact");
    expect(r.bg).toBe("в радиус 2 км OpenStreetMap не показва университети, институции, паркове или други обекти");
    expect(r.en).toBe("OpenStreetMap shows no universities, institutions, parks or other landmarks within 2 km");
    expect(r.bg).not.toMatch(/\d+ (парка|университета)/);
  });
  it("followers with no breakdown: states only the count, as missing demographics", () => {
    const r = plan({ followers: { followers: 120, age: {}, gender: {}, cities: [] } }).reasons[1];
    expect(r.kind).toBe("missing");
  });
  it("a post stat adds a fact with only the numbers Meta gave", () => {
    const post = { id: "p", caption: "x", type: "image" as const, stat: { id: "p", caption: "x", type: "image" as const, at: "2026-10-10T00:00:00Z", permalink: "u", reach: 400, saved: 12, shares: 3 } };
    const r = plan({ post }).reasons;
    const line = r.find((x) => x.kind === "fact" && x.bg.includes("запазвания"));
    expect(line?.bg).toBe("този пост има 12 запазвания и 3 споделяния при обхват 400");
    expect(r.indexOf(line!)).toBe(2);
  });
  it("a stat whose reach, saves and shares are all 0 adds no post line", () => {
    const post = { id: "p", caption: "x", type: "image" as const, stat: { id: "p", caption: "x", type: "image" as const, at: "2026-10-10T00:00:00Z", permalink: "u", reach: 0, saved: 0, shares: 0 } };
    expect(plan({ post }).reasons.some((r) => r.bg.startsWith("този пост"))).toBe(false);
  });
  it("a stat with only some metrics states only those", () => {
    const post = { id: "p", caption: "x", type: "image" as const, stat: { id: "p", caption: "x", type: "image" as const, at: "2026-10-10T00:00:00Z", permalink: "u", saved: 7 } };
    const line = plan({ post }).reasons[2];
    expect(line.bg).toBe("този пост има 7 запазвания");
    expect(line.bg).not.toContain("споделяния");
  });
  it("no reason line carries a reach, cost or price number unless a stat is given", () => {
    // Facts and missing lines never carry a reach or cost; the only money in a reason is the budget hypothesis (20 € over 5 days).
    for (const p of [plan(), plan({ followers: null, surroundings: MISSING }), plan({ ownerWords: "уикенд" }), plan({ ownerWords: "закуска" })]) {
      const measured = p.reasons.filter((r) => r.kind !== "hypothesis").map((r) => `${r.bg}\n${r.en}`).join("\n");
      expect(measured).not.toMatch(/обхват|reach|€|EUR|евро|CPM|CPC|цена|price|cost/i);
      expect(allText(p)).not.toMatch(/обхват|reach|EUR|евро|CPM|CPC|цена|price|cost/i);
    }
  });
  it("every reason has both languages", () => {
    for (const r of plan({ ownerWords: "закуска" }).reasons) {
      expect(r.bg.length).toBeGreaterThan(0);
      expect(r.en.length).toBeGreaterThan(0);
    }
  });
});

describe("analysis: the radius from the area", () => {
  const km = (surroundings: Surroundings, extra: Partial<BoostInput> = {}) => plan({ surroundings, ...extra }).radiusKm;
  it("10 or more places within 1 km → 2 km; 3–9 → 3 km; 0–2 → 5 km; surroundings missing → 3 km", () => {
    expect(km(AREA(10))).toBe(2);
    expect(km(AREA(9))).toBe(3);
    expect(km(AREA(3))).toBe(3);
    expect(km(AREA(2))).toBe(5);
    expect(km(AREA(0))).toBe(5);
    expect(km(MISSING)).toBe(3);
  });
  it("each has its hypothesis reason, except a missing area, which only has the missing line", () => {
    const reasons = (s: Surroundings) => plan({ surroundings: s }).reasons.filter((r) => r.kind === "hypothesis").map((r) => r.bg);
    expect(reasons(AREA(12))).toContain("гъст район — 2 км стигат");
    expect(reasons(AREA(5))).toContain("смесен район — 3 км");
    expect(reasons(AREA(1))).toContain("малко обекти наоколо — по-широк радиус, 5 км");
    expect(plan({ surroundings: AREA(1) }).reasons.find((r) => r.bg.startsWith("малко"))?.en).toBe("few places around — a wider radius, 5 km");
    expect(plan({ surroundings: MISSING }).reasons.some((r) => /км/.test(r.bg) && r.kind === "hypothesis" && /район/.test(r.bg))).toBe(false);
  });
  it("morning and weekend scale the base: busy area 1.5 / 3, sparse area 4 / 7.5", () => {
    expect(km(AREA(12), { ownerWords: "закуска" })).toBe(1.5);
    expect(km(AREA(12), { ownerWords: "уикенд" })).toBe(3);
    expect(km(AREA(0), { ownerWords: "закуска" })).toBe(4);
    expect(km(AREA(0), { ownerWords: "уикенд" })).toBe(7.5);
  });
});

describe("analysis: age and gender from the followers", () => {
  const followers = (age: Record<string, number>, gender: Record<string, number> = {}): FollowerProfile => ({ followers: 300, age, gender, cities: [] });
  it("the shortest run of bands holding 60% of followers: 25–44", () => {
    const p = plan({ followers: followers({ "18-24": 0.1, "25-34": 0.4, "35-44": 0.3, "45-54": 0.1, "55-64": 0.05, "65+": 0.05 }) });
    expect(p).toMatchObject({ ageMin: 25, ageMax: 44 });
    const line = p.reasons.find((r) => r.kind === "hypothesis" && r.bg.includes("последователите са 25–44"));
    expect(line?.bg).toBe("най-много от последователите са 25–44 → предлагам 25–44 на Meta");
    expect(line?.en).toBe("most followers are 25–44 → suggesting 25–44 to Meta");
  });
  it("13-17 is left out, the minimum is 18, and a run ending in 65+ has no maximum", () => {
    const p = plan({ followers: followers({ "13-17": 0.5, "18-24": 0.05, "45-54": 0.1, "55-64": 0.15, "65+": 0.2 }) });
    expect(p).toMatchObject({ ageMin: 55, ageMax: null });
    expect(p.reasons.find((r) => r.bg.includes("→ предлагам"))?.bg).toBe("най-много от последователите са 55+ → предлагам 55+ на Meta");
  });
  it("a run on the higher sum wins a tie in length", () => {
    // 18-24+25-34 = 0.6 and 25-34+35-44 = 0.65 both reach 60% of 1.0 with two bands; the higher one wins.
    const p = plan({ followers: followers({ "18-24": 0.2, "25-34": 0.4, "35-44": 0.25, "45-54": 0.15 }) });
    expect(p).toMatchObject({ ageMin: 25, ageMax: 44 });
  });
  it("when the run covers every band there is no suggestion: 18 / none, no age line", () => {
    const p = plan({ followers: followers({ "18-24": 0.5, "25-34": 0.5 }) });
    expect(p).toMatchObject({ ageMin: 18, ageMax: null });
    expect(p.reasons.some((r) => r.bg.includes("→ предлагам"))).toBe(false);
  });
  it("no followers → 18 / none, everyone, and no age or gender hypothesis", () => {
    const p = plan({ followers: null });
    expect(p).toMatchObject({ ageMin: 18, ageMax: null, gender: "all" });
    expect(p.reasons.some((r) => /предлагам|suggesting/.test(r.bg + r.en))).toBe(false);
    // Followers with no age data are the same.
    expect(plan({ followers: followers({}) })).toMatchObject({ ageMin: 18, ageMax: null });
  });
  it("women when F is at least 75% of F+M+U, men likewise, otherwise everyone", () => {
    const g = (F: number, M: number, U = 0) => plan({ followers: followers({}, { F, M, U }) });
    expect(g(0.8, 0.2).gender).toBe("women");
    expect(g(0.8, 0.2).reasons.find((r) => r.bg.includes("предлагам жени"))?.bg).toBe("80% от последователите са жени → предлагам жени на Meta");
    expect(g(0.2, 0.8).gender).toBe("men");
    expect(g(0.6, 0.4).gender).toBe("all");
    expect(g(0.6, 0.4).reasons.some((r) => /предлагам (жени|мъже)/.test(r.bg))).toBe(false);
    // The unknown share counts in the total: 0.7 / 1.0 is under 75%.
    expect(g(0.7, 0.1, 0.2).gender).toBe("all");
  });
});

describe("analysis: the open days", () => {
  const schedule = (hours: typeof HOURS) => plan({ venue: { name: "К", hours, tz: TZ } }).schedule;
  it("closed on Sunday → Monday to Saturday, all day", () => {
    expect(schedule(HOURS)).toEqual({ days: ["mon", "tue", "wed", "thu", "fri", "sat"], from: "00:00", to: "23:59" });
    expect(plan().reasons.some((r) => r.bg === "в дните, в които сте отворени")).toBe(true);
  });
  it("open all 7 days → no limit; hours unknown (closed every day) → no limit", () => {
    expect(schedule(OPEN_7)).toBeNull();
    expect(plan({ venue: { name: "К", hours: OPEN_7, tz: TZ } }).reasons.some((r) => r.bg === "в дните, в които сте отворени")).toBe(false);
    const none = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
    expect(schedule(none)).toBeNull();
  });
  it("a variant keeps its own schedule and no open-days line", () => {
    const p = plan({ ownerWords: "уикенд" });
    expect(p.schedule?.days).toEqual(["fri", "sat", "sun"]);
    expect(p.reasons.some((r) => r.bg === "в дните, в които сте отворени")).toBe(false);
  });
});

describe("owner choices on top of the analysis", () => {
  it("win, are stored in plan.owner, and add no hypothesis for their field", () => {
    const owner = { radiusKm: 5, gender: "all" as const, budgetEur: 30 };
    const p = plan({ owner, followers: { followers: 300, age: {}, gender: { F: 0.9, M: 0.1 }, cities: [] }, surroundings: AREA(12) });
    expect(p).toMatchObject({ radiusKm: 5, gender: "all", budgetEur: 30, days: 5, owner });
    const texts = p.reasons.map((r) => r.bg);
    expect(texts.some((t) => t.includes("гъст район"))).toBe(false);
    expect(texts.some((t) => t.includes("предлагам жени"))).toBe(false);
    expect(texts.some((t) => t.includes("20 € за 5 дни"))).toBe(false);
  });
  it("age, audience, place, goal, placements and an explicit schedule replace the analysis", () => {
    const owner: BoostOwnerChoices = { ageMin: 30, ageMax: 50, audience: "студенти от НБУ", place: "около НДК", goal: "profile_visits", placements: "instagram", schedule: { days: ["sat", "sun"], from: "10:00", to: "14:00" } };
    const p = plan({ owner, followers: { followers: 300, age: { "18-24": 0.7, "25-34": 0.3 }, gender: {}, cities: [] } });
    expect(p).toMatchObject({ ageMin: 30, ageMax: 50, audience: "студенти от НБУ", place: "около НДК", goal: "profile_visits", placements: "instagram", schedule: owner.schedule });
    expect(p.reasons.some((r) => r.bg.includes("→ предлагам"))).toBe(false);
  });
  it("a null schedule means every day, all day, even though the café is closed on Sunday", () => {
    expect(plan({ owner: { schedule: null } }).schedule).toBeNull();
  });
  it("an owner schedule beats a variant; the variant still scales the radius and keeps its cut", () => {
    const sched = { days: ["tue" as const], from: "09:00", to: "12:00" };
    const p = plan({ owner: { variant: "weekend", schedule: sched }, surroundings: AREA(12) });
    expect(p.schedule).toEqual(sched);
    expect(p.radiusKm).toBe(3);
    expect(plan({ owner: { variant: "weekend" }, surroundings: AREA(12) }).schedule?.days).toEqual(["fri", "sat", "sun"]);
  });
  it("an owner minimum above a suggested maximum drops the maximum; an owner maximum under a suggested minimum drops the minimum", () => {
    const f: FollowerProfile = { followers: 300, age: { "18-24": 0.1, "25-34": 0.5, "35-44": 0.3, "45-54": 0.1 }, gender: {}, cities: [] };
    expect(plan({ followers: f, owner: { ageMin: 50 } })).toMatchObject({ ageMin: 50, ageMax: null });
    expect(plan({ followers: f, owner: { ageMax: 22 } })).toMatchObject({ ageMin: 18, ageMax: 22 });
  });
});

describe("owner ranges", () => {
  const err = (owner: BoostOwnerChoices) => planBoost(owned(owner));
  it("radius 1–50 km in steps of half a kilometre", () => {
    expect(err({ radiusKm: 0.5 })).toEqual({ error: "radius_range" });
    expect(err({ radiusKm: 51 })).toEqual({ error: "radius_range" });
    expect(err({ radiusKm: 2.25 })).toEqual({ error: "radius_range" });
    expect(err({ radiusKm: Number.NaN })).toEqual({ error: "radius_range" });
    expect(planBoost(owned({ radiusKm: 1 }))).toMatchObject({ radiusKm: 1 });
    expect(planBoost(owned({ radiusKm: 50 }))).toMatchObject({ radiusKm: 50 });
  });
  it("age: minimum 18–65, maximum from the minimum to 65 or none", () => {
    expect(err({ ageMin: 17 })).toEqual({ error: "age_range" });
    expect(err({ ageMin: 66 })).toEqual({ error: "age_range" });
    expect(err({ ageMin: 30, ageMax: 29 })).toEqual({ error: "age_range" });
    expect(err({ ageMax: 17 })).toEqual({ error: "age_range" });
    expect(err({ ageMax: 66 })).toEqual({ error: "age_range" });
    expect(planBoost(owned({ ageMin: 65, ageMax: 65 }))).toMatchObject({ ageMin: 65, ageMax: 65 });
    expect(planBoost(owned({ ageMin: 25, ageMax: null }))).toMatchObject({ ageMin: 25, ageMax: null });
  });
  it("schedule: at least one weekday, HH:MM, from before to", () => {
    expect(err({ schedule: { days: [], from: "09:00", to: "12:00" } })).toEqual({ error: "schedule" });
    expect(err({ schedule: { days: ["mon"], from: "12:00", to: "12:00" } })).toEqual({ error: "schedule" });
    expect(err({ schedule: { days: ["mon"], from: "13:00", to: "12:00" } })).toEqual({ error: "schedule" });
    expect(err({ schedule: { days: ["mon"], from: "9:00", to: "12:00" } })).toEqual({ error: "schedule" });
    expect(err({ schedule: { days: ["mon"], from: "09:00", to: "24:00" } })).toEqual({ error: "schedule" });
    expect(planBoost(owned({ schedule: { days: ["mon"], from: "09:00", to: "12:00" } }))).toMatchObject({ schedule: { days: ["mon"] } });
  });
});
