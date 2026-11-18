// test/supabase-apply.test.ts
import { describe, expect, it } from "vitest";
import { SupabaseStore } from "@/src/store/supabase";

type Call = { table: string; steps: [string, unknown[]][] };
type Result = { data: unknown; error: { message: string } | null };

/** Minimal chainable stand-in for the Supabase client: records every query, answers through `respond`. */
function fakeClient(respond: (c: Call) => Result) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, steps: [] };
    calls.push(call);
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "update", "upsert", "delete", "maybeSingle", "single"]) {
      q[m] = (...args: unknown[]) => (call.steps.push([m, args]), q);
    }
    q.then = (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(ok, fail);
    return q;
  };
  return { calls, client: { from } };
}

const has = (c: Call, m: string) => c.steps.some(([s]) => s === m);
const arg = (c: Call, m: string) => c.steps.find(([s]) => s === m)?.[1][0];

describe("SupabaseStore.applyChangeSet", () => {
  it("resets the set to its prior status when an entity write fails", async () => {
    const changes = [0, 1, 2].map((position) => ({ id: `x${position}`, position, op: "set_price", entity: "item", entity_id: `i${position}`, before: { price_eur: 1 }, after: { price_eur: 2 } }));
    const row = { id: "cs1", venue_id: "v1", chat_ref: "tg:10", summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "applied", apply_at: null, reminded_at: null, decided_at: null, applied_at: "2026-10-09T10:00:00.000Z", reverted_by: null, undoes_id: null, message_ref: null, created_at: "2026-10-09T09:00:00.000Z", changes };
    let itemWrites = 0;
    const { calls, client } = fakeClient((c) => {
      if (c.table === "change_sets" && has(c, "maybeSingle")) return { data: { status: "proposed", source: "text", venue_id: "v1" }, error: null };
      if (c.table === "venues") return { data: { id: "v1", slug: "s", name: "n", change_limit: null, created_at: "2026-10-09T09:00:00.000Z" }, error: null };
      if (c.table === "change_sets" && has(c, "in")) return { data: [row], error: null };
      if (c.table === "items") return ++itemWrites === 2 ? { data: null, error: { message: "boom" } } : { data: [{ id: "i" }], error: null };
      return { data: [{ id: "cs1" }], error: null };
    });
    const store = new SupabaseStore("http://localhost:54321", "test-key");
    (store as unknown as { db: unknown }).db = client;

    await expect(store.applyChangeSet("cs1", "2026-10-09T10:00:00.000Z")).rejects.toThrow(/boom/);

    expect(itemWrites).toBe(2); // stopped at the failing write
    const reset = calls.at(-1)!;
    expect(reset.table).toBe("change_sets");
    expect(arg(reset, "update")).toMatchObject({ status: "proposed", applied_at: null });
    expect(reset.steps).toContainEqual(["eq", ["id", "cs1"]]);
  });
});

describe("SupabaseStore.upsertComments", () => {
  const VENUE = "6f1c2a52-6a0b-4d4e-9d55-2f1c0e5a7b11";
  const base = { post_ref: "p1", parent_id: null, author_id: "a1", author_name: "A", text: "hi", created_at: "2026-11-13T09:00:00.000Z", seen_at: "2026-11-13T09:00:00.000Z", status: "new" as const, post_caption: "" };
  const upserted = (calls: Call[]) => calls.filter((c) => has(c, "upsert")).map((c) => arg(c, "upsert") as Record<string, unknown>[]);

  it("sends rating and review_updated_at only on Google rows: Facebook and Instagram rows keep the key set they had before Google", async () => {
    const { calls, client } = fakeClient((c) => ({ data: (arg(c, "upsert") as Record<string, unknown>[]).map((r, i) => ({ id: `id${i}`, ...r })), error: null }));
    const store = new SupabaseStore("http://localhost:54321", "test-key");
    (store as unknown as { db: unknown }).db = client;
    const out = await store.upsertComments(VENUE, [
      { ...base, network: "facebook", comment_id: "fb1" },
      { ...base, network: "google", comment_id: "g1", author_id: "", rating: 4, review_updated_at: "2026-11-13T08:00:00.000Z" },
      { ...base, network: "instagram", comment_id: "ig1", post_permalink: "https://instagram.com/p/x" },
    ]);
    expect(out.map((c) => c.comment_id)).toEqual(["fb1", "g1", "ig1"]);
    const batches = upserted(calls);
    const meta = batches.flat().filter((r) => r.network !== "google");
    const google = batches.flat().filter((r) => r.network === "google");
    for (const r of meta) expect(Object.keys(r).sort()).toEqual(["venue_id", ...Object.keys(base), "network", "comment_id", "post_permalink"].sort());
    expect(google).toEqual([expect.objectContaining({ rating: 4, review_updated_at: "2026-11-13T08:00:00.000Z" })]);
    // One request never mixes the two key sets (PostgREST bulk upsert needs identical keys per row).
    for (const b of batches) expect(new Set(b.map((r) => Object.keys(r).sort().join())).size).toBe(1);
  });

  it("a Meta-only batch is one request with no Google columns", async () => {
    const { calls, client } = fakeClient((c) => ({ data: (arg(c, "upsert") as Record<string, unknown>[]).map((r, i) => ({ id: `id${i}`, ...r })), error: null }));
    const store = new SupabaseStore("http://localhost:54321", "test-key");
    (store as unknown as { db: unknown }).db = client;
    await store.upsertComments(VENUE, [{ ...base, network: "facebook", comment_id: "fb1" }, { ...base, network: "facebook", comment_id: "fb2" }]);
    const batches = upserted(calls);
    expect(batches).toHaveLength(1);
    for (const r of batches[0]) {
      expect(r).not.toHaveProperty("rating");
      expect(r).not.toHaveProperty("review_updated_at");
    }
  });
});
