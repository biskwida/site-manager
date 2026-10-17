import { formatDate, formatDateTime, hhmm, localTime } from "../time";
import { allergenName } from "./allergens";
import { colorName, inkFor, INK_LIGHT } from "./color";
import { commentModeLabel, commentPreviewLines } from "./comment-preview";
import { categoryName, formatPrice, itemName, keep, quote, tr, weekdayLabel } from "./format";
import { socialPreviewLines } from "./social-preview";
import { wpPreviewLines } from "./wp-preview";
import { MONO_TEXT_KEYS, WEEKDAYS, type Change, type Item, type Lang, type Row, type SiteState, type TextKey, type Theme, type WeekHours } from "./types";

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

/** "#1f3d2b (тъмнозелено)"; with `ink`, also which text the site puts on it: "#1f3d2b (dark green, light text)". */
function colourLabel(hex: string, lang: Lang, ink = false): string {
  const name = colorName(hex, lang);
  const text = ink ? (inkFor(hex) === INK_LIGHT ? tr(lang, "светъл текст", "light text") : tr(lang, "тъмен текст", "dark text")) : "";
  const parts = [name, text].filter(Boolean);
  return parts.length ? `${hex} (${parts.join(", ")})` : hex;
}

/** Lines for a set_theme change: one per colour that differs (the accent line alone when nothing does). */
function themeLines(b: Row, a: Row, lang: Lang): string[] {
  const before = (b.theme ?? {}) as Theme;
  const after = (a.theme ?? {}) as Theme;
  const bgBefore = before.background ?? null;
  const bgAfter = after.background ?? null;
  const lines: string[] = [];
  const accentLine = () => `• ${tr(lang, "Акцентен цвят", "Accent colour")}: ${before.accent ?? "—"} → ${colourLabel(after.accent, lang)}`;
  if (after.accent !== before.accent) lines.push(accentLine());
  if (bgAfter !== bgBefore) {
    const byDefault = tr(lang, "по подразбиране", "design default");
    lines.push(`• ${tr(lang, "Фон", "Background")}: ${bgBefore ?? byDefault} → ${bgAfter === null ? byDefault : colourLabel(bgAfter, lang, true)}`);
  }
  return lines.length ? lines : [accentLine()];
}

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
    return c ? keep(categoryName(c, lang)) : String(v);
  }
  return quote(keep(String(v)), lang);
}

function holidayAddLine(h: Row, lang: Lang): string {
  return `• ${tr(lang, "Почивен ден", "Holiday")} ${formatDate(String(h.date), lang)}: ${keep(String(h[`note_${lang}`]))}`;
}
function holidayRemoveLine(h: Row, lang: Lang): string {
  return `• ${tr(lang, "Премахва почивния ден", "Removes the holiday on")} ${formatDate(String(h.date), lang)}`;
}
function announcementAddLine(an: Row, lang: Lang, tz: string): string {
  const exp = an.expires_at ? ` (${tr(lang, "до", "until")} ${formatDateTime(String(an.expires_at), lang, tz)})` : "";
  return `• ${tr(lang, "Съобщение", "Announcement")}: ${quote(keep(String(an[`text_${lang}`])), lang)}${exp}`;
}
function announcementRemoveLine(an: Row, lang: Lang): string {
  return `• ${tr(lang, "Премахва съобщението", "Removes the announcement")} ${quote(keep(String(an[`text_${lang}`])), lang)}`;
}

/**
 * One line (sometimes more) per change, in the reader's language only, from the state the changes were planned against. The website
 * stores both languages and the agent writes the other one itself, but the chat speaks one: a change that writes both site languages
 * shows the reader's version, and one note at the end of the set says the other was written (a field an edit names in the other
 * language alone is shown, the owner asked for it). `restore` is for an inverted set (an undo): it puts back what was there and
 * writes nothing new, so it gets no note.
 * Undo-safe: an inverted set keeps each `op` with `before`/`after` swapped, so an inverted add renders as a removal and vice versa.
 */
export function renderPreview(s: SiteState, changes: Change[], lang: Lang, tz: string, opts: { restore?: boolean } = {}): string {
  const other: Lang = lang === "bg" ? "en" : "bg";
  const lines: string[] = [];
  // Set by the first change that writes both site languages; the note is added once, last.
  let bothLanguages = false;
  // A dish name stays as written in any language (keep markers: src/bot/translate.ts); the site's own texts below are kept too.
  const name = (i: Item) => keep(itemName(i, lang));
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
        lines.push(`• ${name(it)}: ${formatPrice(Number(b.price_eur), lang)} → ${formatPrice(Number(a.price_eur), lang)}`);
        break;
      }
      case "set_sold_out": {
        const it = itemOf(c);
        const until = a.sold_out_until as string | null;
        lines.push(until
          ? `• ${name(it)}: ${tr(lang, "изчерпано до", "sold out until")} ${formatDateTime(until, lang, tz)}`
          : `• ${name(it)}: ${tr(lang, "отново в наличност", "back in stock")}`);
        break;
      }
      case "add_item": {
        if (c.after === null) {
          lines.push(`• ${tr(lang, "Премахва", "Removes")} ${name(itemOf(c))}`);
          break;
        }
        const it = c.after as unknown as Item;
        const cat = s.categories.find((x) => x.id === it.category_id);
        bothLanguages = true; // a new dish always has both names (planChange requires them)
        const head = it.is_special
          ? `• ${tr(lang, "Специално днес", "Today's special")}${it.special_expires_at ? ` (${tr(lang, "до", "until")} ${localTime(new Date(it.special_expires_at), tz)})` : ""}: ${name(it)} — ${formatPrice(it.price_eur, lang)}`
          : `• ${tr(lang, "Ново в", "New in")} ${quote(cat ? keep(categoryName(cat, lang)) : "?", lang)}: ${name(it)} — ${formatPrice(it.price_eur, lang)}`;
        lines.push(head);
        const desc = lang === "bg" ? it.desc_bg : it.desc_en;
        if (desc) lines.push(`  ${lang.toUpperCase()}: ${keep(desc)}`);
        lines.push(allergenLine(it.allergens, lang));
        break;
      }
      case "update_item": {
        const it = itemOf(c);
        for (const k of Object.keys(a)) {
          // A field set in both languages (name_bg and name_en): the reader's line is shown, the other is the note's business.
          const twin = k.replace(/_(bg|en)$/, (_, l: Lang) => `_${l === "bg" ? "en" : "bg"}`);
          if (twin !== k && twin in a) {
            bothLanguages = true;
            if (k.endsWith(`_${other}`)) continue;
          }
          const label = FIELD[k]?.[lang] ?? k;
          lines.push(`• ${name(it)}: ${label}: ${fieldValue(k, b[k], s, lang)} → ${fieldValue(k, a[k], s, lang)}`);
        }
        break;
      }
      case "remove_item": {
        const it = itemOf(c);
        lines.push(a.active === true
          ? `• ${tr(lang, "Връща", "Restores")} ${name(it)}`
          : `• ${tr(lang, "Премахва", "Removes")} ${name(it)}`);
        break;
      }
      case "set_item_image": {
        const it = itemOf(c);
        lines.push(a.image_media_id ? `• ${tr(lang, "Нова снимка за", "New photo for")} ${name(it)}` : `• ${tr(lang, "Премахва снимката на", "Removes the photo of")} ${name(it)}`);
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
        lines.push(c.before === null ? holidayAddLine(c.after!, lang) : holidayRemoveLine(c.before, lang));
        if (c.before === null) bothLanguages = true;
        break;
      case "add_announcement":
      case "remove_announcement":
        lines.push(c.before === null ? announcementAddLine(c.after!, lang, tz) : announcementRemoveLine(c.before, lang));
        if (c.before === null) bothLanguages = true;
        break;
      case "set_text": {
        const key = c.entity === "site_text" ? c.entity_id : Object.keys(a)[0].replace(/_(bg|en)$/, "");
        const label = TEXT_LABEL[key]?.[lang] ?? key;
        const pick = (row: Record<string, unknown>, l: Lang) => row[`text_${l}`] ?? row[`${key}_${l}`] ?? row[key];
        const bv = pick(b, lang), av = pick(a, lang);
        lines.push(`• ${label}: ${bv === undefined || bv === null ? "—" : quote(keep(String(bv)), lang)} → ${quote(keep(String(av ?? "")), lang)}`);
        // A text with two versions writes both; one value for both languages (an address, a phone number) has no other version.
        const ao = pick(a, other);
        if (ao !== undefined && ao !== null && !MONO_TEXT_KEYS.includes(key as TextKey)) bothLanguages = true;
        break;
      }
      case "set_theme":
        lines.push(...themeLines(b, a, lang));
        break;
      case "wp_edit_page":
      case "wp_upload_photo":
      case "wp_set_option":
      case "wp_edit_menu":
      case "wp_edit_product":
        lines.push(...wpPreviewLines(c, lang));
        break;
      case "social_post":
        lines.push(...socialPreviewLines(c, lang));
        break;
      case "social_reply":
      case "social_moderate":
        lines.push(...commentPreviewLines(c, lang));
        break;
      case "set_comment_mode": {
        const label = (row: Row) => commentModeLabel(row.comment_mode, row.comment_digest_hour, lang);
        lines.push(`• ${tr(lang, "Известия за коментари", "Comment notifications")}: ${label(b)} → ${label(a)}`);
        break;
      }
    }
  }
  if (bothLanguages && !opts.restore) lines.push(tr(lang, "(английският вариант за сайта е написан автоматично)", "(the Bulgarian version for the site was written automatically)"));
  return lines.join("\n");
}
