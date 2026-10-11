"use client";
import Image from "next/image";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MediaLookup } from "./bits";

/** Gallery photos as a row that snaps sideways; nothing at all when the gallery is empty. */
export function Gallery({ state, media }: { state: SiteState; media: MediaLookup }) {
  const { t } = useLang();
  const photos = state.media
    .filter((m) => m.is_gallery)
    .sort((a, b) => a.position - b.position)
    .flatMap((m) => {
      const src = media(m.id);
      return src ? [{ id: m.id, src }] : [];
    });
  if (photos.length === 0) return null;
  return (
    <section aria-labelledby="gallery" className="fu-wrap fu-gallery">
      <h2 id="gallery" className="fu-sr">{t("site.gallery")}</h2>
      <ul className="fu-strip">
        {photos.map((p, n) => (
          <li key={p.id} className="fu-gallery-photo">
            <Image src={p.src} alt={t("site.galleryPhoto", { name: state.venue.name, n: n + 1 })} fill sizes="(min-width: 640px) 300px, 70vw" className="fu-cover" />
          </li>
        ))}
      </ul>
    </section>
  );
}
