// test/memory.test.ts
import { describe, expect, it } from "vitest";
import { appendMemory, loadMemory, MEMORY_TURNS, setCorrection } from "@/src/agent/memory";
import { InMemoryStore } from "@/src/store/memory";

const T = (min: number) => new Date(Date.parse("2026-10-09T09:00:00.000Z") + min * 60_000);

describe("conversation memory", () => {
  it("is empty at first and renders the last 8 turns as text", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    expect(await loadMemory(s, v.id, 1, T(0))).toEqual({ text: "", correctionFor: null });
    for (let i = 1; i <= 10; i++) await appendMemory(s, v.id, 1, { at: T(i).toISOString(), owner: `msg ${i}`, agent: `reply ${i}`, outcome: i % 2 ? "applied" : undefined }, T(i));
    const m = await loadMemory(s, v.id, 1, T(11));
    const lines = m.text.split("\n");
    expect(lines[0]).toBe("Recent conversation (oldest first):");
    expect(m.text).not.toContain("msg 2\n");
    expect(m.text).toContain("Owner: msg 3");
    expect(m.text).toContain("Agent: reply 10");
    expect(m.text).toContain("Outcome: applied");
    expect((await s.getConversation(v.id, 1))?.turns).toHaveLength(MEMORY_TURNS);
  });
  it("forgets after 30 minutes", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    await appendMemory(s, v.id, 1, { at: T(0).toISOString(), owner: "a", agent: "b" }, T(0));
    expect((await loadMemory(s, v.id, 1, T(29))).text).toContain("Owner: a");
    expect((await loadMemory(s, v.id, 1, T(31))).text).toBe("");
  });
  it("keeps the correction marker until the next turn is appended", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    await setCorrection(s, v.id, 1, "set-1", T(0));
    expect((await loadMemory(s, v.id, 1, T(1))).correctionFor).toBe("set-1");
    await appendMemory(s, v.id, 1, { at: T(1).toISOString(), owner: "a", agent: "b" }, T(1));
    expect((await loadMemory(s, v.id, 1, T(2))).correctionFor).toBeNull();
  });
});
