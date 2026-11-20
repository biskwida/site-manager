// test/fake-shopify.ts
// In-memory stand-in for the parts of Shopify the Shopify destination uses, served through `fetch`:
// - POST https://<shop>/admin/api/<version>/graphql.json: shop, products, product, productUpdate,
//   productVariantsBulkUpdate, pages, page, pageUpdate (the operation is recognised by its root field)
// - POST https://<shop>/admin/oauth/access_token (grant_type refresh_token): a new access token and a new refresh
//   token; the old refresh token is spent
// An unknown or expired access token answers 401. Seed with addProduct/addPage; `failNext` queues one failure.
import { randomBytes } from "node:crypto";
import { SHOPIFY_API_VERSION, ShopifyClient } from "@/src/destinations/shopify-client";

export interface FakeVariant { id: string; title: string; price: string; compareAtPrice: string | null }
export interface FakeProduct { id: string; title: string; handle: string; status: string; descriptionHtml: string; updatedAt: string; variants: FakeVariant[] }
export interface FakePage { id: string; title: string; handle: string; isPublished: boolean; body: string; updatedAt: string }
export interface FakeShopifyCall { path: string; root: string; variables: Record<string, unknown> }
export type FakeShopifyFailure = { status: number } | { graphql: string } | { userError: string };

type Json = Record<string, unknown>;
const tok = (p: string) => `${p}${randomBytes(12).toString("hex")}`;
const ROOTS = ["productVariantsBulkUpdate", "productUpdate", "pageUpdate", "products", "product", "pages", "page", "shop"] as const;

export class FakeShopify {
  readonly shop = "smoke-shop.myshopify.com";
  readonly clientId = "client-id";
  readonly clientSecret = "client-secret";
  name = "Smoke Shop";
  currency = "EUR";
  products: FakeProduct[] = [];
  pages: FakePage[] = [];
  calls: FakeShopifyCall[] = [];
  accessTokens = new Set<string>();
  refreshTokens = new Set<string>();
  private failures: FakeShopifyFailure[] = [];
  private nextId = 100;
  private clock = Date.parse("2026-11-01T10:00:00.000Z");

  constructor() {
    this.addProduct({ title: "Linen shirt", descriptionHtml: "<p>Soft washed linen.</p>", variants: [{ title: "S", price: "49.00" }, { title: "M", price: "49.00" }] });
    this.addProduct({ title: "Blue mug", descriptionHtml: "<p>Hand-thrown stoneware.</p>", variants: [{ title: "Default Title", price: "18.00" }] });
    this.addPage({ title: "About", body: "<p>We sew every shirt in Plovdiv.</p><p>Delivery takes 3 days.</p>" });
  }

  private stamp(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  addProduct(p: { title: string; descriptionHtml?: string; status?: string; variants: { title: string; price: string; compareAtPrice?: string | null }[] }): FakeProduct {
    const id = `gid://shopify/Product/${this.nextId++}`;
    const row: FakeProduct = { id, title: p.title, handle: p.title.toLowerCase().replace(/\s+/g, "-"), status: p.status ?? "ACTIVE", descriptionHtml: p.descriptionHtml ?? "", updatedAt: this.stamp(), variants: p.variants.map((v) => ({ id: `gid://shopify/ProductVariant/${this.nextId++}`, title: v.title, price: v.price, compareAtPrice: v.compareAtPrice ?? null })) };
    this.products.push(row);
    return row;
  }

  addPage(p: { title: string; body: string }): FakePage {
    const row: FakePage = { id: `gid://shopify/Page/${this.nextId++}`, title: p.title, handle: p.title.toLowerCase(), isPublished: true, body: p.body, updatedAt: this.stamp() };
    this.pages.push(row);
    return row;
  }

  /** The next GraphQL call fails this way (HTTP status, a top-level GraphQL error code, or a userError). */
  failNext(f: FakeShopifyFailure): void {
    this.failures.push(f);
  }

  issueTokens(): { access_token: string; refresh_token: string } {
    const access_token = tok("shpat_");
    const refresh_token = tok("shprt_");
    this.accessTokens.add(access_token);
    this.refreshTokens.add(refresh_token);
    return { access_token, refresh_token };
  }

  /** A client holding a fresh access token. */
  connected(): ShopifyClient {
    return new ShopifyClient({ shop: this.shop, accessToken: this.issueTokens().access_token, fetch: this.fetch });
  }

  writes(): FakeShopifyCall[] {
    return this.calls.filter((c) => /Update$/.test(c.root));
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== this.shop) return new Response("not found", { status: 404 });
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Json;
    if (url.pathname === "/admin/oauth/access_token") return this.token(body);
    if (url.pathname !== `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`) return new Response("not found", { status: 404 });
    const headers = new Headers(init?.headers);
    if (!this.accessTokens.has(headers.get("x-shopify-access-token") ?? "")) return Response.json({ errors: "[API] Invalid API key or access token" }, { status: 401 });
    const query = String(body.query ?? "");
    const variables = (body.variables ?? {}) as Json;
    const root = ROOTS.find((r) => new RegExp(`[{\\s]${r}\\s*[({]`).test(query)) ?? "unknown";
    this.calls.push({ path: url.pathname, root, variables });
    const failure = this.failures.shift();
    if (failure && "status" in failure) return new Response("", { status: failure.status });
    if (failure && "graphql" in failure) return Response.json({ errors: [{ message: failure.graphql, extensions: { code: failure.graphql } }] });
    const userErrors = failure && "userError" in failure ? [{ field: ["input"], message: failure.userError }] : [];
    return Response.json({ data: this.resolve(root, variables, userErrors) });
  };

  private token(body: Json): Response {
    if (body.client_id !== this.clientId || body.client_secret !== this.clientSecret) return Response.json({ error: "invalid_client" }, { status: 401 });
    if (body.grant_type !== "refresh_token" || !this.refreshTokens.has(String(body.refresh_token))) return Response.json({ error: "invalid_request" }, { status: 400 });
    this.refreshTokens.delete(String(body.refresh_token));
    return Response.json({ ...this.issueTokens(), expires_in: 3600, refresh_token_expires_in: 7776000, scope: "write_products,write_content" });
  }

  private resolve(root: string, v: Json, userErrors: Json[]): Json {
    const failed = userErrors.length > 0;
    switch (root) {
      case "shop":
        return { shop: { name: this.name, myshopifyDomain: this.shop, currencyCode: this.currency, primaryDomain: { url: "https://smoke-shop.example" } } };
      case "products": {
        const q = typeof v.query === "string" ? v.query.toLowerCase() : "";
        const all = this.products.filter((p) => !q || p.title.toLowerCase().includes(q)).sort((a, b) => a.title.localeCompare(b.title));
        const first = Number(v.first ?? 50);
        return {
          products: {
            nodes: all.slice(0, first).map((p) => {
              const prices = p.variants.map((x) => Number(x.price));
              return { id: p.id, title: p.title, handle: p.handle, status: p.status, variantsCount: { count: p.variants.length }, priceRangeV2: { minVariantPrice: { amount: Math.min(...prices).toFixed(2) }, maxVariantPrice: { amount: Math.max(...prices).toFixed(2) } } };
            }),
            pageInfo: { hasNextPage: all.length > first },
          },
        };
      }
      case "product": {
        const p = this.products.find((x) => x.id === v.id);
        return { product: p ? { ...p, onlineStoreUrl: `https://smoke-shop.example/products/${p.handle}`, variants: { nodes: p.variants } } : null };
      }
      case "productUpdate": {
        const input = (v.product ?? {}) as Json;
        const p = this.products.find((x) => x.id === input.id);
        if (!p) return { productUpdate: { product: null, userErrors: [{ field: ["id"], message: "Product does not exist" }] } };
        if (!failed) {
          if (typeof input.title === "string") p.title = input.title;
          if (typeof input.descriptionHtml === "string") p.descriptionHtml = input.descriptionHtml;
          if (typeof input.status === "string") p.status = input.status;
          p.updatedAt = this.stamp();
        }
        return { productUpdate: { product: failed ? null : { id: p.id }, userErrors } };
      }
      case "productVariantsBulkUpdate": {
        const p = this.products.find((x) => x.id === v.productId);
        if (!p) return { productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["productId"], message: "Product does not exist" }] } };
        const rows = (Array.isArray(v.variants) ? v.variants : []) as Json[];
        if (!failed) {
          for (const r of rows) {
            const variant = p.variants.find((x) => x.id === r.id);
            if (!variant) return { productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["variants"], message: "Variant does not exist" }] } };
            if (typeof r.price === "string") variant.price = Number(r.price).toFixed(2);
            if ("compareAtPrice" in r) variant.compareAtPrice = r.compareAtPrice === null ? null : Number(r.compareAtPrice).toFixed(2);
          }
          p.updatedAt = this.stamp();
        }
        return { productVariantsBulkUpdate: { productVariants: failed ? null : rows.map((r) => ({ id: r.id })), userErrors } };
      }
      case "pages":
        return { pages: { nodes: this.pages.slice(0, Number(v.first ?? 50)).map((p) => ({ id: p.id, title: p.title, handle: p.handle, isPublished: p.isPublished })) } };
      case "page":
        return { page: this.pages.find((x) => x.id === v.id) ?? null };
      case "pageUpdate": {
        const p = this.pages.find((x) => x.id === v.id);
        if (!p) return { pageUpdate: { page: null, userErrors: [{ field: ["id"], message: "Page does not exist" }] } };
        const input = (v.page ?? {}) as Json;
        if (!failed) {
          if (typeof input.title === "string") p.title = input.title;
          if (typeof input.body === "string") p.body = input.body;
          p.updatedAt = this.stamp();
        }
        return { pageUpdate: { page: failed ? null : { id: p.id }, userErrors } };
      }
      default:
        return {};
    }
  }
}
