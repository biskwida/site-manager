// src/destinations/shopify-errors.ts
// Pure (safe in client components): owner-facing text for a stored Shopify sync error ("<code>: <message>").
import { parseSyncError } from "./wp-errors";

const KNOWN: Record<string, { bg: string; en: string }> = {
  sm_shopify_revoked: { bg: "връзката с Shopify вече не е валидна; отворете Claudia в Shopify, за да я подновите", en: "the Shopify connection is no longer valid; open Claudia in Shopify to renew it" },
  sm_shopify_scope: { bg: "Claudia няма нужното разрешение в Shopify; отворете Claudia в Shopify и го одобрете", en: "Claudia lacks a permission in Shopify; open Claudia in Shopify and approve it" },
  sm_shopify_conflict: { bg: "някой е променил същото в Shopify междувременно; нищо не е презаписано, поискайте промяната отново", en: "someone changed the same thing in Shopify in the meantime; nothing was overwritten, ask for the change again" },
  sm_shopify_published: { bg: "продуктът вече не е чернова и не е изтрит; изтрийте го от Shopify, ако желаете", en: "the product is no longer a draft, so it was not deleted; delete it in Shopify if you wish" },
  sm_shopify_missing: { bg: "продуктът или страницата вече не съществува в Shopify", en: "the product or page no longer exists in Shopify" },
  sm_shopify_frozen: { bg: "магазинът в Shopify е замразен", en: "the Shopify store is frozen" },
  sm_shopify_locked: { bg: "магазинът в Shopify е заключен", en: "the Shopify store is locked" },
};

/** Text for the owner: the known codes in their language, anything else as Shopify's (or our) message. */
export function shopifyErrorText(stored: string | null | undefined, lang: "bg" | "en"): string {
  if (!stored) return "";
  const { code, message } = parseSyncError(stored);
  const known = code ? KNOWN[code] : undefined;
  return known ? known[lang] : message;
}
