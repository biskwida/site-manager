"use client";
import { useEffect, useRef, useState } from "react";
import { aiUnavailable, api } from "../api";
import { fieldError } from "../errors";
import { Button, Note, Status, TextArea, TextField } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

export function Texts({ id, draft, update, aiAvailable, fieldErrors }: StepProps) {
  const { t, lang } = useT();
  const [facts, setFacts] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(!aiAvailable);
  const [error, setError] = useState<string | null>(null);
  const [askOverwrite, setAskOverwrite] = useState(false);
  // When the confirm group closes (Yes or No), focus would fall to <body>; put it back on the "Write for me" button.
  const wasAsking = useRef(false);
  useEffect(() => {
    if (wasAsking.current && !askOverwrite) document.getElementById(`texts-write-${id}`)?.focus();
    wasAsking.current = askOverwrite;
  }, [askOverwrite, id]);
  const hasText = [draft.tagline_bg, draft.tagline_en, draft.about_bg, draft.about_en, draft.texts.welcome.bg, draft.texts.welcome.en, draft.texts.footer_note.bg, draft.texts.footer_note.en].some((v) => v.trim() !== "");
  async function write() {
    setAskOverwrite(false);
    setBusy(true);
    setError(null);
    const r = await api.texts(id, facts);
    setBusy(false);
    if (!r.ok) {
      if (aiUnavailable(r)) { setUnavailable(true); return; }
      setError(r.status === 429 || r.status === 400 ? (lang === "bg" ? r.error.bg : r.error.en) : t("texts.writeFailed"));
      return;
    }
    const d = r.data;
    update({ tagline_bg: d.tagline_bg, tagline_en: d.tagline_en, about_bg: d.about_bg, about_en: d.about_en, texts: { welcome: { bg: d.welcome_bg, en: d.welcome_en }, footer_note: { bg: d.footer_note_bg, en: d.footer_note_en } } });
  }
  const setText = (key: "welcome" | "footer_note", l: "bg" | "en", v: string) => update({ texts: { ...draft.texts, [key]: { ...draft.texts[key], [l]: v } } });
  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        {unavailable ? (
          <Note>{t("texts.unavailable")}</Note>
        ) : (
          <>
            <TextArea label={t("texts.facts")} hint={t("texts.factsHint")} value={facts} rows={4} maxLength={2000} onChange={setFacts} />
            {!askOverwrite ? (
              <div><Button id={`texts-write-${id}`} variant="primary" disabled={busy || facts.trim().length === 0} aria-busy={busy} onClick={() => (hasText ? setAskOverwrite(true) : void write())}>{busy ? t("texts.writing") : t("texts.write")}</Button></div>
            ) : (
              <div role="group" aria-label={t("texts.overwriteAsk")} className="flex flex-wrap items-center gap-2 text-sm">
                <span aria-live="polite" className="font-semibold">{t("texts.overwriteAsk")}</span>
                <Button variant="primary" autoFocus onClick={() => void write()}>{t("texts.overwriteYes")}</Button>
                <Button onClick={() => setAskOverwrite(false)}>{t("menu.no")}</Button>
              </div>
            )}
            <Status tone={error ? "danger" : "soft"}>{busy ? t("texts.writing") : error ?? ""}</Status>
          </>
        )}
      </section>
      <div className="grid gap-5 border-t border-line pt-8">
        <p className="text-sm leading-snug text-fg-soft">{t("texts.bothHint")}</p>
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-4">
          <TextField label={t("texts.tagline.bg")} value={draft.tagline_bg} error={fieldError(fieldErrors, "tagline_bg", lang)} maxLength={160} lang="bg" onChange={(tagline_bg) => update({ tagline_bg })} />
          <TextField label={t("texts.tagline.en")} value={draft.tagline_en} error={fieldError(fieldErrors, "tagline_en", lang)} maxLength={160} lang="en" onChange={(tagline_en) => update({ tagline_en })} />
          <TextArea label={t("texts.about.bg")} value={draft.about_bg} error={fieldError(fieldErrors, "about_bg", lang)} rows={5} maxLength={2000} lang="bg" onChange={(about_bg) => update({ about_bg })} />
          <TextArea label={t("texts.about.en")} value={draft.about_en} error={fieldError(fieldErrors, "about_en", lang)} rows={5} maxLength={2000} lang="en" onChange={(about_en) => update({ about_en })} />
          <TextField label={t("texts.welcome.bg")} value={draft.texts.welcome.bg} error={fieldError(fieldErrors, "texts.welcome.bg", lang)} maxLength={400} lang="bg" onChange={(v) => setText("welcome", "bg", v)} />
          <TextField label={t("texts.welcome.en")} value={draft.texts.welcome.en} error={fieldError(fieldErrors, "texts.welcome.en", lang)} maxLength={400} lang="en" onChange={(v) => setText("welcome", "en", v)} />
          <TextField label={t("texts.footer.bg")} value={draft.texts.footer_note.bg} error={fieldError(fieldErrors, "texts.footer_note.bg", lang)} maxLength={400} lang="bg" onChange={(v) => setText("footer_note", "bg", v)} />
          <TextField label={t("texts.footer.en")} value={draft.texts.footer_note.en} error={fieldError(fieldErrors, "texts.footer_note.en", lang)} maxLength={400} lang="en" onChange={(v) => setText("footer_note", "en", v)} />
        </div>
      </div>
    </div>
  );
}
