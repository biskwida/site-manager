// test/templates-boundary.test.ts
// Guarantees the shell bundle is complete: files under src/templates/** may only import what the manifest ships.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMPLATES = join(ROOT, "src", "templates");
const DOMAIN_ALLOWED = new Set(["types", "format", "effective", "hours", "allergens"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && name !== "current.ts") out.push(p);
  }
  return out;
}

export function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s+["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of source.matchAll(re)) out.push(m[1]);
  }
  return out;
}

export function allowed(spec: string, file: string): boolean {
  if (spec === "react" || spec === "react-dom" || spec.startsWith("react/") || spec.startsWith("react-dom/")) return true;
  if (spec === "next" || spec.startsWith("next/")) return true;
  if (spec.startsWith("./") || spec.startsWith("../")) return !relative(TEMPLATES, resolve(dirname(file), spec)).startsWith("..");
  if (spec.startsWith("@/src/templates/")) return true;
  if (spec.startsWith("@/src/domain/")) return DOMAIN_ALLOWED.has(spec.slice("@/src/domain/".length));
  if (spec === "@/src/time") return true;
  if (spec === "@/src/i18n" || spec.startsWith("@/src/i18n/")) return true;
  return false;
}

describe("src/templates import boundary", () => {
  it("only imports react, next/*, src/templates/**, the domain closure, src/time and src/i18n", () => {
    const files = walk(TEMPLATES);
    expect(files.length).toBeGreaterThanOrEqual(12);
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of specifiers(readFileSync(f, "utf8"))) if (!allowed(spec, f)) offenders.push(`${relative(ROOT, f)} → ${spec}`);
    }
    expect(offenders).toEqual([]);
  });
  it("classifies specifiers", () => {
    const f = join(TEMPLATES, "classic", "Template.tsx");
    expect(allowed("@/src/domain/types", f)).toBe(true);
    expect(allowed("@/src/domain/changes", f)).toBe(false);
    expect(allowed("@/src/store/memory", f)).toBe(false);
    expect(allowed("@/src/lib/supabase-browser", f)).toBe(false);
    expect(allowed("@supabase/supabase-js", f)).toBe(false);
    expect(allowed("../shared/media", f)).toBe(true);
    expect(allowed("../../server/site", f)).toBe(false);
    expect(allowed("next/image", f)).toBe(true);
    expect(specifiers('import x from "a";\nexport { y } from "./b";\nconst z = await import("c");')).toEqual(["a", "./b", "c"]);
  });
});
