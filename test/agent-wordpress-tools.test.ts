// test/agent-wordpress-tools.test.ts
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { FakeWordPress } from "./fake-wordpress";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-09T09:00:00.000Z");
const KEY = parseSecretKey("ab".repeat(32));

async function setup(over: Partial<AgentDeps> = {}) {
  const demo = await makeDemo();
  const wp = new FakeWordPress();
  const client = wp.connected();
  const token = (client as unknown as { o: { token: string } }).o.token;
  await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "wordpress", config: { site_url: wp.siteUrl, site_name: "Smoke Café" }, secrets: encryptSecrets({ token }, KEY) });
  const store = withDestinationSync(demo.store, { store: demo.store, secretKey: KEY, fetch: wp.fetch, log: () => undefined }, () => T0);
  const messenger = new FakeMessenger();
  const member = (await store.findMember("tg:1001"))!;
  const deps: AgentDeps = { store, venueId: demo.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: "https://site.example", wordpress: client, ...over };
  const photo = await store.saveMedia(demo.venue.id, new Uint8Array([1, 2, 3]), "image/jpeg");
  return { ...demo, store, wp, messenger, deps, photo, tools: makeTools(deps) };
}

describe("wp tools availability", () => {
  it("are absent without a connected site and present with one", async () => {
    const { tools } = await setup({ wordpress: null });
    expect(tools.map((t) => t.name).filter((n) => n.startsWith("wp_"))).toEqual([]);
    const { tools: withWp } = await setup();
    expect(withWp.map((t) => t.name).filter((n) => n.startsWith("wp_"))).toEqual(["wp_list_site", "wp_read_page", "wp_edit_page", "wp_upload_photo", "wp_set_option", "wp_edit_menu", "wp_edit_product"]);
  });
});

describe("wp_list_site / wp_read_page", () => {
  it("lists pages, menus, options and reads a page with its text", async () => {
    const { tools } = await setup();
    const site = await call(tools, "wp_list_site", {});
    expect(site.site_name).toBe("Smoke Café");
    expect((site.pages as { id: number; title: string; builder: string }[]).map((p) => [p.id, p.title, p.builder])).toEqual([[1, "Home", "gutenberg"], [2, "About", "gutenberg"], [3, "Menu", "classic"]]);
    expect((site.menus as { id: number; name: string }[])[0]).toMatchObject({ id: 3, name: "Main" });
    expect(site.options).toMatchObject({ blogname: "Smoke Café" });
    expect(site.woocommerce).toBe(false);
    const page = await call(tools, "wp_read_page", { page_id: 2 });
    expect(page).toMatchObject({ id: 2, title: "About", builder: "gutenberg", editable: true, text: "We bake banitsa every morning." });
    expect(page.content).toContain("<!-- wp:paragraph -->");
    expect(await call(tools, "wp_read_page", { page_id: 999 })).toMatchObject({ error: "No such page." });
  });
});

describe("wp_edit_page", () => {
  it("previews a replacement, proposes it with the plugin's before/after and applies it on ✅ with the WordPress line", async () => {
    const { tools, store, wp, messenger } = await setup();
    const r = await call(tools, "wp_edit_page", { summary_bg: "Нов текст в „За нас“", summary_en: "New About text", page_id: 2, replacements: [{ find: "banitsa every morning", replace: "banitsa and kozunak every morning" }] });
    expect(r).toMatchObject({ status: "proposed" });
    expect(r.preview).toBe(`• WordPress: страница „About“\n  „banitsa every morning“ → „banitsa and kozunak every morning“\n  Преглед: https://cafe.example/about/?sm_preview=${r.pending_key}`);
    expect(r.preview_url).toMatch(/sm_preview=/);
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes).toHaveLength(1);
    expect(cs.changes[0]).toMatchObject({ op: "wp_edit_page", entity: "wp_page", entity_id: "2", before: { title: "About", page_title: "About", page_url: "https://cafe.example/about/" }, after: { content: "<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->" } });
    expect(wp.pages.get(2)?.content).not.toContain("kozunak"); // nothing written yet
    expect(messenger.sent[0]).toMatchObject({ setId: cs.id, lang: "bg" });
    const decision = await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", cs.id);
    expect(decision.edit?.full).toContain("✅ Приложено\nWordPress: обновено ✅");
    expect(wp.pages.get(2)?.content).toContain("kozunak");
    expect(wp.pending.has(2)).toBe(false);
  });
  it("refuses ambiguous replacements, Elementor full content, staff and an unchanged page", async () => {
    const { tools, wp } = await setup();
    const amb = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, replacements: [{ find: "e", replace: "x" }] });
    expect(amb.error).toMatch(/occurs \d+ times on the page; choose a longer unique anchor/);
    const none = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, replacements: [{ find: "croissant", replace: "x" }] });
    expect(none.error).toMatch(/occurs 0 times/);
    const el = wp.addElementorPage("Events", [{ id: "a1", settings: { title: "Live jazz" } }]);
    const full = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: el, content: "<p>x</p>" });
    expect(full.error).toMatch(/Elementor; send replacements/);
    const same = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, title: "About" });
    expect(same.error).toMatch(/Nothing would change/);
    const { tools: staffTools } = await setup({ chatRef: "tg:1002", member: { venue_id: "", chat_ref: "tg:1002", role: "staff", lang: "en", last_seen_at: null, created_at: "" } });
    const staff = await call(staffTools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, title: "X" });
    expect(staff.error).toMatch(/only the owner/);
  });
  it("bundles photos: upload rows first, placeholders carry the photo URL into the preview", async () => {
    const { tools, store, photo, wp } = await setup();
    const content = `<!-- wp:paragraph --><p>Коледа в Ъгъла.</p><!-- /wp:paragraph --><!-- wp:image {"id":{{sm_media_id:${photo.id}}}} --><figure class="wp-block-image"><img src="{{sm_media_url:${photo.id}}}" alt="Коледна витрина"/></figure><!-- /wp:image -->`;
    const r = await call(tools, "wp_edit_page", { summary_bg: "Коледна секция", summary_en: "Christmas section", page_id: 2, content, photos: [{ media_id: photo.id, alt_bg: "Коледна витрина", alt_en: "Christmas window" }] });
    expect(r.status).toBe("proposed");
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes.map((c) => [c.position, c.entity])).toEqual([[0, "wp_media"], [1, "wp_page"]]);
    expect(cs.changes[0].after).toMatchObject({ source_url: photo.public_url, alt_bg: "Коледна витрина", alt_en: "Christmas window", page_id: 2, page_title: "About", as_featured: false });
    expect(wp.pending.get(2)?.after.content).toContain(`src="${photo.public_url}"`); // preview shows our copy of the photo
    expect(String(cs.changes[1].after?.content)).toContain(`{{sm_media_url:${photo.id}}}`); // the push resolves it after the upload
    expect(r.preview).toContain("• WordPress: качва снимка „Коледна витрина“");
    await store.updateChangeSet(cs.id, { status: "cancelled" }); // the pending check now runs before the placeholder check
    const unknown = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, content: "{{sm_media_url:nope}}", photos: [] });
    expect(unknown.error).toMatch(/nope/);
  });
  it("keeps placeholders in the stored row on every path, proposes photos alone when the page is unchanged, and refuses before previewing when a proposal is pending", async () => {
    const { tools, store, photo, wp, deps } = await setup();
    const photos = [{ media_id: photo.id, alt_bg: "Витрина", alt_en: "Window" }];
    // A replacement whose replace text carries a placeholder: the plugin's preview resolves it to our URL for display only.
    const r = await call(tools, "wp_edit_page", { summary_bg: "Снимка в „За нас“", summary_en: "Photo on About", page_id: 2, replacements: [{ find: "every morning.", replace: `every morning.<img src="{{sm_media_url:${photo.id}}}">` }], photos });
    expect(r.status).toBe("proposed");
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes.map((c) => c.entity)).toEqual(["wp_media", "wp_page"]);
    expect(String(cs.changes[1].after?.content)).toContain(`{{sm_media_url:${photo.id}}}`);
    expect(String(cs.changes[1].after?.content)).not.toContain(photo.public_url);
    expect(wp.pending.get(2)?.after.content).toContain(photo.public_url);
    // A proposal from an earlier message pending: the next message is refused before the plugin stores a preview for the page.
    wp.pending.delete(2);
    const refused = await call(makeTools(deps), "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, title: "Y" });
    expect(refused.error).toMatch(/already waiting for a decision/);
    expect(wp.pending.has(2)).toBe(false);
    await store.updateChangeSet(cs.id, { status: "cancelled" });
    // Photos with an unchanged page: only the upload rows, no no-op page row.
    const only = await call(tools, "wp_edit_page", { summary_bg: "Снимка", summary_en: "Photo", page_id: 2, title: "About", photos });
    expect(only.status).toBe("proposed");
    const cs2 = await store.getChangeSet(only.change_set_id as string);
    expect(cs2.changes.map((c) => [c.position, c.entity])).toEqual([[0, "wp_media"]]);
    expect(only.preview).toBe("• WordPress: качва снимка „Витрина“");
  });
});

describe("wp_upload_photo / wp_set_option / wp_edit_menu / wp_edit_product", () => {
  it("proposes a featured photo with the previous featured image remembered", async () => {
    const { tools, store, photo, wp } = await setup();
    wp.pages.get(2)!.featured_media = 55;
    const r = await call(tools, "wp_upload_photo", { summary_bg: "Нова снимка", summary_en: "New photo", media_id: photo.id, alt_bg: "Витрина", alt_en: "Window", page_id: 2, as_featured: true });
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes[0]).toMatchObject({ op: "wp_upload_photo", entity: "wp_media", entity_id: photo.id, before: null, after: { page_id: 2, page_title: "About", as_featured: true, previous_featured: 55 } });
    expect(r.preview).toBe("• WordPress: качва снимка „Витрина“\n  като водеща снимка на страница „About“");
    expect(await call(tools, "wp_upload_photo", { summary_bg: "x", summary_en: "x", media_id: "nope", alt_bg: "a", alt_en: "a" })).toMatchObject({ error: expect.stringMatching(/media_id "nope" not found/) });
    expect(await call(tools, "wp_upload_photo", { summary_bg: "x", summary_en: "x", media_id: photo.id, alt_bg: "a", alt_en: "a", as_featured: true })).toMatchObject({ error: "as_featured needs page_id (the page that gets the featured image)." });
  });
  it("proposes site title and a logo from a photo", async () => {
    const { tools, store, photo } = await setup();
    const t = await call(tools, "wp_set_option", { summary_bg: "Име", summary_en: "Name", key: "blogname", value: "Кафене „Ъгъла“" });
    expect((await store.getChangeSet(t.change_set_id as string)).changes[0]).toMatchObject({ entity: "wp_option", entity_id: "blogname", before: { value: "Smoke Café" }, after: { value: "Кафене „Ъгъла“" } });
    await store.updateChangeSet(t.change_set_id as string, { status: "cancelled" });
    const l = await call(tools, "wp_set_option", { summary_bg: "Лого", summary_en: "Logo", key: "custom_logo", media_id: photo.id, alt_bg: "Лого", alt_en: "Logo" });
    const cs = await store.getChangeSet(l.change_set_id as string);
    expect(cs.changes.map((c) => c.entity)).toEqual(["wp_media", "wp_option"]);
    expect(cs.changes[1]).toMatchObject({ entity_id: "custom_logo", before: { value: null }, after: { value: `{{sm_media_id:${photo.id}}}` } });
    expect(l.preview).toContain("• WordPress: Лого: — → новата снимка");
    expect(await call(tools, "wp_set_option", { summary_bg: "x", summary_en: "x", key: "custom_logo" })).toMatchObject({ error: expect.stringMatching(/media_id/) });
  });
  it("proposes a menu replacement and a product patch", async () => {
    const { tools, store, wp } = await setup();
    const m = await call(tools, "wp_edit_menu", { summary_bg: "Меню", summary_en: "Menu", menu_id: 3, items: [{ title: "Home", url: "/" }, { title: "Menu", url: "/menu/" }] });
    expect((await store.getChangeSet(m.change_set_id as string)).changes[0]).toMatchObject({ entity: "wp_menu", entity_id: "3", before: { name: "Main" }, after: { name: "Main", items: [{ title: "Home", url: "/", parent_index: null }, { title: "Menu", url: "/menu/", parent_index: null }] } });
    expect(m.preview).toBe("• WordPress: меню „Main“: 2 → 2 елемента\n  – Home → /\n  – Menu → /menu/");
    await store.updateChangeSet(m.change_set_id as string, { status: "cancelled" });
    expect(await call(tools, "wp_edit_product", { summary_bg: "x", summary_en: "x", product_id: 77, patch: { regular_price: "13.50" } })).toMatchObject({ error: "WooCommerce is not active on this site." });
    wp.addProduct({ id: 77, name: "Espresso beans 250 g", regular_price: "12", sale_price: "", stock_status: "instock", description: "", short_description: "" });
    const p = await call(tools, "wp_edit_product", { summary_bg: "Цена на зърната", summary_en: "Beans price", product_id: 77, patch: { regular_price: "13.50" } });
    expect((await store.getChangeSet(p.change_set_id as string)).changes[0]).toMatchObject({ entity: "wp_product", entity_id: "77", before: { product_name: "Espresso beans 250 g", regular_price: "12" }, after: { product_name: "Espresso beans 250 g", regular_price: "13.50" } });
    expect(p.preview).toBe("• WordPress: продукт „Espresso beans 250 g“\n  цена: „12“ → „13.50“");
  });
});

describe("monthly change limit", () => {
  it("refuses WordPress proposals at the limit before the plugin stores a preview", async () => {
    const { tools, store, venue, wp } = await setup();
    await store.setChangeLimit(venue.id, 0);
    const page = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, title: "Y" });
    expect(page.error).toMatch(/Monthly change limit reached.*Лимитът от 0 промени за този месец е достигнат \(0\/0\)\. Нови промени от 1 ноември\./);
    expect(wp.pending.has(2)).toBe(false);
    expect((await call(tools, "wp_set_option", { summary_bg: "Име", summary_en: "Name", key: "blogname", value: "Ново" })).error).toMatch(/Monthly change limit reached/);
    expect(await store.listChangeSets(venue.id)).toEqual([]);
  });
});
