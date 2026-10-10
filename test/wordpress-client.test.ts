// test/wordpress-client.test.ts
import { describe, expect, it } from "vitest";
import { isPrivateAddress, WordPressApiError, WordPressClient, validateSiteUrl } from "@/src/destinations/wordpress-client";
import { FakeWordPress } from "./fake-wordpress";

function setup() {
  const wp = new FakeWordPress();
  const anon = new WordPressClient({ siteUrl: wp.siteUrl, token: null, fetch: wp.fetch });
  return { wp, anon };
}

describe("validateSiteUrl", () => {
  it("normalises and accepts https sites, with or without a path", () => {
    expect(validateSiteUrl(" https://cafe.bg/ ")).toEqual({ ok: true, url: "https://cafe.bg" });
    expect(validateSiteUrl("cafe.bg/wordpress/")).toEqual({ ok: true, url: "https://cafe.bg/wordpress" });
    expect(validateSiteUrl("https://Cafe.BG/blog?x=1#top")).toEqual({ ok: true, url: "https://cafe.bg/blog" });
  });
  it("accepts plain http and local hosts only with allowLocal (memory store, smoke test)", () => {
    expect(validateSiteUrl("http://localhost:8088", { allowLocal: true })).toEqual({ ok: true, url: "http://localhost:8088" });
    expect(validateSiteUrl("http://host.docker.internal:8088/", { allowLocal: true })).toEqual({ ok: true, url: "http://host.docker.internal:8088" });
    expect(validateSiteUrl("https://cafe.localhost", { allowLocal: true })).toEqual({ ok: true, url: "https://cafe.localhost" });
    for (const local of ["http://localhost:8088", "https://localhost", "http://127.0.0.1:8088", "https://[::1]", "http://host.docker.internal:8088/", "https://cafe.localhost"]) {
      const r = validateSiteUrl(local);
      expect(r.ok, local).toBe(false);
      if (!r.ok) expect(r.reason.en, local).toMatch(/private network/);
    }
    for (const opts of [{}, { allowLocal: true }]) {
      const r = validateSiteUrl("http://cafe.bg", opts);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.bg).toMatch(/https:\/\//);
    }
  });
  it("refuses credentials, private addresses and junk", () => {
    for (const bad of ["https://user:pw@cafe.bg", "https://10.0.0.5", "https://192.168.1.10/wp", "https://172.16.0.1", "https://169.254.1.1", "https://[fd00::1]", "https://[::ffff:10.0.0.1]", "https://[::ffff:a9fe:a9fe]", "ftp://cafe.bg", "not a url", "https://cafe"]) {
      const r = validateSiteUrl(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason.en.length, bad).toBeGreaterThan(5);
    }
  });
});

describe("isPrivateAddress", () => {
  it("knows private IPv4, IPv6 and IPv4-mapped addresses, as DNS returns them and as URLs write them", () => {
    for (const a of ["10.0.0.5", "127.0.0.1", "192.168.1.1", "172.20.0.3", "169.254.169.254", "0.0.0.0", "::1", "[::1]", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "[::ffff:a00:1]", "::"]) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["93.184.216.34", "1.1.1.1", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34"]) expect(isPrivateAddress(a), a).toBe(false);
  });
});

describe("WordPressClient redirects", () => {
  it("does not follow redirects and maps any 3xx to sm_redirect (not retryable)", async () => {
    const inits: RequestInit[] = [];
    const fetch302: typeof fetch = async (_url, init) => {
      inits.push(init ?? {});
      return new Response(null, { status: 302, headers: { location: "http://10.0.0.5/wp-json/site-manager/v1/site" } });
    };
    const client = new WordPressClient({ siteUrl: "https://cafe.example", token: "t", fetch: fetch302 });
    const e = await client.site().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WordPressApiError);
    expect(e).toMatchObject({ status: 302, code: "sm_redirect", message: "The site redirected the request; use its final address.", retryable: false });
    expect(inits[0].redirect).toBe("manual");
  });
});

describe("WordPressClient against the fake plugin", () => {
  it("handshakes with the code and slug, then needs the bearer token", async () => {
    const { wp, anon } = setup();
    const code = wp.issueCode();
    await expect(anon.handshake("WRONG", "agala")).rejects.toMatchObject({ status: 403, code: "sm_forbidden" });
    await expect(anon.handshake(code, "other-venue")).rejects.toMatchObject({ status: 403, code: "sm_forbidden" });
    const hs = await anon.handshake(code, "agala");
    expect(hs.token).toHaveLength(64);
    expect(hs.site.name).toBe("Smoke Café");
    expect(hs.site.pages.map((p) => p.title)).toEqual(["Home", "About", "Menu"]);
    await expect(anon.handshake(code, "agala")).rejects.toMatchObject({ status: 403 }); // one-time
    await expect(anon.site()).rejects.toMatchObject({ status: 401, code: "sm_unauthorized" });
    const bad = new WordPressClient({ siteUrl: wp.siteUrl, token: "nope", fetch: wp.fetch });
    await expect(bad.site()).rejects.toMatchObject({ status: 401 });
    const ok = new WordPressClient({ siteUrl: wp.siteUrl, token: hs.token, fetch: wp.fetch });
    expect((await ok.site()).connected_user).toEqual({ id: 1, login: "admin" });
    expect(wp.calls.map((c) => c.path)).toContain("/site");
  });

  it("reads a page with its plain text and previews a replacement without touching the live page", async () => {
    const { wp } = setup();
    const client = wp.connected();
    const about = await client.page(2);
    expect(about).toMatchObject({ id: 2, title: "About", builder: "gutenberg", editable: true, featured_media: null });
    expect(about.text).toBe("We bake banitsa every morning.");
    const p = await client.previewPage(2, { replacements: [{ find: "banitsa every morning", replace: "banitsa and kozunak every morning" }] });
    expect(p.before.content).toContain("banitsa every morning");
    expect(p.after.content).toBe("<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->");
    expect(p.preview_url).toBe(`https://cafe.example/about/?sm_preview=${p.pending_key}`);
    expect(wp.pageHtml(2)).toContain("banitsa every morning.");
    expect(wp.pageHtml(2)).not.toContain("kozunak");
    expect(wp.pageHtml(2, p.pending_key)).toContain("kozunak");
    expect(wp.pageHtml(2, "wrong-key")).not.toContain("kozunak");
  });

  it("refuses a find text that occurs zero or two times, and full content on Elementor", async () => {
    const { wp } = setup();
    const client = wp.connected();
    await expect(client.previewPage(2, { replacements: [{ find: "croissant", replace: "x" }] })).rejects.toMatchObject({ status: 422, code: "sm_replace_failed", data: { find: "croissant", count: 0 } });
    await expect(client.previewPage(2, { replacements: [{ find: "e", replace: "x" }] })).rejects.toMatchObject({ code: "sm_replace_failed" });
    const el = wp.addElementorPage("Events", [{ id: "a1", settings: { title: "Live jazz on Fridays" } }, { id: "a2", settings: { editor: "<p>Doors open at 19:00.</p>" } }]);
    const page = await client.page(el);
    expect(page.builder).toBe("elementor");
    expect(page.texts).toEqual(["Live jazz on Fridays", "<p>Doors open at 19:00.</p>"]);
    await expect(client.previewPage(el, { content: "<p>x</p>" })).rejects.toMatchObject({ status: 422, code: "sm_builder_unsupported", data: { builder: "elementor" } });
    const p = await client.previewPage(el, { replacements: [{ find: "19:00", replace: "20:00" }] });
    expect(p.preview_url).toBeNull();
    expect(JSON.parse(p.after.elementor_data as string)[1].settings.editor).toBe("<p>Doors open at 20:00.</p>");
    expect(p.after.content).toBe(p.before.content);
  });

  it("applies fields, resolves placeholders from uploaded media and records a revision", async () => {
    const { wp } = setup();
    const client = wp.connected();
    const m = await client.uploadMedia({ url: "https://cdn.example/m-1.jpg", source_id: "m-1", alt: "Christmas window", title: "Коледна витрина" });
    expect(m).toMatchObject({ id: 101, existed: false, alt: "Christmas window" });
    expect(m.url).toMatch(/^https:\/\/cafe\.example\/wp-content\/uploads\/.*m-1\.jpg$/);
    expect(await client.uploadMedia({ url: "https://cdn.example/m-1.jpg", source_id: "m-1" })).toMatchObject({ id: 101, existed: true });
    const applied = await client.applyPage(2, { title: "About us", content: '<!-- wp:image {"id":{{sm_media_id:m-1}}} --><figure><img src="{{sm_media_url:m-1}}"/></figure><!-- /wp:image -->', elementor_data: null, featured_media: 101 });
    expect(applied.after.content).toContain(`"id":101`);
    expect(applied.after.content).toContain(m.url);
    expect(applied.after.featured_media).toBe(101);
    expect(applied.before.title).toBe("About");
    expect(applied.revision_id).toBe(1);
    expect(wp.pages.get(2)?.title).toBe("About us");
    await expect(client.applyPage(2, { content: "{{sm_media_url:nope}}" })).rejects.toMatchObject({ status: 400, code: "sm_invalid", data: { placeholder: "{{sm_media_url:nope}}" } });
    expect(await client.deleteMedia({ source_id: "m-1" })).toEqual({ ok: true, deleted: true });
    expect(await client.deleteMedia({ source_id: "m-1" })).toEqual({ ok: true, deleted: false });
  });

  it("reads and writes options, menus and products", async () => {
    const { wp } = setup();
    const client = wp.connected();
    expect(await client.options()).toEqual({ blogname: "Smoke Café", blogdescription: "Just another WordPress site", custom_logo: null, site_icon: null });
    expect(await client.setOption("blogname", "Кафене „Ъгъла“")).toEqual({ key: "blogname", before: "Smoke Café", after: "Кафене „Ъгъла“" });
    await expect(client.setOption("admin_email" as never, "x")).rejects.toMatchObject({ status: 400, code: "sm_invalid" });
    const menu = await client.menu(3);
    expect(menu).toMatchObject({ id: 3, name: "Main", locations: ["primary"] });
    expect(menu.items.map((i) => [i.title, i.parent_index])).toEqual([["Home", null], ["About", null]]);
    const r = await client.setMenu(3, [{ title: "Home", url: "/" }, { title: "Menu", url: "/menu/" }, { title: "Lunch", url: "/menu/#lunch", parent_index: 1 }]);
    expect(r.before.map((i) => i.title)).toEqual(["Home", "About"]);
    expect(r.after.map((i) => [i.title, i.parent_index, i.position])).toEqual([["Home", null, 1], ["Menu", null, 2], ["Lunch", 1, 3]]);
    await expect(client.menu(99)).rejects.toMatchObject({ status: 404, code: "sm_not_found" });
    await expect(client.product(1)).rejects.toMatchObject({ status: 404, code: "sm_no_woocommerce" });
    wp.addProduct({ id: 77, name: "Espresso beans 250 g", regular_price: "12", sale_price: "", stock_status: "instock", description: "", short_description: "" });
    expect((await client.site()).woocommerce).toBe(true);
    const pr = await client.setProduct(77, { regular_price: "13.5", stock_status: "outofstock" });
    expect(pr.before.regular_price).toBe("12");
    expect(pr.after).toMatchObject({ regular_price: "13.5", stock_status: "outofstock" });
  });

  it("guards small edge cases: empty media delete, media upload validation, logo option values", async () => {
    const { wp } = setup();
    const client = wp.connected();
    await expect(client.deleteMedia({})).rejects.toMatchObject({ status: 400, code: "sm_invalid" });
    await expect(client.uploadMedia({ url: "https://cdn.example/l.png", source_id: "" })).rejects.toMatchObject({ status: 400, code: "sm_invalid", message: "source_id is required." });
    await expect(client.uploadMedia({ url: "file:///etc/passwd", source_id: "logo" })).rejects.toMatchObject({ status: 400, code: "sm_invalid", message: "url must be a public http(s) URL on port 80, 443 or 8080." });
    await client.uploadMedia({ url: "https://cdn.example/l.png", source_id: "logo" });
    expect(await client.setOption("custom_logo", "{{sm_media_id:logo}}")).toEqual({ key: "custom_logo", before: null, after: 101 });
    await expect(client.setOption("custom_logo", "{{sm_media_url:logo}}")).rejects.toMatchObject({ status: 400, code: "sm_invalid" });
    expect(wp.options.custom_logo).toBe(101);
  });

  it("maps network failures and server errors to retryable errors", async () => {
    const { wp } = setup();
    const client = wp.connected();
    wp.failNext = { status: 503, code: "sm_down", message: "maintenance" };
    const e1 = await client.site().catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(WordPressApiError);
    expect(e1).toMatchObject({ status: 503, retryable: true });
    wp.unreachable = true;
    const e2 = await client.site().catch((e: unknown) => e);
    expect(e2).toMatchObject({ status: 0, code: "sm_unreachable", retryable: true });
    wp.unreachable = false;
    const e3 = await client.page(999).catch((e: unknown) => e);
    expect(e3).toMatchObject({ status: 404, retryable: false });
  });
});
