// src/wizard/preview.ts
import type { Category, Item, Media, SiteState, SiteText, Venue } from "../domain/types";
import { bothLangs, type WizardDraft } from "./schema";

/** The draft rendered as if it were live: ids are prefixed so nothing can be mistaken for a stored row. */
export function buildPreviewState(d: WizardDraft, media: Media[], now: Date): SiteState {
  const iso = now.toISOString();
  const tagline = bothLangs(d.tagline_bg, d.tagline_en);
  const about = bothLangs(d.about_bg, d.about_en);
  const venue: Venue = {
    id: "preview",
    slug: d.slug || "preview",
    name: d.name.trim() || (d.default_lang === "bg" ? "Вашето заведение" : "Your venue"),
    tagline_bg: tagline.bg,
    tagline_en: tagline.en,
    about_bg: about.bg,
    about_en: about.en,
    address: d.address,
    phone: d.phone,
    maps_url: d.maps_url,
    instagram: d.instagram,
    cover_media_id: d.cover_media_id,
    logo_media_id: d.logo_media_id,
    hours: d.hours,
    tz: "Europe/Sofia",
    default_lang: d.default_lang,
    theme: { accent: d.theme.accent },
    created_at: iso,
    template: d.template,
    business_type: d.business_type,
    status: "live",
    deploy: null,
    wizard_draft: null,
  };
  const categories: Category[] = d.categories.map((c, i) => {
    const n = bothLangs(c.name_bg, c.name_en);
    return { id: `prev-cat-${c.key}`, venue_id: "preview", name_bg: n.bg, name_en: n.en, position: i, active: true };
  });
  const items: Item[] = d.categories.flatMap((c) =>
    c.items.map((it, j): Item => {
      const n = bothLangs(it.name_bg, it.name_en);
      return {
        id: `prev-item-${it.key}`,
        venue_id: "preview",
        category_id: `prev-cat-${c.key}`,
        name_bg: n.bg,
        name_en: n.en,
        desc_bg: it.desc_bg,
        desc_en: it.desc_en,
        price_eur: it.price_eur,
        allergens: [...it.allergens].sort((a, b) => a - b),
        image_media_id: it.image_media_id,
        sold_out_until: null,
        is_special: false,
        special_expires_at: null,
        position: j,
        active: true,
        created_at: iso,
        updated_at: iso,
      };
    }),
  );
  const gallery = new Map(d.gallery_media_ids.map((id, i) => [id, i]));
  const mediaRows: Media[] = media.map((m) => ({ ...m, venue_id: "preview", is_gallery: gallery.has(m.id), position: gallery.get(m.id) ?? m.position }));
  const texts: SiteText[] = [];
  for (const key of ["welcome", "footer_note"] as const) {
    const t = d.texts[key];
    if (!t.bg.trim() && !t.en.trim()) continue;
    const b = bothLangs(t.bg, t.en);
    texts.push({ venue_id: "preview", key, text_bg: b.bg, text_en: b.en });
  }
  return { venue, categories, items, holidays: [], announcements: [], media: mediaRows, texts };
}
