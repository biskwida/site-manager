// scripts/check-rls.mts
// Proves with the anon key what the browser can and cannot do. Exit 1 on any FAIL.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
const db = createClient(url, anon, { auth: { persistSession: false } });
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const admin = serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

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
// R27: column-level grants. Owner-only venue columns are refused by the grant itself (42501), even on live rows.
for (const col of ["deploy", "wizard_draft", "draft_token_hash", "instagram_import"]) {
  const r = await db.from("venues").select(col).limit(1);
  check(`anon cannot select venues.${col}: permission denied`, r.error?.code === "42501", r.error?.code ?? `no error, ${r.data?.length ?? 0} rows`);
}
const star = await db.from("venues").select("*").limit(1);
check("anon cannot select venues.*: permission denied", star.error?.code === "42501", star.error?.code ?? `no error, ${star.data?.length ?? 0} rows`);
const liveCols = await db.from("venues").select("id, slug, name").eq("status", "live").limit(1);
check("anon can read id, slug, name of a live venue", !liveCols.error && (liveCols.data?.length ?? 0) === 1 && typeof liveCols.data?.[0]?.name === "string", liveCols.error?.code ?? `${liveCols.data?.length ?? 0} rows`);
for (const t of ["venue_members", "venue_invites", "venue_admin_tokens", "change_sets", "changes", "conversations"]) {
  const r = await db.from(t).select("*").limit(1);
  check(`anon cannot read ${t}`, !!r.error || (r.data?.length ?? 0) === 0, r.error?.code ?? `${r.data?.length ?? 0} rows`);
}
if (admin) {
  // A throwaway draft proves the policy hides drafts (an empty result alone would pass with no drafts at all).
  const slug = `rlscheck-${randomBytes(4).toString("hex")}`;
  const created = await admin.from("venues").insert({ slug, name: "RLS check", status: "draft" }).select("id").single();
  try {
    check("service role creates a throwaway draft venue", !created.error && !!created.data, created.error?.code ?? slug);
    const asAdmin = await admin.from("venues").select("id").eq("slug", slug);
    check("service role sees the throwaway draft", !asAdmin.error && asAdmin.data?.length === 1, asAdmin.error?.code ?? `${asAdmin.data?.length ?? 0} rows`);
    const asAnon = await db.from("venues").select("id").eq("slug", slug);
    check("anon cannot see the throwaway draft", !asAnon.error && (asAnon.data?.length ?? 0) === 0, asAnon.error?.code ?? `${asAnon.data?.length ?? 0} rows`);
  } finally {
    const del = await admin.from("venues").delete().eq("slug", slug);
    check("throwaway draft venue deleted", !del.error, del.error?.code ?? slug);
  }
} else console.log("SKIP anon cannot see a draft venue (no SUPABASE_SERVICE_ROLE_KEY)");
const rl = await db.from("rate_limits").select("*").limit(1);
check("anon cannot read rate_limits", !!rl.error || (rl.data?.length ?? 0) === 0, rl.error?.code ?? `${rl.data?.length ?? 0} rows`);
const bump = await db.rpc("bump_rate_limit", { p_key: "rls-check", p_window_ms: 1000, p_max: 1, p_now: new Date().toISOString() });
check("anon cannot call bump_rate_limit: permission denied", bump.error?.code === "42501", bump.error?.code ?? "no error");
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

for (const t of ["venue_destinations", "destination_syncs"]) {
  const r = await db.from(t).select("*").limit(1);
  check(`anon cannot read ${t}`, !!r.error || (r.data?.length ?? 0) === 0, r.error?.code ?? `${r.data?.length ?? 0} rows`);
}

process.exit(failed ? 1 : 0);
