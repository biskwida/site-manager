# Shopify (Claudia)

Plan and reasoning: the "Claudia for Shopify: plan" document (2026-11-20). This file describes what the code does today.

## Status: phase 1 (offline core)

A venue's Shopify store is a destination of kind `shopify`. The agent can read the store and propose changes to products and pages; nothing is written before the owner approves, and every change can be undone.

Not built yet (phase 2 onward): the install and token exchange from Shopify, the screen inside the Shopify admin, uninstall and privacy webhooks, Shopify billing, photos, new products, stock, collections, menus, blog, translations, theme blocks. Until the install flow exists no real store can be connected, so nothing here reaches a real shop.

## What the agent can do

| Tool | What |
|---|---|
| `shopify_list_store` | store name, address, currency, up to 50 products (price range) and pages; `search` narrows products |
| `shopify_read_product` | one product with every variant, its price and compare-at price |
| `shopify_read_page` | one page: visible text and HTML body |
| `shopify_edit_products` | name, description, status (active or draft) and variant prices of 1 to 50 products in one proposal |
| `shopify_edit_page` | page title, exact text replacements or a full new body |

The tools exist only when the venue has a connected store. Only the owner can propose Shopify changes.

## Safety rules in the code

- **Approval first.** The tools only create a change set (`shopify_product` and `shopify_page` rows with before and after). The push runs after ✅, through the same store hook and retry queue as WordPress.
- **Conflict check.** Before each write the adapter reads the current values. A field that is neither what the proposal saw nor what it wants was changed in the Shopify admin meanwhile: the push stops with `sm_shopify_conflict` and overwrites nothing. An undo is checked the same way.
- **Connection state.** Only a revoked token or a missing permission marks the destination as `error`; a conflict, a refused value or an outage does not.
- **Tokens.** Access tokens live about an hour and are refreshed with the refresh token (replaced on every use); both are stored encrypted with `DESTINATION_SECRET_KEY`. Requests go only to `<name>.myshopify.com`.
- **GraphQL only**, pinned to the version in `SHOPIFY_API_VERSION` (`src/destinations/shopify-client.ts`).

## Environment keys

| Key | What |
|---|---|
| `SHOPIFY_CLIENT_ID` | client id of the Claudia app in the Shopify Dev Dashboard |
| `SHOPIFY_CLIENT_SECRET` | its secret |
| `DESTINATION_SECRET_KEY` | encrypts each store's tokens (shared with WordPress, Google and social) |

Neither Shopify key is needed until phase 2.

## Before deploying code that stores Shopify rows

Apply the migration: `npm run db:apply -- supabase/migrations/2026-11-20-shopify.sql`. It allows destination kind `shopify` and the two new change entities. Phase 1 creates no such rows in production, because no store can be connected yet.

## To verify against a real development store (phase 2)

These were written from Shopify's documentation and tested against `test/fake-shopify.ts` only:

- the refresh call (`POST /admin/oauth/access_token`, `grant_type=refresh_token`) and its reply fields;
- the GraphQL field and mutation names (`productUpdate(product:)`, `productVariantsBulkUpdate`, `pageUpdate(id:, page:)`, `priceRangeV2`, `variantsCount`);
- the scope names (`write_products`, `write_content`).

## Tests

`npx vitest run test/agent-shopify-tools.test.ts test/shopify-client.test.ts`
