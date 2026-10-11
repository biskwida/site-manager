// test/wp-plugin-blocks.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(process.cwd(), "integrations/wordpress/site-manager/blocks");
const NAMES = ["menu", "specials", "hours", "announcements", "photos", "text"];

describe("block.json files", () => {
  it("exist for every block with the lang attribute and the shared editor script", () => {
    for (const n of NAMES) {
      const meta = JSON.parse(readFileSync(resolve(DIR, n, "block.json"), "utf8")) as Record<string, unknown>;
      expect(meta.name).toBe(`site-manager/${n}`);
      expect(meta.apiVersion).toBe(3);
      expect(meta.textdomain).toBe("site-manager");
      expect(meta.editorScript).toBe("site-manager-blocks");
      const attrs = meta.attributes as Record<string, { type: string; default: string; enum?: string[] }>;
      expect(attrs.lang).toEqual({ type: "string", default: "auto", enum: ["auto", "bg", "en"] });
      if (n === "text") expect(attrs.key).toEqual({ type: "string", default: "welcome" });
      else expect(attrs.key).toBeUndefined();
      expect((meta.supports as Record<string, unknown>).html).toBe(false);
    }
    const js = readFileSync(resolve(DIR, "editor.js"), "utf8");
    for (const n of NAMES) expect(js).toContain(`'site-manager/${n}'`);
    expect(js).not.toMatch(/\bimport\b|=>|`/); // plain ES5: runs without a build step in every browser WordPress supports
  });
});
