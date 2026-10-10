"use client";
import Image from "next/image";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MediaLookup } from "./bits";

/** The gallery as a plain grid of 4:3 photos, three across on a laptop; nothing at all when the gallery is empty. */
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
    <section aria-labelledby="gallery-h" className="me-wrap me-gallery">
      <h2 id="gallery-h" className="me-sr">{t("site.gallery")}</h2>
      <ul className="me-gallery-grid">
        {photos.map((p, n) => (
          <li key={p.id} className="me-gallery-photo">
            <Image src={p.src} alt={t("site.galleryPhoto", { name: state.venue.name, n: n + 1 })} fill sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw" className="me-cover" />
          </li>
        ))}
      </ul>
    </section>
  );
}
