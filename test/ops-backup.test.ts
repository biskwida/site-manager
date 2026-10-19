// test/ops-backup.test.ts
// db:backup copies every public table (as JSON) and every storage file, so one free Supabase project is not the only copy.
import { describe, expect, it } from "vitest";
import { backupNamesToPrune, runBackup, type BackupSource } from "@/src/ops/backup";

function fakeSource(): BackupSource {
  const tables: Record<string, unknown[]> = { venues: [{ id: "v1" }], items: [{ id: "i1" }, { id: "i2" }], changes: [] };
  const files: Record<string, Record<string, string>> = { media: { "v1/a.jpg": "A", "v1/cutouts/b.png": "B", "v2/c.jpg": "C" } };
  return {
    tables: async () => Object.keys(tables),
    rows: async (t) => tables[t],
    buckets: async () => Object.keys(files),
    list: async (bucket, prefix) => {
      const seen = new Map<string, boolean>();
      for (const path of Object.keys(files[bucket])) {
        if (prefix && !path.startsWith(`${prefix}/`)) continue;
        const rest = prefix ? path.slice(prefix.length + 1) : path;
        const [head, ...tail] = rest.split("/");
        seen.set(head, tail.length > 0);
      }
      return [...seen].map(([name, folder]) => ({ name, folder }));
    },
    download: async (bucket, path) => new TextEncoder().encode(files[bucket][path]),
  };
}

describe("runBackup", () => {
  it("writes every table, every storage file (nested folders too) and a manifest with the counts", async () => {
    const written = new Map<string, string>();
    const sink = { write: async (path: string, data: string | Uint8Array) => void written.set(path, typeof data === "string" ? data : new TextDecoder().decode(data)) };
    const summary = await runBackup(fakeSource(), sink, new Date("2026-10-16T21:00:00Z"));

    expect(JSON.parse(written.get("db/items.json")!)).toEqual([{ id: "i1" }, { id: "i2" }]);
    expect(JSON.parse(written.get("db/changes.json")!)).toEqual([]);
    expect(written.get("storage/media/v1/a.jpg")).toBe("A");
    expect(written.get("storage/media/v1/cutouts/b.png")).toBe("B");
    expect(written.get("storage/media/v2/c.jpg")).toBe("C");
    expect(summary).toEqual({ tables: { venues: 1, items: 2, changes: 0 }, files: 3 });
    expect(JSON.parse(written.get("manifest.json")!)).toEqual({ taken_at: "2026-10-16T21:00:00.000Z", ...summary });
  });
});

describe("backupNamesToPrune", () => {
  it("keeps the newest N timestamped folders and ignores anything else", () => {
    const names = ["2026-10-14T21-00-00Z", "notes.txt", "2026-10-16T21-00-00Z", "2026-10-15T21-00-00Z"];
    expect(backupNamesToPrune(names, 2)).toEqual(["2026-10-14T21-00-00Z"]);
    expect(backupNamesToPrune(names, 5)).toEqual([]);
  });
});
