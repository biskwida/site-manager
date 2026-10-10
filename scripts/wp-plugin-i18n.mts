// scripts/wp-plugin-i18n.mts
// Generates languages/site-manager-bg_BG.l10n.php (WordPress ≥ 6.5 PHP translation file) and the classic .mo
// from the hand-written .po. No gettext tools needed. Run: npm run wp:i18n
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const LANG_DIR = resolve(process.cwd(), "integrations/wordpress/site-manager/languages");
export const PO_FILE = resolve(LANG_DIR, "site-manager-bg_BG.po");

/** Parses a simple .po (no plurals, no contexts): [msgid, msgstr] pairs, header included as "" → metadata. */
export function parsePo(text: string): { header: string; messages: Map<string, string> } {
  const messages = new Map<string, string>();
  let header = "";
  let current: { id: string[]; str: string[]; mode: "id" | "str" | null } = { id: [], str: [], mode: null };
  const unq = (s: string) => JSON.parse(s.replace(/^\s*"|"\s*$/g, '"')) as string;
  const flush = () => {
    if (current.mode === null) return;
    const id = current.id.join("");
    const str = current.str.join("");
    if (id === "") header = str;
    else messages.set(id, str);
    current = { id: [], str: [], mode: null };
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("msgid ")) {
      flush();
      current.mode = "id";
      current.id.push(unq(line.slice(6)));
    } else if (line.startsWith("msgstr ")) {
      current.mode = "str";
      current.str.push(unq(line.slice(7)));
    } else if (line.startsWith('"')) {
      (current.mode === "id" ? current.id : current.str).push(unq(line));
    }
  }
  flush();
  return { header, messages };
}

export function toL10nPhp(header: string, messages: Map<string, string>): string {
  const esc = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  const version = /Project-Id-Version: (.*)\n/.exec(header)?.[1] ?? "Site Manager";
  const lines = [...messages].filter(([, v]) => v !== "").map(([k, v]) => `\t${esc(k)} => ${esc(v)},`);
  return `<?php\nreturn [\n\t'project-id-version' => ${esc(version)},\n\t'language' => 'bg_BG',\n\t'x-generator' => 'scripts/wp-plugin-i18n.mts',\n\t'plural-forms' => 'nplurals=2; plural=(n != 1);',\n\t'messages' => [\n${lines.join("\n")}\n\t],\n];\n`;
}

/** Minimal GNU .mo writer: header entry ("" → metadata) plus the translated messages, sorted by msgid bytes. */
export function toMo(header: string, messages: Map<string, string>): Buffer {
  const entries = [["", header] as [string, string], ...[...messages].filter(([, v]) => v !== "")].sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const n = entries.length;
  const origTable = 28;
  const transTable = origTable + n * 8;
  let offset = transTable + n * 8;
  const strings: Buffer[] = [];
  const orig: { len: number; off: number }[] = [];
  const trans: { len: number; off: number }[] = [];
  for (const [id] of entries) {
    const b = Buffer.from(id, "utf8");
    orig.push({ len: b.length, off: offset });
    strings.push(b, Buffer.from([0]));
    offset += b.length + 1;
  }
  for (const [, str] of entries) {
    const b = Buffer.from(str, "utf8");
    trans.push({ len: b.length, off: offset });
    strings.push(b, Buffer.from([0]));
    offset += b.length + 1;
  }
  const head = Buffer.alloc(transTable + n * 8);
  head.writeUInt32LE(0x950412de, 0);
  head.writeUInt32LE(0, 4);
  head.writeUInt32LE(n, 8);
  head.writeUInt32LE(origTable, 12);
  head.writeUInt32LE(transTable, 16);
  head.writeUInt32LE(0, 20);
  head.writeUInt32LE(0, 24);
  orig.forEach((e, i) => {
    head.writeUInt32LE(e.len, origTable + i * 8);
    head.writeUInt32LE(e.off, origTable + i * 8 + 4);
  });
  trans.forEach((e, i) => {
    head.writeUInt32LE(e.len, transTable + i * 8);
    head.writeUInt32LE(e.off, transTable + i * 8 + 4);
  });
  return Buffer.concat([head, ...strings]);
}

export function generate(): { php: string; mo: Buffer } {
  const { header, messages } = parsePo(readFileSync(PO_FILE, "utf8"));
  return { php: toL10nPhp(header, messages), mo: toMo(header, messages) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { php, mo } = generate();
  writeFileSync(resolve(LANG_DIR, "site-manager-bg_BG.l10n.php"), php);
  writeFileSync(resolve(LANG_DIR, "site-manager-bg_BG.mo"), mo);
  console.log("wrote site-manager-bg_BG.l10n.php and site-manager-bg_BG.mo");
}
