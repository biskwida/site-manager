// src/domain/boost-preview.ts
// The preview of a boost_plan row (src/agent/boost-tools.ts): where, who, when, how much, and why, in the reader's language.
// No reach or price: those exist only once ads are connected, so the reach line says so. Phase 1 only saves the plan, and the
// last line says that too. Pure; undo-safe (an inverted row has after null and reads as a removal). The caption is kept as written.
import { keep, tr, weekdayLabel } from "./format";
import { WEEKDAYS, type BoostPlanRow, type BoostReasonRow, type Change, type Lang, type Weekday } from "./types";

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

function whenText(p: BoostPlanRow["plan"], lang: Lang): string {
  const length = p.days === 1 ? tr(lang, "1 ден", "1 day") : `${p.days} ${tr(lang, "дни", "days")}`;
  const allDay = tr(lang, "по цял ден", "all day");
  if (!p.schedule) return `${length}, ${allDay}`;
  const wholeDay = p.schedule.from === "00:00" && p.schedule.to === "23:59";
  return `${length}, ${dayList(p.schedule.days, lang)}${wholeDay ? `, ${allDay}` : ` ${p.schedule.from}–${p.schedule.to}`}`;
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
  const km = `${decimal(p.radiusKm, lang)} ${tr(lang, "км", "km")}`;
  return [
    `📣 ${tr(lang, "Реклама", "Ad")}: ${captionHead(row.caption ?? "", lang)}`,
    tr(lang, `Къде: до ${km} от кафенето · Кой: ${p.ageMin}+ · Кога: ${whenText(p, lang)}`, `Where: within ${km} of the café · Who: ${p.ageMin}+ · When: ${whenText(p, lang)}`),
    tr(lang, `Бюджет: ${euros(p.budgetEur, lang)} общо · Обхват: ще го видите, щом рекламите са свързани`, `Budget: ${euros(p.budgetEur, lang)} total · Reach: you'll see it once ads are connected`),
    ...reasonLines(p.reasons ?? [], lang),
    tr(lang, "(Сега само записвам плана — ще може да се пусне, щом Meta одобри рекламите в Claudia.)", "(For now I only save the plan — it can run once Meta approves ads in Claudia.)"),
  ];
}
