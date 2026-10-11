// scripts/db-dry-run.mts
// Runs SQL files against SUPABASE_DB_URL inside one transaction and ROLLS BACK: nothing is changed.
//   npm run db:dry-run                                   (default: supabase/migrations/2026-10-10-chat-ref.sql)
//   npm run db:dry-run -- supabase/migrations/2026-10-10-chat-ref.sql schema.sql policies.sql
// After the files it checks what phase 1 of the chat_ref change must leave behind: no member without chat_ref,
// the fill_chat_ref trigger present, and the production (Telegram-only) upserts still working and filling chat_ref.
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error("Missing SUPABASE_DB_URL (Supabase → Settings → Database → Connection string URI); put it in .env.local");

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["supabase/migrations/2026-10-10-chat-ref.sql"];
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
let failed = false;
try {
  await client.query("begin");
  for (const file of files) {
    const sql = await readFile(new URL(`../${file.startsWith("supabase/") ? file : "supabase/" + file}`, import.meta.url), "utf8");
    await client.query(sql);
    console.log(`ran ${file} (inside the transaction)`);
  }
  const nulls = Number((await client.query("select count(*) as n from public.venue_members where chat_ref is null")).rows[0].n);
  const triggers = (await client.query("select tgname, tgrelid::regclass::text as tbl from pg_trigger where tgname = 'fill_chat_ref' order by 2")).rows;
  console.log(`venue_members with chat_ref null: ${nulls}`);
  console.log(`fill_chat_ref trigger on: ${triggers.map((t) => t.tbl).join(", ") || "(none)"}`);
  if (nulls !== 0 || triggers.length === 0) failed = true;

  // Production's upserts (onConflict venue_id,tg_chat_id and venue_id,chat_id), twice each, with a sentinel chat id.
  const venue = (await client.query("select id from public.venues limit 1")).rows[0]?.id as string | undefined;
  if (!venue) console.log("legacy upsert check: SKIP (no venue)");
  else {
    const chat = 999000000001;
    for (let i = 0; i < 2; i++) {
      await client.query("insert into public.venue_members (venue_id, tg_chat_id, role, lang) values ($1, $2, 'staff', 'en') on conflict (venue_id, tg_chat_id) do update set lang = excluded.lang", [venue, chat]);
      await client.query("insert into public.conversations (venue_id, chat_id, turns) values ($1, $2, '[]'::jsonb) on conflict (venue_id, chat_id) do update set turns = excluded.turns", [venue, chat]);
    }
    const m = (await client.query("select chat_ref from public.venue_members where venue_id = $1 and tg_chat_id = $2", [venue, chat])).rows;
    const c = (await client.query("select chat_ref from public.conversations where venue_id = $1 and chat_id = $2", [venue, chat])).rows;
    const ok = m.length === 1 && m[0].chat_ref === `tg:${chat}` && c.length === 1 && c[0].chat_ref === `tg:${chat}`;
    console.log(`legacy upsert check (production's Telegram-only writes): ${ok ? "PASS" : "FAIL"}`);
    if (!ok) failed = true;
  }
} catch (e) {
  failed = true;
  console.error(`ERROR: ${(e as Error).message}`);
} finally {
  await client.query("rollback").catch(() => {});
  console.log("rolled back: nothing was changed");
  await client.end();
}
console.log(failed ? "DRY RUN FAILED" : "DRY RUN OK");
process.exit(failed ? 1 : 0);
