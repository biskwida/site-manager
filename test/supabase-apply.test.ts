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
    const row = { id: "cs1", venue_id: "v1", chat_id: 10, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "applied", apply_at: null, reminded_at: null, decided_at: null, applied_at: "2026-10-09T10:00:00.000Z", reverted_by: null, undoes_id: null, tg_message_id: null, created_at: "2026-10-09T09:00:00.000Z", changes };
    let itemWrites = 0;
    const { calls, client } = fakeClient((c) => {
      if (c.table === "change_sets" && has(c, "maybeSingle")) return { data: { status: "proposed" }, error: null };
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
