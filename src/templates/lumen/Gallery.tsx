"use client";
import Image from "next/image";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MediaLookup } from "./bits";

/** Photo strip right under the status line: 3:4 photos that snap; nothing at all when the gallery is empty. */
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
    <section aria-labelledby="gallery" className="l-section mt-8">
      <h2 id="gallery" className="l-sr">{t("site.gallery")}</h2>
      <ul className="l-strip">
        {photos.map((p, n) => (
          <li key={p.id} className="l-photo l-gallery-photo">
            <Image src={p.src} alt={t("site.galleryPhoto", { name: state.venue.name, n: n + 1 })} fill sizes="(min-width: 640px) 320px, 64vw" className="l-cover" />
          </li>
        ))}
      </ul>
    </section>
  );
}
