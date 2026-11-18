// test/fake-google.ts
// In-memory stand-in for the Google endpoints the Business Profile feature uses, served through `fetch`:
// - oauth2.googleapis.com/token (form POST): authorization_code (single use) and refresh_token grants; a revoked refresh
//   token answers 400 invalid_grant
// - mybusinessaccountmanagement /v1/accounts
// - mybusinessbusinessinformation /v1/{account}/locations (list), GET and PATCH /v1/locations/{id} (updateMask limited to
//   regularHours/specialHours, validateOnly dry-runs, periods of 24 h or more or hours > 24 answer 400 INVALID_ARGUMENT)
// - mybusiness /v4/accounts/{a}/locations/{l}/reviews (list, orderBy updateTime desc) and .../reviews/{r}/reply (PUT, DELETE)
// Access tokens are random and never expire; an unknown bearer answers 401. Seed with addAccount/addLocation/addReview.
import { randomBytes } from "node:crypto";
import type { GoogleLocation, GooglePeriod, GoogleReview, GoogleSpecialPeriod, GoogleTime } from "../src/destinations/google-api";

export interface FakeGoogleCall { method: string; host: string; path: string; query: Record<string, string>; body: Record<string, unknown> | null; auth: boolean }
export interface FakeGoogleFailure { status: number; reason?: string; message?: string; match?: (call: FakeGoogleCall) => boolean }

type Json = Record<string, unknown>;
const tok = (p: string) => `${p}${randomBytes(12).toString("hex")}`;
const STATUS: Record<number, string> = { 400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND", 429: "RESOURCE_EXHAUSTED", 503: "UNAVAILABLE" };
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const STARS = ["ONE", "TWO", "THREE", "FOUR", "FIVE"] as const;

function apiError(status: number, message: string, reason?: string): Response {
  const error: Json = { code: status, message, status: STATUS[status] ?? "UNKNOWN" };
  if (reason) error.details = [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }];
  return Response.json({ error }, { status });
}
const tokenError = (status: number, error: string, description: string) => Response.json({ error, error_description: description }, { status });

const minutes = (t: GoogleTime | undefined) => (t?.hours ?? 0) * 60 + (t?.minutes ?? 0);
const timeOk = (t: GoogleTime | undefined) => !t || ((t.hours ?? 0) >= 0 && (t.hours ?? 0) <= 24 && (t.minutes ?? 0) >= 0 && (t.minutes ?? 0) < 60);
const dateMs = (d: { year: number; month: number; day: number }) => Date.UTC(d.year, d.month - 1, d.day);

/** null when valid, else Google-style INVALID_ARGUMENT text. */
function validateHours(field: "regularHours" | "specialHours", v: unknown): string | null {
  if (field === "regularHours") {
    for (const p of ((v as { periods?: GooglePeriod[] } | undefined)?.periods ?? [])) {
      if (!timeOk(p.openTime) || !timeOk(p.closeTime)) return "Invalid time of day: hours must be 0-24.";
      let diff = (DAYS.indexOf(p.closeDay) - DAYS.indexOf(p.openDay)) * 1440 + minutes(p.closeTime) - minutes(p.openTime);
      if (diff < 0) diff += 7 * 1440;
      if (diff >= 1440) return "Invalid period: a period must be shorter than 24 hours.";
    }
  } else {
    for (const p of ((v as { specialHourPeriods?: GoogleSpecialPeriod[] } | undefined)?.specialHourPeriods ?? [])) {
      if (p.closed) continue;
      if (!timeOk(p.openTime) || !timeOk(p.closeTime)) return "Invalid time of day: hours must be 0-24.";
      const start = dateMs(p.startDate) + minutes(p.openTime) * 60_000;
      const end = dateMs(p.endDate ?? p.startDate) + minutes(p.closeTime) * 60_000;
      if (end - start >= 24 * 3_600_000) return "Invalid special period: a period must be shorter than 24 hours.";
    }
  }
  return null;
}

export class FakeGoogle {
  clientId = "google-client-1";
  clientSecret = "google-secret-1";
  now: () => Date = () => new Date();
  calls: FakeGoogleCall[] = [];

  private accounts = new Map<string, { name: string; label: string; refresh_token: string }>();
  private codes = new Map<string, string>(); // unused authorization code → refresh token
  private revoked = new Set<string>();
  private accessTokens = new Set<string>();
  private locations = new Map<string, { account: string; v4: string; loc: GoogleLocation }>(); // key "locations/2"
  private reviews = new Map<string, GoogleReview>();
  private failures: FakeGoogleFailure[] = [];
  private seq = 100;

  /** The next request (matching `match`, when given) answers this error; one-shot. */
  failNext(f: FakeGoogleFailure): void {
    this.failures.push(f);
  }
  /** Later token calls with this refresh token answer 400 invalid_grant. */
  revoke(refreshToken: string): void {
    this.revoked.add(refreshToken);
  }
  addAccount(label = "Test account"): { name: string; refresh_token: string; code: string } {
    const name = `accounts/${++this.seq}`;
    const refresh_token = tok("rt-");
    const code = tok("code-");
    this.accounts.set(name, { name, label, refresh_token });
    this.codes.set(code, refresh_token);
    return { name, refresh_token, code };
  }
  addLocation(accountName: string, o: { title?: string; address?: string; verified?: boolean; regularHours?: GooglePeriod[]; specialHours?: GoogleSpecialPeriod[]; hasGoogleUpdated?: boolean; serviceArea?: boolean } = {}): GoogleLocation & { v4: string } {
    if (!this.accounts.has(accountName)) throw new Error(`no account ${accountName}`);
    const id = String(++this.seq);
    const name = `locations/${id}`;
    const loc: GoogleLocation = {
      name,
      title: o.title ?? "Test Cafe",
      storefrontAddress: { addressLines: o.address === undefined ? ["1 Main St"] : o.address ? [o.address] : [], locality: "Sofia", postalCode: "1000" },
      metadata: { hasVoiceOfMerchant: o.verified ?? true, hasGoogleUpdated: o.hasGoogleUpdated ?? false, hasPendingEdits: false },
    };
    // A service-area business (no storefront): Google returns serviceArea and no storefrontAddress.
    if (o.serviceArea) {
      delete loc.storefrontAddress;
      loc.serviceArea = { businessType: "CUSTOMER_LOCATION_ONLY", places: { placeInfos: [{ placeName: "Sofia" }] } };
    }
    if (o.regularHours) loc.regularHours = { periods: o.regularHours };
    if (o.specialHours) loc.specialHours = { specialHourPeriods: o.specialHours };
    const v4 = `${accountName}/${name}`;
    this.locations.set(name, { account: accountName, v4, loc });
    return { ...structuredClone(loc), v4 };
  }
  addReview(locationV4: string, o: { text?: string; stars?: 1 | 2 | 3 | 4 | 5; name?: string; created?: Date; updated?: Date; reply?: string } = {}): GoogleReview {
    if (![...this.locations.values()].some((l) => l.v4 === locationV4)) throw new Error(`no location ${locationV4}`);
    const created = o.created ?? this.now();
    const updated = o.updated ?? created;
    const r: GoogleReview = {
      name: `${locationV4}/reviews/${tok("r")}`,
      reviewer: { displayName: o.name ?? "Customer", isAnonymous: false },
      starRating: STARS[(o.stars ?? 5) - 1],
      comment: o.text ?? "Great place.",
      createTime: created.toISOString(),
      updateTime: updated.toISOString(),
    };
    if (o.reply !== undefined) r.reviewReply = { comment: o.reply, updateTime: updated.toISOString() };
    this.reviews.set(r.name, r);
    return structuredClone(r);
  }
  editReview(name: string, o: { text?: string; stars?: number; updated: Date }): void {
    const r = this.reviews.get(name);
    if (!r) throw new Error(`no review ${name}`);
    if (o.text !== undefined) r.comment = o.text;
    if (o.stars !== undefined) r.starRating = STARS[o.stars - 1];
    r.updateTime = o.updated.toISOString();
  }
  location(name: string): GoogleLocation {
    const l = this.locations.get(name);
    if (!l) throw new Error(`no location ${name}`);
    return structuredClone(l.loc);
  }
  review(name: string): GoogleReview {
    const r = this.reviews.get(name);
    if (!r) throw new Error(`no review ${name}`);
    return structuredClone(r);
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    let body: Json | null = null;
    if (typeof init?.body === "string") body = headers.get("content-type")?.includes("json") ? (JSON.parse(init.body) as Json) : Object.fromEntries(new URLSearchParams(init.body));
    else if (init?.body instanceof URLSearchParams) body = Object.fromEntries(init.body);
    const bearer = headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
    const call: FakeGoogleCall = { method, host: url.hostname, path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: bearer !== null };
    this.calls.push(call);
    const isToken = url.hostname === "oauth2.googleapis.com";
    const i = this.failures.findIndex((f) => !f.match || f.match(call));
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      return isToken ? tokenError(f.status, f.reason ?? "server_error", f.message ?? "injected") : apiError(f.status, f.message ?? "Injected failure.", f.reason);
    }
    if (isToken) return method === "POST" && url.pathname === "/token" ? this.token(body ?? {}) : tokenError(404, "invalid_request", "Unsupported request");
    if (!bearer || !this.accessTokens.has(bearer)) return apiError(401, "Request had invalid authentication credentials.");
    return this.api(method, url, body);
  };

  private token(b: Json): Response {
    if (b.client_id !== this.clientId || b.client_secret !== this.clientSecret) return tokenError(401, "invalid_client", "The OAuth client was not found.");
    let refresh: string | undefined;
    let first = false;
    if (b.grant_type === "authorization_code") {
      refresh = this.codes.get(String(b.code));
      if (!refresh || typeof b.redirect_uri !== "string" || !b.redirect_uri) return tokenError(400, "invalid_grant", "Bad Request");
      this.codes.delete(String(b.code));
      first = true;
    } else if (b.grant_type === "refresh_token") {
      refresh = [...this.accounts.values()].find((a) => a.refresh_token === b.refresh_token)?.refresh_token;
      if (!refresh) return tokenError(400, "invalid_grant", "Bad Request");
    } else return tokenError(400, "unsupported_grant_type", "Unsupported grant type");
    if (this.revoked.has(refresh)) return tokenError(400, "invalid_grant", "Token has been expired or revoked.");
    const access_token = tok("at-");
    this.accessTokens.add(access_token);
    return Response.json({ access_token, expires_in: 3599, scope: "https://www.googleapis.com/auth/business.manage", token_type: "Bearer", ...(first ? { refresh_token: refresh } : {}) });
  }

  private api(method: string, url: URL, body: Json | null): Response {
    const p = url.pathname;
    const q = url.searchParams;
    if (url.hostname === "mybusinessaccountmanagement.googleapis.com" && method === "GET" && p === "/v1/accounts") {
      return Response.json({ accounts: [...this.accounts.values()].map((a) => ({ name: a.name, accountName: a.label, type: "PERSONAL" })) });
    }
    if (url.hostname === "mybusinessbusinessinformation.googleapis.com") {
      const list = p.match(/^\/v1\/(accounts\/\d+)\/locations$/);
      if (list && method === "GET") return Response.json({ locations: [...this.locations.values()].filter((l) => l.account === list[1]).map((l) => this.mask(l.loc, q.get("readMask"))) });
      const one = p.match(/^\/v1\/(locations\/\d+)$/);
      const l = one ? this.locations.get(one[1]) : undefined;
      if (one && !l) return apiError(404, "Requested entity was not found.");
      if (l && method === "GET") return Response.json(this.mask(l.loc, q.get("readMask")));
      if (l && method === "PATCH") return this.patch(l.loc, q, body ?? {});
    }
    if (url.hostname === "mybusiness.googleapis.com") {
      const list = p.match(/^\/v4\/(accounts\/\d+\/locations\/\d+)\/reviews$/);
      if (list && method === "GET") {
        const rows = [...this.reviews.values()].filter((r) => r.name.startsWith(`${list[1]}/reviews/`)).sort((a, b) => Date.parse(b.updateTime) - Date.parse(a.updateTime));
        return Response.json({ reviews: structuredClone(rows.slice(0, Number(q.get("pageSize") ?? 50))), totalReviewCount: rows.length });
      }
      const reply = p.match(/^\/v4\/(accounts\/\d+\/locations\/\d+\/reviews\/[^/]+)\/reply$/);
      if (reply) {
        const r = this.reviews.get(reply[1]);
        if (!r) return apiError(404, "Requested entity was not found.");
        if (method === "PUT") {
          const comment = typeof body?.comment === "string" ? body.comment : "";
          if (!comment) return apiError(400, "Reply comment is required.");
          r.reviewReply = { comment, updateTime: this.now().toISOString() };
          return Response.json(r.reviewReply);
        }
        if (method === "DELETE") {
          delete r.reviewReply;
          return Response.json({});
        }
      }
    }
    return apiError(404, "Unsupported request.");
  }

  /** readMask is honoured at the top level; `name` is always returned. */
  private mask(loc: GoogleLocation, readMask: string | null): GoogleLocation {
    if (!readMask) return structuredClone(loc);
    const keep = new Set(readMask.split(",").map((s) => s.trim()));
    return structuredClone(Object.fromEntries(Object.entries(loc).filter(([k]) => k === "name" || keep.has(k)))) as unknown as GoogleLocation;
  }

  private patch(loc: GoogleLocation, q: URLSearchParams, body: Json): Response {
    const fields = (q.get("updateMask") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!fields.length) return apiError(400, "updateMask is required.");
    const next: GoogleLocation = structuredClone(loc);
    for (const f of fields) {
      if (f !== "regularHours" && f !== "specialHours") return apiError(400, `Unsupported updateMask field: ${f}.`);
      const bad = validateHours(f, body[f]);
      if (bad) return apiError(400, bad);
      if (body[f] === undefined) delete next[f];
      else (next as unknown as Json)[f] = structuredClone(body[f]);
    }
    if (q.get("validateOnly") !== "true") Object.assign(loc, next, { regularHours: next.regularHours, specialHours: next.specialHours });
    return Response.json(structuredClone(next));
  }
}
