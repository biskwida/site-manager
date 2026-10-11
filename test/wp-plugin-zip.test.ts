// test/wp-plugin-zip.test.ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildZip, listPluginFiles, ZIP_PATH, zipEntries } from "../scripts/wp-plugin-zip.mts";

describe("public/wp/site-manager.zip", () => {
  it("is committed and matches the plugin sources (run `npm run wp:zip` after changing the plugin)", () => {
    expect(existsSync(ZIP_PATH)).toBe(true);
    const fresh = buildZip();
    expect(readFileSync(ZIP_PATH).equals(fresh), "stale zip: run npm run wp:zip and commit public/wp/site-manager.zip").toBe(true);
    const names = zipEntries(fresh);
    expect(names).toContain("site-manager/site-manager.php");
    expect(names).toContain("site-manager/readme.txt");
    expect(names).toContain("site-manager/uninstall.php");
    expect(names).toContain("site-manager/blocks/menu/block.json");
    expect(names).toContain("site-manager/languages/site-manager-bg_BG.l10n.php");
    expect(names).toContain("site-manager/languages/site-manager-bg_BG.mo");
    expect(names.some((n) => n.includes("/tests/") || n.endsWith(".DS_Store"))).toBe(false);
    expect(names.length).toBe(listPluginFiles().length);
    expect(buildZip().equals(fresh)).toBe(true); // deterministic
  });
});
