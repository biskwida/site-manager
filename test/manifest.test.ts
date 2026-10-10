// test/manifest.test.ts
import { readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFiles, MANIFEST_DIRS, SHELL_ROOT, type InlinedFile } from "@/src/deploy/manifest";

const BUILTIN = /^node:/;
const TEXT_EXT = /\.(ts|tsx|css|json|mjs|js|md|txt|svg)$/;

/** Runtime specifiers only: `import type …` statements are erased by the compiler and may point at files the manifest does not ship. */
function specifiers(source: string): string[] {
  const runtime = source.replace(/^\s*import\s+type\b[^;]*;/gm, "");
  const out: string[] = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s+["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of runtime.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** Every specifier, type-only ones included: `next build` type-checks the shell, and tsc resolves `import type` too. */
function allSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s+["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of source.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** True when `spec` imported from `file` resolves to a file in the manifest or to a dependency the shell package.json provides. */
function resolves(spec: string, file: string, set: Set<string>): boolean {
  if (spec === "react" || spec === "react-dom" || spec.startsWith("react/") || spec.startsWith("react-dom/")) return true;
  if (spec === "next" || spec.startsWith("next/")) return true;
  if (BUILTIN.test(spec)) return true;
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) base = posix.normalize(posix.join(dirname(file), spec));
  else return false;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.tsx`].some((p) => set.has(p));
}

describe("buildFiles", () => {
  it("ships the shell, the chosen template, shared code, the domain closure and i18n, in a deterministic order", async () => {
    const files = await buildFiles("classic");
    const names = files.map((f) => f.file);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    for (const must of ["package.json", "next.config.ts", "tsconfig.json", "app/layout.tsx", "app/page.tsx", "app/menu/page.tsx", "app/globals.css", "app/not-found.tsx", "app/robots.ts", "app/sitemap.ts", "app/opengraph-image.tsx", "src/templates/current.ts", "src/templates/classic/Template.tsx", "src/templates/classic/index.ts", "src/templates/shared/useLiveSite.ts", "src/templates/shared/media.ts", "src/domain/types.ts", "src/domain/format.ts", "src/time.ts", "src/i18n/index.tsx", "src/i18n/dicts.ts", "src/templates/index.d.ts", "src/wizard/schema.d.ts"]) {
      expect(names, `missing ${must}`).toContain(must);
    }
    expect(files.find((f) => f.file === "src/templates/current.ts")).toEqual({ file: "src/templates/current.ts", data: 'export { def } from "./classic";\n', encoding: "utf-8" });
    expect(names).not.toContain("src/templates/index.ts"); // templates import only its types; shipping it would bundle every design
    const again = await buildFiles("classic");
    expect(JSON.stringify(again)).toBe(JSON.stringify(files));
    expect(SHELL_ROOT).toBe("templates/shell");
    expect(MANIFEST_DIRS).toEqual(["src/templates/shared", "src/domain", "src/time.ts", "src/i18n"]);
  });

  it("includes only allowed paths, no env files, no tests, no other templates", async () => {
    const files = await buildFiles("classic");
    for (const f of files) {
      const ok = f.file.startsWith("app/") || f.file.startsWith("src/") || ["package.json", "next.config.ts", "tsconfig.json"].includes(f.file);
      expect(ok, f.file).toBe(true);
      expect(f.file, f.file).not.toMatch(/(^|\/)\.env/);
      expect(f.file, f.file).not.toMatch(/\.test\.tsx?$/);
      expect(f.file, f.file).not.toMatch(/(^|\/)(tests|node_modules|\.next)\//);
      if (f.file.startsWith("src/templates/") && f.file !== "src/templates/current.ts" && f.file !== "src/templates/index.d.ts") {
        expect(f.file, f.file).toMatch(/^src\/templates\/(shared|classic)\//);
      }
    }
    const nocturne = await buildFiles("nocturne");
    expect(nocturne.find((f) => f.file === "src/templates/current.ts")?.data).toBe('export { def } from "./nocturne";\n');
    expect(nocturne.some((f) => f.file.startsWith("src/templates/classic/"))).toBe(false);
  });

  it("resolves every import inside the manifest or to react, next or node builtins", async () => {
    const files = await buildFiles("classic");
    const set = new Set(files.map((f) => f.file));
    const unresolved: string[] = [];
    for (const f of files) {
      if (!/\.(ts|tsx)$/.test(f.file) || f.encoding !== "utf-8") continue;
      for (const spec of specifiers(f.data)) if (!resolves(spec, f.file, set)) unresolved.push(`${f.file} → ${spec}`);
    }
    expect(unresolved).toEqual([]);
  });

  it("resolves type-only imports as well, through the shell's type-only stand-ins", async () => {
    for (const id of ["classic", "nocturne"] as const) {
      const files = await buildFiles(id);
      const set = new Set(files.map((f) => f.file));
      const unresolved: string[] = [];
      for (const f of files) {
        if (!/\.(ts|tsx)$/.test(f.file)) continue;
        for (const spec of allSpecifiers(f.data)) if (!/\.css$/.test(spec) && !resolves(spec, f.file, set)) unresolved.push(`${f.file} → ${spec}`);
      }
      expect(unresolved, id).toEqual([]);
      for (const stub of ["src/templates/index.d.ts", "src/wizard/schema.d.ts"]) {
        const code = (files.find((f) => f.file === stub)?.data ?? "").replace(/^\s*\/\/.*$/gm, "").trim();
        expect(code, stub).toMatch(/^export type\b/);
      }
    }
  });

  it("encodes text as utf-8 straight from disk and everything else as base64", async () => {
    const files = await buildFiles("classic");
    const byName = new Map(files.map((f) => [f.file, f] as const));
    const tpl = byName.get("src/templates/classic/Template.tsx") as InlinedFile;
    expect(tpl.encoding).toBe("utf-8");
    expect(tpl.data).toBe(readFileSync("src/templates/classic/Template.tsx", "utf8"));
    for (const f of files) expect(f.encoding, f.file).toBe(TEXT_EXT.test(f.file) ? "utf-8" : "base64");
    expect(files.length).toBeGreaterThan(30);
    expect(files.length).toBeLessThan(120);
  });
});
