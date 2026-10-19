// test/venue-users-sql.test.ts — venue_users and account_invites: schema.sql and the 2026-10-19 migration agree, idempotent, server-only.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION = "migrations/2026-10-19-venue-users.sql";
function statements(path: string): string[] {
  const sql = readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8").replace(/--.*$/gm, "");
  return sql.split(";").map((s) => s.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
}

describe("venue_users and account_invites SQL", () => {
  it("the migration exists", () => {
    expect(existsSync(new URL(`../supabase/${MIGRATION}`, import.meta.url))).toBe(true);
  });

  it.each(["schema.sql", MIGRATION])("%s creates venue_users keyed by venue and user, tied to auth.users and venues", (file) => {
    const t = statements(file).find((s) => s.startsWith("create table if not exists public.venue_users"));
    expect(t).toBeDefined();
    expect(t).toContain("venue_id uuid not null references public.venues(id) on delete cascade");
    expect(t).toContain("user_id uuid not null references auth.users(id) on delete cascade");
    expect(t).toContain("role text not null check (role in ('owner', 'staff'))");
    expect(t).toContain("primary key (venue_id, user_id)");
  });

  it.each(["schema.sql", MIGRATION])("%s creates account_invites with lower-case emails, one pending row per venue and email", (file) => {
    const t = statements(file).find((s) => s.startsWith("create table if not exists public.account_invites"));
    expect(t).toBeDefined();
    expect(t).toContain("venue_id uuid not null references public.venues(id) on delete cascade");
    expect(t).toContain("email text not null check (email = lower(email))");
    expect(t).toContain("claimed_at timestamptz");
    expect(t).toContain("primary key (venue_id, email)");
  });

  it.each(["schema.sql", MIGRATION])("%s indexes venue_users by user", (file) => {
    expect(statements(file)).toContain("create index if not exists venue_users_user_idx on public.venue_users(user_id)");
  });

  it("the migration makes both tables server-only, like policies.sql", () => {
    const s = statements(MIGRATION);
    for (const t of ["venue_users", "account_invites"]) {
      expect(s).toContain(`alter table public.${t} enable row level security`);
      expect(s).toContain(`revoke all on public.${t} from anon, authenticated`);
    }
  });

  it("is re-runnable: every create is guarded", () => {
    for (const file of ["schema.sql", MIGRATION]) {
      for (const s of statements(file).filter((x) => /venue_users|account_invites/.test(x) && /^create /.test(x))) expect(s, s).toMatch(/^create (table|index) if not exists /);
    }
  });
});
