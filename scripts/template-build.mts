// scripts/template-build.mts
// Offline proof that every deployed venue site builds: writes each template's manifest to a temp dir, installs, runs `next build`.
//   npm run test:templates                         all templates
//   npm run test:templates -- classic nocturne     only these templates
//   npm run test:templates -- --keep               keep the temp dirs for inspection
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildFiles } from "../src/deploy/manifest";
import { TEMPLATE_IDS, type TemplateId } from "../src/domain/types";

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const named = argv.filter((a) => !a.startsWith("--"));
const unknown = named.filter((a) => !(TEMPLATE_IDS as readonly string[]).includes(a));
if (unknown.length) {
  console.error(`unknown template(s) ${unknown.map((u) => `"${u}"`).join(", ")} (one of ${TEMPLATE_IDS.join(", ")})`);
  process.exit(1);
}
const ids = (named.length ? named : [...TEMPLATE_IDS]) as TemplateId[];

function run(cmd: string, args: string[], cwd: string): boolean {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, SITE_MANAGER_URL: "http://localhost:3000", SITE_MANAGER_SLUG: "demo", NEXT_TELEMETRY_DISABLED: "1" } });
  return r.status === 0;
}

let failed = 0;
for (const id of ids) {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), `site-manager-shell-${id}-`));
  const files = await buildFiles(id);
  for (const f of files) {
    const abs = join(dir, f.file);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.encoding === "base64" ? Buffer.from(f.data, "base64") : f.data);
  }
  console.log(`\n=== ${id}: ${files.length} files in ${dir}`);
  const ok = run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir) && run("npx", ["next", "build"], dir);
  const secs = Math.round((Date.now() - started) / 1000);
  if (ok) {
    console.log(`=== ${id}: build OK (${secs} s)`);
    if (!keep) await rm(dir, { recursive: true, force: true });
  } else {
    failed++;
    console.error(`=== ${id}: BUILD FAILED after ${secs} s (files kept in ${dir})`);
  }
}
process.exit(failed ? 1 : 0);
