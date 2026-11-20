// src/destinations/shopify-client.ts
// Server-only: a typed client for the Shopify GraphQL Admin API (products, variants, pages) and the token endpoint.
// GraphQL only (new public apps may not use REST). The access token travels only in the X-Shopify-Access-Token
// header or the token endpoint's JSON body, never in a URL. Errors carry a code and a fixed or Shopify-supplied
// message (never a token), so they are safe to store in a sync row and to log.

/** Pinned Admin API version; Shopify retires a version about a year after its release. */
export const SHOPIFY_API_VERSION = "2026-10";
const TIMEOUT_MS = 20_000;
/** An access token this close to its end is refreshed before use. */
const REFRESH_MARGIN_MS = 5 * 60_000;

export class ShopifyApiError extends Error {
  private readonly retryOverride: boolean | undefined;
  constructor(public readonly status: number, public readonly code: string, message: string, o: { retry?: boolean } = {}) {
    super(message);
    this.name = "ShopifyApiError";
    this.retryOverride = o.retry;
  }
  /** Network failures, throttling and 5xx are worth another attempt later; a revoked token and other 4xx are not. */
  get retryable(): boolean {
    if (this.retryOverride !== undefined) return this.retryOverride;
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface ShopifyCreds {
  clientId: string;
  clientSecret: string;
}

/** `<name>.myshopify.com`, lower case; null for anything else (so a request can never be aimed at another host). */
export function validateShopDomain(raw: string): string | null {
  const shop = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/.test(shop) ? shop : null;
}

/** "gid://shopify/Product/12" from "12" or from a gid of that type; null when it is neither. */
export function toGid(type: "Product" | "ProductVariant" | "Page", id: string | number): string | null {
  const s = String(id).trim();
  if (/^\d+$/.test(s)) return `gid://shopify/${type}/${s}`;
  return new RegExp(`^gid://shopify/${type}/\\d+$`).test(s) ? s : null;
}

export interface ShopInfo { name: string; domain: string; url: string; currency: string }
export interface ShopifyVariant { id: string; title: string; price: string; compare_at_price: string | null }
export interface ShopifyProductSummary { id: string; title: string; handle: string; status: string; price_min: string; price_max: string; variants_count: number }
export interface ShopifyProduct { id: string; title: string; handle: string; status: string; description_html: string; url: string | null; updated_at: string; variants: ShopifyVariant[] }
export interface ShopifyPageSummary { id: string; title: string; handle: string; published: boolean }
export interface ShopifyPage extends ShopifyPageSummary { body: string; updated_at: string }
export interface ShopifyProductFields { title?: string; description_html?: string; status?: string }
export interface ShopifyVariantPrice { id: string; price?: string; compare_at_price?: string | null }
export interface ShopifyPageFields { title?: string; body?: string }

async function send(f: typeof fetch, url: string, init: RequestInit): Promise<{ res: Response; json: unknown }> {
  let res: Response;
  try {
    res = await f(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ShopifyApiError(0, "sm_shopify_unreachable", "Shopify did not answer.");
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json };
}

function httpError(status: number): ShopifyApiError {
  if (status === 401) return new ShopifyApiError(status, "sm_shopify_revoked", "Shopify no longer accepts the connection.", { retry: false });
  if (status === 402) return new ShopifyApiError(status, "sm_shopify_frozen", "The Shopify store is frozen (unpaid).");
  if (status === 403) return new ShopifyApiError(status, "sm_shopify_scope", "The Shopify connection lacks a permission.");
  if (status === 404) return new ShopifyApiError(status, "sm_shopify_not_found", "Shopify does not know this store.");
  if (status === 423) return new ShopifyApiError(status, "sm_shopify_locked", "The Shopify store is locked.");
  if (status === 429) return new ShopifyApiError(status, "sm_shopify_rate", "Shopify asked to slow down.");
  return new ShopifyApiError(status, `http_${status}`, `Shopify answered HTTP ${status}.`);
}

export interface ShopifyTokens {
  access_token: string;
  /** ISO time the access token ends. */
  access_expires_at: string;
  refresh_token: string;
}

/**
 * Trades a refresh token for a new access token (expiring offline tokens: the access token lives about an hour, the
 * refresh token 90 days and is replaced on every use). The caller stores the reply encrypted and never logs it.
 */
export async function refreshShopifyToken(f: typeof fetch, creds: ShopifyCreds, shop: string, refreshToken: string, now: Date): Promise<ShopifyTokens> {
  const { res, json } = await send(f, `https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new ShopifyApiError(res.status, "sm_shopify_revoked", "Shopify no longer accepts the connection.", { retry: false });
    throw httpError(res.status);
  }
  const r = (json ?? {}) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown };
  if (typeof r.access_token !== "string" || !r.access_token) throw new ShopifyApiError(res.status, "sm_shopify_invalid", "Shopify returned no token.");
  const seconds = typeof r.expires_in === "number" && r.expires_in > 0 ? r.expires_in : 3600;
  return {
    access_token: r.access_token,
    access_expires_at: new Date(now.getTime() + seconds * 1000).toISOString(),
    refresh_token: typeof r.refresh_token === "string" && r.refresh_token ? r.refresh_token : refreshToken,
  };
}

/** True when the stored access token is missing, has no end time on record, or ends within the margin. */
export function tokenIsStale(secrets: Record<string, string>, now: Date): boolean {
  if (!secrets.access_token) return true;
  const end = Date.parse(secrets.access_expires_at ?? "");
  return Number.isNaN(end) || end - now.getTime() < REFRESH_MARGIN_MS;
}

interface UserError { field?: unknown; message?: unknown }
interface GqlReply { data?: Record<string, unknown> | null; errors?: { message?: unknown; extensions?: { code?: unknown } }[] }

export interface ShopifyClientOptions {
  shop: string;
  accessToken: string;
  fetch?: typeof fetch;
}

const PRODUCT_FIELDS = "id title handle status descriptionHtml onlineStoreUrl updatedAt variants(first: 100) { nodes { id title price compareAtPrice } }";
const PAGE_FIELDS = "id title handle isPublished body updatedAt";

export class ShopifyClient {
  private readonly f: typeof fetch;
  constructor(private readonly o: ShopifyClientOptions) {
    if (!validateShopDomain(o.shop)) throw new ShopifyApiError(0, "sm_shopify_invalid", "Not a Shopify store address.", { retry: false });
    this.f = o.fetch ?? ((input, init) => fetch(input, init));
  }

  get shopDomain(): string {
    return this.o.shop;
  }

  /** One GraphQL call. Throws on HTTP errors, top-level GraphQL errors and (via `userErrors`) refused mutations. */
  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const { res, json } = await send(this.f, `https://${this.o.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-shopify-access-token": this.o.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw httpError(res.status);
    const reply = (json ?? {}) as GqlReply;
    if (Array.isArray(reply.errors) && reply.errors.length > 0) {
      const first = reply.errors[0];
      const code = String(first.extensions?.code ?? "");
      if (code === "THROTTLED") throw new ShopifyApiError(429, "sm_shopify_rate", "Shopify asked to slow down.");
      if (code === "ACCESS_DENIED") throw new ShopifyApiError(403, "sm_shopify_scope", "The Shopify connection lacks a permission.");
      throw new ShopifyApiError(400, "sm_shopify_invalid", typeof first.message === "string" ? first.message.slice(0, 200) : "Shopify rejected the request.");
    }
    if (!reply.data) throw new ShopifyApiError(res.status, "sm_shopify_invalid", "Shopify returned no data.");
    return reply.data as T;
  }

  private static check(userErrors: unknown): void {
    const errs = Array.isArray(userErrors) ? (userErrors as UserError[]) : [];
    if (errs.length > 0) throw new ShopifyApiError(422, "sm_shopify_invalid", String(errs[0].message ?? "Shopify rejected the change.").slice(0, 200));
  }

  async shop(): Promise<ShopInfo> {
    const d = await this.gql<{ shop: { name: string; myshopifyDomain: string; currencyCode: string; primaryDomain: { url: string } | null } }>(
      "query { shop { name myshopifyDomain currencyCode primaryDomain { url } } }",
    );
    return { name: d.shop.name, domain: d.shop.myshopifyDomain, url: d.shop.primaryDomain?.url ?? `https://${d.shop.myshopifyDomain}`, currency: d.shop.currencyCode };
  }

  /** Up to `first` products by title, with the price range instead of every variant (keeps the query cheap). */
  async listProducts(first = 50, search?: string): Promise<{ products: ShopifyProductSummary[]; more: boolean }> {
    interface Node { id: string; title: string; handle: string; status: string; variantsCount: { count: number } | null; priceRangeV2: { minVariantPrice: { amount: string }; maxVariantPrice: { amount: string } } | null }
    const d = await this.gql<{ products: { nodes: Node[]; pageInfo: { hasNextPage: boolean } } }>(
      "query($first: Int!, $query: String) { products(first: $first, sortKey: TITLE, query: $query) { nodes { id title handle status variantsCount { count } priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } } } pageInfo { hasNextPage } } }",
      { first, query: search?.trim() || null },
    );
    return {
      products: d.products.nodes.map((n) => ({ id: n.id, title: n.title, handle: n.handle, status: n.status, price_min: n.priceRangeV2?.minVariantPrice.amount ?? "", price_max: n.priceRangeV2?.maxVariantPrice.amount ?? "", variants_count: n.variantsCount?.count ?? 0 })),
      more: d.products.pageInfo.hasNextPage,
    };
  }

  async product(id: string): Promise<ShopifyProduct> {
    interface Node { id: string; title: string; handle: string; status: string; descriptionHtml: string | null; onlineStoreUrl: string | null; updatedAt: string; variants: { nodes: { id: string; title: string; price: string; compareAtPrice: string | null }[] } }
    const d = await this.gql<{ product: Node | null }>(`query($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`, { id });
    if (!d.product) throw new ShopifyApiError(404, "sm_shopify_missing", "No such product.", { retry: false });
    const p = d.product;
    return { id: p.id, title: p.title, handle: p.handle, status: p.status, description_html: p.descriptionHtml ?? "", url: p.onlineStoreUrl, updated_at: p.updatedAt, variants: p.variants.nodes.map((v) => ({ id: v.id, title: v.title, price: v.price, compare_at_price: v.compareAtPrice })) };
  }

  async updateProduct(id: string, fields: ShopifyProductFields): Promise<void> {
    const product: Record<string, unknown> = { id };
    if (fields.title !== undefined) product.title = fields.title;
    if (fields.description_html !== undefined) product.descriptionHtml = fields.description_html;
    if (fields.status !== undefined) product.status = fields.status;
    const d = await this.gql<{ productUpdate: { userErrors: unknown } | null }>(
      "mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id } userErrors { field message } } }",
      { product },
    );
    ShopifyClient.check(d.productUpdate?.userErrors);
  }

  async updateVariantPrices(productId: string, variants: ShopifyVariantPrice[]): Promise<void> {
    const input = variants.map((v) => {
      const row: Record<string, unknown> = { id: v.id };
      if (v.price !== undefined) row.price = v.price;
      if (v.compare_at_price !== undefined) row.compareAtPrice = v.compare_at_price;
      return row;
    });
    const d = await this.gql<{ productVariantsBulkUpdate: { userErrors: unknown } | null }>(
      "mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id } userErrors { field message } } }",
      { productId, variants: input },
    );
    ShopifyClient.check(d.productVariantsBulkUpdate?.userErrors);
  }

  async listPages(first = 50): Promise<ShopifyPageSummary[]> {
    const d = await this.gql<{ pages: { nodes: { id: string; title: string; handle: string; isPublished: boolean }[] } }>(
      "query($first: Int!) { pages(first: $first) { nodes { id title handle isPublished } } }",
      { first },
    );
    return d.pages.nodes.map((n) => ({ id: n.id, title: n.title, handle: n.handle, published: n.isPublished }));
  }

  async page(id: string): Promise<ShopifyPage> {
    const d = await this.gql<{ page: { id: string; title: string; handle: string; isPublished: boolean; body: string | null; updatedAt: string } | null }>(`query($id: ID!) { page(id: $id) { ${PAGE_FIELDS} } }`, { id });
    if (!d.page) throw new ShopifyApiError(404, "sm_shopify_missing", "No such page.", { retry: false });
    const p = d.page;
    return { id: p.id, title: p.title, handle: p.handle, published: p.isPublished, body: p.body ?? "", updated_at: p.updatedAt };
  }

  async updatePage(id: string, fields: ShopifyPageFields): Promise<void> {
    const page: Record<string, unknown> = {};
    if (fields.title !== undefined) page.title = fields.title;
    if (fields.body !== undefined) page.body = fields.body;
    const d = await this.gql<{ pageUpdate: { userErrors: unknown } | null }>(
      "mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id } userErrors { field message } } }",
      { id, page },
    );
    ShopifyClient.check(d.pageUpdate?.userErrors);
  }
}
