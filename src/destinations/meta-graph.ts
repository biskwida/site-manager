// src/destinations/meta-graph.ts
// Server-only: small typed fetch helpers for graph.facebook.com (Page tokens) and graph.instagram.com (Instagram User tokens),
// both Graph v25.0. Tokens travel as a bearer header, never in a URL this module builds; errors carry Meta's code and message
// only (never the URL or the request body), so they are safe to store in a sync row and to log.
import { GRAPH } from "../channels/meta/graph";

export const FB_GRAPH = GRAPH;
/** Same value as IG_GRAPH_URL in src/server/instagram.ts (a test keeps them equal); not imported to keep the wizard out of the tick. */
export const IG_GRAPH = "https://graph.instagram.com/v25.0";
/** Meta's OAuthException code for an access token that expired, was revoked or lost its permissions. */
export const META_TOKEN_INVALID = 190;
const TIMEOUT_MS = 20_000;

export class MetaApiError extends Error {
  readonly metaCode: number | null;
  /** Meta's error_subcode (33 = the object does not exist). */
  readonly subcode: number | null;
  private readonly retryOverride: boolean | undefined;
  constructor(public status: number, public code: string, message: string, o: { metaCode?: number | null; subcode?: number | null; retry?: boolean } = {}) {
    super(message);
    this.name = "MetaApiError";
    this.metaCode = o.metaCode ?? null;
    this.subcode = o.subcode ?? null;
    this.retryOverride = o.retry;
  }
  /** The object is gone (HTTP 404, or Meta's code 100 with subcode 33): a delete of it is already done. */
  get notFound(): boolean {
    return this.status === 404 || (this.metaCode === 100 && this.subcode === 33);
  }
  /** Network failures, 429 and 5xx (or Meta's is_transient) are worth another attempt; other 4xx and an invalid token are not. */
  get retryable(): boolean {
    if (this.retryOverride !== undefined) return this.retryOverride;
    if (this.code === "sm_meta_token") return false;
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

interface MetaErrorBody {
  message?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  is_transient?: unknown;
}

/** Turns a non-2xx Graph reply into a MetaApiError: code 190 → sm_meta_token, 10/200-299 → sm_meta_permission, else meta_<code>. */
function errorFrom(status: number, json: unknown): MetaApiError {
  const err = ((json as { error?: MetaErrorBody } | null)?.error ?? {}) as MetaErrorBody;
  const metaCode = typeof err.code === "number" ? err.code : null;
  const subcode = typeof err.error_subcode === "number" ? err.error_subcode : null;
  const message = typeof err.message === "string" && err.message ? err.message.slice(0, 300) : `HTTP ${status}`;
  if (metaCode === META_TOKEN_INVALID) return new MetaApiError(status, "sm_meta_token", "The access token is no longer valid.", { metaCode });
  if (metaCode === 10 || (metaCode !== null && metaCode >= 200 && metaCode < 300)) return new MetaApiError(status, "sm_meta_permission", message, { metaCode });
  const code = metaCode !== null ? `meta_${metaCode}` : `http_${status}`;
  return new MetaApiError(status, code, message, { metaCode, subcode, ...(err.is_transient === true ? { retry: true } : {}) });
}

/** One Graph request; JSON in, JSON out. `init.headers` may carry the bearer token. Never logs anything. */
export async function metaFetch<T>(f: typeof fetch, url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await f(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new MetaApiError(0, "sm_meta_unreachable", "Meta did not answer.");
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw errorFrom(res.status, json);
  if (json === null || typeof json !== "object") throw new MetaApiError(res.status, "sm_meta_bad_json", "Meta returned no JSON.");
  return json as T;
}

/** Bound to one host (FB_GRAPH or IG_GRAPH) and one token. Paths start with "/" and may carry a query (fields=…). */
export class GraphClient {
  constructor(private readonly base: string, private readonly token: string, private readonly f: typeof fetch = fetch) {}
  private call<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    return metaFetch<T>(this.f, `${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  get<T>(path: string): Promise<T> {
    return this.call<T>("GET", path);
  }
  post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.call<T>("POST", path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.call<T>("DELETE", path);
  }
}
