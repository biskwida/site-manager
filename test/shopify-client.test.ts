// test/shopify-client.test.ts
import { describe, expect, it } from "vitest";
import { sameMoney } from "@/src/destinations/shopify";
import { refreshShopifyToken, ShopifyApiError, ShopifyClient, toGid, tokenIsStale, validateShopDomain } from "@/src/destinations/shopify-client";
import { shopifyErrorText } from "@/src/destinations/shopify-errors";
import { FakeShopify } from "./fake-shopify";

const NOW = new Date("2026-11-20T09:00:00.000Z");
const caught = async (p: Promise<unknown>): Promise<ShopifyApiError> => p.then(() => { throw new Error("expected a failure"); }, (e) => e as ShopifyApiError);

describe("shop addresses and ids", () => {
  it("accepts only <name>.myshopify.com", () => {
    expect(validateShopDomain(" Smoke-Shop.myshopify.com ")).toBe("smoke-shop.myshopify.com");
    for (const bad of ["smoke-shop.com", "evil.com/x.myshopify.com", "a.myshopify.com.evil.com", "https://a.myshopify.com", "-a.myshopify.com", "a b.myshopify.com", ""]) expect(validateShopDomain(bad)).toBeNull();
    expect(() => new ShopifyClient({ shop: "evil.com", accessToken: "x" })).toThrow(/Not a Shopify store address/);
  });
  it("builds global ids from numbers and refuses ids of another type", () => {
    expect(toGid("Product", 12)).toBe("gid://shopify/Product/12");
    expect(toGid("Product", "gid://shopify/Product/12")).toBe("gid://shopify/Product/12");
    expect(toGid("Product", "gid://shopify/Page/12")).toBeNull();
    expect(toGid("Page", "12; drop")).toBeNull();
  });
  it("compares prices as numbers and treats null and empty as no price", () => {
    expect(sameMoney("13.5", "13.50")).toBe(true);
    expect(sameMoney(null, "")).toBe(true);
    expect(sameMoney(null, "0.00")).toBe(false);
    expect(sameMoney("13.50", "13.51")).toBe(false);
  });
});

describe("errors", () => {
  it("maps HTTP and GraphQL failures to codes, and only outages and throttling are retried", async () => {
    const shop = new FakeShopify();
    const client = shop.connected();
    shop.failNext({ status: 503 });
    expect(await caught(client.shop())).toMatchObject({ code: "http_503", retryable: true });
    shop.failNext({ graphql: "THROTTLED" });
    expect(await caught(client.shop())).toMatchObject({ code: "sm_shopify_rate", retryable: true });
    shop.failNext({ graphql: "ACCESS_DENIED" });
    expect(await caught(client.listPages())).toMatchObject({ code: "sm_shopify_scope", retryable: false });
    shop.failNext({ userError: "Title can't be blank" });
    expect(await caught(client.updatePage(shop.pages[0].id, { title: "" }))).toMatchObject({ code: "sm_shopify_invalid", message: "Title can't be blank", retryable: false });
    const stranger = new ShopifyClient({ shop: shop.shop, accessToken: "shpat_unknown", fetch: shop.fetch });
    expect(await caught(stranger.shop())).toMatchObject({ code: "sm_shopify_revoked", retryable: false });
    const offline = new ShopifyClient({ shop: shop.shop, accessToken: "x", fetch: async () => { throw new Error("ECONNRESET"); } });
    expect(await caught(offline.shop())).toMatchObject({ code: "sm_shopify_unreachable", retryable: true });
  });
  it("has owner texts in both languages and passes unknown messages through", () => {
    expect(shopifyErrorText("sm_shopify_conflict: x", "en")).toMatch(/nothing was overwritten/);
    expect(shopifyErrorText("sm_shopify_revoked: x", "bg")).toMatch(/Shopify/);
    expect(shopifyErrorText("sm_shopify_invalid: Title can't be blank", "en")).toBe("Title can't be blank");
  });
});

describe("token refresh", () => {
  it("knows a stale token, trades the refresh token once and never accepts it twice", async () => {
    expect(tokenIsStale({ access_token: "a", access_expires_at: new Date(NOW.getTime() + 3_600_000).toISOString() }, NOW)).toBe(false);
    expect(tokenIsStale({ access_token: "a", access_expires_at: new Date(NOW.getTime() + 60_000).toISOString() }, NOW)).toBe(true);
    expect(tokenIsStale({ access_token: "a" }, NOW)).toBe(true);
    const shop = new FakeShopify();
    const creds = { clientId: shop.clientId, clientSecret: shop.clientSecret };
    const { refresh_token } = shop.issueTokens();
    const t = await refreshShopifyToken(shop.fetch, creds, shop.shop, refresh_token, NOW);
    expect(t.access_expires_at).toBe("2026-11-20T10:00:00.000Z");
    expect(t.refresh_token).not.toBe(refresh_token);
    expect(await new ShopifyClient({ shop: shop.shop, accessToken: t.access_token, fetch: shop.fetch }).shop()).toMatchObject({ name: "Smoke Shop", currency: "EUR" });
    expect(await caught(refreshShopifyToken(shop.fetch, creds, shop.shop, refresh_token, NOW))).toMatchObject({ code: "sm_shopify_revoked", retryable: false });
  });
});
