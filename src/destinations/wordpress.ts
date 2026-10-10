// src/destinations/wordpress.ts
// Pushes applied wp_* change rows to the owner's WordPress site through the plugin. Idempotent per change:
// page/option/menu/product writes are content-based, uploads are keyed by source_id, deletes are by source_id.
import { isWpEntity, type Change, type Row } from "../domain/types";
import type { DestinationAdapter, PushContext, PushResult } from "./types";
import { WordPressApiError, WordPressClient } from "./wordpress-client";
import type { WpMenuItemInput, WpOptionKey, WpPageFields, WpProductPatch } from "./wordpress-types";

export const WP_LINES = {
  ok: { bg: "WordPress: обновено ✅", en: "WordPress: updated ✅" },
  retry: { bg: "WordPress: не успях да обновя, ще опитам пак", en: "WordPress: update failed, will retry" },
  error: (msg: string) => ({ bg: `WordPress: грешка: ${msg}`, en: `WordPress: error: ${msg}` }),
};

const PAGE_FIELDS = ["title", "content", "elementor_data", "featured_media"] as const;

function pageFields(row: Row): Partial<WpPageFields> {
  const out: Partial<WpPageFields> = {};
  for (const k of PAGE_FIELDS) if (row[k] !== undefined) (out as Record<string, unknown>)[k] = row[k];
  return out;
}

export const wordpressAdapter: DestinationAdapter = {
  kind: "wordpress",
  relevant: (changes) => changes.filter((c) => isWpEntity(c.entity)).sort((a, b) => a.position - b.position),
  async push(ctx: PushContext): Promise<PushResult> {
    const siteUrl = String(ctx.destination.config.site_url ?? "");
    if (!siteUrl || !ctx.secrets.token) return { ok: false, retry: false, error: "destination has no site_url or token", line: WP_LINES.error("not connected") };
    const client = new WordPressClient({ siteUrl, token: ctx.secrets.token, fetch: ctx.fetch });
    const uploaded = new Map<string, { id: number; url: string }>();
    /** Pages whose featured image this run set (by page id): a later page apply must not reset it from its stale snapshot. */
    const featured = new Map<number, number | null>();
    const placeholders = () => {
      const map: Record<string, string> = {};
      for (const [sourceId, m] of uploaded) {
        map[`{{sm_media_url:${sourceId}}}`] = m.url;
        map[`{{sm_media_id:${sourceId}}}`] = String(m.id);
      }
      return map;
    };
    const lang = ctx.venue.default_lang;
    const pushed: Record<string, unknown>[] = [];
    try {
      for (const c of ctx.changes) {
        const a = c.after ?? null;
        const b = c.before ?? null;
        switch (c.entity) {
          case "wp_media": {
            if (a) {
              const alt = String((lang === "bg" ? a.alt_bg : a.alt_en) ?? a.alt_bg ?? a.title ?? "");
              const m = await client.uploadMedia({ url: String(a.source_url), source_id: c.entity_id, title: String(a.title ?? ""), alt, filename: typeof a.filename === "string" ? a.filename : undefined });
              uploaded.set(c.entity_id, { id: m.id, url: m.url });
              if (a.as_featured === true && a.page_id) {
                await client.applyPage(Number(a.page_id), { featured_media: m.id });
                featured.set(Number(a.page_id), m.id);
              }
              pushed.push({ entity: "wp_media", source_id: c.entity_id, attachment_id: m.id, existed: m.existed });
            } else if (b) {
              if (b.as_featured === true && b.page_id) {
                const previous = b.previous_featured === undefined ? null : (b.previous_featured as number | null);
                await client.applyPage(Number(b.page_id), { featured_media: previous });
                featured.set(Number(b.page_id), previous);
              }
              const r = await client.deleteMedia({ source_id: c.entity_id });
              pushed.push({ entity: "wp_media", source_id: c.entity_id, deleted: r.deleted });
            }
            break;
          }
          case "wp_page": {
            if (!a) break;
            const pageId = Number(c.entity_id);
            const fields = pageFields(a);
            if (featured.has(pageId)) fields.featured_media = featured.get(pageId) ?? null;
            const r = await client.applyPage(pageId, { ...fields, placeholders: placeholders() });
            pushed.push({ entity: "wp_page", id: r.id, url: r.url, revision_id: r.revision_id });
            break;
          }
          case "wp_option": {
            if (!a) break;
            let value = a.value as string | number | null;
            if (typeof value === "string" && value.startsWith("{{")) value = placeholders()[value] ?? value;
            const r = await client.setOption(c.entity_id as WpOptionKey, value);
            pushed.push({ entity: "wp_option", key: r.key, after: r.after });
            break;
          }
          case "wp_menu": {
            if (!a) break;
            const items = (Array.isArray(a.items) ? a.items : []) as WpMenuItemInput[];
            const r = await client.setMenu(Number(c.entity_id), items.map((i) => ({ title: i.title, url: i.url, parent_index: i.parent_index ?? null, type: i.type ?? "custom", object_id: i.object_id ?? null })));
            pushed.push({ entity: "wp_menu", id: r.id, items: r.after.length });
            break;
          }
          case "wp_product": {
            if (!a) break;
            const patch: WpProductPatch = {};
            for (const k of ["name", "regular_price", "sale_price", "stock_status", "description", "short_description"] as const) if (typeof a[k] === "string") (patch as Record<string, unknown>)[k] = a[k];
            const r = await client.setProduct(Number(c.entity_id), patch);
            pushed.push({ entity: "wp_product", id: r.id });
            break;
          }
          default:
            break;
        }
      }
      return { ok: true, result: { pushed }, line: WP_LINES.ok };
    } catch (e) {
      const retry = e instanceof WordPressApiError ? e.retryable : true;
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, retry, error: msg, line: retry ? WP_LINES.retry : WP_LINES.error(msg), ...(e instanceof WordPressApiError ? { code: e.code } : {}) };
    }
  },
};

export type { Change };
