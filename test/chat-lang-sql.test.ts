// test/chat-lang-sql.test.ts — any conversation language in the database: schema.sql and the 2026-10-16 migration agree.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The file's SQL statements, comments removed, whitespace collapsed, lower case. */
function statements(path: string): string[] {
  const sql = readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8").replace(/--.*$/gm, "");
  return sql.split(";").map((s) => s.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
}
const MIGRATION = "migrations/2026-10-16-chat-lang.sql";
const CHECK = "alter table public.venue_members add constraint venue_members_lang_check check (lang ~ '^[a-z]{2}$')";

describe("venue_members.lang and the translations table", () => {
  it("the migration exists", () => {
    expect(existsSync(new URL(`../supabase/${MIGRATION}`, import.meta.url))).toBe(true);
  });

  it.each(["schema.sql", MIGRATION])("%s widens the member language check to any lower-case two-letter code", (file) => {
    const s = statements(file);
    const drop = s.indexOf("alter table public.venue_members drop constraint if exists venue_members_lang_check");
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(s.indexOf(CHECK)).toBeGreaterThan(drop);
  });

  it("schema.sql creates venue_members with the wide check from the start", () => {
    const table = statements("schema.sql").find((s) => s.startsWith("create table if not exists public.venue_members"));
    expect(table).toContain("lang text not null default 'bg' check (lang ~ '^[a-z]{2}$')");
    expect(table).not.toContain("lang in (");
  });

  it.each(["schema.sql", MIGRATION])("%s creates translations keyed by language and source hash", (file) => {
    const table = statements(file).find((s) => s.startsWith("create table if not exists public.translations"));
    expect(table).toBeDefined();
    for (const column of ["lang text not null", "source_hash text not null", "text text not null", "created_at timestamptz not null default now()", "primary key (lang, source_hash)"]) expect(table).toContain(column);
  });

  it("the migration also makes translations server-only, like policies.sql", () => {
    const s = statements(MIGRATION);
    expect(s).toContain("alter table public.translations enable row level security");
    expect(s).toContain("revoke all on public.translations from anon, authenticated");
    expect(s.join(";")).not.toMatch(/\bgrant\b|create policy/);
  });
});
