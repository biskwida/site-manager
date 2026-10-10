"use client";
import { useState } from "react";
import { allergenName } from "@/src/domain/allergens";
import { formatPrice } from "@/src/domain/format";
import type { ExtractResult } from "@/src/wizard/extract";
import { Button, PriceField, TextField } from "../Field";
import { useT } from "../useWizardText";

type Row = ExtractResult["categories"][number]["items"][number] & { on: boolean };
type Cat = { name_bg: string; name_en: string; items: Row[] };

/** The extraction as an editable checklist. Accept returns only the ticked rows, with edits applied. */
export function ExtractReview({ result, onAccept, onDiscard }: { result: ExtractResult; onAccept: (r: ExtractResult) => void; onDiscard: () => void }) {
  const { t, lang } = useT();
  const [cats, setCats] = useState<Cat[]>(() => result.categories.map((c) => ({ name_bg: c.name_bg, name_en: c.name_en, items: c.items.map((i) => ({ ...i, on: true })) })));
  const selected = cats.reduce((n, c) => n + c.items.filter((i) => i.on).length, 0);
  const total = cats.reduce((n, c) => n + c.items.length, 0);
  const patch = (ci: number, ii: number, p: Partial<Row>) => setCats(cats.map((c, x) => (x === ci ? { ...c, items: c.items.map((i, y) => (y === ii ? { ...i, ...p } : i)) } : c)));
  const accept = (all: boolean) =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onAccept({ notes_bg: result.notes_bg, notes_en: result.notes_en, categories: cats.map((c) => ({ name_bg: c.name_bg, name_en: c.name_en, items: c.items.filter((i) => all || i.on).map(({ on: _on, ...i }) => i) })).filter((c) => c.items.length > 0) });
  const notes = lang === "bg" ? result.notes_bg : result.notes_en;
  const name = (c: { name_bg: string; name_en: string }) => (lang === "bg" ? c.name_bg : c.name_en) || c.name_bg || c.name_en;
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-xl font-semibold leading-tight">{t("extract.title")}</h2>
        <p className="mt-1 max-w-[60ch] text-fg-soft">{t("extract.lead")}</p>
      </div>
      {notes && <p className="rounded-xl bg-note-soft px-4 py-3 text-sm leading-snug text-fg"><span className="font-semibold">{t("extract.notes")}: </span>{notes}</p>}
      {cats.map((c, ci) => (
        <section key={ci} aria-label={name(c)} className="grid gap-2">
          <h3 className="font-semibold">{name(c)}</h3>
          <ul className="grid gap-2">
            {c.items.map((it, ii) => (
              <li key={ii} className={`grid gap-3 rounded-xl bg-panel p-3 ring-1 ring-line transition-opacity duration-150 ${it.on ? "" : "opacity-60"}`}>
                <label className="flex min-h-11 items-center gap-3 font-semibold">
                  <input type="checkbox" checked={it.on} onChange={(e) => patch(ci, ii, { on: e.target.checked })} className="size-5 accent-brand" />
                  <span>{t("extract.include")}: {name(it)} · {formatPrice(it.price_eur, lang)}</span>
                </label>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6.5rem]">
                  <TextField label={t("menu.item.nameBg")} value={it.name_bg} onChange={(name_bg) => patch(ci, ii, { name_bg })} />
                  <TextField label={t("menu.item.nameEn")} value={it.name_en} onChange={(name_en) => patch(ci, ii, { name_en })} />
                  <PriceField label={t("menu.item.price")} value={it.price_eur} onChange={(price_eur) => patch(ci, ii, { price_eur })} />
                </div>
                {(it.currency_seen === "BGN" || it.allergens.length > 0) && (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-fg-soft">
                    {it.currency_seen === "BGN" && <span className="rounded-full bg-note-soft px-2 py-0.5 font-semibold text-note">{t("extract.bgn")}</span>}
                    {it.allergens.length > 0 && <span>{t("menu.item.allergens")}: {it.allergens.map((a) => `${a} ${allergenName(a, lang)}`).join(", ")}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        {/* Once something is unticked, "Add selected" is what the owner means, so it becomes the primary action. */}
        <Button variant={selected < total ? "secondary" : "primary"} onClick={() => accept(true)}>{t("extract.acceptAll")}</Button>
        <Button variant={selected < total ? "primary" : "secondary"} disabled={selected === 0} onClick={() => accept(false)}>{t("extract.acceptSelected", { n: selected })}</Button>
        <Button variant="quiet" onClick={onDiscard}>{t("extract.discard")}</Button>
      </div>
    </div>
  );
}
