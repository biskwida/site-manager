// src/agent/shopify-tools.ts
// Agent tools for a connected Shopify store. Every write becomes a change set with shopify_* rows built from the
// store's live values; the push to Shopify happens only after the owner approves (src/destinations/store-hook.ts).
import { randomUUID } from "node:crypto";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sameMoney } from "../destinations/shopify";
import { ShopifyApiError, toGid } from "../destinations/shopify-client";
import { strip } from "../domain/shopify-preview";
import type { Change, Row } from "../domain/types";
import { proposalText, type AgentDeps, type ToolKit } from "./tools";

const TEXT_LIMIT = 6000;
const BODY_LIMIT = 12000;
const PRICE = /^\d{1,7}(\.\d{1,2})?$/;

const Summary = {
  summary_bg: z.string().min(1).describe("One line in Bulgarian, e.g. „Нова цена на ленената риза“"),
  summary_en: z.string().min(1).describe("The same line in English"),
};
const Id = z.union([z.string().min(1), z.number().int().positive()]);
const Price = z.string().regex(PRICE).describe('Decimal as text in the store currency, e.g. "13.50"');

export const ShopifyEditProductsSchema = z.object({
  ...Summary,
  products: z
    .array(
      z.object({
        product_id: Id.describe("An id from shopify_list_store"),
        title: z.string().min(1).optional().describe("New product name"),
        description_html: z.string().optional().describe("Full new description as simple HTML (<p>, <ul>, <strong>)"),
        status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional().describe("ACTIVE = visible in the shop, DRAFT = hidden"),
        variants: z
          .array(z.object({ variant_id: Id.describe("A variant id from shopify_read_product"), price: Price.optional(), compare_at_price: Price.nullable().optional().describe("The crossed-out old price of a sale; null removes it") }))
          .max(100)
          .optional()
          .describe("Price changes, one entry per variant. A product without options has exactly one variant."),
      }),
    )
    .min(1)
    .max(50)
    .describe("Every product this request changes, in ONE call: a second call would be a second proposal."),
});
export const ShopifyAddProductSchema = z.object({
  ...Summary,
  title: z.string().min(1).max(255).describe("Product name, in the language of the store's other products"),
  description_html: z.string().optional().describe("Description as simple HTML (<p>, <ul>, <strong>)"),
  price: Price,
  compare_at_price: Price.optional().describe("Only for a product that starts on sale: the crossed-out old price"),
});
export const ShopifyEditPageSchema = z.object({
  ...Summary,
  page_id: Id.describe("An id from shopify_list_store"),
  title: z.string().min(1).optional().describe("New page title"),
  body: z.string().optional().describe("Full new body as HTML. Prefer replacements for small edits."),
  replacements: z.array(z.object({ find: z.string().min(1).describe("Exact text copied from the page body (shopify_read_page), long enough to occur once"), replace: z.string() })).max(20).optional(),
});

/** Turns a Shopify error into an instruction the model can act on. */
export function shopifyErrorMessage(e: ShopifyApiError): string {
  switch (e.code) {
    case "sm_shopify_revoked":
      return "The Shopify connection is no longer valid. Tell the owner to open Claudia inside their Shopify admin to renew it; do not retry.";
    case "sm_shopify_scope":
      return "Claudia lacks the Shopify permission for this. Tell the owner to open Claudia inside their Shopify admin and approve the permissions; do not retry.";
    case "sm_shopify_rate":
    case "sm_shopify_unreachable":
      return "Shopify did not answer right now. Tell the owner to try again in a minute.";
    default:
      return e.message;
  }
}

export function shopifyTools(d: AgentDeps, k: ToolKit) {
  const shop = d.shopify;
  if (!shop) return [];
  const requireOwner = () => {
    if (d.member.role !== "owner") throw new Error("Shopify changes are only the owner's decision; tell the owner to send this.");
  };
  const api = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw e instanceof ShopifyApiError ? new Error(shopifyErrorMessage(e)) : e;
    }
  };
  const gid = (type: "Product" | "ProductVariant" | "Page", id: string | number): string => {
    const g = toGid(type, id);
    if (!g) throw new Error(`"${String(id)}" is not a ${type} id; use an id from shopify_list_store or shopify_read_product.`);
    return g;
  };

  const propose = async (summary_bg: string, summary_en: string, changes: Change[]) => {
    await k.ensureEntitled("site");
    await k.ensureWithinLimit();
    await k.ensureNoPending();
    const s = await k.site();
    const p = k.previews(s, changes);
    const cs = await d.store.createChangeSet({ venue_id: d.venueId, chat_ref: d.chatRef, summary_bg, summary_en, ...p, source: d.source ?? "text", status: "proposed", changes });
    const messageRef = await d.messenger.sendProposal(d.chatRef, proposalText(k.mine(p), k.lang, null, s.venue.tz), cs.id, k.lang);
    if (messageRef !== null) await d.store.updateChangeSet(cs.id, { message_ref: messageRef });
    return { change_set_id: cs.id, status: "proposed", preview: k.mine(p), next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
  };

  const listStore = betaZodTool({
    name: "shopify_list_store",
    description: "The owner's connected Shopify store: name, address, currency, products (id, name, status, price range) and pages (id, title). Call it before any Shopify edit. `search` narrows the products by name when the store has more than 50.",
    inputSchema: z.object({ search: z.string().optional().describe("Part of a product name") }),
    run: (input) =>
      k.attempt(async () => {
        const [info, list, pages] = await api(() => Promise.all([shop.shop(), shop.listProducts(50, input.search), shop.listPages(50)]));
        return {
          store_name: info.name, store_url: info.url, currency: info.currency,
          products: list.products,
          more_products: list.more,
          pages,
          note: "Prices are in the store currency. Read a product with shopify_read_product before changing its prices (you need its variant ids). The theme (homepage banner, colours, layout) cannot be edited from here: say so and point the owner to Online Store → Themes → Customize.",
        };
      }),
  });

  const readProduct = betaZodTool({
    name: "shopify_read_product",
    description: "One Shopify product: name, status, description (text and HTML) and every variant with its id, price and compare-at price.",
    inputSchema: z.object({ product_id: Id }),
    run: (input) =>
      k.attempt(async () => {
        const p = await api(() => shop.product(gid("Product", input.product_id)));
        const text = strip(p.description_html);
        return { id: p.id, title: p.title, status: p.status, url: p.url, description_text: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text, description_html: p.description_html.slice(0, BODY_LIMIT), variants: p.variants };
      }),
  });

  const readPage = betaZodTool({
    name: "shopify_read_page",
    description: "One Shopify page: title, the visible text, and the HTML body to copy exact `find` anchors from for shopify_edit_page.",
    inputSchema: z.object({ page_id: Id }),
    run: (input) =>
      k.attempt(async () => {
        const p = await api(() => shop.page(gid("Page", input.page_id)));
        const text = strip(p.body);
        return { id: p.id, title: p.title, published: p.published, text: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text, body: p.body.slice(0, BODY_LIMIT), body_truncated: p.body.length > BODY_LIMIT, hint: "Use replacements with a find text copied verbatim from body; use body only to rewrite the whole page." };
      }),
  });

  const editProducts = betaZodTool({
    name: "shopify_edit_products",
    description: "Propose changes to one or more Shopify products: name, description, status (ACTIVE/DRAFT) and variant prices. Put every product of the request in this one call. Nothing changes in the store until the owner taps ✅.",
    inputSchema: ShopifyEditProductsSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const ids = input.products.map((p) => gid("Product", p.product_id));
        if (new Set(ids).size !== ids.length) throw new Error("The same product is listed twice; merge its changes into one entry.");
        const info = await api(() => shop.shop());
        const rows: Change[] = [];
        for (const [i, want] of input.products.entries()) {
          const p = await api(() => shop.product(ids[i]));
          const before: Row = { product_title: p.title, currency: info.currency };
          const after: Row = { product_title: p.title, currency: info.currency };
          if (want.title !== undefined && want.title.trim() !== p.title) [before.title, after.title] = [p.title, want.title.trim()];
          if (want.description_html !== undefined && want.description_html !== p.description_html) [before.description_html, after.description_html] = [p.description_html, want.description_html];
          if (want.status !== undefined && want.status !== p.status) [before.status, after.status] = [p.status, want.status];
          const was: Row[] = [];
          const next: Row[] = [];
          for (const v of want.variants ?? []) {
            const id = gid("ProductVariant", v.variant_id);
            const cur = p.variants.find((x) => x.id === id);
            if (!cur) throw new Error(`Variant ${id} does not belong to "${p.title}"; use the ids from shopify_read_product.`);
            const b: Row = { id, title: cur.title };
            const a: Row = { id, title: cur.title };
            if (v.price !== undefined && !sameMoney(v.price, cur.price)) [b.price, a.price] = [cur.price, v.price];
            if (v.compare_at_price !== undefined && !sameMoney(v.compare_at_price, cur.compare_at_price)) [b.compare_at_price, a.compare_at_price] = [cur.compare_at_price, v.compare_at_price];
            const price = Number(a.price ?? cur.price);
            const compare = a.compare_at_price === undefined ? cur.compare_at_price : (a.compare_at_price as string | null);
            if (compare !== null && compare !== "" && Number(compare) <= price) throw new Error(`"${p.title}": the compare-at price (${compare}) must be higher than the price (${price.toFixed(2)}); it is the crossed-out old price of a sale.`);
            if (Object.keys(a).length > 2) {
              was.push(b);
              next.push(a);
            }
          }
          if (next.length > 0) [before.variants, after.variants] = [was, next];
          if (Object.keys(after).length > 2) rows.push({ position: rows.length, op: "shopify_edit_product", entity: "shopify_product", entity_id: p.id, before, after });
        }
        if (rows.length === 0) throw new Error("Nothing would change: the store already has these values.");
        return propose(input.summary_bg, input.summary_en, rows);
      }),
  });

  const addProduct = betaZodTool({
    name: "shopify_add_product",
    description: "Propose a new Shopify product with one price. After ✅ it is created as a DRAFT (hidden from the shop); the owner activates it by asking you to set its status to ACTIVE, or in the Shopify admin. Photos, options (size, colour) and stock are added in the Shopify admin for now: say so in one sentence.",
    inputSchema: ShopifyAddProductSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const title = input.title.trim();
        if (input.compare_at_price !== undefined && Number(input.compare_at_price) <= Number(input.price)) throw new Error(`The compare-at price (${input.compare_at_price}) must be higher than the price (${input.price}); it is the crossed-out old price of a sale.`);
        const [info, existing] = await api(() => Promise.all([shop.shop(), shop.listProducts(50, title)]));
        const twin = existing.products.find((p) => p.title.trim().toLowerCase() === title.toLowerCase());
        if (twin) throw new Error(`The store already has a product named "${twin.title}" (${twin.id}); change that one with shopify_edit_products, or ask the owner whether they want a second one under another name.`);
        const after: Row = { title, price: input.price, currency: info.currency, status: "DRAFT" };
        if (input.description_html) after.description_html = input.description_html;
        if (input.compare_at_price !== undefined) after.compare_at_price = input.compare_at_price;
        return propose(input.summary_bg, input.summary_en, [{ position: 0, op: "shopify_add_product", entity: "shopify_product", entity_id: `new:${randomUUID()}`, before: null, after }]);
      }),
  });

  const editPage = betaZodTool({
    name: "shopify_edit_page",
    description: "Propose a Shopify page edit: a new title, exact text replacements (preferred) or a full new body. Nothing changes in the store until the owner taps ✅.",
    inputSchema: ShopifyEditPageSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        if (input.body !== undefined && (input.replacements?.length ?? 0) > 0) throw new Error("Send either body or replacements, not both.");
        const p = await api(() => shop.page(gid("Page", input.page_id)));
        let body = input.body ?? p.body;
        for (const r of input.replacements ?? []) {
          const count = body.split(r.find).length - 1;
          if (count !== 1) throw new Error(`"${r.find}" occurs ${count} times in the page body; choose a longer unique anchor copied verbatim from shopify_read_page body.`);
          body = body.replace(r.find, () => r.replace);
        }
        const before: Row = { page_title: p.title };
        const after: Row = { page_title: p.title };
        if (input.title !== undefined && input.title.trim() !== p.title) [before.title, after.title] = [p.title, input.title.trim()];
        if (body !== p.body) {
          [before.body, after.body] = [p.body, body];
          after.replacements = input.replacements ?? [];
        }
        if (Object.keys(after).length === 1) throw new Error("Nothing would change on the page; check the replacements or the title.");
        return propose(input.summary_bg, input.summary_en, [{ position: 0, op: "shopify_edit_page", entity: "shopify_page", entity_id: p.id, before, after }]);
      }),
  });

  return [listStore, readProduct, readPage, editProducts, addProduct, editPage];
}
