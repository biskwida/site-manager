// Copies every public table (one JSON file each) and every storage file out of Supabase. The schema itself lives in
// supabase/*.sql in git, so data is all a restore needs. Wired to Postgres + Supabase Storage in scripts/db-backup.mts.

export interface BackupSource {
  /** Table names in the public schema. */
  tables(): Promise<string[]>;
  rows(table: string): Promise<unknown[]>;
  buckets(): Promise<string[]>;
  /** Direct children of `prefix` ("" = bucket root); folders are listed with folder: true. */
  list(bucket: string, prefix: string): Promise<{ name: string; folder: boolean }[]>;
  download(bucket: string, path: string): Promise<Uint8Array>;
}

export interface BackupSink {
  /** `path` is relative to this backup's folder. */
  write(path: string, data: string | Uint8Array): Promise<void>;
}

export interface BackupSummary {
  tables: Record<string, number>;
  files: number;
}

export async function runBackup(src: BackupSource, sink: BackupSink, now = new Date()): Promise<BackupSummary> {
  const summary: BackupSummary = { tables: {}, files: 0 };
  for (const table of await src.tables()) {
    const rows = await src.rows(table);
    await sink.write(`db/${table}.json`, JSON.stringify(rows));
    summary.tables[table] = rows.length;
  }
  for (const bucket of await src.buckets()) {
    const folders = [""];
    while (folders.length) {
      const prefix = folders.pop() as string;
      for (const entry of await src.list(bucket, prefix)) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.folder) {
          folders.push(path);
          continue;
        }
        await sink.write(`storage/${bucket}/${path}`, await src.download(bucket, path));
        summary.files++;
      }
    }
  }
  await sink.write("manifest.json", JSON.stringify({ taken_at: now.toISOString(), ...summary }, null, 2));
  return summary;
}

/** Folder name for a backup taken at `now`: sortable, and safe on every file system (no colons). */
export function backupFolderName(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

/** Backup folders (by backupFolderName) beyond the newest `keep`; other names are left alone. */
export function backupNamesToPrune(names: string[], keep: number): string[] {
  const backups = names.filter((n) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(n)).sort().reverse();
  return backups.slice(keep);
}
