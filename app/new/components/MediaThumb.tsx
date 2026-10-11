"use client";
import type { Media } from "@/src/domain/types";
import { useT } from "./useWizardText";

export function thumbUrl(m: Media | undefined): string | null {
  if (!m) return null;
  return /^(https?:|blob:|data:)/.test(m.public_url) ? m.public_url : null;
}

/** A thumbnail or a neutral tile when the URL cannot be shown (memory:// in offline mode). Plain <img>: blob and memory URLs are not next/image material. */
export function MediaThumb({ media, alt, className = "" }: { media: Media | undefined; alt: string; className?: string }) {
  const { t } = useT();
  const src = thumbUrl(media);
  return (
    <div className={`relative overflow-hidden rounded-xl bg-sunken ring-1 ring-line ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs leading-snug text-fg-soft">{media ? t("photos.noPreview") : t("look.none")}</span>
      )}
    </div>
  );
}
