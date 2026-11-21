// test/agent-shopify-tools.test.ts
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { shopifyClientFor } from "@/src/destinations/shopify-connect";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { FakeShopify } from "./fake-shopify";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-11-20T09:00:00.000Z");
const KEY = parseSecretKey("ab".repeat(32));
const S = { summary_bg: "Промяна", summary_en: "Change" };

async function setup(over: Partial<AgentDeps> = {}, o: { expired?: boolean } = {}) {
  const demo = await makeDemo();
  const shop = new FakeShopify();
  const tokens = shop.issueTokens();
  const expires = new Date(T0.getTime() + (o.expired ? -60_000 : 3_600_000)).toISOString();
  await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "shopify", config: { shop: shop.shop, shop_name: shop.name }, secrets: encryptSecrets({ ...tokens, access_expires_at: expires }, KEY) });
  const creds = { clientId: shop.clientId, clientSecret: shop.clientSecret };
  const store = withDestinationSync(demo.store, { store: demo.store, secretKey: KEY, fetch: shop.fetch, log: () => undefined, shopify: creds }, () => T0);
  const messenger = new FakeMessenger();
  const member = (await store.findMember("tg:1001"))!;
  const client = await shopifyClientFor({ store: demo.store, secretKey: KEY, creds, fetch: shop.fetch, now: () => T0 }, demo.venue.id);
  const deps: AgentDeps = { store, venueId: demo.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: "https://site.example", shopify: client, ...over };
  const apply = (id: string) => handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", id);
  return { ...demo, store, shop, messenger, deps, tools: makeTools(deps), apply, shirt: shop.products[0], mug: shop.products[1], about: shop.pages[0] };
}

describe("shopify tools availability", () => {
  it("are absent without a connected store and present with one", async () => {
    const { tools } = await setup({ shopify: null });
    expect(tools.map((t) => t.name).filter((n) => n.startsWith("shopify_"))).toEqual([]);
    const { tools: withShop } = await setup();
    expect(withShop.map((t) => t.name).filter((n) => n.startsWith("shopify_"))).toEqual(["shopify_list_store", "shopify_read_product", "shopify_read_page", "shopify_edit_products", "shopify_add_product", "shopify_edit_page"]);
  });
  it("refreshes an expired access token before the first read and stores the new pair", async () => {
    const { tools, shop, store, venue } = await setup({}, { expired: true });
    expect(shop.refreshTokens.size).toBe(1); // the old refresh token is spent, a new one issued
    const site = await call(tools, "shopify_list_store", {});
    expect(site.store_name).toBe("Smoke Shop");
    const row = await store.getDestination(venue.id, "shopify");
    expect(JSON.stringify(row?.secrets)).not.toContain("shpat_"); // stored encrypted
  });
});

describe("shopify_list_store / shopify_read_product / shopify_read_page", () => {
  it("lists products with price ranges and pages, and reads one of each", async () => {
    const { tools, shirt, mug, about } = await setup();
    const site = await call(tools, "shopify_list_store", {});
    expect(site).toMatchObject({ store_name: "Smoke Shop", currency: "EUR", more_products: false });
    expect(site.products).toEqual([
      { id: mug.id, title: "Blue mug", handle: "blue-mug", status: "ACTIVE", price_min: "18.00", price_max: "18.00", variants_count: 1 },
      { id: shirt.id, title: "Linen shirt", handle: "linen-shirt", status: "ACTIVE", price_min: "49.00", price_max: "49.00", variants_count: 2 },
    ]);
    expect(site.pages).toEqual([{ id: about.id, title: "About", handle: "about", published: true }]);
    const found = await call(tools, "shopify_list_store", { search: "mug" });
    expect((found.products as unknown[]).length).toBe(1);
    // A bare number works as an id too.
    const p = await call(tools, "shopify_read_product", { product_id: shirt.id.split("/").pop() });
    expect(p).toMatchObject({ id: shirt.id, title: "Linen shirt", description_text: "Soft washed linen." });
    expect((p.variants as { title: string; price: string }[]).map((v) => [v.title, v.price])).toEqual([["S", "49.00"], ["M", "49.00"]]);
    const page = await call(tools, "shopify_read_page", { page_id: about.id });
    expect(page).toMatchObject({ title: "About", text: "We sew every shirt in Plovdiv. Delivery takes 3 days." });
    expect(await call(tools, "shopify_read_product", { product_id: "gid://shopify/Product/999" })).toMatchObject({ error: "No such product." });
    expect((await call(tools, "shopify_read_product", { product_id: "abc" })).error).toMatch(/not a Product id/);
  });
});

describe("shopify_edit_products", () => {
  it("proposes prices for several products in one set, writes nothing before ✅, applies with the Shopify line, and undoes", async () => {
    const { tools, store, shop, shirt, mug, messenger, apply } = await setup();
    const r = await call(tools, "shopify_edit_products", {
      ...S,
      products: [
        { product_id: shirt.id, variants: shirt.variants.map((v) => ({ variant_id: v.id, price: "54" })) },
        { product_id: mug.id, title: "Blue mug, large", variants: [{ variant_id: mug.variants[0].id, price: "15.00", compare_at_price: "18.00" }] },
      ],
    });
    expect(r.status).toBe("proposed");
    expect(r.preview).toBe(
      ["• Shopify: продукт „Linen shirt“", "  S: цена: 49.00 EUR → 54.00 EUR", "  M: цена: 49.00 EUR → 54.00 EUR", "• Shopify: продукт „Blue mug“", "  име: „Blue mug“ → „Blue mug, large“", "  цена: 18.00 EUR → 15.00 EUR", "  стара цена (зачеркната): — → 18.00 EUR"].join("\n"),
    );
    expect(shop.writes()).toEqual([]); // nothing written yet
    expect(shirt.variants[0].price).toBe("49.00");
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes.map((c) => [c.op, c.entity, c.entity_id])).toEqual([["shopify_edit_product", "shopify_product", shirt.id], ["shopify_edit_product", "shopify_product", mug.id]]);
    expect(messenger.sent[0]).toMatchObject({ setId: cs.id });
    const decision = await apply(cs.id);
    expect(decision.edit?.full).toContain("✅ Приложено\nShopify: обновено ✅");
    expect(shirt.variants.map((v) => v.price)).toEqual(["54.00", "54.00"]);
    expect(mug).toMatchObject({ title: "Blue mug, large" });
    expect(mug.variants[0]).toMatchObject({ price: "15.00", compareAtPrice: "18.00" });

    const undo = await call(tools, "undo", { change_set_id: "last" });
    expect(undo.status).toBe("proposed");
    expect(undo.preview).toContain("S: цена: 54.00 EUR → 49.00 EUR");
    await apply(undo.change_set_id as string);
    expect(shirt.variants.map((v) => v.price)).toEqual(["49.00", "49.00"]);
    expect(mug).toMatchObject({ title: "Blue mug" });
    expect(mug.variants[0]).toMatchObject({ price: "18.00", compareAtPrice: null });
  });
  it("changes description and status, and refuses no-ops, foreign variants, duplicates, a bad sale price and staff", async () => {
    const { tools, shirt, mug, apply } = await setup();
    const same = await call(tools, "shopify_edit_products", { ...S, products: [{ product_id: mug.id, title: "Blue mug", variants: [{ variant_id: mug.variants[0].id, price: "18" }] }] });
    expect(same.error).toMatch(/Nothing would change/);
    const foreign = await call(tools, "shopify_edit_products", { ...S, products: [{ product_id: mug.id, variants: [{ variant_id: shirt.variants[0].id, price: "20" }] }] });
    expect(foreign.error).toMatch(/does not belong to "Blue mug"/);
    const twice = await call(tools, "shopify_edit_products", { ...S, products: [{ product_id: mug.id, title: "A" }, { product_id: mug.id, title: "B" }] });
    expect(twice.error).toMatch(/listed twice/);
    const sale = await call(tools, "shopify_edit_products", { ...S, products: [{ product_id: mug.id, variants: [{ variant_id: mug.variants[0].id, compare_at_price: "10.00" }] }] });
    expect(sale.error).toMatch(/must be higher than the price/);
    const r = await call(tools, "shopify_edit_products", { ...S, products: [{ product_id: mug.id, description_html: "<p>Now in <strong>two</strong> sizes.</p>", status: "DRAFT" }] });
    expect(r.preview).toBe("• Shopify: продукт „Blue mug“\n  описание: „Hand-thrown stoneware.“ → „Now in two sizes.“\n  статус: активен → чернова");
    await apply(r.change_set_id as string);
    expect(mug).toMatchObject({ status: "DRAFT", descriptionHtml: "<p>Now in <strong>two</strong> sizes.</p>" });
    const { tools: staffTools } = await setup({ chatRef: "tg:1002", member: { venue_id: "", chat_ref: "tg:1002", role: "staff", lang: "en", last_seen_at: null, created_at: "" } });
    const staff = await call(staffTools, "shopify_edit_products", { ...S, products: [{ product_id: 1, title: "X" }] });
    expect(staff.error).toMatch(/only the owner/);
  });
  it("does not overwrite a price someone changed in the Shopify admin after the proposal", async () => {
    const { tools, store, shop, mug, apply, venue } = await setup();
    const r = await call(tools, "shopify_edit_products", { ...S, products: [{ product_id: mug.id, variants: [{ variant_id: mug.variants[0].id, price: "20.00" }] }] });
    mug.variants[0].price = "19.00"; // edited in the admin meanwhile
    const decision = await apply(r.change_set_id as string);
    expect(decision.edit?.full).toContain("Shopify: грешка: някой е променил същото в Shopify междувременно");
    expect(mug.variants[0].price).toBe("19.00");
    expect(shop.writes()).toEqual([]);
    // A conflict says nothing about the connection: the store stays connected.
    expect((await store.getDestination(venue.id, "shopify"))?.status).toBe("connected");
  });
  it("keeps the change for a retry when Shopify is down, and marks the connection on a revoked token", async () => {
    const { tools, store, shop, mug, apply, venue } = await setup();
    const r = await call(tools, "shopify_edit_products", { ...S, products: [{ product_id: mug.id, title: "Mug" }] });
    shop.failNext({ status: 503 });
    const down = await apply(r.change_set_id as string);
    expect(down.edit?.full).toContain("Shopify: не успях да обновя, ще опитам пак");
    expect((await store.listSyncs({ changeSetId: r.change_set_id as string }))[0]).toMatchObject({ status: "pending" });
    expect(mug.title).toBe("Blue mug");

    const again = await setup();
    const r2 = await call(again.tools, "shopify_edit_products", { ...S, products: [{ product_id: again.mug.id, title: "Mug" }] });
    again.shop.accessTokens.clear(); // the app was uninstalled
    const gone = await again.apply(r2.change_set_id as string);
    expect(gone.edit?.full).toContain("Shopify: грешка: връзката с Shopify вече не е валидна");
    expect((await again.store.getDestination(again.venue.id, "shopify"))?.status).toBe("error");
    expect(venue.id).toBeTruthy();
  });
});

describe("shopify_edit_page", () => {
  it("previews a replacement, applies it on ✅ and restores the old text on undo", async () => {
    const { tools, shop, about, apply } = await setup();
    const r = await call(tools, "shopify_edit_page", { ...S, page_id: about.id, replacements: [{ find: "Delivery takes 3 days.", replace: "Delivery takes 2 days." }] });
    expect(r.preview).toBe("• Shopify: страница „About“\n  „Delivery takes 3 days.“ → „Delivery takes 2 days.“");
    expect(shop.writes()).toEqual([]);
    await apply(r.change_set_id as string);
    expect(about.body).toBe("<p>We sew every shirt in Plovdiv.</p><p>Delivery takes 2 days.</p>");
    const undo = await call(tools, "undo", { change_set_id: "last" });
    expect(undo.preview).toBe("• Shopify: страница „About“\n  връща предишния текст");
    await apply(undo.change_set_id as string);
    expect(about.body).toContain("3 days");
  });
  it("refuses ambiguous or missing anchors, body together with replacements, and an unchanged page", async () => {
    const { tools, about } = await setup();
    expect((await call(tools, "shopify_edit_page", { ...S, page_id: about.id, replacements: [{ find: "e", replace: "x" }] })).error).toMatch(/occurs \d+ times in the page body/);
    expect((await call(tools, "shopify_edit_page", { ...S, page_id: about.id, replacements: [{ find: "croissant", replace: "x" }] })).error).toMatch(/occurs 0 times/);
    expect((await call(tools, "shopify_edit_page", { ...S, page_id: about.id, body: "<p>x</p>", replacements: [{ find: "a", replace: "b" }] })).error).toMatch(/either body or replacements/);
    expect((await call(tools, "shopify_edit_page", { ...S, page_id: about.id, title: "About" })).error).toMatch(/Nothing would change/);
  });
});

describe("shopify_add_product", () => {
  const candle = { ...S, title: "Soy candle", description_html: "<p>Burns for 40 hours.</p>", price: "24" };
  it("creates the product as a draft only after ✅, and undo deletes the draft", async () => {
    const { tools, shop, apply } = await setup();
    const r = await call(tools, "shopify_add_product", candle);
    expect(r.preview).toBe("• Shopify: нов продукт (чернова) „Soy candle“\n  цена: 24.00 EUR\n  описание: „Burns for 40 hours.“\n  Остава скрит, докато не го активирате.");
    expect(shop.products).toHaveLength(2); // nothing created yet
    const decision = await apply(r.change_set_id as string);
    expect(decision.edit?.full).toContain("Shopify: обновено ✅");
    const made = shop.products.find((p) => p.title === "Soy candle");
    expect(made).toMatchObject({ status: "DRAFT", descriptionHtml: "<p>Burns for 40 hours.</p>" });
    expect(made?.variants[0].price).toBe("24.00");
    const undo = await call(tools, "undo", { change_set_id: "last" });
    expect(undo.preview).toBe("• Shopify: изтрива черновата на продукт „Soy candle“");
    await apply(undo.change_set_id as string);
    expect(shop.products.map((p) => p.title)).toEqual(["Linen shirt", "Blue mug"]);
  });
  it("undo leaves a product the owner has activated since", async () => {
    const { tools, shop, apply } = await setup();
    const r = await call(tools, "shopify_add_product", candle);
    await apply(r.change_set_id as string);
    shop.products.find((p) => p.title === "Soy candle")!.status = "ACTIVE";
    const undo = await call(tools, "undo", { change_set_id: "last" });
    const decision = await apply(undo.change_set_id as string);
    expect(decision.edit?.full).toContain("Shopify: грешка: продуктът вече не е чернова и не е изтрит");
    expect(shop.products).toHaveLength(3);
  });
  it("a retry after a failed price write prices the same product instead of creating a second one", async () => {
    const { tools, shop, store, deps, apply } = await setup();
    const r = await call(tools, "shopify_add_product", candle);
    shop.failNext({ status: 503, root: "productVariantsBulkUpdate" }); // the product is created, then the price write hits an outage
    await apply(r.change_set_id as string);
    expect(shop.products.filter((p) => p.title === "Soy candle")).toHaveLength(1);
    expect(shop.products.find((p) => p.title === "Soy candle")?.variants[0].price).toBe("0.00");
    const row = (await store.listSyncs({ changeSetId: r.change_set_id as string }))[0];
    expect(row.status).toBe("pending");
    const { runDestinationQueue } = await import("@/src/destinations/sync");
    await runDestinationQueue({ store: deps.store, secretKey: KEY, fetch: shop.fetch, log: () => undefined }, row.destination_id, T0, { force: true, venueId: deps.venueId });
    expect(shop.products.filter((p) => p.title === "Soy candle")).toHaveLength(1);
    expect(shop.products.find((p) => p.title === "Soy candle")?.variants[0].price).toBe("24.00");
    expect((await store.getSync(row.id)).status).toBe("done");
  });
  it("refuses a name the store already has and a compare-at price that is not higher", async () => {
    const { tools } = await setup();
    expect((await call(tools, "shopify_add_product", { ...S, title: "blue mug", price: "10" })).error).toMatch(/already has a product named "Blue mug"/);
    expect((await call(tools, "shopify_add_product", { ...S, title: "Vase", price: "10", compare_at_price: "9" })).error).toMatch(/must be higher than the price/);
  });
});
