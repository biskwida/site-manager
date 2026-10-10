// test/wp-plugin-contract.test.ts
// Every feed field the PHP reads must exist on our types; every translatable PHP string must have a Bulgarian entry;
// the generated translation files must match the .po. Keeps the plugin honest without running WordPress.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generate, LANG_DIR, parsePo, PO_FILE } from "../scripts/wp-plugin-i18n.mts";
import { state } from "./fixtures";

const PLUGIN = resolve(process.cwd(), "integrations/wordpress/site-manager");

function phpFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = resolve(dir, f);
    return statSync(p).isDirectory() ? phpFiles(p) : p.endsWith(".php") ? [p] : [];
  });
}
const sources = phpFiles(PLUGIN).filter((p) => !p.includes("/languages/")).map((p) => readFileSync(p, "utf8")).join("\n");

describe("plugin ↔ feed contract", () => {
  it("reads only fields that exist in SiteState", () => {
    const s = state();
    const known = new Set<string>([
      ...Object.keys(s), ...Object.keys(s.venue), ...Object.keys(s.venue.theme), ...Object.keys(s.venue.hours), "open", "close",
      ...Object.keys(s.categories[0]), ...Object.keys(s.items[0]), "image_media_id", ...Object.keys(s.media[0] ?? { id: 1, public_url: 1, is_gallery: 1, position: 1 }),
      "date", "note_bg", "note_en", "text_bg", "text_en", "expires_at", "key", "state", "now", "stale",
      // settings / internal keys
      "base_url", "slug", "cache_seconds", "lang", "at", "url", "until", "next", "holiday", "weekday", "time",
    ]);
    const read = [...readFileSync(resolve(PLUGIN, "includes/class-sm-render.php"), "utf8").matchAll(/\$(?:state|v|i|c|m|a|h|t|dh|item|s|l|feed|last|cached|body)\['([a-z_]+)'\]/g)].map((m) => m[1]);
    const unknown = [...new Set(read)].filter((k) => !known.has(k));
    expect(unknown).toEqual([]);
  });
});

describe("plugin translations", () => {
  const { messages } = parsePo(readFileSync(PO_FILE, "utf8"));
  it("has a Bulgarian string for every translatable English string in the PHP", () => {
    const literals = [...sources.matchAll(/(?:__|_e|esc_html__|esc_attr__|esc_html_e|esc_attr_e)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'site-manager'\s*\)/g)].map((m) => m[1].replace(/\\'/g, "'"));
    const missing = [...new Set(literals)].filter((s) => !messages.has(s) || messages.get(s) === "");
    expect(missing).toEqual([]);
    const doubleQuoted = [...sources.matchAll(/(?:__|_e|esc_html__|esc_attr__|esc_html_e)\(\s*"/g)];
    expect(doubleQuoted, "use single-quoted strings in translation calls so the scanner sees them").toEqual([]);
  });
  it("ships generated translation files that match the .po", () => {
    const { php, mo } = generate();
    expect(readFileSync(resolve(LANG_DIR, "site-manager-bg_BG.l10n.php"), "utf8")).toBe(php);
    expect(readFileSync(resolve(LANG_DIR, "site-manager-bg_BG.mo")).equals(mo)).toBe(true);
    expect(mo.readUInt32LE(0)).toBe(0x950412de);
  });
});
