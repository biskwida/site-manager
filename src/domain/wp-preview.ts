// src/domain/wp-preview.ts
// Preview lines for WordPress change rows (entities wp_*). Pure; both languages; undo-safe (an inverted
// row keeps the op with before/after swapped, so "after without replacements" reads as a restore).
import { quote, tr } from "./format";
import type { Change, Lang, Row } from "./types";

const OPTION_LABEL: Record<string, { bg: string; en: string }> = {
  blogname: { bg: "Име на сайта", en: "Site title" },
  blogdescription: { bg: "Слоган", en: "Tagline" },
  custom_logo: { bg: "Лого", en: "Logo" },
  site_icon: { bg: "Икона на сайта", en: "Site icon" },
};
const PRODUCT_FIELD: Record<string, { bg: string; en: string }> = {
  name: { bg: "име", en: "name" },
  regular_price: { bg: "цена", en: "price" },
  sale_price: { bg: "промоционална цена", en: "sale price" },
  stock_status: { bg: "наличност", en: "stock" },
  description: { bg: "описание", en: "description" },
  short_description: { bg: "кратко описание", en: "short description" },
};

/** One line, whitespace collapsed, at most `n` characters. */
export function clip(s: string, n = 80): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): string => (v === null || v === undefined ? "—" : `#${String(v)}`);

function pageTitle(b: Row, a: Row, id: string): string {
  return str(a.page_title) || str(b.page_title) || `#${id}`;
}

export function wpPreviewLines(c: Change, lang: Lang): string[] {
  const b: Row = c.before ?? {};
  const a: Row = c.after ?? {};
  const q = (s: string) => quote(clip(s), lang);
  switch (c.op) {
    case "wp_edit_page": {
      const lines = [`• WordPress: ${tr(lang, "страница", "page")} ${quote(pageTitle(b, a, c.entity_id), lang)}`];
      const reps = Array.isArray(a.replacements) ? (a.replacements as { find: string; replace: string }[]) : [];
      if (a.title !== undefined && str(a.title) !== str(b.title)) lines.push(`  ${tr(lang, "заглавие", "title")}: ${q(str(b.title))} → ${q(str(a.title))}`);
      for (const r of reps) lines.push(`  ${q(r.find)} → ${q(r.replace)}`);
      const contentChanged = str(a.content) !== str(b.content) || str(a.elementor_data) !== str(b.elementor_data);
      if (reps.length === 0 && contentChanged) lines.push(a.replacements === undefined && a.preview_url === undefined ? `  ${tr(lang, "връща предишния текст", "restores the previous text")}` : `  ${tr(lang, "нов текст на страницата", "new page text")}`);
      if (a.featured_media !== undefined && a.featured_media !== b.featured_media) lines.push(`  ${tr(lang, "нова водеща снимка", "new featured image")}`);
      if (typeof a.preview_url === "string" && a.preview_url) lines.push(`  ${tr(lang, "Преглед", "Preview")}: ${a.preview_url}`);
      return lines;
    }
    case "wp_upload_photo": {
      const row = c.after ?? c.before ?? {};
      const alt = str(lang === "bg" ? row.alt_bg : row.alt_en) || str(row.alt_bg) || str(row.title);
      if (c.after === null) {
        const lines = [`• WordPress: ${tr(lang, "премахва снимката", "removes photo")} ${quote(alt, lang)}`];
        if (row.as_featured === true) lines.push(`  ${tr(lang, "и водещата снимка на страница", "and the featured image of page")} ${quote(str(row.page_title) || `#${str(row.page_id)}`, lang)}`);
        return lines;
      }
      const lines = [`• WordPress: ${tr(lang, "качва снимка", "uploads photo")} ${quote(alt, lang)}`];
      if (row.as_featured === true) lines.push(`  ${tr(lang, "като водеща снимка на страница", "as the featured image of page")} ${quote(str(row.page_title) || `#${str(row.page_id)}`, lang)}`);
      return lines;
    }
    case "wp_set_option": {
      const label = OPTION_LABEL[c.entity_id]?.[lang] ?? c.entity_id;
      const isMedia = c.entity_id === "custom_logo" || c.entity_id === "site_icon";
      const show = (v: unknown) => (isMedia ? (typeof v === "string" && v.startsWith("{{") ? tr(lang, "новата снимка", "the new photo") : num(v)) : q(str(v)));
      return [`• WordPress: ${label}: ${show(b.value)} → ${show(a.value)}`];
    }
    case "wp_edit_menu": {
      const name = str(a.name) || str(b.name) || `#${c.entity_id}`;
      const before = Array.isArray(b.items) ? (b.items as Row[]) : [];
      const after = Array.isArray(a.items) ? (a.items as Row[]) : [];
      const lines = [`• WordPress: ${tr(lang, "меню", "menu")} ${quote(name, lang)}: ${before.length} → ${after.length} ${tr(lang, "елемента", "items")}`];
      for (const it of after.slice(0, 15)) lines.push(`  – ${clip(str(it.title), 40)} → ${clip(str(it.url), 60)}`);
      if (after.length > 15) lines.push(`  … ${after.length - 15} ${tr(lang, "още", "more")}`);
      return lines;
    }
    case "wp_edit_product": {
      const name = str(a.product_name) || str(b.product_name) || `#${c.entity_id}`;
      const lines = [`• WordPress: ${tr(lang, "продукт", "product")} ${quote(name, lang)}`];
      for (const k of Object.keys(a)) {
        if (k === "product_name" || str(a[k]) === str(b[k])) continue;
        lines.push(`  ${PRODUCT_FIELD[k]?.[lang] ?? k}: ${q(str(b[k]))} → ${q(str(a[k]))}`);
      }
      return lines;
    }
    default:
      return [`• ${c.op}`];
  }
}
