// src/destinations/wordpress-client.ts
// Client for the Site Manager WordPress plugin's REST namespace (integrations/wordpress/site-manager).
// Server-only: it carries the plugin token. Never log the token or full responses.
import type {
  WpMedia, WpMenu, WpMenuItem, WpMenuItemInput, WpOptionKey, WpOptions, WpPage, WpPageApplied, WpPageEdit, WpPageFields, WpPagePreview, WpProduct, WpProductPatch, WpSiteInfo,
} from "./wordpress-types";

export class WordPressApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
    this.name = "WordPressApiError";
  }
  /** Network failures, 429 and 5xx are worth another attempt later; other 4xx are not. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface WordPressClientOptions {
  siteUrl: string;
  token: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class WordPressClient {
  readonly base: string;
  constructor(private o: WordPressClientOptions) {
    this.base = `${o.siteUrl.replace(/\/+$/, "")}/wp-json/site-manager/v1`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const f = this.o.fetch ?? fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.o.token) headers.authorization = `Bearer ${this.o.token}`;
    let res: Response;
    try {
      // Never follow redirects: a redirect could carry the bearer token or the request to another (private) host.
      res = await f(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000) });
    } catch (e) {
      throw new WordPressApiError(0, "sm_unreachable", `WordPress unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status >= 300 && res.status < 400) throw new WordPressApiError(res.status, "sm_redirect", "The site redirected the request; use its final address.");
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json && typeof json === "object" ? json : {}) as { code?: string; message?: string; data?: Record<string, unknown> };
      const { status: _status, ...data } = err.data ?? {};
      void _status;
      throw new WordPressApiError(res.status, err.code ?? `http_${res.status}`, err.message ?? `HTTP ${res.status}`, data);
    }
    if (json === null) throw new WordPressApiError(res.status, "sm_bad_json", "WordPress returned no JSON (is the plugin active?)");
    return json as T;
  }

  handshake(code: string, slug: string) {
    return this.call<{ token: string; site: WpSiteInfo }>("POST", "/handshake", { code, slug });
  }
  site() {
    return this.call<WpSiteInfo>("GET", "/site");
  }
  page(id: number) {
    return this.call<WpPage>("GET", `/page/${id}`);
  }
  previewPage(id: number, edit: WpPageEdit) {
    return this.call<WpPagePreview>("POST", `/page/${id}/preview`, edit);
  }
  cancelPreview(id: number) {
    return this.call<{ ok: true }>("DELETE", `/page/${id}/preview`);
  }
  applyPage(id: number, fields: Partial<WpPageFields> & { placeholders?: Record<string, string> }) {
    return this.call<WpPageApplied>("POST", `/page/${id}/apply`, fields);
  }
  revert(pageId: number, revisionId: number) {
    return this.call<{ id: number; restored_revision: number }>("POST", `/revert/${pageId}/${revisionId}`);
  }
  uploadMedia(input: { url: string; source_id: string; filename?: string; title?: string; alt?: string }) {
    return this.call<WpMedia>("POST", "/media", input);
  }
  updateMedia(id: number, patch: { alt?: string; title?: string; caption?: string }) {
    return this.call<WpMedia>("PUT", `/media/${id}`, patch);
  }
  deleteMedia(by: { id?: number; source_id?: string }) {
    if (by.id === undefined && !by.source_id) return Promise.reject(new WordPressApiError(400, "sm_invalid", "deleteMedia needs id or source_id"));
    return by.id !== undefined
      ? this.call<{ ok: true; deleted: boolean }>("DELETE", `/media/${by.id}`)
      : this.call<{ ok: true; deleted: boolean }>("DELETE", `/media?source_id=${encodeURIComponent(by.source_id ?? "")}`);
  }
  options() {
    return this.call<WpOptions>("GET", "/option");
  }
  setOption(key: WpOptionKey, value: string | number | null) {
    return this.call<{ key: WpOptionKey; before: string | number | null; after: string | number | null }>("PUT", "/option", { key, value });
  }
  menu(id: number) {
    return this.call<WpMenu>("GET", `/menu/${id}`);
  }
  setMenu(id: number, items: WpMenuItemInput[]) {
    return this.call<{ id: number; before: WpMenuItem[]; after: WpMenuItem[] }>("PUT", `/menu/${id}`, { items });
  }
  product(id: number) {
    return this.call<WpProduct>("GET", `/product/${id}`);
  }
  setProduct(id: number, patch: WpProductPatch) {
    return this.call<{ id: number; before: WpProduct; after: WpProduct }>("PUT", `/product/${id}`, patch);
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);
const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** The owner-facing reason for a site address that is (or resolves to) a private or local network. */
export const PRIVATE_NETWORK_REASON = { bg: "Адресът сочи към вътрешна мрежа; нужен е публичният адрес на сайта.", en: "That address points at a private network; use the site's public address." } as const;

/** localhost, 127.0.0.1, [::1], host.docker.internal and *.localhost (a URL hostname, IPv6 in brackets). */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return LOCAL_HOSTS.has(h) || h.endsWith(".localhost");
}

/** True for private, loopback, link-local and unspecified IPv4/IPv6 addresses, written as DNS returns them or as a URL hostname ([v6]). */
export function isPrivateAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) return PRIVATE_V4.some((re) => re.test(a));
  const h = a.startsWith("[") && a.endsWith("]") ? a.slice(1, -1) : a;
  if (!h.includes(":")) return false;
  if (h.startsWith("::ffff:")) {
    // IPv4-mapped IPv6: URL normalises ::ffff:10.0.0.1 to ::ffff:a00:1; check the embedded IPv4 address.
    const tail = h.slice(7);
    const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    const v4 = hex ? [parseInt(hex[1], 16) >> 8, parseInt(hex[1], 16) & 255, parseInt(hex[2], 16) >> 8, parseInt(hex[2], 16) & 255].join(".") : tail;
    return PRIVATE_V4.some((re) => re.test(v4));
  }
  return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::";
}

/**
 * Normalises what the owner typed into an https site URL or explains why not, in both languages. Local hosts and
 * plain http are accepted only with `allowLocal` (memory store and the Docker smoke test); otherwise they are refused
 * as a private network.
 */
export function validateSiteUrl(raw: string, opts: { allowLocal?: boolean } = {}): { ok: true; url: string } | { ok: false; reason: { bg: string; en: string } } {
  const typed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, reason: { bg: "Това не прилича на адрес на сайт. Пример: https://moeto-kafene.bg", en: "That does not look like a site address. Example: https://my-cafe.com" } };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: { bg: "Адресът трябва да започва с https://", en: "The address must start with https://" } };
  if (u.username || u.password) return { ok: false, reason: { bg: "Адресът не бива да съдържа потребител или парола.", en: "The address must not contain a username or password." } };
  const host = u.hostname.toLowerCase();
  const hostWithPort = u.host.toLowerCase();
  const local = isLocalHost(host);
  if (local && !opts.allowLocal) return { ok: false, reason: { ...PRIVATE_NETWORK_REASON } };
  if (!local && isPrivateAddress(host)) return { ok: false, reason: { ...PRIVATE_NETWORK_REASON } };
  if (!local && !host.includes(".")) return { ok: false, reason: { bg: "Адресът трябва да е пълен домейн, например https://moeto-kafene.bg", en: "Use the full domain, for example https://my-cafe.com" } };
  if (u.protocol === "http:" && !local) return { ok: false, reason: { bg: "Адресът трябва да започва с https:// (обикновен http се допуска само за localhost).", en: "The address must start with https:// (plain http is allowed only for localhost)." } };
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${hostWithPort}${path}` };
}
