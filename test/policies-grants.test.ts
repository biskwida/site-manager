// test/policies-grants.test.ts — R27: anon/authenticated may select only the public feed's venue columns (column-level grants).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicSiteState } from "@/src/server/site";
import { makeDemo } from "./helpers";

const BILLING_COLUMNS = ["plan", "billing_status", "trial_started_at", "trial_ends_at", "past_due_since", "stripe_customer_id", "stripe_subscription_id", "trial_reminder_sent", "website_fee_paid"];
const sql = readFileSync(new URL("../supabase/policies.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
const statements = sql.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

describe("supabase/policies.sql venue grants", () => {
  it("no table-wide select on venues: revoked, then granted column by column", () => {
    const tableWide = statements.filter((s) => /^grant select on /i.test(s));
    for (const s of tableWide) expect(s, s).not.toMatch(/public\.venues\b/);
    expect(tableWide.join(" ")).toMatch(/public\.site_texts.*public\.media/); // the other content tables keep table-wide select
    const revoke = statements.findIndex((s) => /^revoke select on public\.venues from anon, authenticated$/i.test(s));
    const grant = statements.findIndex((s) => /^grant select \(.+\) on public\.venues to anon, authenticated$/i.test(s));
    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(grant).toBeGreaterThan(revoke);
    expect(statements.some((s) => /create policy "anon read venues" on public\.venues/i.test(s))).toBe(true);
  });

  it("grants exactly the PublicVenue columns (the public feed's venue), never the owner-only ones", async () => {
    const { store, venue } = await makeDemo();
    const publicColumns = Object.keys(publicSiteState(await store.getSite(venue.id)).venue).sort();
    const grant = statements.find((s) => /^grant select \(.+\) on public\.venues/i.test(s))!;
    const granted = grant.slice(grant.indexOf("(") + 1, grant.indexOf(")")).split(",").map((c) => c.trim()).sort();
    expect(granted).toEqual(publicColumns);
    for (const secret of ["deploy", "wizard_draft", "draft_token_hash", "instagram_import", "publishing_at", "site_url", "site_mode", "site_platform", "created_via", "comment_mode", "comment_digest_hour", "comment_limit", "last_comment_digest_at", ...BILLING_COLUMNS]) expect(granted).not.toContain(secret);
    expect(granted).toEqual(expect.arrayContaining(["id", "slug", "status"])); // check:rls reads id, slug; the RLS policies test status
  });

  it("data_deletion_requests is server-only: RLS on, everything revoked from anon/authenticated, never granted", () => {
    expect(statements).toContain("alter table public.data_deletion_requests enable row level security");
    expect(statements).toContain("revoke all on public.data_deletion_requests from anon, authenticated");
    expect(statements.filter((s) => /^grant /i.test(s)).join(" ")).not.toMatch(/data_deletion_requests/);
  });

  it("translations is server-only: RLS on, no policy, everything revoked from anon/authenticated, never granted", () => {
    expect(statements).toContain("alter table public.translations enable row level security");
    expect(statements).toContain("revoke all on public.translations from anon, authenticated");
    expect(statements.filter((s) => /^(grant|create policy) /i.test(s)).join(" ")).not.toMatch(/translations/);
  });

  it.each(["venue_users", "account_invites"])("%s is server-only: RLS on, no policy, everything revoked from anon/authenticated, never granted", (table) => {
    expect(statements).toContain(`alter table public.${table} enable row level security`);
    expect(statements).toContain(`revoke all on public.${table} from anon, authenticated`);
    expect(statements.filter((s) => /^(grant|create policy) /i.test(s)).join(" ")).not.toMatch(new RegExp(table));
  });

  it("account tables never appear in any column or table-wide grant", () => {
    for (const s of statements.filter((x) => /^grant /i.test(x))) expect(s).not.toMatch(/venue_users|account_invites/);
  });

  it("billing_events is server-only: RLS on, no policy, everything revoked from anon/authenticated, never granted", () => {
    expect(statements).toContain("alter table public.billing_events enable row level security");
    expect(statements).toContain("revoke all on public.billing_events from anon, authenticated");
    expect(statements.filter((s) => /^(grant|create policy) /i.test(s)).join(" ")).not.toMatch(/billing_events/);
  });

  it("no billing column is in any grant on venues, and none is in the public feed's venue", async () => {
    for (const s of statements.filter((x) => /^grant /i.test(x))) for (const c of BILLING_COLUMNS) expect(s, `${c} in ${s}`).not.toMatch(new RegExp(`\\b${c}\\b`));
    const { store, venue } = await makeDemo();
    await store.updateVenue(venue.id, { plan: "both", billing_status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", website_fee_paid: true });
    const feed = publicSiteState(await store.getSite(venue.id)).venue as unknown as Record<string, unknown>;
    for (const c of BILLING_COLUMNS) expect(Object.keys(feed), c).not.toContain(c);
    expect(JSON.stringify(feed)).not.toMatch(/cus_1|sub_1/);
  });
});
