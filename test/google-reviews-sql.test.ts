// test/google-reviews-sql.test.ts — Google reviews as a third comment network: the migration and schema-integrations.sql agree.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The file's text, comments removed, whitespace collapsed, lower case. */
function sql(path: string): string {
  return readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8").replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
}
const MIGRATION = "migrations/2026-10-31-google-reviews.sql";

describe("google reviews in social_comments", () => {
  it.each([MIGRATION, "schema-integrations.sql"])("%s allows the google network and has rating and review_updated_at", (file) => {
    const s = sql(file);
    expect(s).toContain("network in ('facebook', 'instagram', 'google')");
    expect(s).toContain("rating smallint");
    expect(s).toContain("rating is null or rating between 1 and 5");
    expect(s).toContain("review_updated_at timestamptz");
  });

  it("the migration replaces the old check, is safe to re-run and reloads the schema cache", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("alter table public.social_comments drop constraint if exists social_comments_network_check");
    expect(s.indexOf("add constraint social_comments_network_check")).toBeGreaterThan(s.indexOf("drop constraint if exists"));
    expect(s).toContain("add column if not exists rating smallint");
    expect(s).toContain("add column if not exists review_updated_at timestamptz");
    expect(s.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
    const raw = readFileSync(new URL(`../supabase/${MIGRATION}`, import.meta.url), "utf8");
    expect(raw).toContain("npm run db:apply -- supabase/migrations/2026-10-31-google-reviews.sql");
  });
});
