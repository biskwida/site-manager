// src/deploy/manifest.ts
// Builds the file list of one venue's thin site: shell + chosen template + shared template code + domain closure + i18n.
// Paths are preserved, so the shell's tsconfig `@/*` → `./*` resolves `@/src/...` exactly as in this repo.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { TemplateId } from "../domain/types";

export interface InlinedFile {
  file: string;
  data: string;
  encoding: "utf-8" | "base64";
}

export const SHELL_ROOT = "templates/shell";
/** Repo-relative paths copied verbatim (plus src/templates/<id>). */
export const MANIFEST_DIRS = ["src/templates/shared", "src/domain", "src/time.ts", "src/i18n"];

const TEXT_EXT = /\.(ts|tsx|css|json|mjs|js|md|txt|svg)$/;
const SKIP_DIR = new Set(["node_modules", ".next", "tests", "__tests__", ".git"]);
const skipFile = (name: string) => name.startsWith(".env") || name === ".DS_Store" || /\.test\.tsx?$/.test(name) || name.endsWith(".tsbuildinfo") || name === "next-env.d.ts";

async function walk(absDir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(absDir, { withFileTypes: true })) {
    const p = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) await walk(p, out);
    } else if (entry.isFile() && !skipFile(entry.name)) out.push(p);
  }
  return out;
}

const toPosix = (p: string) => p.split(sep).join(posix.sep);

async function inline(abs: string, file: string): Promise<InlinedFile> {
  const bytes = await readFile(abs);
  return TEXT_EXT.test(file) ? { file, data: bytes.toString("utf8"), encoding: "utf-8" } : { file, data: bytes.toString("base64"), encoding: "base64" };
}

/** Deterministic (sorted by path) list of files, paths relative to the shell root. `root` defaults to process.cwd() (the repo root). */
export async function buildFiles(templateId: TemplateId, opts: { root?: string } = {}): Promise<InlinedFile[]> {
  const root = opts.root ?? process.cwd();
  const out: InlinedFile[] = [];
  const shell = join(root, SHELL_ROOT);
  for (const abs of await walk(shell)) out.push(await inline(abs, toPosix(relative(shell, abs))));
  // src/templates/index.ts is deliberately absent: templates import only its types (erased), and shipping it would pull in every design.
  for (const dir of [...MANIFEST_DIRS, `src/templates/${templateId}`]) {
    const abs = join(root, dir);
    const s = await stat(abs);
    const files = s.isDirectory() ? await walk(abs) : [abs];
    for (const f of files) {
      const rel = toPosix(relative(root, f));
      if (rel === "src/templates/current.ts") continue; // generated below, never read from disk
      out.push(await inline(f, rel));
    }
  }
  out.push({ file: "src/templates/current.ts", data: `export { def } from "./${templateId}";\n`, encoding: "utf-8" });
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return out;
}
