// test/approvals.test.ts
import { describe, expect, it } from "vitest";
import { loadMemory } from "@/src/agent/memory";
import { handleDecision, parseCallback } from "@/src/bot/approvals";
import { proposalButtons } from "@/src/bot/messenger";
import { planChanges } from "@/src/domain/changes";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function proposal(applyAt: string | null = null) {
  const demo = await makeDemo();
  const site = await demo.store.getSite(demo.venue.id);
  const cs = await demo.store.createChangeSet({ venue_id: demo.venue.id, chat_ref: "tg:1001", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "• Капучино: 2,90 € → 3,20 €", preview_en: "• Cappuccino: €2.90 → €3.20", source: "text", status: "proposed", apply_at: applyAt, message_ref: "42", changes: planChanges(site, [{ op: "set_price", item_id: demo.items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
  const messenger = new FakeMessenger();
  return { ...demo, cs, messenger, d: { store: demo.store, messenger, now: () => T0 } };
}

describe("parseCallback", () => {
  it("parses cs:<decision>:<id> and rejects the rest", () => {
    expect(parseCallback("cs:apply:abc")).toEqual({ decision: "apply", setId: "abc" });
    expect(parseCallback("cs:nope:abc")).toBeNull();
    expect(parseCallback("hello")).toBeNull();
  });
});

describe("proposalButtons", () => {
  it("gives three labels under 20 characters in both languages", () => {
    for (const lang of ["bg", "en"] as const) {
      const b = proposalButtons(lang);
      expect(b.map((x) => x.id)).toEqual(["apply", "change", "cancel"]);
      for (const x of b) expect(x.label.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("handleDecision", () => {
  it("applies and edits the message in the member's language", async () => {
    const { d, cs, store, venue, items } = await proposal();
    const r = await handleDecision(d, "tg:1001", "apply", cs.id);
    expect(r).toEqual({ edit: { full: "• Капучино: 2,90 € → 3,20 €\n\n✅ Приложено", short: "✅ Приложено" }, toast: "✅ Приложено" });
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    const again = await handleDecision(d, "tg:1001", "apply", cs.id);
    expect(again).toEqual({ edit: { full: "• Капучино: 2,90 € → 3,20 €\n\nВече е приложено.", short: "Вече е приложено." }, toast: "Вече е приложено." });
  });
  it("schedules instead of applying when apply_at is in the future", async () => {
    const { d, cs, store } = await proposal("2026-12-20T06:00:00.000Z");
    const r = await handleDecision(d, "tg:1001", "apply", cs.id);
    expect(r.edit?.full).toBe("• Капучино: 2,90 € → 3,20 €\n\n⏰ Насрочено за 20.12.2026, 08:00");
    expect(await store.getChangeSet(cs.id)).toMatchObject({ status: "scheduled", decided_at: T0.toISOString() });
  });
  it("cancels", async () => {
    const { d, cs, store } = await proposal();
    expect(await handleDecision(d, "tg:1001", "cancel", cs.id)).toEqual({ edit: { full: "• Капучино: 2,90 € → 3,20 €\n\n❌ Отказано", short: "❌ Отказано" }, toast: "❌ Отказано" });
    expect((await store.getChangeSet(cs.id)).status).toBe("cancelled");
  });
  it("marks the next message as a correction on change", async () => {
    const { d, cs, store, venue } = await proposal();
    expect(await handleDecision(d, "tg:1001", "change", cs.id)).toEqual({ reply: "Напишете какво да променя в предложението.", toast: "✏️" });
    expect((await loadMemory(store, venue.id, "tg:1001", T0)).correctionFor).toBe(cs.id);
    expect((await store.getChangeSet(cs.id)).status).toBe("proposed");
  });
  it("ignores other chats and unknown ids", async () => {
    const { d, cs } = await proposal();
    expect(await handleDecision(d, "tg:1002", "apply", cs.id)).toEqual({ toast: "That proposal is not from this chat." });
    expect(await handleDecision(d, "tg:1001", "apply", "missing")).toEqual({ toast: "Това предложение не е от този чат." });
  });
});
