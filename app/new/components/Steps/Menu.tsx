"use client";
import { useState } from "react";
import { ALLERGENS, allergenName } from "@/src/domain/allergens";
import { blankCategory, blankItem, mergeExtracted, moveIndex } from "@/src/wizard/edit";
import { EXTRACT_MAX_FILES, IMAGE_MEDIA_TYPES, type ExtractFile, type ExtractResult } from "@/src/wizard/extract";
import type { WizardCategory, WizardItem } from "@/src/wizard/schema";
import { aiUnavailable, api, EXTRACT_MAX_TOTAL_BYTES, fileToBase64 } from "../api";
import { Button, FileButton, Note, PriceField, Status, TextField } from "../Field";
import { shrinkImage } from "../image";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";
import { ExtractReview } from "./ExtractReview";

const MB = 1024 * 1024;
const TAB = "min-h-11 rounded-full px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150 ease-out";
const ROW = "grid gap-4 rounded-xl bg-panel p-4 ring-1 ring-line";
const ARROW = "min-w-11 px-0 text-base";

/** Images shrink to 1600 px / JPEG 0.8 before encoding; PDFs go as-is. Null when the batch cannot fit the extraction budget. */
export async function prepareExtractFiles(files: File[]): Promise<{ files: ExtractFile[] } | { error: "pdfTooBig" | "tooBig" }> {
  const blobs: { type: ExtractFile["media_type"]; blob: Blob }[] = [];
  for (const f of files) {
    if (f.type === "application/pdf") {
      if (f.size > EXTRACT_MAX_TOTAL_BYTES) return { error: "pdfTooBig" };
      blobs.push({ type: "application/pdf", blob: f });
    } else {
      const perFile = Math.floor(EXTRACT_MAX_TOTAL_BYTES / files.length);
      const shrunk = await shrinkImage(f, { maxEdge: 1600, quality: 0.8, maxBytes: perFile });
      if (!shrunk) return { error: "tooBig" };
      blobs.push({ type: shrunk.type as ExtractFile["media_type"], blob: shrunk });
    }
  }
  if (blobs.reduce((n, b) => n + b.blob.size, 0) > EXTRACT_MAX_TOTAL_BYTES) return { error: "tooBig" };
  const out: ExtractFile[] = [];
  for (const b of blobs) out.push({ media_type: b.type, data: await fileToBase64(b.blob) });
  return { files: out };
}

export function Menu({ id, draft, update, aiAvailable }: StepProps) {
  const { t, lang } = useT();
  const cats = draft.categories;
  const [activeKey, setActiveKey] = useState<string | null>(cats[0]?.key ?? null);
  const [askRemove, setAskRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(!aiAvailable);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [review, setReview] = useState<ExtractResult | null>(null);
  const active = cats.find((c) => c.key === activeKey) ?? cats[0] ?? null;
  const setCats = (categories: WizardCategory[]) => update({ categories });
  const patchCat = (key: string, patch: Partial<WizardCategory>) => setCats(cats.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const patchItem = (ckey: string, ikey: string, patch: Partial<WizardItem>) => setCats(cats.map((c) => (c.key === ckey ? { ...c, items: c.items.map((i) => (i.key === ikey ? { ...i, ...patch } : i)) } : c)));
  const catName = (c: WizardCategory, i: number) => (lang === "bg" ? c.name_bg : c.name_en) || c.name_bg || c.name_en || t("menu.category.nth", { n: i + 1 });
  const itemName = (it: WizardItem, i: number) => (lang === "bg" ? it.name_bg : it.name_en) || it.name_bg || it.name_en || t("menu.item.nth", { n: i + 1 });

  async function onFiles(files: File[]) {
    setUploadError(null);
    const okTypes: string[] = [...IMAGE_MEDIA_TYPES, "application/pdf"];
    if (files.some((f) => !okTypes.includes(f.type))) { setUploadError(t("menu.upload.badFile")); return; }
    if (files.length > EXTRACT_MAX_FILES) { setUploadError(t("menu.upload.tooMany", { n: EXTRACT_MAX_FILES })); return; }
    setBusy(true);
    const prepared = await prepareExtractFiles(files);
    if ("error" in prepared) { setUploadError(t(prepared.error === "pdfTooBig" ? "menu.upload.pdfTooBig" : "menu.upload.tooBig", { mb: EXTRACT_MAX_TOTAL_BYTES / MB })); setBusy(false); return; }
    const r = await api.extract(id, prepared.files);
    setBusy(false);
    if (!r.ok) {
      if (aiUnavailable(r)) { setUnavailable(true); return; }
      setUploadError(r.status === 429 || r.status === 400 ? (lang === "bg" ? r.error.bg : r.error.en) : t("menu.upload.failed"));
      return;
    }
    if (r.data.categories.every((c) => c.items.length === 0)) { setUploadError(t("extract.empty")); return; }
    setReview(r.data);
  }

  if (review) {
    return <ExtractReview result={review} onDiscard={() => setReview(null)} onAccept={(r) => { const merged = mergeExtracted(cats, r); setCats(merged); setActiveKey(merged[0]?.key ?? null); setReview(null); }} />;
  }

  const ci = active ? cats.indexOf(active) : -1;
  return (
    <div className="grid gap-8">
      <section aria-labelledby="menu-cats" className="grid gap-3">
        <h2 id="menu-cats" className="text-sm font-semibold">{t("menu.categories")}</h2>
        <div role="tablist" aria-label={t("menu.categories")} className="flex flex-wrap gap-2">
          {cats.map((c, i) => (
            <button key={c.key} role="tab" type="button" aria-selected={active?.key === c.key} onClick={() => { setActiveKey(c.key); setAskRemove(false); }}
              className={`${TAB} ${active?.key === c.key ? "bg-fg text-canvas" : "bg-panel text-fg ring-1 ring-line-strong hover:bg-sunken"}`}>
              {catName(c, i)}
            </button>
          ))}
          <Button variant="quiet" onClick={() => { const c = blankCategory(); setCats([...cats, c]); setActiveKey(c.key); }}>+ {t("menu.addCategory")}</Button>
        </div>
        {active && (
          <div role="tabpanel" className={ROW}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={t("menu.category.nameBg")} value={active.name_bg} maxLength={80} onChange={(name_bg) => patchCat(active.key, { name_bg })} />
              <TextField label={t("menu.category.nameEn")} value={active.name_en} maxLength={80} onChange={(name_en) => patchCat(active.key, { name_en })} />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="quiet" className={ARROW} disabled={ci <= 0} title={t("menu.moveUp")} aria-label={`${t("menu.moveUp")}: ${catName(active, ci)}`} onClick={() => setCats(moveIndex(cats, ci, ci - 1))}><span aria-hidden="true">↑</span></Button>
              <Button variant="quiet" className={ARROW} disabled={ci >= cats.length - 1} title={t("menu.moveDown")} aria-label={`${t("menu.moveDown")}: ${catName(active, ci)}`} onClick={() => setCats(moveIndex(cats, ci, ci + 1))}><span aria-hidden="true">↓</span></Button>
              {!askRemove ? (
                <Button variant="quiet" onClick={() => (active.items.length ? setAskRemove(true) : setCats(cats.filter((c) => c.key !== active.key)))}>{t("menu.removeCategory")}</Button>
              ) : (
                <span role="group" aria-label={t("menu.removeCategoryAsk", { n: active.items.length })} className="inline-flex flex-wrap items-center gap-2 text-sm">
                  <span aria-live="polite" className="font-semibold">{t("menu.removeCategoryAsk", { n: active.items.length })}</span>
                  <Button variant="primary" autoFocus onClick={() => { setCats(cats.filter((c) => c.key !== active.key)); setAskRemove(false); setActiveKey(null); }}>{t("menu.yes")}</Button>
                  <Button onClick={() => setAskRemove(false)}>{t("menu.no")}</Button>
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="menu-items" className="grid gap-3">
        <h2 id="menu-items" className="text-sm font-semibold">{t("menu.items")}</h2>
        {!active && <p className="text-fg-soft">{t("menu.noCategory")}</p>}
        {active && active.items.length === 0 && <p className="text-fg-soft">{t("menu.empty")}</p>}
        {active && (
          <ol className="grid gap-3">
            {active.items.map((it, ii) => (
              <li key={it.key} className={ROW}>
                <div className="grid gap-4 sm:grid-cols-[1fr_1fr_6.5rem]">
                  <TextField label={t("menu.item.nameBg")} value={it.name_bg} maxLength={120} onChange={(name_bg) => patchItem(active.key, it.key, { name_bg })} />
                  <TextField label={t("menu.item.nameEn")} value={it.name_en} maxLength={120} onChange={(name_en) => patchItem(active.key, it.key, { name_en })} />
                  <PriceField label={t("menu.item.price")} value={it.price_eur} onChange={(price_eur) => patchItem(active.key, it.key, { price_eur })} />
                </div>
                <details className="group">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-fg-soft hover:text-fg [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="inline-block transition-transform duration-150 ease-out group-open:rotate-90">›</span>
                    {t("menu.item.details")}
                    {it.allergens.length > 0 && <span className="font-normal">({it.allergens.join(", ")})</span>}
                  </summary>
                  <div className="mt-2 grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField label={t("menu.item.descBg")} value={it.desc_bg} maxLength={400} onChange={(desc_bg) => patchItem(active.key, it.key, { desc_bg })} />
                      <TextField label={t("menu.item.descEn")} value={it.desc_en} maxLength={400} onChange={(desc_en) => patchItem(active.key, it.key, { desc_en })} />
                    </div>
                    <fieldset>
                      <legend className="text-sm font-semibold">{t("menu.item.allergens")}</legend>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ALLERGENS.map((a) => {
                          const on = it.allergens.includes(a.code);
                          return (
                            <button key={a.code} type="button" aria-pressed={on} onClick={() => patchItem(active.key, it.key, { allergens: on ? it.allergens.filter((c) => c !== a.code) : [...it.allergens, a.code].sort((x, y) => x - y) })}
                              className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-[background-color,color] duration-150 ease-out ${on ? "bg-fg text-canvas" : "bg-sunken text-fg hover:bg-line/60"}`}>
                              {a.code} {allergenName(a.code, lang)}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  </div>
                </details>
                <div className="-mb-1 flex items-center gap-1 border-t border-line pt-3">
                  <Button variant="quiet" className={ARROW} disabled={ii === 0} title={t("menu.moveUp")} aria-label={`${t("menu.moveUp")}: ${itemName(it, ii)}`} onClick={() => patchCat(active.key, { items: moveIndex(active.items, ii, ii - 1) })}><span aria-hidden="true">↑</span></Button>
                  <Button variant="quiet" className={ARROW} disabled={ii === active.items.length - 1} title={t("menu.moveDown")} aria-label={`${t("menu.moveDown")}: ${itemName(it, ii)}`} onClick={() => patchCat(active.key, { items: moveIndex(active.items, ii, ii + 1) })}><span aria-hidden="true">↓</span></Button>
                  <Button variant="quiet" className="ml-auto" aria-label={`${t("menu.item.remove")}: ${itemName(it, ii)}`} onClick={() => patchCat(active.key, { items: active.items.filter((x) => x.key !== it.key) })}>{t("menu.item.remove")}</Button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {active && <div><Button onClick={() => patchCat(active.key, { items: [...active.items, blankItem()] })}>+ {t("menu.addItem")}</Button></div>}
      </section>

      <section aria-labelledby="menu-upload" className="grid gap-3 border-t border-line pt-8">
        <h2 id="menu-upload" className="text-lg font-semibold leading-tight">{t("menu.upload.title")}</h2>
        {unavailable ? (
          <Note>{t("menu.upload.unavailable")}</Note>
        ) : (
          <>
            <p className="max-w-[60ch] text-sm leading-snug text-fg-soft">{t("menu.upload.hint", { n: EXTRACT_MAX_FILES })}</p>
            <div><FileButton label={busy ? t("menu.upload.working") : t("menu.upload.choose")} accept="image/*,application/pdf" multiple disabled={busy} onFiles={(f) => void onFiles(f)} /></div>
            <Status tone={uploadError ? "danger" : "soft"}>{busy ? t("menu.upload.working") : uploadError ?? ""}</Status>
          </>
        )}
      </section>
    </div>
  );
}
