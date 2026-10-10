// scripts/db-apply.mts
// Applies supabase/schema.sql and policies.sql to SUPABASE_DB_URL. Idempotent.
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error("Missing SUPABASE_DB_URL (Supabase → Settings → Database → Connection string URI); put it in .env.local");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const file of ["schema.sql", "policies.sql"]) {
    const sql = await readFile(new URL(`../supabase/${file}`, import.meta.url), "utf8");
    await client.query(sql);
    console.log(`applied ${file}`);
  }
  await client.query("notify pgrst, 'reload schema'");
  const { rows } = await client.query("select (select count(*) from venues) as venues, (select count(*) from items) as items");
  console.log(`venues=${rows[0].venues} items=${rows[0].items}`);
} finally {
  await client.end();
}
