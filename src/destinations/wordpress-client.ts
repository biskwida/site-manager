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
      res = await f(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000) });
    } catch (e) {
      throw new WordPressApiError(0, "sm_unreachable", `WordPress unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
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

function isPrivateIp(host: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return PRIVATE_V4.some((re) => re.test(host));
  if (host.startsWith("[")) {
    const h = host.slice(1, -1).toLowerCase();
    return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::";
  }
  return false;
}

/** Normalises what the owner typed into an https site URL (plain http only for local hosts) or explains why not, in both languages. */
export function validateSiteUrl(raw: string): { ok: true; url: string } | { ok: false; reason: { bg: string; en: string } } {
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
  const local = LOCAL_HOSTS.has(host) || LOCAL_HOSTS.has(hostWithPort) || host.endsWith(".localhost");
  if (!local && isPrivateIp(host)) return { ok: false, reason: { bg: "Адресът сочи към вътрешна мрежа; нужен е публичният адрес на сайта.", en: "That address points at a private network; use the site's public address." } };
  if (!local && !host.includes(".")) return { ok: false, reason: { bg: "Адресът трябва да е пълен домейн, например https://moeto-kafene.bg", en: "Use the full domain, for example https://my-cafe.com" } };
  if (u.protocol === "http:" && !local) return { ok: false, reason: { bg: "Адресът трябва да започва с https:// (обикновен http се допуска само за localhost).", en: "The address must start with https:// (plain http is allowed only for localhost)." } };
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${hostWithPort}${path}` };
}
