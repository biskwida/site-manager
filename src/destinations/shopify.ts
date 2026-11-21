// src/destinations/shopify.ts
// Pushes applied shopify_* change rows to the owner's Shopify store. Idempotent per change (every write sets values,
// none appends). Before each write the current values are read back: a field that is neither what the proposal saw
// (`before`) nor what it wants (`after`) was changed in the Shopify admin meanwhile, and the push stops instead of
// overwriting it. The same check protects an undo, whose rows have before and after swapped.
import { isShopifyEntity, type Change, type Row } from "../domain/types";
import { refreshShopifyToken, ShopifyApiError, ShopifyClient, tokenIsStale, validateShopDomain, type ShopifyProductFields, type ShopifyVariantPrice } from "./shopify-client";
import type { DestinationAdapter, PushContext, PushResult } from "./types";

export const SHOPIFY_LINES = {
  ok: { bg: "Shopify: обновено ✅", en: "Shopify: updated ✅" },
  retry: { bg: "Shopify: не успях да обновя, ще опитам пак", en: "Shopify: update failed, will retry" },
  error: (msg: string) => ({ bg: `Shopify: грешка: ${msg}`, en: `Shopify: error: ${msg}` }),
};

const PRODUCT_KEYS = ["title", "description_html", "status"] as const;
const PAGE_KEYS = ["title", "body"] as const;
type VariantRow = { id: string; title?: string; price?: string; compare_at_price?: string | null };

/** Prices compare as numbers ("13.5" = "13.50"); null and "" are both "no price". */
export function sameMoney(a: unknown, b: unknown): boolean {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  return Number(a) === Number(b);
}
const sameText = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

function conflict(what: string): ShopifyApiError {
  return new ShopifyApiError(409, "sm_shopify_conflict", `${what} was changed in Shopify in the meantime.`, { retry: false });
}

function variantRows(row: Row | null): VariantRow[] {
  return Array.isArray(row?.variants) ? (row.variants as VariantRow[]) : [];
}

async function pushProduct(client: ShopifyClient, c: Change): Promise<Record<string, unknown>> {
  const a = c.after ?? {};
  const b = c.before ?? {};
  const current = await client.product(c.entity_id);
  const fields: ShopifyProductFields = {};
  for (const k of PRODUCT_KEYS) {
    if (typeof a[k] !== "string") continue;
    if (!sameText(current[k], b[k]) && !sameText(current[k], a[k])) throw conflict(`"${current.title}" (${k})`);
    if (!sameText(current[k], a[k])) fields[k] = a[k] as string;
  }
  const before = new Map(variantRows(c.before).map((v) => [v.id, v]));
  const prices: ShopifyVariantPrice[] = [];
  for (const v of variantRows(c.after)) {
    const cur = current.variants.find((x) => x.id === v.id);
    if (!cur) throw new ShopifyApiError(404, "sm_shopify_missing", `A variant of "${current.title}" no longer exists.`, { retry: false });
    const was = before.get(v.id);
    const next: ShopifyVariantPrice = { id: v.id };
    if (v.price !== undefined) {
      if (!sameMoney(cur.price, was?.price) && !sameMoney(cur.price, v.price)) throw conflict(`The price of "${current.title}"`);
      if (!sameMoney(cur.price, v.price)) next.price = v.price;
    }
    if (v.compare_at_price !== undefined) {
      if (!sameMoney(cur.compare_at_price, was?.compare_at_price) && !sameMoney(cur.compare_at_price, v.compare_at_price)) throw conflict(`The sale price of "${current.title}"`);
      if (!sameMoney(cur.compare_at_price, v.compare_at_price)) next.compare_at_price = v.compare_at_price;
    }
    if (next.price !== undefined || next.compare_at_price !== undefined) prices.push(next);
  }
  if (Object.keys(fields).length > 0) await client.updateProduct(c.entity_id, fields);
  if (prices.length > 0) await client.updateVariantPrices(c.entity_id, prices);
  return { entity: "shopify_product", id: c.entity_id, fields: Object.keys(fields), variants: prices.length };
}

type Pushed = { entity?: unknown; source_id?: unknown; id?: unknown; variant_id?: unknown; priced?: unknown; deleted?: unknown };
/** The entries earlier pushes stored for a locally-named new product (results are `{ pushed: [...] }`). */
function createdIn(results: Record<string, unknown>[], sourceId: string): Pushed | null {
  for (const r of results) for (const p of (Array.isArray(r.pushed) ? r.pushed : []) as Pushed[]) if (p.source_id === sourceId && typeof p.id === "string") return p;
  return null;
}

/**
 * A new product, always as a draft. The Shopify id is stored on the sync row right after the create (checkpoint), so a
 * retry after a lost answer or a failed price write continues with the same product and never makes a second one.
 */
async function addProduct(client: ShopifyClient, c: Change, ctx: PushContext, pushed: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  const a = c.after ?? {};
  let made = createdIn(ctx.prior ?? [], c.entity_id);
  if (!made) {
    const r = await client.createProduct({ title: String(a.title ?? ""), description_html: typeof a.description_html === "string" ? a.description_html : undefined, status: "DRAFT" });
    made = { entity: "shopify_product", source_id: c.entity_id, id: r.id, variant_id: r.variant_id, priced: false };
    await ctx.checkpoint?.({ pushed: [...pushed, made] });
  }
  if (made.priced !== true && typeof made.variant_id === "string" && typeof a.price === "string") {
    await client.updateVariantPrices(String(made.id), [{ id: made.variant_id, price: a.price, ...(typeof a.compare_at_price === "string" ? { compare_at_price: a.compare_at_price } : {}) }]);
  }
  return { ...made, priced: true };
}

/** Undo of a new product: deletes it, but only while it is still the draft Claudia made. A product the owner has published since stays. */
async function removeAddedProduct(client: ShopifyClient, c: Change, ctx: PushContext): Promise<Record<string, unknown>> {
  const original = ctx.changeSet.undoes_id && ctx.resultsOf ? createdIn(await ctx.resultsOf(ctx.changeSet.undoes_id), c.entity_id) : null;
  if (!original) return { entity: "shopify_product", source_id: c.entity_id, deleted: false }; // it was never created
  let current;
  try {
    current = await client.product(String(original.id));
  } catch (e) {
    if (e instanceof ShopifyApiError && e.code === "sm_shopify_missing") return { entity: "shopify_product", source_id: c.entity_id, deleted: false }; // already gone
    throw e;
  }
  if (current.status !== "DRAFT") throw new ShopifyApiError(409, "sm_shopify_published", `"${current.title}" is no longer a draft, so it was not deleted.`, { retry: false });
  await client.deleteProduct(current.id);
  return { entity: "shopify_product", source_id: c.entity_id, deleted: true };
}

async function pushPage(client: ShopifyClient, c: Change): Promise<Record<string, unknown>> {
  const a = c.after ?? {};
  const b = c.before ?? {};
  const current = await client.page(c.entity_id);
  const fields: { title?: string; body?: string } = {};
  for (const k of PAGE_KEYS) {
    if (typeof a[k] !== "string") continue;
    if (!sameText(current[k], b[k]) && !sameText(current[k], a[k])) throw conflict(`The page "${current.title}"`);
    if (!sameText(current[k], a[k])) fields[k] = a[k] as string;
  }
  if (Object.keys(fields).length > 0) await client.updatePage(c.entity_id, fields);
  return { entity: "shopify_page", id: c.entity_id, fields: Object.keys(fields) };
}

export const shopifyAdapter: DestinationAdapter = {
  kind: "shopify",
  relevant: (changes) => changes.filter((c) => isShopifyEntity(c.entity)).sort((a, b) => a.position - b.position),
  async push(ctx: PushContext): Promise<PushResult> {
    const shop = validateShopDomain(String(ctx.destination.config.shop ?? ""));
    if (!shop) return { ok: false, retry: false, error: "destination has no shop", line: SHOPIFY_LINES.error("not connected") };
    const pushed: Record<string, unknown>[] = [];
    try {
      let secrets = ctx.secrets;
      if (tokenIsStale(secrets, ctx.now)) {
        if (!secrets.refresh_token || !ctx.shopify) throw new ShopifyApiError(401, "sm_shopify_revoked", "Shopify no longer accepts the connection.", { retry: false });
        const t = await refreshShopifyToken(ctx.fetch ?? fetch, ctx.shopify, shop, secrets.refresh_token, ctx.now);
        secrets = { ...secrets, ...t };
        // The old refresh token is spent the moment Shopify answers: store the new pair before anything else can fail.
        await ctx.saveConnection?.(ctx.destination.config, secrets);
      }
      const client = new ShopifyClient({ shop, accessToken: secrets.access_token, fetch: ctx.fetch });
      for (const c of ctx.changes) {
        if (c.op === "shopify_add_product") {
          pushed.push(c.after ? await addProduct(client, c, ctx, pushed) : await removeAddedProduct(client, c, ctx));
          continue;
        }
        if (!c.after) continue;
        if (c.entity === "shopify_product") pushed.push(await pushProduct(client, c));
        else if (c.entity === "shopify_page") pushed.push(await pushPage(client, c));
      }
      return { ok: true, result: { pushed }, line: SHOPIFY_LINES.ok };
    } catch (e) {
      const retry = e instanceof ShopifyApiError ? e.retryable : true;
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, retry, error: msg, line: retry ? SHOPIFY_LINES.retry : SHOPIFY_LINES.error(msg), ...(e instanceof ShopifyApiError ? { code: e.code } : {}), ...(pushed.length > 0 ? { partial: { pushed } } : {}) };
    }
  },
};
