// test/domain-boost.test.ts — the boost recommendation: defaults, variants, limits, and reasons that are only ever fact, hypothesis or missing.
import { describe, expect, it } from "vitest";
import { buildFiles } from "@/src/deploy/manifest";
import { planBoost, type BoostInput, type BoostPlan } from "@/src/domain/boost";
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
  hasFacebookPage: true,
  ...over,
});
const plan = (over: Partial<BoostInput> = {}): BoostPlan => {
  const r = planBoost(input(over));
  if ("error" in r) throw new Error(`unexpected ${r.error}`);
  return r;
};
const allText = (p: BoostPlan) => p.reasons.map((r) => `${r.bg}\n${r.en}`).join("\n");

describe("planBoost defaults", () => {
  it("2 km, 18+, 20 EUR over 5 days, automatic placements, reach, all day", () => {
    const p = plan();
    expect(p).toMatchObject({ variant: "default", radiusKm: 2, ageMin: 18, budgetEur: 20, days: 5, placements: "automatic", goal: "reach", schedule: null });
  });
  it("the goal is profile_visits without a Facebook Page", () => {
    expect(plan({ hasFacebookPage: false }).goal).toBe("profile_visits");
  });
});

describe("variants", () => {
  it("morning by keyword: 1.5 km, Monday to Friday, clipped to the opening hours", () => {
    const p = plan({ ownerWords: "оферта за закуска до 11" });
    expect(p.variant).toBe("morning");
    expect(p.radiusKm).toBe(1.5);
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
    expect(p).toMatchObject({ variant: "default", radiusKm: 2, schedule: null });
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
  it("weekend by keyword: 3 km, Friday to Sunday", () => {
    const p = plan({ ownerWords: "бранч в неделя с концерт" });
    expect(p.variant).toBe("weekend");
    expect(p.radiusKm).toBe(3);
    expect(p.schedule?.days).toEqual(["fri", "sat", "sun"]);
    expect(p.schedule).toMatchObject({ from: "00:00", to: "23:59" });
  });
  it("weekend in English", () => {
    expect(plan({ ownerWords: "live music this weekend" }).variant).toBe("weekend");
  });
  it("an explicit variant wins over keywords", () => {
    expect(plan({ variant: "weekend", ownerWords: "закуска" }).variant).toBe("weekend");
    expect(plan({ variant: "default", ownerWords: "закуска" }).variant).toBe("default");
  });
  it("there is no student variant: студенти leaves the default", () => {
    const p = plan({ ownerWords: "искам да стигна до студенти" });
    expect(p).toMatchObject({ variant: "default", radiusKm: 2, schedule: null });
  });
  it("does not match keywords inside other words", () => {
    expect(plan({ ownerWords: "deliver and alive" }).variant).toBe("default");
  });
});

describe("owner limits", () => {
  it("refuses a budget under 5 or over 200 EUR", () => {
    expect(planBoost(input({ budgetEur: 4 }))).toEqual({ error: "budget_range" });
    expect(planBoost(input({ budgetEur: 201 }))).toEqual({ error: "budget_range" });
    expect(planBoost(input({ budgetEur: Number.NaN }))).toEqual({ error: "budget_range" });
  });
  it("refuses 0 or more than 14 days", () => {
    expect(planBoost(input({ days: 15 }))).toEqual({ error: "days_range" });
    expect(planBoost(input({ days: 0 }))).toEqual({ error: "days_range" });
    expect(planBoost(input({ days: 2.5 }))).toEqual({ error: "days_range" });
  });
  it("accepts the edges and 30 EUR over 3 days", () => {
    expect(plan({ budgetEur: 30, days: 3 })).toMatchObject({ budgetEur: 30, days: 3 });
    expect(plan({ budgetEur: 5, days: 1 })).toMatchObject({ budgetEur: 5, days: 1 });
    expect(plan({ budgetEur: 200, days: 14 })).toMatchObject({ budgetEur: 200, days: 14 });
  });
});

describe("reasons", () => {
  it("come in order: surroundings, followers, hypothesis, with the right kinds", () => {
    const r = plan().reasons;
    expect(r.map((x) => x.kind)).toEqual(["fact", "fact", "hypothesis"]);
    expect(r[0].bg).toBe("в радиус 1 км: Софийски университет (400 м), 3 държавни институции, 2 парка");
    expect(r[0].en).toBe("within 1 km: Софийски университет (400 m), 3 government buildings, 2 parks");
    expect(r[1].bg).toBe("62% от последователите са жени, най-много 25–34 г., 71% от Sofia");
    expect(r[1].en).toBe("62% of followers are women, most are 25–34, 71% from Sofia");
    expect(r[2].bg).toContain("по-широката аудитория обикновено е по-евтина");
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
    expect(r.bg).toContain("не откри");
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
  it("a stat with only some metrics states only those", () => {
    const post = { id: "p", caption: "x", type: "image" as const, stat: { id: "p", caption: "x", type: "image" as const, at: "2026-10-10T00:00:00Z", permalink: "u", saved: 7 } };
    const line = plan({ post }).reasons[2];
    expect(line.bg).toBe("този пост има 7 запазвания");
    expect(line.bg).not.toContain("споделяния");
  });
  it("no reason line carries a reach, cost or price number unless a stat is given", () => {
    for (const p of [plan(), plan({ followers: null, surroundings: MISSING }), plan({ ownerWords: "уикенд" }), plan({ ownerWords: "закуска" })]) {
      expect(allText(p)).not.toMatch(/обхват|reach|€|EUR|евро|CPM|CPC|цена|price|cost/i);
      expect(p.reasons.find((x) => x.kind === "hypothesis")?.bg).not.toMatch(/\d/);
    }
  });
  it("every reason has both languages", () => {
    for (const r of plan({ ownerWords: "закуска" }).reasons) {
      expect(r.bg.length).toBeGreaterThan(0);
      expect(r.en.length).toBeGreaterThan(0);
    }
  });
});

describe("venue sites", () => {
  it("do not ship the server-only recommendation (it imports geo and social code the thin site does not have)", async () => {
    const files = await buildFiles("classic");
    expect(files.some((f) => f.file === "src/domain/boost.ts")).toBe(false);
    expect(files.some((f) => f.file === "src/domain/hours.ts")).toBe(true);
  });
});
