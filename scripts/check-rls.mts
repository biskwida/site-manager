// scripts/check-rls.mts
// Proves with the anon key what the browser can and cannot do. Exit 1 on any FAIL.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
const db = createClient(url, anon, { auth: { persistSession: false } });

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

const venues = await db.from("venues").select("id, slug").limit(5);
check("anon can read venues", !venues.error, venues.error?.message);
const items = await db.from("items").select("id").limit(1);
check("anon can read items", !items.error, items.error?.message);
for (const t of ["venue_members", "venue_invites", "venue_admin_tokens", "change_sets", "changes", "conversations"]) {
  const r = await db.from(t).select("*").limit(1);
  check(`anon cannot read ${t}`, !!r.error || (r.data?.length ?? 0) === 0, r.error?.code ?? `${r.data?.length ?? 0} rows`);
}
const write = await db.from("items").update({ price_eur: 1 }).eq("id", "00000000-0000-0000-0000-000000000000").select("id");
check("anon cannot update items", (write.data?.length ?? 0) === 0);
const ins = await db.from("announcements").insert({ venue_id: "00000000-0000-0000-0000-000000000000", text_bg: "x", text_en: "x" }).select("id");
check("anon cannot insert announcements", !!ins.error || (ins.data?.length ?? 0) === 0, ins.error?.code);
const tokens = await db.from("venue_admin_tokens").select("token").limit(1);
check("anon sees no admin tokens", (tokens.data?.length ?? 0) === 0, tokens.error?.code);
const bucket = await db.storage.from("media").list("", { limit: 1 });
check("media bucket is readable", !bucket.error, bucket.error?.message);

process.exit(failed ? 1 : 0);
