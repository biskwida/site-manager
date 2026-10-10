// scripts/cleanup-test-venues.mts
// npm run cleanup:test-venues — deletes venues whose slug starts with "test-" (left by the store contract tests) and their
// storage objects. Rows in every other table cascade from venues. Prints counts.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: venues, error } = await db.from("venues").select("id, slug").like("slug", "test-%");
if (error) throw new Error(`list test venues: ${error.message}`);
console.log(`test venues found: ${venues.length}`);

let objects = 0;
for (const v of venues) {
  // Objects live at <venue_id>/<uuid>.<ext>; list in pages until empty.
  for (;;) {
    const { data: files, error: listError } = await db.storage.from("media").list(v.id as string, { limit: 100 });
    if (listError) throw new Error(`list storage ${v.slug}: ${listError.message}`);
    if (!files.length) break;
    const { error: rmError } = await db.storage.from("media").remove(files.map((f) => `${v.id}/${f.name}`));
    if (rmError) throw new Error(`remove storage ${v.slug}: ${rmError.message}`);
    objects += files.length;
  }
}
if (venues.length) {
  const { error: delError, count } = await db.from("venues").delete({ count: "exact" }).in("id", venues.map((v) => v.id as string));
  if (delError) throw new Error(`delete test venues: ${delError.message}`);
  console.log(`deleted venues: ${count ?? venues.length} (members, invites, tokens, menu, change sets and media rows cascade)`);
}
console.log(`deleted storage objects: ${objects}`);
const { count: left } = await db.from("venues").select("id", { count: "exact", head: true }).like("slug", "test-%");
console.log(`test venues left: ${left ?? "?"}`);
