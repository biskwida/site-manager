// test/fake-wordpress.ts
// In-memory stand-in for the Site Manager WordPress plugin's REST namespace (see the plan's "Plugin REST contract").
// Serves /wp-json/site-manager/v1/* and page HTML (permalinks, with ?sm_preview=<key>) through `fetch`.
import { createHash, randomBytes } from "node:crypto";
import { WordPressClient } from "@/src/destinations/wordpress-client";
import type { WpBuilder, WpMenuItem, WpMenuItemInput, WpOptions, WpPageFields, WpPageSummary, WpProduct, WpSiteInfo } from "@/src/destinations/wordpress-types";

export interface FakePage extends WpPageFields { id: number; slug: string; status: string; builder: WpBuilder; modified: string; is_front_page: boolean }
export interface FakeMedia { id: number; url: string; alt: string; title: string; source_id: string | null }
export interface FakeMenu { id: number; name: string; locations: string[]; items: WpMenuItem[] }
interface Pending { key: string; after: WpPageFields; expires: number }

type Json = Record<string, unknown>;
const PLACEHOLDER = /\{\{sm_media_(url|id):([^}]+)\}\}/g;

function err(status: number, code: string, message: string, extra: Json = {}): Response {
  return Response.json({ code, message, data: { status, ...extra } }, { status });
}
function textOf(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function elementorStrings(data: string | null): string[] {
  if (!data) return [];
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const o = node as Json;
      if (o.settings && typeof o.settings === "object") for (const v of Object.values(o.settings as Json)) if (typeof v === "string" && v.trim()) out.push(v);
      if (Array.isArray(o.elements)) walk(o.elements);
    }
  };
  walk(JSON.parse(data));
  return out;
}
function replaceInElementor(data: string, find: string, replace: string): { data: string; count: number } {
  let count = 0;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const o = { ...(node as Json) };
      if (o.settings && typeof o.settings === "object") {
        const s = { ...(o.settings as Json) };
        for (const [k, v] of Object.entries(s)) if (typeof v === "string") { count += v.split(find).length - 1; s[k] = v.split(find).join(replace); }
        o.settings = s;
      }
      if (Array.isArray(o.elements)) o.elements = walk(o.elements);
      return o;
    }
    return node;
  };
  return { data: JSON.stringify(walk(JSON.parse(data))), count };
}

export class FakeWordPress {
  siteUrl = "https://cafe.example";
  slug = "agala";
  name = "Smoke Café";
  code: { hash: string; expires: number } | null = null;
  tokenHash: string | null = null;
  pages = new Map<number, FakePage>();
  pending = new Map<number, Pending>();
  media = new Map<number, FakeMedia>();
  options: WpOptions = { blogname: "Smoke Café", blogdescription: "Just another WordPress site", custom_logo: null, site_icon: null };
  menus = new Map<number, FakeMenu>();
  products = new Map<number, WpProduct>();
  revisions = new Map<number, WpPageFields[]>();
  calls: { method: string; path: string; body: unknown; auth: boolean }[] = [];
  failNext: { status: number; code: string; message: string } | null = null;
  unreachable = false;
  now = () => Date.now();
  private nextMedia = 101;
  private nextPage = 10;
  private nextMenuItem = 1000;

  constructor() {
    this.addPage({ id: 1, title: "Home", slug: "", content: "<!-- wp:paragraph --><p>Welcome to Smoke Café.</p><!-- /wp:paragraph -->", is_front_page: true });
    this.addPage({ id: 2, title: "About", slug: "about", content: "<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->" });
    this.addPage({ id: 3, title: "Menu", slug: "menu", content: "[site_manager_menu]", builder: "classic" });
    this.addMenu(3, "Main", ["primary"], [{ title: "Home", url: "/" }, { title: "About", url: "/about/" }]);
  }

  addPage(p: { id?: number; title: string; slug: string; content: string; builder?: WpBuilder; is_front_page?: boolean; featured_media?: number | null }): number {
    const id = p.id ?? this.nextPage++;
    this.pages.set(id, { id, title: p.title, slug: p.slug, content: p.content, elementor_data: null, featured_media: p.featured_media ?? null, status: "publish", builder: p.builder ?? "gutenberg", modified: new Date(this.now()).toISOString(), is_front_page: p.is_front_page ?? false });
    return id;
  }
  addElementorPage(title: string, elements: { id: string; settings: Json; elements?: unknown[] }[]): number {
    const id = this.nextPage++;
    this.pages.set(id, { id, title, slug: title.toLowerCase().replace(/\s+/g, "-"), content: "", elementor_data: JSON.stringify(elements), featured_media: null, status: "publish", builder: "elementor", modified: new Date(this.now()).toISOString(), is_front_page: false });
    return id;
  }
  addMenu(id: number, name: string, locations: string[], items: WpMenuItemInput[]) {
    this.menus.set(id, { id, name, locations, items: this.materialise(items) });
  }
  addProduct(p: Omit<WpProduct, "url">) {
    this.products.set(p.id, { ...p, url: `${this.siteUrl}/product/${p.id}/` });
  }
  /** What the settings page shows the owner. */
  issueCode(): string {
    const code = randomBytes(5).toString("hex").toUpperCase();
    this.code = { hash: sha(code), expires: this.now() + 15 * 60_000 };
    return code;
  }
  /** A client that already completed the handshake. */
  connected(): WordPressClient {
    const token = randomBytes(32).toString("hex");
    this.tokenHash = sha(token);
    return new WordPressClient({ siteUrl: this.siteUrl, token, fetch: this.fetch });
  }
  /** The HTML a visitor (or the preview link) gets for a page. */
  pageHtml(id: number, previewKey?: string): string {
    const p = this.pages.get(id);
    if (!p) return "<h1>Not found</h1>";
    const pend = previewKey ? this.pending.get(id) : undefined;
    const show = pend && pend.key === previewKey && pend.expires > this.now() ? pend.after : p;
    const banner = show !== p ? '<div class="sm-preview-banner">Предварителен преглед от Site Manager · Preview from Site Manager, not published</div>' : "";
    return `<!doctype html><html><body>${banner}<h1>${show.title}</h1><main>${show.content}</main></body></html>`;
  }
  permalink(p: FakePage): string {
    return p.is_front_page || p.slug === "" ? `${this.siteUrl}/` : `${this.siteUrl}/${p.slug}/`;
  }

  fetch: typeof fetch = async (input, init) => {
    if (this.unreachable) throw new TypeError("fetch failed");
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : undefined;
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? "";
    const prefix = "/wp-json/site-manager/v1";
    if (!url.pathname.startsWith(prefix)) return this.serveHtml(url);
    const path = url.pathname.slice(prefix.length) + (url.search ? url.search : "");
    const authed = this.tokenHash !== null && auth.startsWith("Bearer ") && sha(auth.slice(7)) === this.tokenHash;
    this.calls.push({ method, path, body, auth: authed });
    if (this.failNext) {
      const f = this.failNext;
      this.failNext = null;
      return err(f.status, f.code, f.message);
    }
    if (path === "/handshake" && method === "POST") return this.handshake(body ?? {});
    if (!authed) return err(401, "sm_unauthorized", "Missing or invalid plugin token.");
    return this.route(method, url.pathname.slice(prefix.length), url.searchParams, body ?? {});
  };

  private serveHtml(url: URL): Response {
    const slug = url.pathname.replace(/^\/|\/$/g, "");
    const page = [...this.pages.values()].find((p) => (slug === "" ? p.is_front_page : p.slug === slug));
    if (!page) return new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(this.pageHtml(page.id, url.searchParams.get("sm_preview") ?? undefined), { headers: { "content-type": "text/html" } });
  }

  private handshake(body: Json): Response {
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!this.code || this.code.expires < this.now() || sha(code) !== this.code.hash) return err(403, "sm_forbidden", "The code is wrong or expired. Generate a new one on the plugin's settings page.");
    if (String(body.slug ?? "") !== this.slug) return err(403, "sm_forbidden", `This plugin is configured for the venue "${this.slug}".`);
    this.code = null;
    const token = randomBytes(32).toString("hex");
    this.tokenHash = sha(token);
    return Response.json({ token, site: this.siteInfo() });
  }

  siteInfo(): WpSiteInfo {
    return {
      name: this.options.blogname, description: this.options.blogdescription, url: this.siteUrl, home_url: this.siteUrl, wp_version: "6.8", plugin_version: "0.1.0", locale: "bg_BG", timezone: "Europe/Sofia",
      theme: { name: "Twenty Twenty-Four", slug: "twentytwentyfour" },
      pages: [...this.pages.values()].map((p) => this.summary(p)),
      menus: [...this.menus.values()].map((m) => ({ id: m.id, name: m.name, locations: m.locations, count: m.items.length })),
      options: { ...this.options },
      woocommerce: this.products.size > 0,
      products: [...this.products.values()].map((p) => ({ id: p.id, name: p.name, regular_price: p.regular_price, sale_price: p.sale_price, stock_status: p.stock_status })),
      connected_user: this.tokenHash ? { id: 1, login: "admin" } : null,
    };
  }
  private summary(p: FakePage): WpPageSummary {
    return { id: p.id, title: p.title, slug: p.slug, url: this.permalink(p), status: p.status, builder: p.builder, modified: p.modified, featured_media: p.featured_media, is_front_page: p.is_front_page };
  }
  private fields(p: FakePage): WpPageFields {
    return { title: p.title, content: p.content, elementor_data: p.elementor_data, featured_media: p.featured_media };
  }

  private route(method: string, path: string, q: URLSearchParams, body: Json): Response {
    let m: RegExpMatchArray | null;
    if (path === "/site" && method === "GET") return Response.json(this.siteInfo());
    if ((m = path.match(/^\/page\/(\d+)$/)) && method === "GET") {
      const p = this.pages.get(Number(m[1]));
      if (!p) return err(404, "sm_not_found", "No such page.");
      return Response.json({ ...this.summary(p), ...this.fields(p), text: p.builder === "elementor" ? elementorStrings(p.elementor_data).map(textOf).join(" ") : textOf(p.content), texts: elementorStrings(p.elementor_data), editable: p.builder !== "unknown" });
    }
    if ((m = path.match(/^\/page\/(\d+)\/preview$/))) {
      const p = this.pages.get(Number(m[1]));
      if (!p) return err(404, "sm_not_found", "No such page.");
      if (method === "DELETE") {
        this.pending.delete(p.id);
        return Response.json({ ok: true });
      }
      const r = this.computeAfter(p, body, false);
      if (r instanceof Response) return r;
      const key = randomBytes(8).toString("hex");
      this.pending.set(p.id, { key, after: r, expires: this.now() + 86_400_000 });
      return Response.json({ before: this.fields(p), after: r, preview_url: p.builder === "elementor" ? null : `${this.permalink(p)}?sm_preview=${key}`, pending_key: key });
    }
    if ((m = path.match(/^\/page\/(\d+)\/apply$/)) && method === "POST") {
      const p = this.pages.get(Number(m[1]));
      if (!p) return err(404, "sm_not_found", "No such page.");
      const before = this.fields(p);
      const r = this.computeAfter(p, body, true);
      if (r instanceof Response) return r;
      const revs = this.revisions.get(p.id) ?? [];
      revs.push(before);
      this.revisions.set(p.id, revs);
      Object.assign(p, r, { modified: new Date(this.now()).toISOString() });
      this.pending.delete(p.id);
      return Response.json({ id: p.id, url: this.permalink(p), revision_id: revs.length, before, after: this.fields(p) });
    }
    if ((m = path.match(/^\/revert\/(\d+)\/(\d+)$/)) && method === "POST") {
      const p = this.pages.get(Number(m[1]));
      const rev = this.revisions.get(Number(m[1]))?.[Number(m[2]) - 1];
      if (!p || !rev) return err(404, "sm_not_found", "No such page or revision.");
      Object.assign(p, rev);
      return Response.json({ id: p.id, restored_revision: Number(m[2]) });
    }
    if (path === "/media" && method === "POST") {
      const source = String(body.source_id ?? "");
      if (!/^https?:\/\//.test(String(body.url ?? "")) || !source) return err(400, "sm_invalid", "url and source_id are required.");
      const existing = [...this.media.values()].find((x) => x.source_id === source);
      if (existing) return Response.json({ id: existing.id, url: existing.url, alt: existing.alt, existed: true });
      const id = this.nextMedia++;
      const file = String(body.filename ?? new URL(String(body.url)).pathname.split("/").pop() ?? `${id}.jpg`);
      const row: FakeMedia = { id, url: `${this.siteUrl}/wp-content/uploads/2026/10/${file}`, alt: String(body.alt ?? ""), title: String(body.title ?? file), source_id: source };
      this.media.set(id, row);
      return Response.json({ id, url: row.url, alt: row.alt, existed: false });
    }
    if ((m = path.match(/^\/media\/(\d+)$/)) && method === "PUT") {
      const row = this.media.get(Number(m[1]));
      if (!row) return err(404, "sm_not_found", "No such attachment.");
      if (typeof body.alt === "string") row.alt = body.alt;
      if (typeof body.title === "string") row.title = body.title;
      return Response.json({ id: row.id, url: row.url, alt: row.alt, existed: true });
    }
    if (path === "/media" && method === "DELETE") {
      const source = q.get("source_id") ?? "";
      const row = [...this.media.values()].find((x) => x.source_id === source);
      if (row) this.media.delete(row.id);
      return Response.json({ ok: true, deleted: Boolean(row) });
    }
    if ((m = path.match(/^\/media\/(\d+)$/)) && method === "DELETE") {
      return Response.json({ ok: true, deleted: this.media.delete(Number(m[1])) });
    }
    if (path === "/option" && method === "GET") return Response.json({ ...this.options });
    if (path === "/option" && method === "PUT") {
      const key = String(body.key ?? "");
      if (!(key in this.options)) return err(400, "sm_invalid", `Option "${key}" is not editable.`);
      const k = key as keyof WpOptions;
      const before = this.options[k];
      let value = body.value as string | number | null;
      if ((k === "custom_logo" || k === "site_icon")) {
        if (typeof value === "string" && value.startsWith("{{")) {
          const resolved = this.resolvePlaceholders(value, {});
          if (resolved instanceof Response) return resolved;
          value = Number(resolved);
        }
        value = value === null || value === "" ? null : Number(value);
        (this.options as unknown as Record<string, unknown>)[k] = value;
      } else (this.options as unknown as Record<string, unknown>)[k] = String(value ?? "");
      return Response.json({ key: k, before, after: this.options[k] });
    }
    if ((m = path.match(/^\/menu\/(\d+)$/))) {
      const menu = this.menus.get(Number(m[1]));
      if (!menu) return err(404, "sm_not_found", "No such menu.");
      if (method === "GET") return Response.json({ id: menu.id, name: menu.name, locations: menu.locations, items: menu.items });
      if (method === "PUT") {
        const before = menu.items;
        menu.items = this.materialise((body.items as WpMenuItemInput[]) ?? []);
        return Response.json({ id: menu.id, before, after: menu.items });
      }
    }
    if ((m = path.match(/^\/product\/(\d+)$/))) {
      if (this.products.size === 0) return err(404, "sm_no_woocommerce", "WooCommerce is not active on this site.");
      const p = this.products.get(Number(m[1]));
      if (!p) return err(404, "sm_not_found", "No such product.");
      if (method === "GET") return Response.json(p);
      if (method === "PUT") {
        const before = { ...p };
        for (const k of ["name", "regular_price", "sale_price", "stock_status", "description", "short_description"] as const) if (typeof body[k] === "string") (p as unknown as Record<string, unknown>)[k] = body[k];
        return Response.json({ id: p.id, before, after: { ...p } });
      }
    }
    return err(404, "sm_not_found", `No route ${method} ${path}`);
  }

  /** Shared by preview and apply. `strict` = unresolved placeholders are an error (apply). */
  private computeAfter(p: FakePage, body: Json, strict: boolean): WpPageFields | Response {
    const after: WpPageFields = this.fields(p);
    if (p.builder === "unknown" && (body.content !== undefined || body.replacements !== undefined)) return err(422, "sm_builder_unsupported", "This page is built with an unsupported editor.", { builder: p.builder });
    if (typeof body.title === "string") after.title = body.title;
    if (typeof body.content === "string") {
      if (p.builder === "elementor") return err(422, "sm_builder_unsupported", "Elementor pages take replacements, not full content.", { builder: "elementor" });
      after.content = body.content;
    }
    if (typeof body.elementor_data === "string" || body.elementor_data === null) after.elementor_data = body.elementor_data as string | null;
    for (const r of (body.replacements as { find: string; replace: string }[] | undefined) ?? []) {
      if (p.builder === "elementor") {
        const res = replaceInElementor(after.elementor_data ?? "[]", r.find, r.replace);
        if (res.count !== 1) return err(422, "sm_replace_failed", `"${r.find}" occurs ${res.count} times; it must occur exactly once.`, { find: r.find, count: res.count });
        after.elementor_data = res.data;
      } else {
        const count = after.content.split(r.find).length - 1;
        if (count !== 1) return err(422, "sm_replace_failed", `"${r.find}" occurs ${count} times; it must occur exactly once.`, { find: r.find, count });
        after.content = after.content.replace(r.find, () => r.replace);
      }
    }
    if (body.featured_media !== undefined) after.featured_media = body.featured_media === null ? null : Number(body.featured_media);
    const map = (body.placeholders as Record<string, string> | undefined) ?? {};
    for (const k of ["title", "content", "elementor_data"] as const) {
      const v = after[k];
      if (typeof v !== "string") continue;
      const resolved = this.resolvePlaceholders(v, map, !strict);
      if (resolved instanceof Response) return resolved;
      (after as unknown as Record<string, unknown>)[k] = resolved;
    }
    return after;
  }

  private resolvePlaceholders(text: string, map: Record<string, string>, lenient = false): string | Response {
    let failed: string | null = null;
    const out = text.replace(PLACEHOLDER, (token, kind: string, source: string) => {
      if (map[token] !== undefined) return map[token];
      const m = [...this.media.values()].find((x) => x.source_id === source);
      if (m) return kind === "url" ? m.url : String(m.id);
      if (!lenient) failed ??= token;
      return token;
    });
    return failed ? err(400, "sm_invalid", `Unresolved placeholder ${failed}`, { placeholder: failed }) : out;
  }

  private materialise(items: WpMenuItemInput[]): WpMenuItem[] {
    return items.map((it, i) => ({ id: this.nextMenuItem++, title: it.title, url: it.url, parent_index: it.parent_index ?? null, position: i + 1, type: it.type ?? "custom", object_id: it.object_id ?? null }));
  }
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
