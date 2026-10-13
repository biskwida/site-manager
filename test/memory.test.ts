// test/memory.test.ts
import { describe, expect, it } from "vitest";
import { appendMemory, holdPhoto, loadMemory, MEMORY_TURNS, setCorrection } from "@/src/agent/memory";
import { InMemoryStore } from "@/src/store/memory";

const T = (min: number) => new Date(Date.parse("2026-10-09T09:00:00.000Z") + min * 60_000);

describe("conversation memory", () => {
  it("is empty at first and renders the last 8 turns as text", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    expect(await loadMemory(s, v.id, "tg:1", T(0))).toEqual({ text: "", correctionFor: null, waiting: [] });
    for (let i = 1; i <= 10; i++) await appendMemory(s, v.id, "tg:1", { at: T(i).toISOString(), owner: `msg ${i}`, agent: `reply ${i}`, outcome: i % 2 ? "applied" : undefined }, T(i));
    const m = await loadMemory(s, v.id, "tg:1", T(11));
    const lines = m.text.split("\n");
    expect(lines[0]).toBe("Recent conversation (oldest first):");
    expect(m.text).not.toContain("msg 2\n");
    expect(m.text).toContain("Owner: msg 3");
    expect(m.text).toContain("Agent: reply 10");
    expect(m.text).toContain("Outcome: applied");
    expect((await s.getConversation(v.id, "tg:1"))?.turns).toHaveLength(MEMORY_TURNS);
  });
  it("forgets after 30 minutes", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    await appendMemory(s, v.id, "tg:1", { at: T(0).toISOString(), owner: "a", agent: "b" }, T(0));
    expect((await loadMemory(s, v.id, "tg:1", T(29))).text).toContain("Owner: a");
    expect((await loadMemory(s, v.id, "tg:1", T(31))).text).toBe("");
  });
  it("keeps the correction marker until the next turn is appended", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    await setCorrection(s, v.id, "tg:1", "set-1", T(0));
    expect((await loadMemory(s, v.id, "tg:1", T(1))).correctionFor).toBe("set-1");
    await appendMemory(s, v.id, "tg:1", { at: T(1).toISOString(), owner: "a", agent: "b" }, T(1));
    expect((await loadMemory(s, v.id, "tg:1", T(2))).correctionFor).toBeNull();
  });

  it("holds photos sent without instructions, groups an album into one turn and acknowledges only the first", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    expect(await holdPhoto(s, v.id, "tg:1", "p-1", "ack", T(0))).toBe(true);
    expect(await holdPhoto(s, v.id, "tg:1", "p-2", "ack", T(0))).toBe(false);
    const m = await loadMemory(s, v.id, "tg:1", T(1));
    expect(m.waiting).toEqual(["p-1", "p-2"]);
    expect(m.text).toContain("Owner: [photo media_id: p-1, p-2] (no instructions yet)");
    expect((await s.getConversation(v.id, "tg:1"))?.turns).toHaveLength(1);
  });
  it("releases held photos once a turn claims them, but keeps their ids in the memory text", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    await holdPhoto(s, v.id, "tg:1", "p-1", "ack", T(0));
    await appendMemory(s, v.id, "tg:1", { at: T(1).toISOString(), owner: "[voice] сложи я за корица", agent: "" }, T(1), ["p-1"]);
    const m = await loadMemory(s, v.id, "tg:1", T(2));
    expect(m.waiting).toEqual([]);
    expect(m.text).toContain("media_id: p-1");
    // A photo held after the turn started is not claimed by it.
    await holdPhoto(s, v.id, "tg:1", "p-2", "ack", T(2));
    await appendMemory(s, v.id, "tg:1", { at: T(3).toISOString(), owner: "x", agent: "y" }, T(3), []);
    expect((await loadMemory(s, v.id, "tg:1", T(4))).waiting).toEqual(["p-2"]);
  });
  it("starts a new held group (and acknowledges again) after a turn ran", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    await holdPhoto(s, v.id, "tg:1", "p-1", "ack", T(0));
    await appendMemory(s, v.id, "tg:1", { at: T(1).toISOString(), owner: "x", agent: "y" }, T(1), ["p-1"]);
    expect(await holdPhoto(s, v.id, "tg:1", "p-2", "ack", T(2))).toBe(true);
  });
});
