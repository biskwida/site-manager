"use client";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { mediaUrl, SiteImage } from "./bits";

export function Gallery({ state }: { state: SiteState }) {
  const { t } = useLang();
  const photos = state.media.filter((m) => m.is_gallery).sort((a, b) => a.position - b.position);
  if (photos.length === 0) return null;
  return (
    <section aria-labelledby="gallery" className="mt-12">
      <h2 id="gallery" className="text-2xl font-semibold">{t("site.gallery")}</h2>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((m, n) => (
          <li key={m.id} className="relative aspect-square overflow-hidden rounded-2xl">
            <SiteImage src={mediaUrl(state, m.id)} alt={t("site.galleryPhoto", { name: state.venue.name, n: n + 1 })} sizes="(min-width: 640px) 240px, 50vw" />
          </li>
        ))}
      </ul>
    </section>
  );
}
