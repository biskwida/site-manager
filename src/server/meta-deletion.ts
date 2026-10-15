// src/server/meta-deletion.ts
// Server-only. Meta's two app-removal callbacks (App settings → Facebook Login / Instagram → Deauthorize callback URL and Data
// Deletion Request URL). Both POST a form field `signed_request` = base64url(HMAC-SHA256(payload, app secret)) "." base64url(JSON
// payload), payload { algorithm: "HMAC-SHA256", user_id: <app-scoped id>, issued_at }. Facebook Login signs with META_APP_SECRET,
// Instagram Login with INSTAGRAM_APP_SECRET; both are tried (constant-time compare) and the one that matched says which
// connections may be removed: Facebook rows by config.app_user_id, Instagram rows by config.app_user_id or config.ig_user_id
// (stored on connect, src/server/social-connect.ts). Removing = deleting the destination row: the encrypted token goes with it,
// exactly like the dashboard's Disconnect. A data deletion request is recorded with a confirmation code whose status
// /data-deletion?code= shows; Meta wants 200 with { url, confirmation_code } even when nothing matched.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "../config";
import type { DeletionProvider, DeletionStatus, Destination, Store } from "../store/types";

export const DEAUTHORIZE_PATH = "/api/meta/deauthorize";
export const DATA_DELETION_CALLBACK_PATH = "/api/meta/data-deletion";
export const DATA_DELETION_PAGE_PATH = "/data-deletion";
const MAX_SIGNED_REQUEST = 4096;
const CODE_RE = /^[A-Z2-9]{12}$/;
const NO_STORE = { "cache-control": "no-store" };

export interface MetaDeletionDeps {
  store: Store;
  config: Pick<Config, "publicBaseUrl" | "metaAppSecret" | "instagramAppSecret">;
  now: () => Date;
}

export interface VerifiedRequest {
  /** The app-scoped user id Meta names. */
  userId: string;
  /** Which logins' secrets signed it (both when the two apps share one secret). */
  providers: DeletionProvider[];
}

function userIdOf(v: unknown): string | null {
  if (typeof v === "string") return /^[\w-]{1,64}$/.test(v) ? v : null;
  // A number past 2^53 has lost digits in JSON.parse: never match on it.
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  return null;
}

/** The verified user id and the matching providers; null for a bad signature, another algorithm, no user id or junk. */
export function verifySignedRequest(raw: string | null, config: Pick<Config, "metaAppSecret" | "instagramAppSecret">): VerifiedRequest | null {
  if (!raw || raw.length > MAX_SIGNED_REQUEST) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const sig = Buffer.from(raw.slice(0, dot), "base64url");
  const body = raw.slice(dot + 1);
  const candidates: [DeletionProvider, string | null][] = [["facebook", config.metaAppSecret], ["instagram", config.instagramAppSecret]];
  const providers: DeletionProvider[] = [];
  for (const [provider, secret] of candidates) {
    if (!secret) continue;
    const expect = createHmac("sha256", secret).update(body).digest();
    if (sig.length === expect.length && timingSafeEqual(sig, expect)) providers.push(provider);
  }
  if (!providers.length) return null;
  let payload: { algorithm?: unknown; user_id?: unknown } | null;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof payload;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || typeof payload.algorithm !== "string" || payload.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
  const userId = userIdOf(payload.user_id);
  return userId ? { userId, providers } : null;
}

/** Deletes every connection the verified request names; returns how many. */
async function removeConnections(store: Store, v: VerifiedRequest): Promise<number> {
  const found = new Map<string, Destination>();
  for (const provider of v.providers) {
    for (const key of provider === "facebook" ? ["app_user_id"] : ["app_user_id", "ig_user_id"]) {
      for (const d of await store.findDestinationsByConfig(provider, key, v.userId)) found.set(d.id, d);
    }
  }
  for (const d of found.values()) await store.deleteDestination(d.id);
  return found.size;
}

async function signedRequestOf(req: Request): Promise<string | null> {
  const form = await req.formData().catch(() => null);
  const v = form?.get("signed_request");
  return typeof v === "string" ? v : null;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function verified(req: Request, d: MetaDeletionDeps): Promise<VerifiedRequest | Response> {
  if (!d.config.metaAppSecret && !d.config.instagramAppSecret) return json({ error: "not_configured" }, 503);
  const v = verifySignedRequest(await signedRequestOf(req), d.config);
  return v ?? json({ error: "invalid_signed_request" }, 400);
}

/** POST /api/meta/deauthorize: the user removed the app; their connections (and tokens) are deleted. */
export async function handleMetaDeauthorize(req: Request, d: MetaDeletionDeps): Promise<Response> {
  const v = await verified(req, d);
  if (v instanceof Response) return v;
  const n = await removeConnections(d.store, v);
  console.log(`[meta] deauthorize (${v.providers.join("+")}): ${n} connection(s) removed`);
  return json({ success: true });
}

/** POST /api/meta/data-deletion: same removal, recorded with a confirmation code; answers { url, confirmation_code }. */
export async function handleMetaDataDeletion(req: Request, d: MetaDeletionDeps): Promise<Response> {
  const v = await verified(req, d);
  if (v instanceof Response) return v;
  const record = await d.store.createDeletionRequest({ provider: v.providers[0], subject_id: v.userId, now: d.now().toISOString() });
  try {
    const n = await removeConnections(d.store, v);
    await d.store.completeDeletionRequest(record.confirmation_code, d.now().toISOString());
    console.log(`[meta] data deletion (${v.providers.join("+")}): ${n} connection(s) removed`);
  } catch (e) {
    // The request stays pending (the status page says so); Meta still gets its code.
    console.error(`[meta] data deletion failed: ${e instanceof Error ? e.message : "error"}`);
  }
  const code = record.confirmation_code;
  return json({ url: `${d.config.publicBaseUrl}${DATA_DELETION_PAGE_PATH}?code=${code}`, confirmation_code: code });
}

export interface DeletionStatusView {
  status: DeletionStatus;
  provider: DeletionProvider;
  created_at: string;
  completed_at: string | null;
}

/** What /data-deletion?code= shows (never the user id); null for a malformed or unknown code. */
export async function deletionStatus(store: Store, code: string | null | undefined): Promise<DeletionStatusView | null> {
  const c = (code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(c)) return null;
  const r = await store.getDeletionRequest(c);
  return r ? { status: r.status, provider: r.provider, created_at: r.created_at, completed_at: r.completed_at } : null;
}
