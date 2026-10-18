// src/boost/plan.ts
// The boost recommendation: what ad Claudia proposes for a café's post, and why. Pure, no IO.
// Every reason is a fact (from the café's own data, OpenStreetMap or Meta), a hypothesis, or missing. Nothing here estimates
// reach, cost or results: those numbers exist only once ads are connected, and a number appears in a reason only when it was measured.
import { PLACE_KINDS, type PlaceKind } from "../geo/osm";
import { summarise, type Surroundings } from "../geo/surroundings";
import type { FollowerProfile, PostStat } from "../social/insights-graph";
import type { Venue, Weekday } from "../domain/types";

export type BoostVariant = "default" | "morning" | "weekend";

export interface BoostInput {
  venue: Pick<Venue, "name" | "hours" | "tz">;
  surroundings: Surroundings;
  followers: FollowerProfile | null;
  post: { id: string; caption: string; type: "image" | "video" | "carousel"; stat?: PostStat } | null;
  ownerWords: string;
  budgetEur?: number;
  days?: number;
  variant?: BoostVariant;
  hasFacebookPage: boolean;
}

export interface BoostReason { kind: "fact" | "hypothesis" | "missing"; bg: string; en: string }

export interface BoostPlan {
  variant: BoostVariant;
  radiusKm: number;
  ageMin: 18;
  schedule: null | { days: Weekday[]; from: string; to: string };
  budgetEur: number;
  days: number;
  placements: "automatic";
  goal: "reach" | "profile_visits";
  reasons: BoostReason[];
}

export const DEFAULT_BUDGET_EUR = 20;
export const DEFAULT_DAYS = 5;
export const MIN_BUDGET_EUR = 5;
export const MAX_BUDGET_EUR = 200;
export const MIN_DAYS = 1;
export const MAX_DAYS = 14;

const DEFAULT_RADIUS_KM = 2;
const MORNING = { radiusKm: 1.5, days: ["mon", "tue", "wed", "thu", "fri"] as Weekday[], from: "07:30", to: "11:00" };
const WEEKEND = { radiusKm: 3, days: ["fri", "sat", "sun"] as Weekday[], from: "00:00", to: "23:59" };

const MORNING_WORDS = ["сутрин", "закуска", "до 11", "morning", "breakfast"];
const WEEKEND_WORDS = ["уикенд", "събота", "неделя", "бранч", "концерт", "weekend", "brunch", "event", "live"];

/** A keyword counts at the start of a word (so "сутринта" and "events" match, "alive" does not) and "до 11" not inside "до 110". */
function mentions(text: string, words: readonly string[]): boolean {
  return words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w}${/\d$/.test(w) ? "(?!\\d)" : ""}`, "iu").test(text));
}

/** The variant the words call for. A weekend word wins over a morning word ("неделя сутрин" is a weekend offer). */
function variantFrom(text: string): BoostVariant {
  if (mentions(text, WEEKEND_WORDS)) return "weekend";
  if (mentions(text, MORNING_WORDS)) return "morning";
  return "default";
}

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
    const tightest = kept.reduce((a, b) => (a.to.localeCompare(a.from) <= b.to.localeCompare(b.from) ? a : b));
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
      bg.push(`${named.name} (${Math.round(named.meters)} м)`);
      en.push(`${named.name} (${Math.round(named.meters)} m)`);
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
      bg: `в радиус 2 км не откри университети, институции, паркове или други обекти в OpenStreetMap${staleBg}`,
      en: `OpenStreetMap shows no universities, institutions, parks or other landmarks within 2 km${staleEn}`,
    };
  }
  return { kind: "fact", bg: `в радиус ${km} км: ${bg.join(", ")}${staleBg}`, en: `within ${km} km: ${en.join(", ")}${staleEn}` };
}

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
    bg.push(`${pct(city.share)} от ${name}`);
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

export function planBoost(input: BoostInput): BoostPlan | { error: "budget_range" | "days_range" } {
  const budgetEur = input.budgetEur ?? DEFAULT_BUDGET_EUR;
  const days = input.days ?? DEFAULT_DAYS;
  if (!Number.isFinite(budgetEur) || budgetEur < MIN_BUDGET_EUR || budgetEur > MAX_BUDGET_EUR) return { error: "budget_range" };
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) return { error: "days_range" };

  // The owner's words decide first; the caption only when they say nothing about it.
  let variant: BoostVariant = input.variant ?? (variantFrom(input.ownerWords) !== "default" ? variantFrom(input.ownerWords) : variantFrom(input.post?.caption ?? ""));
  let radiusKm = DEFAULT_RADIUS_KM;
  let schedule: BoostPlan["schedule"] = null;
  if (variant === "morning") {
    schedule = morningSchedule(input.venue.hours);
    if (schedule) radiusKm = MORNING.radiusKm;
    else variant = "default";
  }
  if (variant === "weekend") {
    radiusKm = WEEKEND.radiusKm;
    schedule = { days: [...WEEKEND.days], from: WEEKEND.from, to: WEEKEND.to };
  }

  const reasons: BoostReason[] = [surroundingsReason(input.surroundings), followersReason(input.followers)];
  const postLine = postReason(input.post?.stat);
  if (postLine) reasons.push(postLine);
  reasons.push({
    kind: "hypothesis",
    bg: "по-широката аудитория обикновено е по-евтина; Meta сама намира кой да види рекламата в радиуса",
    en: "a broader audience is usually cheaper; Meta itself finds who sees the ad within the radius",
  });
  if (variant === "morning") reasons.push({ kind: "hypothesis", bg: "сутрешна оферта → делнични сутрини", en: "a morning offer → weekday mornings" });
  if (variant === "weekend") reasons.push({ kind: "hypothesis", bg: "оферта за уикенда → от петък до неделя", en: "a weekend offer → Friday to Sunday" });

  return { variant, radiusKm, ageMin: 18, schedule, budgetEur, days, placements: "automatic", goal: input.hasFacebookPage ? "reach" : "profile_visits", reasons };
}
