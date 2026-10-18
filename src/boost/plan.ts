// src/boost/plan.ts
// The boost recommendation: what ad Claudia proposes for a café's post, and why. Pure, no IO.
// Every reason is a fact (from the café's own data, OpenStreetMap or Meta), a hypothesis, or missing. Nothing here estimates
// reach, cost or results: those numbers exist only once ads are connected, and a number appears in a reason only when it was measured.
import { PLACE_KINDS, SEARCH_RADIUS_M, type PlaceKind } from "../geo/osm";
import { summarise, type Surroundings } from "../geo/surroundings";
import type { FollowerProfile, PostStat } from "../social/insights-graph";
import { keep } from "../domain/format";
import { WEEKDAYS, type BoostOwnerChoices, type BoostPlanData, type Venue, type Weekday } from "../domain/types";

export type BoostVariant = "default" | "morning" | "weekend";

export interface BoostInput {
  venue: Pick<Venue, "name" | "hours" | "tz">;
  surroundings: Surroundings;
  followers: FollowerProfile | null;
  post: { id: string; caption: string; type: "image" | "video" | "carousel"; stat?: PostStat } | null;
  ownerWords: string;
  /** What the owner set by hand; each field replaces Claudia's analysis value and adds no hypothesis. */
  owner: BoostOwnerChoices;
  hasFacebookPage: boolean;
}

export interface BoostReason { kind: "fact" | "hypothesis" | "missing"; bg: string; en: string }

/** The plan; the same shape src/domain restates as BoostPlanData. */
export type BoostPlan = BoostPlanData;

export type BoostPlanError = "budget_range" | "days_range" | "radius_range" | "age_range" | "schedule";

export const DEFAULT_BUDGET_EUR = 20;
export const DEFAULT_DAYS = 5;
export const MIN_BUDGET_EUR = 5;
export const MAX_BUDGET_EUR = 200;
export const MIN_DAYS = 1;
export const MAX_DAYS = 14;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 50;
export const MIN_AGE = 18;
export const MAX_AGE = 65;

const MORNING = { scale: 0.75, days: ["mon", "tue", "wed", "thu", "fri"] as Weekday[], from: "07:30", to: "11:00" };
const WEEKEND = { scale: 1.5, days: ["fri", "sat", "sun"] as Weekday[], from: "00:00", to: "23:59" };
/** Radius when the surroundings could not be read. */
const UNKNOWN_AREA_RADIUS_KM = 3;
/** The share of the followers a suggested age range must hold. */
const AGE_SHARE = 0.6;
/** The share of one gender (of women + men + unknown) from which Claudia suggests that gender alone. */
const GENDER_SHARE = 0.75;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const MORNING_WORDS = ["сутрин", "закуска", "до 11", "morning", "breakfast"];
const WEEKEND_WORDS = ["уикенд", "събота", "неделя", "бранч", "концерт", "weekend", "brunch", "event", "live"];

/** English words that count only whole (a plural allowed where given): "events" is an event, "eventually", "liver" and "lively" are not. */
const WHOLE_WORDS: Readonly<Record<string, string>> = { event: "events?", live: "live" };

/**
 * A keyword counts at the start of a word (so the Bulgarian stems match "сутринта" and "неделята", "alive" does not), "до 11" not
 * inside "до 110", and the words in WHOLE_WORDS only as whole words.
 */
function mentions(text: string, words: readonly string[]): boolean {
  return words.some((w) => {
    const body = WHOLE_WORDS[w] ? `${WHOLE_WORDS[w]}(?![\\p{L}\\p{N}])` : `${w}${/\d$/.test(w) ? "(?!\\d)" : ""}`;
    return new RegExp(`(?<![\\p{L}\\p{N}])${body}`, "iu").test(text);
  });
}

/** The variant the words call for. A weekend word wins over a morning word ("неделя сутрин" is a weekend offer). */
function variantFrom(text: string): BoostVariant {
  if (mentions(text, WEEKEND_WORDS)) return "weekend";
  if (mentions(text, MORNING_WORDS)) return "morning";
  return "default";
}

/** "07:30" → 450. */
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Monday to Friday 07:30-11:00 cut to the hours the café is open; null when it is never open in that window. */
function morningSchedule(hours: BoostInput["venue"]["hours"]): NonNullable<BoostPlan["schedule"]> | null {
  let kept = MORNING.days
    .map((d) => ({ d, open: hours[d]?.open ?? "", close: hours[d]?.close ?? "" }))
    .filter((x) => x.open !== "")
    .map((x) => ({ d: x.d, from: x.open > MORNING.from ? x.open : MORNING.from, to: x.close < MORNING.to ? x.close : MORNING.to }))
    .filter((x) => x.from < x.to);
  // One window serves every day, so it must lie inside each day's open window; drop the day with the least room until one fits.
  while (kept.length > 0) {
    const from = kept.reduce((m, x) => (x.from > m ? x.from : m), "00:00");
    const to = kept.reduce((m, x) => (x.to < m ? x.to : m), "23:59");
    if (from < to) return { days: kept.map((x) => x.d), from, to };
    const room = (x: { from: string; to: string }) => minutes(x.to) - minutes(x.from);
    const tightest = kept.reduce((a, b) => (room(a) <= room(b) ? a : b));
    kept = kept.filter((x) => x !== tightest);
  }
  return null;
}

type Plural = { one: string; many: string };
const KIND_BG: Record<PlaceKind, Plural> = {
  university: { one: "университет", many: "университета" },
  government: { one: "държавна институция", many: "държавни институции" },
  office: { one: "офис сграда", many: "офис сгради" },
  park: { one: "парк", many: "парка" },
  sight: { one: "забележителност", many: "забележителности" },
  culture: { one: "културен обект", many: "културни обекта" },
};
const KIND_EN: Record<PlaceKind, Plural> = {
  university: { one: "university", many: "universities" },
  government: { one: "government building", many: "government buildings" },
  office: { one: "office building", many: "office buildings" },
  park: { one: "park", many: "parks" },
  sight: { one: "landmark", many: "landmarks" },
  culture: { one: "cultural venue", many: "cultural venues" },
};
const pick = (n: number, p: Plural) => `${n} ${n === 1 ? p.one : p.many}`;

function surroundingsReason(s: Surroundings): BoostReason {
  if (s.status !== "ok") return { kind: "missing", bg: "не успях да проверя района", en: "I couldn't check the area" };
  const sum = summarise(s.places);
  const total = (w: "km1" | "km2") => PLACE_KINDS.reduce((n, k) => n + sum.counts[k][w], 0);
  const km = total("km1") > 0 ? 1 : 2;
  const window = km === 1 ? "km1" : "km2";
  const limit = km * 1000;
  const bg: string[] = [];
  const en: string[] = [];
  for (const kind of PLACE_KINDS) {
    const count = sum.counts[kind][window];
    if (count === 0) continue;
    const named = sum.nearest[kind].find((p) => p.meters <= limit);
    if (count === 1 && named?.name) {
      // A place's own name is kept as written (keep markers: the translation wrapper leaves it alone).
      bg.push(`${keep(named.name)} (${Math.round(named.meters)} м)`);
      en.push(`${keep(named.name)} (${Math.round(named.meters)} m)`);
    } else {
      bg.push(pick(count, KIND_BG[kind]));
      en.push(pick(count, KIND_EN[kind]));
    }
  }
  const staleBg = s.stale ? " (данни отпреди време)" : "";
  const staleEn = s.stale ? " (older data)" : "";
  if (bg.length === 0) {
    return {
      kind: "fact",
      bg: `в радиус ${SEARCH_RADIUS_M / 1000} км OpenStreetMap не показва университети, институции, паркове или други обекти${staleBg}`,
      en: `OpenStreetMap shows no universities, institutions, parks or other landmarks within ${SEARCH_RADIUS_M / 1000} km${staleEn}`,
    };
  }
  return { kind: "fact", bg: `в радиус ${km} км: ${bg.join(", ")}${staleBg}`, en: `within ${km} km: ${en.join(", ")}${staleEn}` };
}

/** Meta names cities in English; the Bulgarian line names the largest ones in Bulgarian, any other as Meta gave it. */
export const CITY_BG: Readonly<Record<string, string>> = { Sofia: "София", Plovdiv: "Пловдив", Varna: "Варна", Burgas: "Бургас", Ruse: "Русе", "Stara Zagora": "Стара Загора" };

const pct = (share: number) => `${Math.round(share * 100)}%`;
const top = (rec: Record<string, number>) => Object.entries(rec).reduce<[string, number] | null>((best, e) => (e[1] > 0 && (!best || e[1] > best[1]) ? e : best), null);

function followersReason(f: FollowerProfile | null): BoostReason {
  if (!f) {
    return { kind: "missing", bg: "демографията на последователите ще се вижда при 100+ последователи и свързан Instagram", en: "follower demographics will show with 100+ followers and a connected Instagram" };
  }
  const bg: string[] = [];
  const en: string[] = [];
  const female = f.gender.F ?? 0;
  const male = f.gender.M ?? 0;
  if (female > 0 || male > 0) {
    const women = female >= male;
    bg.push(`${pct(women ? female : male)} от последователите са ${women ? "жени" : "мъже"}`);
    en.push(`${pct(women ? female : male)} of followers are ${women ? "women" : "men"}`);
  }
  const age = top(f.age);
  if (age) {
    const band = age[0].replace("-", "–");
    bg.push(`най-много ${band} г.`);
    en.push(`most are ${band}`);
  }
  const city = f.cities.find((c) => c.share > 0);
  if (city) {
    const name = city.name.split(",")[0].trim();
    bg.push(`${pct(city.share)} от ${CITY_BG[name] ?? name}`);
    en.push(`${pct(city.share)} from ${name}`);
  }
  if (bg.length === 0) {
    return { kind: "missing", bg: "Meta не даде разбивка на последователите по възраст, пол и град", en: "Meta gave no breakdown of followers by age, gender or city" };
  }
  return { kind: "fact", bg: bg.join(", "), en: en.join(", ") };
}

/** Only the numbers Meta reported for this post; there is no account average to compare with, so nothing is a multiple of it. */
function postReason(stat: PostStat | undefined): BoostReason | null {
  if (!stat) return null;
  // Nothing measured yet (every known number is 0) says nothing about the post: no line.
  const known = [stat.reach, stat.saved, stat.shares].filter((n): n is number => n !== undefined);
  if (known.length > 0 && known.every((n) => n === 0)) return null;
  const bg: string[] = [];
  const en: string[] = [];
  if (stat.saved !== undefined) {
    bg.push(`${stat.saved} ${stat.saved === 1 ? "запазване" : "запазвания"}`);
    en.push(`${stat.saved} ${stat.saved === 1 ? "save" : "saves"}`);
  }
  if (stat.shares !== undefined) {
    bg.push(`${stat.shares} ${stat.shares === 1 ? "споделяне" : "споделяния"}`);
    en.push(`${stat.shares} ${stat.shares === 1 ? "share" : "shares"}`);
  }
  const reachBg = stat.reach !== undefined ? ` при обхват ${stat.reach}` : "";
  const reachEn = stat.reach !== undefined ? ` at a reach of ${stat.reach}` : "";
  if (bg.length === 0) {
    return stat.reach === undefined ? null : { kind: "fact", bg: `този пост е с обхват ${stat.reach}`, en: `this post has a reach of ${stat.reach}` };
  }
  return { kind: "fact", bg: `този пост има ${bg.join(" и ")}${reachBg}`, en: `this post has ${en.join(" and ")}${reachEn}` };
}

/** How busy the area is: places of every kind within 1 km. Null when the surroundings could not be read. */
function areaDensity(s: Surroundings): number | null {
  if (s.status !== "ok") return null;
  const sum = summarise(s.places);
  return PLACE_KINDS.reduce((n, k) => n + sum.counts[k].km1, 0);
}

/** The base radius from the density, with its hypothesis reason (none when the area is unknown). */
function radiusFromArea(s: Surroundings): { km: number; reason: BoostReason | null } {
  const density = areaDensity(s);
  if (density === null) return { km: UNKNOWN_AREA_RADIUS_KM, reason: null };
  if (density >= 10) return { km: 2, reason: { kind: "hypothesis", bg: "гъст район — 2 км стигат", en: "a busy area — 2 km is enough" } };
  if (density >= 3) return { km: 3, reason: { kind: "hypothesis", bg: "смесен район — 3 км", en: "a mixed area — 3 km" } };
  return { km: 5, reason: { kind: "hypothesis", bg: "малко обекти наоколо — по-широк радиус, 5 км", en: "few places around — a wider radius, 5 km" } };
}

/** Nearest half kilometre. */
const halfKm = (km: number) => Math.round(km * 2) / 2;

/** "25-34" → 25; "65+" → 65. */
const lower = (band: string) => Number.parseInt(band, 10);

interface AgeSuggestion { ageMin: number; ageMax: number | null; reason: BoostReason | null }

/** The shortest run of neighbouring age bands holding 60% of the followers (the higher sum on a tie); 18+ when nothing stands out. */
function ageFromFollowers(f: FollowerProfile | null): AgeSuggestion {
  const none: AgeSuggestion = { ageMin: MIN_AGE, ageMax: null, reason: null };
  if (!f) return none;
  const bands = Object.entries(f.age)
    .filter(([band, share]) => band !== "13-17" && Number.isFinite(lower(band)) && share > 0)
    .sort((a, b) => lower(a[0]) - lower(b[0]));
  const total = bands.reduce((n, [, share]) => n + share, 0);
  if (bands.length === 0 || total <= 0) return none;
  let best: { from: number; to: number; sum: number } | null = null;
  for (let from = 0; from < bands.length; from++) {
    let sum = 0;
    for (let to = from; to < bands.length; to++) {
      sum += bands[to][1];
      if (sum >= AGE_SHARE * total - 1e-9) {
        const len = to - from;
        if (!best || len < best.to - best.from || (len === best.to - best.from && sum > best.sum + 1e-9)) best = { from, to, sum };
        break;
      }
    }
  }
  if (!best || (best.from === 0 && best.to === bands.length - 1)) return none;
  const first = bands[best.from][0];
  const last = bands[best.to][0];
  const ageMin = Math.max(MIN_AGE, lower(first));
  const ageMax = last.endsWith("+") ? null : Number.parseInt(last.split("-")[1] ?? "", 10);
  if (ageMax !== null && !Number.isFinite(ageMax)) return none;
  const range = ageMax === null ? `${ageMin}+` : `${ageMin}–${ageMax}`;
  return {
    ageMin,
    ageMax,
    reason: { kind: "hypothesis", bg: `най-много от последователите са ${range} → предлагам ${range} на Meta`, en: `most followers are ${range} → suggesting ${range} to Meta` },
  };
}

/** "women" or "men" when three quarters of the followers are one gender; otherwise everyone. */
function genderFromFollowers(f: FollowerProfile | null): { gender: BoostPlan["gender"]; reason: BoostReason | null } {
  const all: { gender: BoostPlan["gender"]; reason: BoostReason | null } = { gender: "all", reason: null };
  if (!f) return all;
  const female = f.gender.F ?? 0;
  const male = f.gender.M ?? 0;
  const total = female + male + (f.gender.U ?? 0);
  if (total <= 0) return all;
  if (female / total >= GENDER_SHARE - 1e-9) {
    return { gender: "women", reason: { kind: "hypothesis", bg: `${pct(female / total)} от последователите са жени → предлагам жени на Meta`, en: `${pct(female / total)} of followers are women → suggesting women to Meta` } };
  }
  if (male / total >= GENDER_SHARE - 1e-9) {
    return { gender: "men", reason: { kind: "hypothesis", bg: `${pct(male / total)} от последователите са мъже → предлагам мъже на Meta`, en: `${pct(male / total)} of followers are men → suggesting men to Meta` } };
  }
  return all;
}

/** The days the business is open when that is some days of the week (1–6); null when it is open every day or the hours are unknown. */
function openDays(hours: BoostInput["venue"]["hours"]): Weekday[] | null {
  const open = WEEKDAYS.filter((d) => (hours[d]?.open ?? "") !== "");
  return open.length >= 1 && open.length <= 6 ? [...open] : null;
}

const validSchedule = (sc: NonNullable<BoostPlan["schedule"]>) =>
  Array.isArray(sc.days) && sc.days.length > 0 && sc.days.every((d) => WEEKDAYS.includes(d)) && HHMM.test(sc.from) && HHMM.test(sc.to) && sc.from < sc.to;

export function planBoost(input: BoostInput): BoostPlan | { error: BoostPlanError } {
  const o = input.owner;
  const budgetEur = o.budgetEur ?? DEFAULT_BUDGET_EUR;
  const days = o.days ?? DEFAULT_DAYS;
  if (!Number.isFinite(budgetEur) || budgetEur < MIN_BUDGET_EUR || budgetEur > MAX_BUDGET_EUR) return { error: "budget_range" };
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) return { error: "days_range" };
  if (o.radiusKm !== undefined && (!Number.isFinite(o.radiusKm) || o.radiusKm < MIN_RADIUS_KM || o.radiusKm > MAX_RADIUS_KM || (o.radiusKm * 2) % 1 !== 0)) return { error: "radius_range" };
  const intAge = (n: number) => Number.isInteger(n) && n >= MIN_AGE && n <= MAX_AGE;
  if (o.ageMin !== undefined && !intAge(o.ageMin)) return { error: "age_range" };
  if (typeof o.ageMax === "number" && (!intAge(o.ageMax) || o.ageMax < (o.ageMin ?? MIN_AGE))) return { error: "age_range" };
  if (o.schedule && !validSchedule(o.schedule)) return { error: "schedule" };

  // The owner's words decide first; the caption only when they say nothing about it.
  let variant: BoostVariant = o.variant ?? (variantFrom(input.ownerWords) !== "default" ? variantFrom(input.ownerWords) : variantFrom(input.post?.caption ?? ""));
  let schedule: BoostPlan["schedule"] = null;
  if (variant === "morning") {
    schedule = morningSchedule(input.venue.hours);
    if (!schedule) variant = "default";
  }
  if (variant === "weekend") schedule = { days: [...WEEKEND.days], from: WEEKEND.from, to: WEEKEND.to };

  // Claudia's analysis of each field; an owner choice replaces it and adds no hypothesis.
  const area = radiusFromArea(input.surroundings);
  const scale = variant === "morning" ? MORNING.scale : variant === "weekend" ? WEEKEND.scale : 1;
  const radiusKm = o.radiusKm ?? (scale === 1 ? area.km : halfKm(area.km * scale));
  const ageSuggestion = ageFromFollowers(input.followers);
  let ageMin = o.ageMin ?? ageSuggestion.ageMin;
  let ageMax = o.ageMax !== undefined ? o.ageMax : ageSuggestion.ageMax;
  // An owner bound beside a suggested one that no longer fits it: the suggestion gives way.
  if (o.ageMax === undefined && ageMax !== null && ageMax < ageMin) ageMax = null;
  if (o.ageMin === undefined && o.ageMax != null && ageMin > o.ageMax) ageMin = MIN_AGE;
  const ageOwned = o.ageMin !== undefined || o.ageMax !== undefined;
  const genderSuggestion = genderFromFollowers(input.followers);
  const gender = o.gender ?? genderSuggestion.gender;

  let weekdays: Weekday[] | null = null;
  if (o.schedule !== undefined) schedule = o.schedule;
  else if (variant === "default") {
    weekdays = openDays(input.venue.hours);
    if (weekdays) schedule = { days: weekdays, from: "00:00", to: "23:59" };
  }

  const reasons: BoostReason[] = [surroundingsReason(input.surroundings), followersReason(input.followers)];
  const postLine = postReason(input.post?.stat);
  if (postLine) reasons.push(postLine);
  reasons.push({
    kind: "hypothesis",
    bg: "по-широката аудитория обикновено е по-евтина; Meta сама намира кой да види рекламата в радиуса",
    en: "a broader audience is usually cheaper; Meta itself finds who sees the ad within the radius",
  });
  if (o.radiusKm === undefined && area.reason) reasons.push(area.reason);
  if (!ageOwned && ageSuggestion.reason) reasons.push(ageSuggestion.reason);
  if (o.gender === undefined && genderSuggestion.reason) reasons.push(genderSuggestion.reason);
  if (weekdays) reasons.push({ kind: "hypothesis", bg: "в дните, в които сте отворени", en: "on the days you're open" });
  if (o.budgetEur === undefined && o.days === undefined) {
    reasons.push({
      kind: "hypothesis",
      bg: "20 € за 5 дни е малък тест — достатъчен Meta да научи кой реагира",
      en: "20 € over 5 days is a small test — enough for Meta to learn who responds",
    });
  }
  if (o.schedule === undefined && variant === "morning") reasons.push({ kind: "hypothesis", bg: "сутрешна оферта → делнични сутрини", en: "a morning offer → weekday mornings" });
  if (o.schedule === undefined && variant === "weekend") reasons.push({ kind: "hypothesis", bg: "оферта за уикенда → от петък до неделя", en: "a weekend offer → Friday to Sunday" });

  return {
    variant,
    radiusKm,
    place: o.place ?? null,
    ageMin,
    ageMax,
    gender,
    audience: o.audience ?? null,
    schedule,
    budgetEur,
    days,
    placements: o.placements ?? "automatic",
    goal: o.goal ?? (input.hasFacebookPage ? "reach" : "profile_visits"),
    reasons,
    owner: o,
  };
}
