"use client";
import Image from "next/image";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MediaLookup } from "./bits";

/** Gallery photos on the 12-column grid (3 across on a laptop, 2 on a phone), square corners; nothing when empty. */
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
    <section aria-labelledby="gallery" className="kv-wrap kv-gallery">
      <h2 id="gallery" className="kv-sr">{t("site.gallery")}</h2>
      <ul className="kv-gallery-grid">
        {photos.map((p, n) => (
          <li key={p.id} className="kv-photo kv-gallery-photo">
            <Image src={p.src} alt={t("site.galleryPhoto", { name: state.venue.name, n: n + 1 })} fill sizes="(min-width: 900px) 400px, 50vw" className="kv-cover" />
          </li>
        ))}
      </ul>
    </section>
  );
}
