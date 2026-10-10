// test/destinations-wordpress.test.ts
import { describe, expect, it } from "vitest";
import { wordpressAdapter } from "@/src/destinations/wordpress";
import type { PushContext } from "@/src/destinations/types";
import { invertChanges } from "@/src/domain/changes";
import type { Change, ChangeSet } from "@/src/domain/types";
import { FakeWordPress } from "./fake-wordpress";
import { venue } from "./fixtures";

const T0 = new Date("2026-10-09T09:00:00.000Z");

function ctx(wp: FakeWordPress, token: string, changes: Change[]): PushContext {
  const cs = { id: "cs-1", venue_id: "v1", changes } as unknown as ChangeSet;
  return { venue: venue(), destination: { id: "d1", venue_id: "v1", kind: "wordpress", config: { site_url: wp.siteUrl }, status: "connected", last_error: null, created_at: "", updated_at: "" }, secrets: { token }, changeSet: cs, changes: wordpressAdapter.relevant(changes), fetch: wp.fetch, now: T0 };
}
function tokenOf(wp: FakeWordPress): string {
  const client = wp.connected();
  return (client as unknown as { o: { token: string } }).o.token;
}

const pageEdit: Change = {
  position: 1, op: "wp_edit_page", entity: "wp_page", entity_id: "2",
  before: { title: "About", content: "<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/" },
  after: { title: "About", content: '<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph --><!-- wp:image {"id":{{sm_media_id:m-1}}} --><figure class="wp-block-image"><img src="{{sm_media_url:m-1}}" alt="Christmas window"/></figure><!-- /wp:image -->', elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/", replacements: [], preview_url: null },
};
const upload: Change = { position: 0, op: "wp_upload_photo", entity: "wp_media", entity_id: "m-1", before: null, after: { source_url: "https://cdn.example/m-1.jpg", title: "Коледна витрина", alt_bg: "Коледна витрина", alt_en: "Christmas window", page_id: 2, page_title: "About", as_featured: true, previous_featured: null } };
const option: Change = { position: 2, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "Smoke Café" }, after: { value: "Кафене „Ъгъла“" } };
const menu: Change = { position: 3, op: "wp_edit_menu", entity: "wp_menu", entity_id: "3", before: { name: "Main", items: [{ id: 1, title: "Home", url: "/", parent_index: null, position: 1, type: "custom", object_id: null }, { id: 2, title: "About", url: "/about/", parent_index: null, position: 2, type: "custom", object_id: null }] }, after: { name: "Main", items: [{ title: "Home", url: "/" }, { title: "Menu", url: "/menu/" }] } };

describe("wordpressAdapter", () => {
  it("keeps only wp_* changes in position order", () => {
    const other: Change = { position: 5, op: "set_price", entity: "item", entity_id: "i", before: {}, after: {} };
    expect(wordpressAdapter.relevant([pageEdit, other, upload]).map((c) => c.entity)).toEqual(["wp_media", "wp_page"]);
  });

  it("uploads first, resolves placeholders in the page, sets the featured image, options and menus", async () => {
    const wp = new FakeWordPress();
    const token = tokenOf(wp);
    const r = await wordpressAdapter.push(ctx(wp, token, [pageEdit, upload, option, menu]));
    expect(r).toMatchObject({ ok: true, line: { bg: "WordPress: обновено ✅" } });
    const page = wp.pages.get(2)!;
    expect(page.content).toContain('"id":101');
    expect(page.content).toContain("/wp-content/uploads/");
    expect(page.content).not.toContain("{{sm_media");
    expect(page.featured_media).toBe(101);
    expect(wp.media.get(101)?.alt).toBe("Коледна витрина"); // venue default_lang bg
    expect(wp.options.blogname).toBe("Кафене „Ъгъла“");
    expect(wp.menus.get(3)?.items.map((i) => i.title)).toEqual(["Home", "Menu"]);
    if (r.ok) expect((r.result.pushed as unknown[]).length).toBe(4);
  });

  it("undo restores the previous content, removes the photo and the featured image, and the old menu", async () => {
    const wp = new FakeWordPress();
    const token = tokenOf(wp);
    await wordpressAdapter.push(ctx(wp, token, [upload, pageEdit, option, menu]));
    const r = await wordpressAdapter.push(ctx(wp, token, invertChanges([upload, pageEdit, option, menu])));
    expect(r.ok).toBe(true);
    const page = wp.pages.get(2)!;
    expect(page.content).toBe("<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->");
    expect(page.featured_media).toBeNull();
    expect(wp.media.size).toBe(0);
    expect(wp.options.blogname).toBe("Smoke Café");
    expect(wp.menus.get(3)?.items.map((i) => i.title)).toEqual(["Home", "About"]);
  });

  it("stops at the first failed change and leaves no placeholder behind; retries are idempotent", async () => {
    const wp = new FakeWordPress();
    const token = tokenOf(wp);
    wp.failNext = { status: 502, code: "sm_upload_failed", message: "could not download" };
    const r1 = await wordpressAdapter.push(ctx(wp, token, [upload, pageEdit]));
    expect(r1).toMatchObject({ ok: false, retry: true, line: { en: "WordPress: update failed, will retry" } });
    expect(wp.pages.get(2)!.content).not.toContain("{{sm_media");
    expect(wp.pages.get(2)!.content).not.toContain("wp:image");
    const r2 = await wordpressAdapter.push(ctx(wp, token, [upload, pageEdit]));
    expect(r2.ok).toBe(true);
    expect(wp.media.size).toBe(1);
    const r3 = await wordpressAdapter.push(ctx(wp, token, [upload, pageEdit]));
    expect(r3.ok).toBe(true);
    expect(wp.media.size).toBe(1); // idempotent upload
  });

  it("reports a non-retryable error with its message", async () => {
    const wp = new FakeWordPress();
    const token = tokenOf(wp);
    const r = await wordpressAdapter.push(ctx(wp, token, [{ ...pageEdit, entity_id: "999" }]));
    expect(r).toMatchObject({ ok: false, retry: false });
    if (!r.ok) expect(r.line.en).toBe("WordPress: error: No such page.");
  });
});
