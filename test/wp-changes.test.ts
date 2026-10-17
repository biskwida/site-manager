// test/wp-changes.test.ts
import { describe, expect, it } from "vitest";
import { applyChange, invertChanges } from "@/src/domain/changes";
import { renderPreview } from "@/src/domain/preview";
import { clip, wpPreviewLines } from "@/src/domain/wp-preview";
import { isWpEntity, type Change } from "@/src/domain/types";
import { state } from "./fixtures";

const page: Change = {
  position: 0, op: "wp_edit_page", entity: "wp_page", entity_id: "12",
  before: { title: "About", content: "<p>We bake banitsa every morning.</p>", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/" },
  after: { title: "About", content: "<p>We bake banitsa and kozunak every morning.</p>", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/", replacements: [{ find: "banitsa every morning", replace: "banitsa and kozunak every morning" }], preview_url: "https://cafe.example/about/?sm_preview=abc" },
};
const photo: Change = {
  position: 1, op: "wp_upload_photo", entity: "wp_media", entity_id: "m-1",
  before: null,
  after: { source_url: "https://cdn.example/m-1.jpg", title: "Коледна витрина", alt_bg: "Коледна витрина", alt_en: "Christmas window", page_id: 12, page_title: "About", as_featured: true, previous_featured: null },
};
const option: Change = { position: 2, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "Agala" }, after: { value: "Кафене „Ъгъла“" } };
const menu: Change = {
  position: 3, op: "wp_edit_menu", entity: "wp_menu", entity_id: "3",
  before: { name: "Main", items: [{ id: 1, title: "Home", url: "/", parent_index: null, position: 1, type: "custom", object_id: null }] },
  after: { name: "Main", items: [{ title: "Home", url: "/", parent_index: null, type: "custom", object_id: null }, { title: "Menu", url: "/menu/", parent_index: null, type: "custom", object_id: null }] },
};
const product: Change = { position: 4, op: "wp_edit_product", entity: "wp_product", entity_id: "77", before: { product_name: "Espresso beans", regular_price: "12" }, after: { product_name: "Espresso beans", regular_price: "13.5" } };

describe("wp entities in the change engine", () => {
  it("recognises wp_* entities and applies them as no-ops", () => {
    expect(isWpEntity("wp_page")).toBe(true);
    expect(isWpEntity("item")).toBe(false);
    const s = state();
    expect(applyChange(s, page)).toEqual(s);
    expect(applyChange(s, photo)).toEqual(s);
  });
  it("inverts like any other change", () => {
    const [inv] = invertChanges([page]);
    expect(inv.before).toEqual(page.after);
    expect(inv.after).toEqual(page.before);
    expect(inv.op).toBe("wp_edit_page");
  });
});

describe("wpPreviewLines", () => {
  it("clips long text on one line", () => {
    expect(clip("a\n b   c")).toBe("a b c");
    expect(clip("x".repeat(100), 10)).toBe("xxxxxxxxx…");
  });
  it("describes a page edit with replacements and the preview link, in both languages", () => {
    // The site's own words are kept as written in any language (keep markers, src/bot/translate.ts); links stay as they are.
    expect(wpPreviewLines(page, "bg")).toEqual([
      "• WordPress: страница „⟦About⟧“",
      "  „⟦banitsa every morning⟧“ → „⟦banitsa and kozunak every morning⟧“",
      "  Преглед: https://cafe.example/about/?sm_preview=abc",
    ]);
    expect(wpPreviewLines(page, "en")).toEqual([
      "• WordPress: page “⟦About⟧”",
      "  “⟦banitsa every morning⟧” → “⟦banitsa and kozunak every morning⟧”",
      "  Preview: https://cafe.example/about/?sm_preview=abc",
    ]);
  });
  it("describes an inverted page edit as restoring the previous text", () => {
    const [inv] = invertChanges([page]);
    expect(wpPreviewLines(inv, "bg")).toEqual(["• WordPress: страница „⟦About⟧“", "  връща предишния текст"]);
    expect(wpPreviewLines(inv, "en")).toEqual(["• WordPress: page “⟦About⟧”", "  restores the previous text"]);
  });
  it("describes photos, options, menus and products", () => {
    expect(wpPreviewLines(photo, "bg")).toEqual(["• WordPress: качва снимка „⟦Коледна витрина⟧“", "  като водеща снимка на страница „⟦About⟧“"]);
    expect(wpPreviewLines(photo, "en")).toEqual(["• WordPress: uploads photo “⟦Christmas window⟧”", "  as the featured image of page “⟦About⟧”"]);
    const [noPhoto] = invertChanges([photo]);
    expect(wpPreviewLines(noPhoto, "en")).toEqual(["• WordPress: removes photo “⟦Christmas window⟧”", "  and the featured image of page “⟦About⟧”"]);
    expect(wpPreviewLines(option, "bg")).toEqual(["• WordPress: Име на сайта: „⟦Agala⟧“ → „⟦Кафене „Ъгъла“⟧“"]);
    expect(wpPreviewLines(option, "en")).toEqual(["• WordPress: Site title: “⟦Agala⟧” → “⟦Кафене „Ъгъла“⟧”"]);
    expect(wpPreviewLines(menu, "en")).toEqual(["• WordPress: menu “⟦Main⟧”: 1 → 2 items", "  – ⟦Home⟧ → /", "  – ⟦Menu⟧ → /menu/"]);
    expect(wpPreviewLines(menu, "bg")[0]).toBe("• WordPress: меню „⟦Main⟧“: 1 → 2 елемента");
    expect(wpPreviewLines(product, "en")).toEqual(["• WordPress: product “⟦Espresso beans⟧”", "  price: “⟦12⟧” → “⟦13.5⟧”"]);
  });
  it("is wired into renderPreview", () => {
    const s = state();
    expect(renderPreview(s, [{ ...option, position: 0 }, { ...page, position: 1 }], "en", "Europe/Sofia")).toBe(
      ["• WordPress: Site title: “⟦Agala⟧” → “⟦Кафене „Ъгъла“⟧”", "• WordPress: page “⟦About⟧”", "  “⟦banitsa every morning⟧” → “⟦banitsa and kozunak every morning⟧”", "  Preview: https://cafe.example/about/?sm_preview=abc"].join("\n"),
    );
  });
});
