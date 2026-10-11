"use client";
import { useState, type ReactNode } from "react";
import { TEMPLATE_IDS, type Media, type TemplateId } from "@/src/domain/types";
import { LOOK_ACCENT_PRESETS, TEMPLATE_ACCENT_DEFAULTS } from "@/src/wizard/schema";
import { api, WIZARD_MAX_IMAGE_BYTES } from "../api";
import { fieldError } from "../errors";
import { Button, Fieldset, FileButton, Status, TextField } from "../Field";
import { InstagramImport } from "../InstagramImport";
import { shrinkImage } from "../image";
import { MediaThumb } from "../MediaThumb";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

const HEX = /^#[0-9a-fA-F]{6}$/;
const SWATCH = "inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full bg-panel py-1 pl-1.5 pr-3.5 text-sm text-fg ring-1 ring-line transition-[box-shadow,background-color] duration-150 ease-out hover:bg-sunken has-[:checked]:ring-2 has-[:checked]:ring-fg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand";

/** Phone photos are 8–12 MB; everything is downscaled before the upload so the owner never sees a size error for a normal picture. */
export async function prepareUpload(file: File): Promise<File | null> {
  return shrinkImage(file, { maxEdge: 2000, quality: 0.85, maxBytes: WIZARD_MAX_IMAGE_BYTES });
}

function ImageSlot({ id, label, hint, mediaId, media, onChange, addMedia, wide, children }: { id: string; label: string; hint?: string; mediaId: string | null; media: Media[]; onChange: (id: string | null) => void; addMedia: StepProps["addMedia"]; wide?: boolean; children?: ReactNode }) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = media.find((m) => m.id === mediaId);
  async function upload(files: File[]) {
    setBusy(true);
    setError(null);
    const file = await prepareUpload(files[0]);
    if (!file) { setError(t("look.tooBig")); setBusy(false); return; }
    const r = await api.upload(id, file);
    if (r.ok) { addMedia(r.data.media, file); onChange(r.data.media.id); } else setError(r.status === 400 ? (lang === "bg" ? r.error.bg : r.error.en) : t("look.uploadFailed"));
    setBusy(false);
  }
  return (
    <Fieldset legend={label} hint={hint}>
      <div className="flex items-center gap-4">
        <MediaThumb media={current} alt={label} className={wide ? "h-24 w-40 shrink-0" : "size-24 shrink-0"} />
        <div className="flex flex-wrap gap-2">
          <FileButton label={busy ? t("look.uploading") : current ? t("look.replace") : t("look.upload")} accept="image/*" disabled={busy} onFiles={(f) => void upload(f)} />
          {current && <Button variant="quiet" onClick={() => onChange(null)}>{t("look.remove")}</Button>}
        </div>
      </div>
      <Status tone={error ? "danger" : "soft"}>{error ?? (busy ? t("look.uploading") : "")}</Status>
      {children}
    </Fieldset>
  );
}

export function Look({ id, draft, media, update, addMedia, fieldErrors, flush, igReturn, onIgConsumed, instagramAvailable }: StepProps) {
  const { t, lang } = useT();
  const templateDefault = TEMPLATE_ACCENT_DEFAULTS[draft.template];
  const options = [templateDefault, ...LOOK_ACCENT_PRESETS.filter((p) => p !== templateDefault)];
  const custom = !options.includes(draft.theme.accent.toLowerCase());
  const [hex, setHex] = useState(draft.theme.accent);
  // Switching designs keeps everything; an accent still on the old design's default follows the new design's default.
  function chooseTemplate(next: TemplateId) {
    if (next === draft.template) return;
    const followDefault = draft.theme.accent.toLowerCase() === templateDefault;
    if (followDefault) setHex(TEMPLATE_ACCENT_DEFAULTS[next]);
    update({ template: next, ...(followDefault ? { theme: { accent: TEMPLATE_ACCENT_DEFAULTS[next] } } : {}) });
  }
  return (
    <div className="grid gap-8">
      <Fieldset legend={t("look.template")} hint={t("look.templateHint")}>
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_IDS.map((id) => (
            <label key={id} className={SWATCH}>
              <input type="radio" name="template" value={id} checked={draft.template === id} onChange={() => chooseTemplate(id)} className="sr-only" />
              <span aria-hidden="true" className="size-7 rounded-full ring-1 ring-fg/10" style={{ background: TEMPLATE_ACCENT_DEFAULTS[id] }} />
              <span>{t(`chooser.template.${id}`)}</span>
            </label>
          ))}
        </div>
      </Fieldset>
      <Fieldset legend={t("look.accent")}>
        <div className="flex flex-wrap gap-2">
          {options.map((c, i) => (
            <label key={c} className={SWATCH}>
              <input type="radio" name="accent" value={c} checked={draft.theme.accent.toLowerCase() === c} onChange={() => { setHex(c); update({ theme: { accent: c } }); }} className="sr-only" />
              <span aria-hidden="true" className="size-7 rounded-full ring-1 ring-fg/10" style={{ background: c }} />
              <span>{i === 0 ? t("look.accentDefault") : c}</span>
            </label>
          ))}
          <label className={SWATCH}>
            <input type="radio" name="accent" value="custom" checked={custom} readOnly className="sr-only" />
            <input type="color" aria-label={t("look.accentCustom")} value={HEX.test(hex) ? hex : "#000000"} onChange={(e) => { setHex(e.target.value); update({ theme: { accent: e.target.value } }); }} className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0" />
            <span>{t("look.accentCustom")}</span>
          </label>
        </div>
        <TextField label={t("look.accentHex")} value={hex} error={fieldError(fieldErrors, "theme.accent", lang)} maxLength={7} spellCheck={false} autoCapitalize="none" className="max-w-[12rem]" onChange={(v) => { setHex(v); if (HEX.test(v)) update({ theme: { accent: v } }); }} />
      </Fieldset>
      <div className="grid gap-8 border-t border-line pt-8">
        <ImageSlot id={id} label={t("look.logo")} mediaId={draft.logo_media_id} media={media} addMedia={addMedia} onChange={(logo_media_id) => update({ logo_media_id })} />
        <ImageSlot id={id} label={t("look.cover")} hint={t("look.coverHint")} mediaId={draft.cover_media_id} media={media} addMedia={addMedia} onChange={(cover_media_id) => update({ cover_media_id })} wide>
          <InstagramImport id={id} draft={draft} update={update} addMedia={addMedia} flush={flush} igReturn={igReturn} onIgConsumed={onIgConsumed} instagramAvailable={instagramAvailable} from="look" />
        </ImageSlot>
      </div>
    </div>
  );
}
