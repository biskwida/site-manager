// src/domain/boost-preview.ts
// The preview of a boost_plan row (src/agent/boost-tools.ts): where, who, when, how much, and why, in the reader's language.
// No reach or price: those exist only once ads are connected, so the reach line says so. Phase 1 only saves the plan, and the
// last line says that too. Pure; undo-safe (an inverted row has after null and reads as a removal). The caption is kept as written.
import { keep, tr, weekdayLabel } from "./format";
import { WEEKDAYS, type BoostOwnerChoices, type BoostPlanData, type BoostPlanRow, type BoostReasonRow, type Change, type Lang, type Weekday } from "./types";

/** Characters of the caption shown in the preview's first line. */
export const BOOST_CAPTION_PREVIEW = 60;

/** The caption's first 60 characters on one line, kept as written; a fixed text when the post has none. */
function captionHead(caption: string, lang: Lang): string {
  const flat = caption.replace(/\s+/g, " ").trim();
  if (!flat) return tr(lang, "(пост без текст)", "(post without text)");
  const chars = Array.from(flat);
  return keep(chars.length > BOOST_CAPTION_PREVIEW ? `${chars.slice(0, BOOST_CAPTION_PREVIEW).join("").trimEnd()}…` : flat);
}

/** "1,5" (bg) / "1.5" (en); whole numbers without decimals. */
const decimal = (n: number, lang: Lang) => (lang === "bg" ? String(n).replace(".", ",") : String(n));
/** "20 €", or "12,50 €" / "12.50 €" with cents. */
const euros = (n: number, lang: Lang) => `${Number.isInteger(n) ? String(n) : lang === "bg" ? n.toFixed(2).replace(".", ",") : n.toFixed(2)} €`;

/** "пон–пет" for a run of days, "пон, ср, пет" otherwise. */
function dayList(days: readonly Weekday[], lang: Lang): string {
  const idx = [...new Set(days.map((d) => WEEKDAYS.indexOf(d)).filter((i) => i >= 0))].sort((a, b) => a - b);
  const label = (i: number) => weekdayLabel(WEEKDAYS[i], lang);
  const run = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return run ? `${label(idx[0])}–${label(idx[idx.length - 1])}` : idx.map(label).join(", ");
}

/** Marks a value the owner chose. */
const MARK = " ✎";
const mark = (owned: boolean) => (owned ? MARK : "");

function whenText(p: BoostPlanRow["plan"], lang: Lang, owner: BoostOwnerChoices): string {
  const length = `${p.days === 1 ? tr(lang, "1 ден", "1 day") : `${p.days} ${tr(lang, "дни", "days")}`}${mark(owner.days !== undefined)}`;
  const allDay = tr(lang, "по цял ден", "all day");
  // An owner's morning or weekend choice sets the days and hours too.
  const hoursOwned = owner.schedule !== undefined || (owner.variant !== undefined && owner.variant !== "default");
  if (!p.schedule) return `${length}, ${allDay}${mark(hoursOwned)}`;
  const wholeDay = p.schedule.from === "00:00" && p.schedule.to === "23:59";
  return `${length}, ${dayList(p.schedule.days, lang)}${wholeDay ? `, ${allDay}` : ` ${p.schedule.from}–${p.schedule.to}`}${mark(hoursOwned)}`;
}

const GOALS: Record<BoostPlanData["goal"], { bg: string; en: string }> = {
  reach: { bg: "хора наблизо", en: "people nearby" },
  profile_visits: { bg: "посещения на профила", en: "profile visits" },
  website_visits: { bg: "посещения на сайта", en: "website visits" },
};
const PLACEMENTS: Record<BoostPlanData["placements"], { bg: string; en: string }> = {
  automatic: { bg: "автоматично (Instagram + Facebook)", en: "automatic (Instagram + Facebook)" },
  instagram: { bg: "само Instagram", en: "Instagram only" },
  facebook: { bg: "само Facebook", en: "Facebook only" },
};
const GENDERS: Record<"women" | "men", { bg: string; en: string }> = { women: { bg: "жени", en: "women" }, men: { bg: "мъже", en: "men" } };

/** "Кой:" — the hard age limits (the owner's, else 18+), then what is only suggested to Meta (age range, gender), then the owner's words about the customers. */
function whoText(p: BoostPlanRow["plan"], lang: Lang, owner: BoostOwnerChoices): string {
  const ageMin = p.ageMin ?? 18;
  const ageMax = p.ageMax ?? null;
  const ageOwned = owner.ageMin !== undefined || owner.ageMax !== undefined;
  const parts = [`${ageMax === null ? `${ageMin}+` : `${ageMin}–${ageMax}`}${mark(ageOwned)}`];
  const suggested: string[] = [];
  const age = p.suggestedAge ?? null;
  if (age) suggested.push(`${age.max === null ? `${age.min}+` : `${age.min}–${age.max}`}${tr(lang, " г.", "")}`);
  const gender = p.gender ?? "all";
  if (gender !== "all") suggested.push(`${GENDERS[gender][lang]}${mark(owner.gender !== undefined)}`);
  else if (owner.gender === "all") suggested.push(`${tr(lang, "всички", "everyone")}${MARK}`);
  if (suggested.length) parts.push(`${tr(lang, "предложение към Meta", "suggested to Meta")}: ${suggested.join(", ")}`);
  if (p.audience) parts.push(`${tr(lang, "клиенти", "customers")}: ${keep(p.audience)}${mark(owner.audience !== undefined)}`);
  return parts.join(" · ");
}

/** Facts first, then hypotheses, then what is missing (marked "—", the others "•"). */
function reasonLines(reasons: readonly BoostReasonRow[], lang: Lang): string[] {
  const order: BoostReasonRow["kind"][] = ["fact", "hypothesis", "missing"];
  const lines = order.flatMap((kind) => reasons.filter((r) => r.kind === kind).map((r) => `${kind === "missing" ? "—" : "•"} ${r[lang]}`));
  return lines.length ? [tr(lang, "Защо:", "Why:"), ...lines] : [];
}

export function boostPreviewLines(c: Change, lang: Lang): string[] {
  if (c.after === null) {
    const old = (c.before ?? {}) as Partial<BoostPlanRow>;
    return [`• ${tr(lang, "Премахва плана за реклама", "Removes the ad plan")}: ${captionHead(old.caption ?? "", lang)}`];
  }
  const row = c.after as unknown as BoostPlanRow;
  const p = row.plan;
  const owner = p.owner ?? {};
  const km = `${decimal(p.radiusKm, lang)} ${tr(lang, "км", "km")}`;
  const label = row.place_label ?? "";
  const where = `${tr(lang, "до", "within")} ${km}${mark(owner.radiusKm !== undefined)}${label ? ` ${tr(lang, "от", "of")} ${keep(label)}${mark(owner.place !== undefined)}` : ""}`;
  return [
    `📣 ${tr(lang, "Реклама", "Ad")}: ${captionHead(row.caption ?? "", lang)}`,
    `${tr(lang, "Къде", "Where")}: ${where}`,
    `${tr(lang, "Кой", "Who")}: ${whoText(p, lang, owner)}`,
    `${tr(lang, "Кога", "When")}: ${whenText(p, lang, owner)}`,
    tr(
      lang,
      `Бюджет: ${euros(p.budgetEur, lang)}${mark(owner.budgetEur !== undefined)} общо · Цел: ${GOALS[p.goal ?? "reach"].bg}${mark(owner.goal !== undefined)} · Показва се: ${PLACEMENTS[p.placements ?? "automatic"].bg}${mark(owner.placements !== undefined)}`,
      `Budget: ${euros(p.budgetEur, lang)}${mark(owner.budgetEur !== undefined)} total · Goal: ${GOALS[p.goal ?? "reach"].en}${mark(owner.goal !== undefined)} · Shows on: ${PLACEMENTS[p.placements ?? "automatic"].en}${mark(owner.placements !== undefined)}`,
    ),
    tr(lang, "Обхват: ще го видите, щом рекламите са свързани", "Reach: you'll see it once ads are connected"),
    ...reasonLines(p.reasons ?? [], lang),
    tr(
      lang,
      "✏️ Всичко може да се промени: радиус, място, възраст, пол, клиенти, дни и часове, продължителност, бюджет, цел, къде се показва.",
      "✏️ You can change anything: radius, place, age, gender, customers, days and hours, length, budget, goal, where it shows.",
    ),
    tr(lang, "(Сега само записвам плана — ще може да се пусне, щом Meta одобри рекламите в Claudia.)", "(For now I only save the plan — it can run once Meta approves ads in Claudia.)"),
  ];
}
