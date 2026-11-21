// src/destinations/shopify-connect.ts
// Server-only. A ready client for a venue's connected Shopify store. The stored access token lives about an hour, so
// it is refreshed here (and the new pair stored encrypted) before the agent reads the store. Never logs a token.
// The install and token exchange that create the destination row arrive with the embedded admin screen (phase 2).
import type { Store } from "../store/types";
import { decryptSecrets, encryptSecrets } from "./secrets";
import { refreshShopifyToken, ShopifyClient, tokenIsStale, validateShopDomain, type ShopifyCreds } from "./shopify-client";

export interface ShopifyConnectDeps {
  store: Store;
  /** null = secrets cannot be read (production without DESTINATION_SECRET_KEY). */
  secretKey: Buffer | null;
  /** null = an expired token cannot be refreshed (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET not set). */
  creds: ShopifyCreds | null;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** The client, or null when no store is connected, secrets cannot be read, or the token is spent and cannot be refreshed. */
export async function shopifyClientFor(d: ShopifyConnectDeps, venueId: string): Promise<ShopifyClient | null> {
  const row = await d.store.getDestination(venueId, "shopify");
  if (!row || row.status === "disconnected" || !d.secretKey) return null;
  const shop = validateShopDomain(String(row.config.shop ?? ""));
  if (!shop) return null;
  let secrets = decryptSecrets(row.secrets, d.secretKey);
  const now = (d.now ?? (() => new Date()))();
  if (tokenIsStale(secrets, now)) {
    if (!secrets.refresh_token || !d.creds) return null;
    const fresh = await refreshShopifyToken(d.fetch ?? fetch, d.creds, shop, secrets.refresh_token, now);
    secrets = { ...secrets, ...fresh };
    await d.store.upsertDestination({ venue_id: row.venue_id, kind: "shopify", config: row.config, secrets: encryptSecrets(secrets, d.secretKey), status: row.status });
  }
  return new ShopifyClient({ shop, accessToken: secrets.access_token, fetch: d.fetch });
}
