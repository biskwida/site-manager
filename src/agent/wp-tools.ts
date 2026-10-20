// src/agent/wp-tools.ts
// Agent tools for a connected WordPress site. Every write becomes a change set with wp_* rows; the push to
// WordPress happens only after the owner approves (src/destinations/store-hook.ts).
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { WordPressApiError } from "../destinations/wordpress-client";
import type { WpMenuItemInput, WpOptionKey, WpPageChangeRow, WpPageFields, WpProductPatch } from "../destinations/wordpress-types";
import { clip } from "../domain/wp-preview";
import type { Change, Row } from "../domain/types";
import { proposalText, type AgentDeps, type ToolKit } from "./tools";
import { WpEditMenuSchema, WpEditPageSchema, WpEditProductSchema, WpPhotoSchema, WpReadPageSchema, WpSetOptionSchema, WpUploadPhotoSchema } from "./wp-tool-schemas";

const PLACEHOLDER = /\{\{sm_media_(?:url|id):([^}]+)\}\}/g;
const TEXT_LIMIT = 6000;
const CONTENT_LIMIT = 12000;

/** Turns a plugin error into an instruction the model can act on. */
export function wpErrorMessage(e: WordPressApiError): string {
  switch (e.code) {
    case "sm_replace_failed":
      return `"${String(e.data.find)}" occurs ${String(e.data.count)} times on the page; choose a longer unique anchor copied verbatim from wp_read_page content.`;
    case "sm_builder_unsupported":
      return e.data.builder === "elementor" ? "This page is built with Elementor; send replacements instead of full content." : `This page is built with an unsupported editor (${String(e.data.builder)}); it cannot be edited here. Offer the hosted Claudia page instead.`;
    case "sm_unreachable":
      return "The WordPress site did not answer; tell the owner the site seems down and try again later.";
    case "sm_unauthorized":
      return "The WordPress connection is no longer valid; ask the owner to reconnect with /connect.";
    default:
      return e.message;
  }
}

export function wpTools(d: AgentDeps, k: ToolKit) {
  const wp = d.wordpress;
  if (!wp) return [];
  const requireOwner = () => {
    if (d.member.role !== "owner") throw new Error("WordPress changes are only the owner's decision; tell the owner to send this.");
  };
  const api = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw e instanceof WordPressApiError ? new Error(wpErrorMessage(e)) : e;
    }
  };

  /** wp_media rows for photos the owner sent; verifies each id belongs to this venue. */
  const photoRows = async (photos: z.infer<typeof WpPhotoSchema>[], page: { id: number; title: string; featured_media: number | null } | null, startPosition: number): Promise<{ rows: Change[]; placeholders: Record<string, string> }> => {
    const rows: Change[] = [];
    const placeholders: Record<string, string> = {};
    for (const [i, p] of photos.entries()) {
      const m = await d.store.getMedia(p.media_id);
      if (!m || m.venue_id !== d.venueId) throw new Error(`media_id "${p.media_id}" not found for this venue; use an id from a photo you received.`);
      rows.push({
        position: startPosition + i, op: "wp_upload_photo", entity: "wp_media", entity_id: m.id, before: null,
        after: { source_url: m.public_url, title: p.alt_bg || p.alt_en, alt_bg: p.alt_bg, alt_en: p.alt_en, page_id: page?.id ?? null, page_title: page?.title ?? "", as_featured: p.as_featured === true, previous_featured: p.as_featured === true ? page?.featured_media ?? null : null },
      });
      placeholders[`{{sm_media_url:${m.id}}}`] = m.public_url;
    }
    return { rows, placeholders };
  };

  const propose = async (summary_bg: string, summary_en: string, changes: Change[], extra: Record<string, unknown> = {}) => {
    await k.ensureEntitled("site");
    await k.ensureWithinLimit();
    await k.ensureNoPending();
    const s = await k.site();
    const p = k.previews(s, changes);
    const cs = await d.store.createChangeSet({ venue_id: d.venueId, chat_ref: d.chatRef, summary_bg, summary_en, ...p, source: d.source ?? "text", status: "proposed", changes });
    const messageRef = await d.messenger.sendProposal(d.chatRef, proposalText(k.mine(p), k.lang, null, s.venue.tz), cs.id, k.lang);
    if (messageRef !== null) await d.store.updateChangeSet(cs.id, { message_ref: messageRef });
    return { change_set_id: cs.id, status: "proposed", preview: k.mine(p), ...extra, next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
  };

  const listSite = betaZodTool({
    name: "wp_list_site",
    description: "The owner's connected WordPress site: pages (id, title, url, editor/builder), navigation menus, site title and tagline, whether WooCommerce is active, and products. Call it before any WordPress edit.",
    inputSchema: z.object({}),
    run: () =>
      k.attempt(async () => {
        const s = await api(() => wp.site());
        return {
          site_name: s.name, site_url: s.home_url, wp_version: s.wp_version, theme: s.theme.name, locale: s.locale,
          pages: s.pages.map((p) => ({ id: p.id, title: p.title, url: p.url, status: p.status, builder: p.builder, is_front_page: p.is_front_page, featured_media: p.featured_media })),
          menus: s.menus,
          options: s.options,
          woocommerce: s.woocommerce,
          products: s.products.slice(0, 50),
          note: "Edit page text with wp_edit_page (read it first with wp_read_page). Menu, prices, hours, specials and announcements are managed with propose_changes; the plugin shows them on the site.",
        };
      }),
  });

  const readPage = betaZodTool({
    name: "wp_read_page",
    description: "One WordPress page: title, builder, the visible text, and the raw content (block HTML) to copy exact `find` anchors from for wp_edit_page.",
    inputSchema: WpReadPageSchema,
    run: (input) =>
      k.attempt(async () => {
        const p = await api(() => wp.page(input.page_id));
        return {
          id: p.id, title: p.title, url: p.url, builder: p.builder, editable: p.editable, featured_media: p.featured_media,
          text: p.text.length > TEXT_LIMIT ? `${p.text.slice(0, TEXT_LIMIT)}…` : p.text,
          content: p.content.length > CONTENT_LIMIT ? p.content.slice(0, CONTENT_LIMIT) : p.content,
          content_truncated: p.content.length > CONTENT_LIMIT,
          texts: p.builder === "elementor" ? p.texts : undefined,
          hint: p.builder === "elementor" ? "Elementor page: edit with replacements only; each find must match exactly one text fragment." : "Use replacements with a find text copied verbatim from content; use content only to rewrite the whole page.",
        };
      }),
  });

  const editPage = betaZodTool({
    name: "wp_edit_page",
    description: "Propose a WordPress page edit: a new title, exact text replacements (preferred) or full new content, optionally with photos the owner sent. The plugin computes the result and a preview link; nothing is published until the owner taps ✅.",
    inputSchema: WpEditPageSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        // Refuse before the plugin stores a pending preview, so a refused proposal leaves nothing behind on the site.
        await k.ensureEntitled("site");
        await k.ensureWithinLimit();
        await k.ensureNoPending();
        const page = await api(() => wp.page(input.page_id));
        const { rows, placeholders } = await photoRows(input.photos ?? [], page, 0);
        const known = new Set((input.photos ?? []).map((p) => p.media_id));
        for (const text of [input.title ?? "", input.content ?? "", ...(input.replacements ?? []).map((r) => r.replace)]) {
          for (const m of text.matchAll(PLACEHOLDER)) if (!known.has(m[1])) throw new Error(`Placeholder for media_id "${m[1]}" is not in photos; add it there or remove the placeholder.`);
        }
        const preview = await api(() => wp.previewPage(input.page_id, { title: input.title, content: input.content, replacements: input.replacements, placeholders }));
        // The plugin resolved our placeholders to our storage URLs for the preview only; the stored `after` keeps the
        // tokens on every field, so the push substitutes the uploaded attachment after the wp_media rows ran.
        const unresolve = (s: string | null) => (s === null ? s : Object.entries(placeholders).reduce((acc, [token, url]) => acc.split(url).join(token), s));
        const afterFields: WpPageFields = { ...preview.after, title: unresolve(preview.after.title) as string, content: unresolve(preview.after.content) as string, elementor_data: unresolve(preview.after.elementor_data) };
        const pageUnchanged = JSON.stringify(preview.before) === JSON.stringify(afterFields);
        if (!pageUnchanged) {
          const before: WpPageChangeRow = { ...preview.before, page_title: page.title, page_url: page.url };
          const after: WpPageChangeRow = { ...afterFields, page_title: page.title, page_url: page.url, replacements: input.replacements ?? [], preview_url: preview.preview_url };
          rows.push({ position: rows.length, op: "wp_edit_page", entity: "wp_page", entity_id: String(page.id), before: before as unknown as Row, after: after as unknown as Row });
        }
        if (rows.length === 0) throw new Error("Nothing would change on the page; check the replacements or the title.");
        return propose(input.summary_bg, input.summary_en, rows, { preview_url: preview.preview_url, pending_key: preview.pending_key });
      }),
  });

  const uploadPhoto = betaZodTool({
    name: "wp_upload_photo",
    description: "Propose uploading a photo the owner sent into the WordPress media library, optionally as a page's featured image. Uploaded only after ✅.",
    inputSchema: WpUploadPhotoSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        if (input.as_featured === true && !input.page_id) throw new Error("as_featured needs page_id (the page that gets the featured image).");
        const page = input.page_id ? await api(() => wp.page(input.page_id as number)) : null;
        const { rows } = await photoRows([{ media_id: input.media_id, alt_bg: input.alt_bg, alt_en: input.alt_en, as_featured: input.as_featured }], page, 0);
        return propose(input.summary_bg, input.summary_en, rows);
      }),
  });

  const setOption = betaZodTool({
    name: "wp_set_option",
    description: "Propose a change of the WordPress site title (blogname), tagline (blogdescription), logo (custom_logo, from a photo the owner sent) or site icon (site_icon).",
    inputSchema: WpSetOptionSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const options = await api(() => wp.options());
        const key = input.key as WpOptionKey;
        const rows: Change[] = [];
        let value: string | number | null;
        if (key === "custom_logo" || key === "site_icon") {
          if (input.media_id) {
            const { rows: photos } = await photoRows([{ media_id: input.media_id, alt_bg: input.alt_bg || "Лого", alt_en: input.alt_en || "Logo" }], null, 0);
            rows.push(...photos);
            value = `{{sm_media_id:${input.media_id}}}`;
          } else if (input.value === null) value = null;
          else throw new Error(`${key} needs media_id (a photo the owner sent) or value null to remove it.`);
        } else {
          if (typeof input.value !== "string" || !input.value.trim()) throw new Error(`${key} needs a non-empty value.`);
          value = input.value.trim();
        }
        rows.push({ position: rows.length, op: "wp_set_option", entity: "wp_option", entity_id: key, before: { value: options[key] }, after: { value } });
        return propose(input.summary_bg, input.summary_en, rows);
      }),
  });

  const editMenu = betaZodTool({
    name: "wp_edit_menu",
    description: "Propose replacing a WordPress navigation menu with a complete new list of items (title, url, optional parent_index). Read the current one with wp_list_site first.",
    inputSchema: WpEditMenuSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const menu = await api(() => wp.menu(input.menu_id));
        const items: WpMenuItemInput[] = input.items.map((i) => ({ title: i.title.trim(), url: i.url.trim(), parent_index: i.parent_index ?? null, type: "custom", object_id: null }));
        for (const i of items) if (i.parent_index !== null && (i.parent_index as number) >= items.length) throw new Error("parent_index must point at an item in the list.");
        const row: Change = { position: 0, op: "wp_edit_menu", entity: "wp_menu", entity_id: String(menu.id), before: { name: menu.name, items: menu.items }, after: { name: menu.name, items } };
        return propose(input.summary_bg, input.summary_en, [row]);
      }),
  });

  const editProduct = betaZodTool({
    name: "wp_edit_product",
    description: "Propose a WooCommerce product change (name, prices, stock status, descriptions). Only when wp_list_site says woocommerce is true.",
    inputSchema: WpEditProductSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const p = await api(() => wp.product(input.product_id));
        const patch = input.patch as WpProductPatch;
        const keys = (Object.keys(patch) as (keyof WpProductPatch)[]).filter((k2) => patch[k2] !== undefined && patch[k2] !== p[k2]);
        if (keys.length === 0) throw new Error("Nothing would change on the product.");
        const before: Row = { product_name: p.name };
        const after: Row = { product_name: p.name };
        for (const k2 of keys) {
          before[k2] = p[k2];
          after[k2] = patch[k2] as string;
        }
        const row: Change = { position: 0, op: "wp_edit_product", entity: "wp_product", entity_id: String(p.id), before, after };
        return propose(input.summary_bg, input.summary_en, [row], { product: clip(p.name, 60) });
      }),
  });

  return [listSite, readPage, editPage, uploadPhoto, setOption, editMenu, editProduct];
}
