// test/supabase-limit.test.ts
// The live Supabase contract (test/store-supabase.test.ts) runs only with SUPABASE_CONTRACT=1; these pin the queries offline.
import { describe, expect, it } from "vitest";
import { SupabaseStore } from "@/src/store/supabase";

type Call = { table: string; steps: [string, unknown[]][] };
type Result = { data: unknown; error: { message: string } | null; count?: number | null };

/** Chainable stand-in for the Supabase client: records every query, answers through `respond`. */
function fakeClient(respond: (c: Call) => Result) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, steps: [] };
    calls.push(call);
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "lt", "not", "is", "update", "maybeSingle", "single"]) {
      q[m] = (...args: unknown[]) => (call.steps.push([m, args]), q);
    }
    q.then = (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(ok, fail);
    return q;
  };
  return { calls, client: { from } };
}
const VENUE = "6f1c2a52-6a0b-4d4e-9d55-2f1c0e5a7b11";
const store = (client: unknown) => {
  const s = new SupabaseStore("http://localhost:54321", "test-key");
  (s as unknown as { db: unknown }).db = client;
  return s;
};

describe("SupabaseStore change limit", () => {
  it("counts applied sets of the venue in [from, to) without undo and automatic sets, as a head count", async () => {
    const { calls, client } = fakeClient(() => ({ data: null, error: null, count: 7 }));
    expect(await store(client).countAppliedChangeSets(VENUE, "2026-09-30T21:00:00.000Z", "2026-10-31T22:00:00.000Z")).toBe(7);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("change_sets");
    expect(calls[0].steps).toEqual([
      ["select", ["id", { count: "exact", head: true }]],
      ["eq", ["venue_id", VENUE]],
      ["gte", ["applied_at", "2026-09-30T21:00:00.000Z"]],
      ["lt", ["applied_at", "2026-10-31T22:00:00.000Z"]],
      ["not", ["source", "in", "(undo,auto)"]],
    ]);
    expect(await store(client).countAppliedChangeSets("not-a-uuid", "a", "b")).toBe(0);
  });

  it("writes change_limit and refuses values that are not whole numbers", async () => {
    const { calls, client } = fakeClient(() => ({ data: { id: VENUE, slug: "coffique", name: "Coffique", change_limit: 60, created_at: "2026-10-09T09:00:00Z" }, error: null }));
    const v = await store(client).setChangeLimit(VENUE, 60);
    expect(v.change_limit).toBe(60);
    expect(calls[0].steps[0]).toEqual(["update", [{ change_limit: 60 }]]);
    await expect(store(client).setChangeLimit(VENUE, -1)).rejects.toThrow(/whole number/);
    await expect(store(client).setChangeLimit(VENUE, 2.5)).rejects.toThrow(/whole number/);
  });
});
