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
check("anon can read venues", !venues.error, venues.error?.message ?? `${venues.data?.length ?? 0} rows`);
const items = await db.from("items").select("id").limit(1);
check("anon can read items", !items.error, items.error?.message ?? `${items.data?.length ?? 0} rows`);
const demoSlug = process.env.DEMO_VENUE_SLUG?.trim() || "agala";
const demo = await db.from("venues").select("id").eq("slug", demoSlug).maybeSingle();
if (demo.data) {
  const demoItems = await db.from("items").select("id", { count: "exact", head: true }).eq("venue_id", demo.data.id);
  check(`anon sees the "${demoSlug}" menu`, !demoItems.error && (demoItems.count ?? 0) > 0, demoItems.error?.code ?? `${demoItems.count} items`);
} else console.log(`SKIP anon sees the "${demoSlug}" menu (no such venue yet)`);
for (const t of ["venue_members", "venue_invites", "venue_admin_tokens", "change_sets", "changes", "conversations"]) {
  const r = await db.from(t).select("*").limit(1);
  check(`anon cannot read ${t}`, !!r.error || (r.data?.length ?? 0) === 0, r.error?.code ?? `${r.data?.length ?? 0} rows`);
}
// Writes must be refused by the grants themselves (42501 insufficient_privilege), not merely match zero rows.
const write = await db.from("items").update({ price_eur: 1 }).eq("id", "00000000-0000-0000-0000-000000000000").select("id");
check("anon cannot update items: permission denied", write.error?.code === "42501", write.error?.code ?? `no error, ${write.data?.length ?? 0} rows`);
const ins = await db.from("announcements").insert({ venue_id: "00000000-0000-0000-0000-000000000000", text_bg: "x", text_en: "x" }).select("id");
check("anon cannot insert announcements: permission denied", ins.error?.code === "42501", ins.error?.code ?? `no error, ${ins.data?.length ?? 0} rows`);
const tokens = await db.from("venue_admin_tokens").select("token").limit(1);
check("anon sees no admin tokens", (tokens.data?.length ?? 0) === 0, tokens.error?.code);
// No media objects exist after a fresh seed, so this checks the public URL shape (bucket served from the public path), not a fetch.
const publicUrl = db.storage.from("media").getPublicUrl("x").data.publicUrl;
check("media public URL uses the public object path", publicUrl.includes("/object/public/media/"));

process.exit(failed ? 1 : 0);
