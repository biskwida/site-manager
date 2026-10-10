"use client";
import { WEEKDAYS, type WeekHours } from "@/src/domain/types";
import { Button } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

const DEFAULT_DAY = { open: "08:00", close: "18:00" };
const TIME = "sm-field min-h-11 w-full rounded-xl bg-panel px-3 text-base text-fg ring-1 ring-line transition-shadow duration-150 ease-out focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-sunken disabled:text-fg-soft/60 disabled:ring-line/60";

/** One row per day: on a phone the day and its "closed" switch sit on the first line, the two times below; from sm everything is one line. */
export function Hours({ draft, update }: StepProps) {
  const { t } = useT();
  const set = (patch: Partial<WeekHours>) => update({ hours: { ...draft.hours, ...patch } });
  return (
    <div className="grid gap-5">
      <div aria-hidden="true" className="hidden grid-cols-[6.5rem_1fr_1fr_auto] gap-x-3 text-sm font-semibold text-fg-soft sm:grid">
        <span>{t("hours.day")}</span><span>{t("hours.open")}</span><span>{t("hours.close")}</span><span className="pr-1">{t("hours.closed")}</span>
      </div>
      <ul className="grid divide-y divide-line">
        {WEEKDAYS.map((d) => {
          const v = draft.hours[d];
          const name = t(`hours.day.${d}` as "hours.day.mon");
          return (
            <li key={d} className="grid grid-cols-2 items-center gap-x-3 gap-y-2 py-3 first:pt-0 sm:grid-cols-[6.5rem_1fr_1fr_auto] sm:py-2.5">
              <span className={`text-base font-semibold sm:text-sm ${v ? "" : "text-fg-soft"}`}>{name}</span>
              <label className="flex min-h-11 items-center justify-end gap-2 text-sm text-fg-soft sm:order-last sm:justify-start">
                <input type="checkbox" checked={!v} onChange={(e) => set({ [d]: e.target.checked ? null : { ...DEFAULT_DAY } })} className="size-5 accent-brand" />
                <span className="sm:sr-only">{t("hours.closed")}</span>
                <span className="sr-only">: {name}</span>
              </label>
              <input type="time" aria-label={`${name}: ${t("hours.open")}`} value={v?.open ?? ""} disabled={!v} onChange={(e) => set({ [d]: { open: e.target.value, close: v?.close ?? DEFAULT_DAY.close } })} className={TIME} />
              <input type="time" aria-label={`${name}: ${t("hours.close")}`} value={v?.close ?? ""} disabled={!v} onChange={(e) => set({ [d]: { open: v?.open ?? DEFAULT_DAY.open, close: e.target.value } })} className={TIME} />
            </li>
          );
        })}
      </ul>
      <div><Button onClick={() => { const mon = draft.hours.mon ? { ...draft.hours.mon } : null; set({ tue: mon && { ...mon }, wed: mon && { ...mon }, thu: mon && { ...mon }, fri: mon && { ...mon } }); }}>{t("hours.copyMon")}</Button></div>
    </div>
  );
}
