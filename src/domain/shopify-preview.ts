// src/domain/shopify-preview.ts
// Preview lines for Shopify change rows (entities shopify_*). Pure; both languages; undo-safe (an inverted row keeps
// the op with before/after swapped, so every line still reads old → new).
import { keep, quote, tr } from "./format";
import type { Change, Lang, Row } from "./types";
import { clip } from "./wp-preview";

const STATUS: Record<string, { bg: string; en: string }> = {
  ACTIVE: { bg: "активен", en: "active" },
  DRAFT: { bg: "чернова", en: "draft" },
  ARCHIVED: { bg: "архивиран", en: "archived" },
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
type VariantRow = { id: string; title?: string; price?: string; compare_at_price?: string | null };
const variants = (r: Row): VariantRow[] => (Array.isArray(r.variants) ? (r.variants as VariantRow[]) : []);

/** "13.5" → "13.50 EUR"; an empty price is a dash. Shopify prices are in the store's currency, not always euro. */
function money(v: unknown, currency: string): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return `${Number.isFinite(n) ? n.toFixed(2) : str(v)}${currency ? ` ${currency}` : ""}`;
}

export function shopifyPreviewLines(c: Change, lang: Lang): string[] {
  const b: Row = c.before ?? {};
  const a: Row = c.after ?? {};
  const q = (s: string) => quote(keep(clip(s)), lang);
  const named = (s: string) => quote(keep(s), lang);
  switch (c.op) {
    case "shopify_edit_product": {
      const name = str(b.product_title) || str(a.product_title) || c.entity_id;
      const currency = str(a.currency) || str(b.currency);
      const lines = [`• Shopify: ${tr(lang, "продукт", "product")} ${named(name)}`];
      if (a.title !== undefined && str(a.title) !== str(b.title)) lines.push(`  ${tr(lang, "име", "name")}: ${q(str(b.title))} → ${q(str(a.title))}`);
      if (a.description_html !== undefined && str(a.description_html) !== str(b.description_html)) lines.push(`  ${tr(lang, "описание", "description")}: ${q(strip(str(b.description_html)))} → ${q(strip(str(a.description_html)))}`);
      if (a.status !== undefined && str(a.status) !== str(b.status)) lines.push(`  ${tr(lang, "статус", "status")}: ${STATUS[str(b.status)]?.[lang] ?? str(b.status)} → ${STATUS[str(a.status)]?.[lang] ?? str(a.status)}`);
      const was = new Map(variants(b).map((v) => [v.id, v]));
      const all = variants(a);
      for (const v of all) {
        const old = was.get(v.id);
        // A product with one variant shows the price on its own; several variants are named.
        const label = all.length > 1 || (v.title && v.title !== "Default Title") ? `${keep(clip(str(v.title), 40))}: ` : "";
        if (v.price !== undefined) lines.push(`  ${label}${tr(lang, "цена", "price")}: ${money(old?.price, currency)} → ${money(v.price, currency)}`);
        if (v.compare_at_price !== undefined) lines.push(`  ${label}${tr(lang, "стара цена (зачеркната)", "compare-at price")}: ${money(old?.compare_at_price, currency)} → ${money(v.compare_at_price, currency)}`);
      }
      return lines;
    }
    case "shopify_edit_page": {
      const name = str(b.page_title) || str(a.page_title) || c.entity_id;
      const lines = [`• Shopify: ${tr(lang, "страница", "page")} ${named(name)}`];
      const reps = Array.isArray(a.replacements) ? (a.replacements as { find: string; replace: string }[]) : [];
      if (a.title !== undefined && str(a.title) !== str(b.title)) lines.push(`  ${tr(lang, "заглавие", "title")}: ${q(str(b.title))} → ${q(str(a.title))}`);
      for (const r of reps) lines.push(`  ${q(r.find)} → ${q(r.replace)}`);
      if (reps.length === 0 && a.body !== undefined && str(a.body) !== str(b.body)) lines.push(a.restores === true || a.replacements === undefined ? `  ${tr(lang, "връща предишния текст", "restores the previous text")}` : `  ${tr(lang, "нов текст на страницата", "new page text")}`);
      return lines;
    }
    default:
      return [`• ${c.op}`];
  }
}

/** HTML to one line of plain text (for previews and for the agent to read). */
export function strip(html: string): string {
  return html.replace(/<(br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
