// scripts/db-backup.mts
// Copies every public table and every storage file into BACKUP_DIR/<timestamp>/ (default ~/Backups/site-manager),
// then keeps the newest BACKUP_KEEP (default 14). Read-only against Supabase. Needs SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. The copy holds personal data (owner chats, members): keep it on this machine, never in git.
//   npm run db:backup
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { backupFolderName, backupNamesToPrune, runBackup, type BackupSource } from "../src/ops/backup";

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}; put it in .env.local`);
  return v;
}

const root = process.env.BACKUP_DIR?.trim() || join(homedir(), "Backups", "site-manager");
const keep = Number(process.env.BACKUP_KEEP ?? 14);
if (!Number.isInteger(keep) || keep < 1) throw new Error("BACKUP_KEEP must be a positive integer");

const client = new pg.Client({ connectionString: need("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

const PAGE = 1000;
const source: BackupSource = {
  async tables() {
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
    );
    return rows.map((r) => r.table_name);
  },
  async rows(table) {
    const { rows } = await client.query(`select * from "${table.replace(/"/g, '""')}"`);
    return rows;
  },
  async buckets() {
    const { data, error } = await db.storage.listBuckets();
    if (error) throw error;
    return data.map((b) => b.name);
  },
  async list(bucket, prefix) {
    const out: { name: string; folder: boolean }[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      // Supabase lists folders as entries without an id.
      for (const e of data) out.push({ name: e.name, folder: e.id === null });
      if (data.length < PAGE) return out;
    }
  },
  async download(bucket, path) {
    const { data, error } = await db.storage.from(bucket).download(path);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  },
};

const folder = join(root, backupFolderName());
await mkdir(folder, { recursive: true, mode: 0o700 });
await client.connect();
try {
  const summary = await runBackup(source, {
    async write(path, data) {
      const file = join(folder, path);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, data, { mode: 0o600 });
    },
  });
  const rows = Object.values(summary.tables).reduce((a, b) => a + b, 0);
  console.log(`backup ${folder}: ${Object.keys(summary.tables).length} tables, ${rows} rows, ${summary.files} files`);
} catch (e) {
  await rm(folder, { recursive: true, force: true }); // never leave a half backup that looks complete
  throw e;
} finally {
  await client.end();
}

for (const old of backupNamesToPrune(await readdir(root), keep)) {
  await rm(join(root, old), { recursive: true, force: true });
  console.log(`pruned ${old}`);
}
