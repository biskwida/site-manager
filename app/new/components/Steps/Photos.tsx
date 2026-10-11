"use client";
import { useState } from "react";
import { moveIndex } from "@/src/wizard/edit";
import { api } from "../api";
import { Button, FileButton, Status } from "../Field";
import { InstagramImport } from "../InstagramImport";
import { MediaThumb } from "../MediaThumb";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";
import { prepareUpload } from "./Look";

export function Photos({ id, draft, media, update, addMedia, flush, igReturn, instagramAvailable }: StepProps) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0);
  const ids = draft.gallery_media_ids;
  async function upload(files: File[]) {
    setBusy(true);
    setFailed(0);
    const added: string[] = [];
    for (const f of files) {
      const file = await prepareUpload(f);
      if (!file) { setFailed((n) => n + 1); continue; }
      const r = await api.upload(id, file);
      if (r.ok) { addMedia(r.data.media, file); added.push(r.data.media.id); } else setFailed((n) => n + 1);
    }
    if (added.length) update({ gallery_media_ids: [...ids, ...added] });
    setBusy(false);
  }
  return (
    <div className="grid gap-4">
      <p className="max-w-[60ch] text-sm leading-snug text-fg-soft">{t("photos.hint")}</p>
      <div><FileButton label={busy ? t("look.uploading") : t("photos.add")} accept="image/*" multiple disabled={busy} onFiles={(f) => void upload(f)} /></div>
      <Status tone={failed ? "danger" : "soft"}>{failed ? t("look.uploadFailed") : busy ? t("look.uploading") : ""}</Status>
      <InstagramImport id={id} draft={draft} update={update} addMedia={addMedia} flush={flush} igReturn={igReturn} instagramAvailable={instagramAvailable} from="photos" />
      {ids.length === 0 && <p className="text-fg-soft">{t("photos.empty")}</p>}
      <ol className="grid gap-3 sm:grid-cols-2" aria-label={t("photos.title")}>
        {ids.map((mid, i) => (
          <li key={mid} className="grid gap-2 rounded-xl bg-panel p-2 ring-1 ring-line">
            <MediaThumb media={media.find((m) => m.id === mid)} alt={t("photos.photo", { n: i + 1 })} className="aspect-[4/3] w-full" />
            <div className="flex items-center gap-0.5">
              <Button variant="quiet" className="min-w-11 px-0 text-base" disabled={i === 0} title={t("menu.moveUp")} aria-label={`${t("menu.moveUp")}: ${t("photos.photo", { n: i + 1 })}`} onClick={() => update({ gallery_media_ids: moveIndex(ids, i, i - 1) })}><span aria-hidden="true">↑</span></Button>
              <Button variant="quiet" className="min-w-11 px-0 text-base" disabled={i === ids.length - 1} title={t("menu.moveDown")} aria-label={`${t("menu.moveDown")}: ${t("photos.photo", { n: i + 1 })}`} onClick={() => update({ gallery_media_ids: moveIndex(ids, i, i + 1) })}><span aria-hidden="true">↓</span></Button>
              <Button variant="quiet" className="ml-auto px-3" aria-label={`${t("photos.remove")}: ${t("photos.photo", { n: i + 1 })}`} onClick={() => update({ gallery_media_ids: ids.filter((x) => x !== mid) })}>{t("photos.remove")}</Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
