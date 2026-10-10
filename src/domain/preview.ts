import { formatDate, formatDateTime, hhmm, localTime } from "../time";
import { allergenName } from "./allergens";
import { categoryName, formatPrice, itemName, quote, tr, weekdayLabel } from "./format";
import { MONO_TEXT_KEYS, WEEKDAYS, type Change, type Item, type Lang, type Row, type SiteState, type TextKey, type WeekHours } from "./types";

const FIELD: Record<string, { bg: string; en: string }> = {
  name_bg: { bg: "име (BG)", en: "name (BG)" },
  name_en: { bg: "име (EN)", en: "name (EN)" },
  desc_bg: { bg: "описание (BG)", en: "description (BG)" },
  desc_en: { bg: "описание (EN)", en: "description (EN)" },
  price_eur: { bg: "цена", en: "price" },
  allergens: { bg: "алергени", en: "allergens" },
  category_id: { bg: "категория", en: "category" },
  position: { bg: "позиция", en: "position" },
};
const TEXT_LABEL: Record<string, { bg: string; en: string }> = {
  welcome: { bg: "Приветствие", en: "Welcome text" },
  footer_note: { bg: "Бележка в долния край", en: "Footer note" },
  tagline: { bg: "Мото", en: "Tagline" },
  about: { bg: "За нас", en: "About" },
  address: { bg: "Адрес", en: "Address" },
  phone: { bg: "Телефон", en: "Phone" },
  maps_url: { bg: "Линк към картата", en: "Map link" },
  instagram: { bg: "Instagram", en: "Instagram" },
};

function allergenLine(codes: number[], lang: Lang): string {
  if (codes.length === 0) return tr(lang, "  Алергени: няма", "  Allergens: none");
  return `  ${tr(lang, "Алергени", "Allergens")}: ${codes.map((c) => `${c} (${allergenName(c, lang)})`).join(", ")}`;
}

function hoursLines(h: WeekHours, lang: Lang): string[] {
  return WEEKDAYS.map((d) => {
    const v = h[d];
    return `  ${weekdayLabel(d, lang)} ${v ? `${hhmm(v.open)}–${hhmm(v.close)}` : tr(lang, "почивен ден", "closed")}`;
  });
}

function fieldValue(key: string, v: unknown, s: SiteState, lang: Lang): string {
  if (v === null || v === undefined) return "—";
  if (key === "price_eur") return formatPrice(Number(v), lang);
  if (key === "allergens") return (v as number[]).join(", ") || tr(lang, "няма", "none");
  if (key === "category_id") {
    const c = s.categories.find((x) => x.id === v);
    return c ? categoryName(c, lang) : String(v);
  }
  return quote(String(v), lang);
}

function holidayAddLine(h: Row, lang: Lang, other: Lang): string {
  return `• ${tr(lang, "Почивен ден", "Holiday")} ${formatDate(String(h.date), lang)}: ${String(h[`note_${lang}`])} / ${String(h[`note_${other}`])}`;
}
function holidayRemoveLine(h: Row, lang: Lang): string {
  return `• ${tr(lang, "Премахва почивния ден", "Removes the holiday on")} ${formatDate(String(h.date), lang)}`;
}
function announcementAddLine(an: Row, lang: Lang, other: Lang, tz: string): string {
  const exp = an.expires_at ? ` (${tr(lang, "до", "until")} ${formatDateTime(String(an.expires_at), lang, tz)})` : "";
  return `• ${tr(lang, "Съобщение", "Announcement")}: ${quote(String(an[`text_${lang}`]), lang)} / ${quote(String(an[`text_${other}`]), other)}${exp}`;
}
function announcementRemoveLine(an: Row, lang: Lang): string {
  return `• ${tr(lang, "Премахва съобщението", "Removes the announcement")} ${quote(String(an[`text_${lang}`]), lang)}`;
}

/**
 * One line (sometimes more) per change, in the reader's language, from the state the changes were planned against.
 * Undo-safe: an inverted set keeps each `op` with `before`/`after` swapped, so an inverted add renders as a removal and vice versa.
 */
export function renderPreview(s: SiteState, changes: Change[], lang: Lang, tz: string): string {
  const other: Lang = lang === "bg" ? "en" : "bg";
  const lines: string[] = [];
  const itemOf = (c: Change): Item => {
    const found = s.items.find((i) => i.id === c.entity_id);
    if (found) return found;
    const row = c.after ?? c.before;
    if (row && "name_bg" in row) return row as unknown as Item;
    throw new Error(`preview: item ${c.entity_id} not found`);
  };
  for (const c of [...changes].sort((a, b) => a.position - b.position)) {
    const b = c.before ?? {};
    const a = c.after ?? {};
    switch (c.op) {
      case "set_price": {
        const it = itemOf(c);
        lines.push(`• ${itemName(it, lang)}: ${formatPrice(Number(b.price_eur), lang)} → ${formatPrice(Number(a.price_eur), lang)}`);
        break;
      }
      case "set_sold_out": {
        const it = itemOf(c);
        const until = a.sold_out_until as string | null;
        lines.push(until
          ? `• ${itemName(it, lang)}: ${tr(lang, "изчерпано до", "sold out until")} ${formatDateTime(until, lang, tz)}`
          : `• ${itemName(it, lang)}: ${tr(lang, "отново в наличност", "back in stock")}`);
        break;
      }
      case "add_item": {
        if (c.after === null) {
          lines.push(`• ${tr(lang, "Премахва", "Removes")} ${itemName(itemOf(c), lang)}`);
          break;
        }
        const it = c.after as unknown as Item;
        const cat = s.categories.find((x) => x.id === it.category_id);
        const names = `${itemName(it, lang)} / ${itemName(it, other)}`;
        const head = it.is_special
          ? `• ${tr(lang, "Специално днес", "Today's special")}${it.special_expires_at ? ` (${tr(lang, "до", "until")} ${localTime(new Date(it.special_expires_at), tz)})` : ""}: ${names} — ${formatPrice(it.price_eur, lang)}`
          : `• ${tr(lang, "Ново в", "New in")} ${quote(cat ? categoryName(cat, lang) : "?", lang)}: ${names} — ${formatPrice(it.price_eur, lang)}`;
        lines.push(head);
        const descs: [Lang, string][] = [[lang, lang === "bg" ? it.desc_bg : it.desc_en], [other, other === "bg" ? it.desc_bg : it.desc_en]];
        for (const [l, d] of descs) if (d) lines.push(`  ${l.toUpperCase()}: ${d}`);
        lines.push(allergenLine(it.allergens, lang));
        break;
      }
      case "update_item": {
        const it = itemOf(c);
        for (const k of Object.keys(a)) {
          const label = FIELD[k]?.[lang] ?? k;
          lines.push(`• ${itemName(it, lang)}: ${label}: ${fieldValue(k, b[k], s, lang)} → ${fieldValue(k, a[k], s, lang)}`);
        }
        break;
      }
      case "remove_item": {
        const it = itemOf(c);
        lines.push(a.active === true
          ? `• ${tr(lang, "Връща", "Restores")} ${itemName(it, lang)}`
          : `• ${tr(lang, "Премахва", "Removes")} ${itemName(it, lang)}`);
        break;
      }
      case "set_item_image": {
        const it = itemOf(c);
        lines.push(a.image_media_id ? `• ${tr(lang, "Нова снимка за", "New photo for")} ${itemName(it, lang)}` : `• ${tr(lang, "Премахва снимката на", "Removes the photo of")} ${itemName(it, lang)}`);
        break;
      }
      case "set_cover_image":
        lines.push(a.cover_media_id ? tr(lang, "• Нова корица", "• New cover photo") : tr(lang, "• Премахва корицата", "• Removes the cover photo"));
        break;
      case "set_logo_image":
        lines.push(a.logo_media_id ? tr(lang, "• Ново лого", "• New logo") : tr(lang, "• Премахва логото", "• Removes the logo"));
        break;
      case "add_gallery_image":
        lines.push(tr(lang, "• Добавя снимка в галерията", "• Adds a photo to the gallery"));
        break;
      case "remove_gallery_image":
        lines.push(tr(lang, "• Премахва снимка от галерията", "• Removes a photo from the gallery"));
        break;
      case "set_hours":
        lines.push(tr(lang, "• Работно време:", "• Opening hours:"), ...hoursLines(a.hours as WeekHours, lang));
        break;
      case "add_holiday":
      case "remove_holiday":
        // before === null is an insert: a planned add, or an inverted remove (undo of a delete).
        lines.push(c.before === null ? holidayAddLine(c.after!, lang, other) : holidayRemoveLine(c.before, lang));
        break;
      case "add_announcement":
      case "remove_announcement":
        lines.push(c.before === null ? announcementAddLine(c.after!, lang, other, tz) : announcementRemoveLine(c.before, lang));
        break;
      case "set_text": {
        const key = c.entity === "site_text" ? c.entity_id : Object.keys(a)[0].replace(/_(bg|en)$/, "");
        const label = TEXT_LABEL[key]?.[lang] ?? key;
        const pick = (row: Record<string, unknown>, l: Lang) => row[`text_${l}`] ?? row[`${key}_${l}`] ?? row[key];
        const bv = pick(b, lang), av = pick(a, lang);
        lines.push(`• ${label}: ${bv === undefined || bv === null ? "—" : quote(String(bv), lang)} → ${quote(String(av ?? ""), lang)}`);
        const bo = pick(b, other), ao = pick(a, other);
        if (ao !== undefined && ao !== null && !MONO_TEXT_KEYS.includes(key as TextKey)) {
          lines.push(`  ${other.toUpperCase()}: ${bo === undefined || bo === null ? "—" : quote(String(bo), other)} → ${quote(String(ao), other)}`);
        }
        break;
      }
      case "set_theme":
        lines.push(`• ${tr(lang, "Цвят на темата", "Accent colour")}: ${(b.theme as { accent: string } | undefined)?.accent ?? "—"} → ${(a.theme as { accent: string }).accent}`);
        break;
    }
  }
  return lines.join("\n");
}
