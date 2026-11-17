// src/destinations/google-api.ts
// Server-only: typed fetch helpers for the Google Business Profile APIs (Business Information v1, Account Management v1,
// My Business v4 reviews) and the OAuth token endpoint. Tokens travel only in the bearer header or the token endpoint's
// form body, never in a URL this module builds. Errors carry a code and a fixed or Google-supplied message (never a URL,
// a request body or a token), so they are safe to store in a sync row and to log.

export const GOOGLE_INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
export const GOOGLE_ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
export const GOOGLE_V4 = "https://mybusiness.googleapis.com/v4";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_EDIT_URL = "https://business.google.com/";
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";
const TIMEOUT_MS = 20_000;
const API_HOSTS = new Set([GOOGLE_INFO, GOOGLE_ACCOUNTS, GOOGLE_V4].map((u) => new URL(u).hostname));
const MAX_ACCOUNTS = 10;

export class GoogleApiError extends Error {
  private readonly retryOverride: boolean | undefined;
  constructor(public readonly status: number, public readonly code: string, message: string, o: { retry?: boolean } = {}) {
    super(message);
    this.name = "GoogleApiError";
    this.retryOverride = o.retry;
  }
  /** The object is gone (HTTP 404): a delete of it is already done. */
  get notFound(): boolean {
    return this.status === 404;
  }
  /** Network failures, 429 and 5xx are worth another attempt; a revoked token and other 4xx are not. */
  get retryable(): boolean {
    if (this.retryOverride !== undefined) return this.retryOverride;
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface GoogleCreds {
  clientId: string;
  clientSecret: string;
}

interface ApiErrorBody {
  message?: unknown;
  details?: unknown;
}

function reasons(err: ApiErrorBody): string[] {
  return Array.isArray(err.details) ? err.details.map((d) => (d as { reason?: unknown } | null)?.reason).filter((r): r is string => typeof r === "string") : [];
}

/** Maps a non-2xx API reply to the error table: 401 revoked, 403 scope/api-disabled/permission, 404, 400, 429, else http_<status>. */
function errorFrom(status: number, json: unknown): GoogleApiError {
  const err = ((json as { error?: ApiErrorBody } | null)?.error ?? {}) as ApiErrorBody;
  const why = reasons(err);
  if (status === 401) return new GoogleApiError(status, "sm_google_revoked", "Google no longer accepts the connection.", { retry: false });
  if (status === 403) {
    if (why.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) return new GoogleApiError(status, "sm_google_scope", "The Google connection lacks the Business Profile permission.");
    if (why.includes("SERVICE_DISABLED")) return new GoogleApiError(status, "sm_google_api_disabled", "A Google Business Profile API is not enabled for the project.");
    return new GoogleApiError(status, "sm_google_permission", "The Google account no longer manages this listing.");
  }
  if (status === 404) return new GoogleApiError(status, "sm_google_not_found", "Google does not know this item.");
  if (status === 400) return new GoogleApiError(status, "sm_google_invalid", typeof err.message === "string" && err.message ? err.message.slice(0, 200) : "Google rejected the request.");
  if (status === 429) return new GoogleApiError(status, "sm_google_rate", "Google asked to slow down.");
  return new GoogleApiError(status, `http_${status}`, `Google answered HTTP ${status}.`);
}

async function send(f: typeof fetch, url: string, init: RequestInit): Promise<{ res: Response; json: unknown }> {
  let res: Response;
  try {
    res = await f(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GoogleApiError(0, "sm_google_unreachable", "Google did not answer.");
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

interface TokenReply {
  access_token?: unknown;
  refresh_token?: unknown;
  error?: unknown;
}

/** One form POST to the token endpoint. `invalid_grant` is reported as `onInvalidGrant`; other failures follow the table. */
async function tokenRequest(f: typeof fetch, form: Record<string, string>, onInvalidGrant: string): Promise<TokenReply> {
  const { res, json } = await send(f, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const error = (json as TokenReply | null)?.error;
    if (error === "invalid_grant") throw new GoogleApiError(res.status, onInvalidGrant, "Google no longer accepts the connection.", { retry: false });
    if (res.status === 429) throw new GoogleApiError(res.status, "sm_google_rate", "Google asked to slow down.");
    if (res.status >= 500) throw new GoogleApiError(res.status, `http_${res.status}`, `Google answered HTTP ${res.status}.`);
    throw new GoogleApiError(res.status, "sm_google_invalid", typeof error === "string" ? `Google refused the token request (${error.slice(0, 60)}).` : "Google refused the token request.");
  }
  if (json === null || typeof json !== "object") throw new GoogleApiError(res.status, "sm_google_invalid", "Google returned no token.");
  return json as TokenReply;
}

/** Authorization-code exchange; the refresh token is returned to the caller (who encrypts it), never logged. */
export async function exchangeGoogleCode(f: typeof fetch, creds: GoogleCreds, code: string, redirectUri: string): Promise<{ refresh_token: string; access_token: string }> {
  const r = await tokenRequest(f, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: creds.clientId, client_secret: creds.clientSecret }, "sm_google_invalid");
  if (typeof r.refresh_token !== "string" || !r.refresh_token || typeof r.access_token !== "string" || !r.access_token) {
    throw new GoogleApiError(200, "sm_google_invalid", "Google sent no refresh token.");
  }
  return { refresh_token: r.refresh_token, access_token: r.access_token };
}

/** A short-lived access token for one push/poll; never stored. `invalid_grant` means the owner revoked access. */
export async function googleAccessToken(f: typeof fetch, creds: GoogleCreds, refreshToken: string): Promise<string> {
  const r = await tokenRequest(f, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret }, "sm_google_revoked");
  if (typeof r.access_token !== "string" || !r.access_token) throw new GoogleApiError(200, "sm_google_invalid", "Google returned no access token.");
  return r.access_token;
}

/** Bound to one access token. Takes absolute URLs on one of the three Google API hosts. */
export class GoogleClient {
  constructor(private readonly accessToken: string, private readonly f: typeof fetch = fetch) {}
  private async call<T>(method: string, url: string, body?: Record<string, unknown>): Promise<T> {
    if (!API_HOSTS.has(new URL(url).hostname)) throw new GoogleApiError(0, "sm_google_invalid", "Not a Google API address.", { retry: false });
    const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${this.accessToken}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const { res, json } = await send(this.f, url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw errorFrom(res.status, json);
    return (json ?? {}) as T;
  }
  get<T>(url: string): Promise<T> {
    return this.call<T>("GET", url);
  }
  patch<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return this.call<T>("PATCH", url, body);
  }
  put<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return this.call<T>("PUT", url, body);
  }
  async delete(url: string): Promise<void> {
    await this.call<unknown>("DELETE", url);
  }
}

export interface GoogleDate { year: number; month: number; day: number }
export interface GoogleTime { hours?: number; minutes?: number }
export type GoogleDay = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
export interface GooglePeriod { openDay: GoogleDay; openTime: GoogleTime; closeDay: GoogleDay; closeTime: GoogleTime }
export interface GoogleSpecialPeriod { startDate: GoogleDate; endDate?: GoogleDate; openTime?: GoogleTime; closeTime?: GoogleTime; closed?: boolean }
export interface GoogleLocation {
  name: string;
  title?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string; postalCode?: string };
  serviceArea?: unknown;
  regularHours?: { periods?: GooglePeriod[] };
  specialHours?: { specialHourPeriods?: GoogleSpecialPeriod[] };
  metadata?: { hasGoogleUpdated?: boolean; hasPendingEdits?: boolean; hasVoiceOfMerchant?: boolean };
}
/** Destination config of kind "google" (not secret). Secrets: `{ refresh_token }`, encrypted. */
export interface GoogleConfig {
  account_name: string;
  location_name: string;
  location_v4: string;
  title: string;
  address: string;
  connected_at: string;
  /** Display name of the Google account that connected (the accounts list's accountName). */
  google_account_name: string;
  last_review_poll_at?: string;
  last_hours_push_at?: string;
  hours_pushed?: boolean;
  hours_conflict?: boolean;
  google_hours?: GooglePeriod[];
  special_dates_pushed?: string[];
  revoked_notified_at?: string;
}

export interface GoogleReview {
  name: string; // "accounts/1/locations/2/reviews/abc"
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

export function getLocation(c: GoogleClient, locationName: string, readMask: string): Promise<GoogleLocation> {
  return c.get<GoogleLocation>(`${GOOGLE_INFO}/${locationName}?readMask=${encodeURIComponent(readMask)}`);
}

/** PATCH {GOOGLE_INFO}/{locationName}?updateMask=<mask>[&validateOnly=true] */
export function patchLocation(c: GoogleClient, locationName: string, mask: string, body: Pick<GoogleLocation, "regularHours" | "specialHours">, o: { validateOnly?: boolean } = {}): Promise<GoogleLocation> {
  return c.patch<GoogleLocation>(`${GOOGLE_INFO}/${locationName}?updateMask=${encodeURIComponent(mask)}${o.validateOnly ? "&validateOnly=true" : ""}`, body);
}

const LIST_MASK = "name,title,storefrontAddress,serviceArea,metadata";

/** Every location of the first accounts (at most 10, first page of 100 each), tagged with its account. */
export async function listLocations(c: GoogleClient): Promise<{ account_name: string; account_label: string; location: GoogleLocation }[]> {
  const accounts = await c.get<{ accounts?: { name: string; accountName?: string }[] }>(`${GOOGLE_ACCOUNTS}/accounts`);
  const out: { account_name: string; account_label: string; location: GoogleLocation }[] = [];
  for (const a of (accounts.accounts ?? []).slice(0, MAX_ACCOUNTS)) {
    const page = await c.get<{ locations?: GoogleLocation[] }>(`${GOOGLE_INFO}/${a.name}/locations?readMask=${LIST_MASK}&pageSize=100`);
    for (const location of page.locations ?? []) out.push({ account_name: a.name, account_label: a.accountName || a.name, location });
  }
  return out;
}

/** The newest 50 reviews of a location (first page), newest update first. */
export async function listReviews(c: GoogleClient, locationV4: string): Promise<GoogleReview[]> {
  const r = await c.get<{ reviews?: GoogleReview[] }>(`${GOOGLE_V4}/${locationV4}/reviews?pageSize=50&orderBy=${encodeURIComponent("updateTime desc")}`);
  return r.reviews ?? [];
}

export async function putReviewReply(c: GoogleClient, reviewName: string, comment: string): Promise<void> {
  await c.put<unknown>(`${GOOGLE_V4}/${reviewName}/reply`, { comment });
}

export function deleteReviewReply(c: GoogleClient, reviewName: string): Promise<void> {
  return c.delete(`${GOOGLE_V4}/${reviewName}/reply`);
}
