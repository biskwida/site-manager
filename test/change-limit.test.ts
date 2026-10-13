// test/change-limit.test.ts
// Monthly change limit at apply time (store choke point → bot approval, tick, dashboard) and the usage line.
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "@/src/agent/prompt";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { copy } from "@/src/bot/copy";
import { planChanges } from "@/src/domain/changes";
import { adminAction } from "@/src/server/admin";
import { runTick } from "@/src/tick";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-09T09:00:00.000Z"); // Fri 9 Oct 2026, 12:00 Sofia

async function setup(limit: number | null, used = 0) {
  const demo = await makeDemo();
  const { store, venue, items } = demo;
  for (let n = 0; n < used; n++) {
    const done = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", source: "text", status: "proposed", changes: [] });
    await store.applyChangeSet(done.id, "2026-10-02T10:00:00.000Z");
  }
  if (limit !== null) await store.setChangeLimit(venue.id, limit);
  const site = await store.getSite(venue.id);
  const cappuccino = (status: "proposed" | "scheduled", applyAt: string | null = null) =>
    store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "• Капучино: 2,90 € → 3,20 €", preview_en: "• Cappuccino: €2.90 → €3.20", source: "text", status, apply_at: applyAt, message_ref: "42", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
  const messenger = new FakeMessenger();
  const price = async () => (await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur;
  return { ...demo, messenger, cappuccino, price };
}

describe("limit copy", () => {
  it("names the limit, the usage and the first day of next month in both languages", () => {
    expect(copy("bg").limitReached(60, 60, "2026-11-01")).toBe("Лимитът от 60 промени за този месец е достигнат (60/60). Нови промени от 1 ноември.");
    expect(copy("en").limitReached(60, 60, "2026-11-01")).toBe("This month's limit of 60 changes is reached (60/60). New changes from 1 November.");
    expect(copy("bg").changesThisMonth(12, 60)).toBe("Промени този месец: 12/60");
    expect(copy("en").changesThisMonth(12, 60)).toBe("Changes this month: 12/60");
    expect(copy("en").limitReached(40, 40, "2027-01-01")).toContain("from 1 January.");
  });
});

describe("bot approval", () => {
  it("appends this month's usage to the applied confirmation when the venue has a limit", async () => {
    const { store, messenger, cappuccino } = await setup(60, 11);
    const cs = await cappuccino("proposed");
    const r = await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", cs.id);
    expect(r.edit).toEqual({ full: "• Капучино: 2,90 € → 3,20 €\n\n✅ Приложено\nПромени този месец: 12/60", short: "✅ Приложено\nПромени този месец: 12/60" });
  });

  it("adds nothing when the venue is unlimited", async () => {
    const { store, messenger, cappuccino } = await setup(null, 3);
    const cs = await cappuccino("proposed");
    const r = await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", cs.id);
    expect(r.edit?.full).toBe("• Капучино: 2,90 € → 3,20 €\n\n✅ Приложено");
  });

  it("refuses ✅ past the limit: the proposal is cancelled and the owner is told why and when it resets", async () => {
    const { store, messenger, cappuccino, price } = await setup(2, 2);
    const cs = await cappuccino("proposed");
    const r = await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", cs.id);
    const line = "Лимитът от 2 промени за този месец е достигнат (2/2). Нови промени от 1 ноември.";
    expect(r).toEqual({ edit: { full: `• Капучино: 2,90 € → 3,20 €\n\n${line}`, short: line }, toast: line });
    expect((await store.getChangeSet(cs.id)).status).toBe("cancelled");
    expect(await price()).toBe(2.9);
  });
});

describe("tick", () => {
  it("does not apply a scheduled set that comes due past the limit: it is cancelled and the owner is told", async () => {
    const { store, venue, messenger, cappuccino, price } = await setup(2, 2);
    const due = await cappuccino("scheduled", "2026-10-09T08:00:00.000Z");
    const r = await runTick({ store, messenger, now: T0 });
    expect(r.applied).toEqual([]);
    expect(r.limited).toEqual([due.id]);
    expect((await store.getChangeSet(due.id)).status).toBe("cancelled");
    expect(await price()).toBe(2.9);
    expect(messenger.sent).toEqual([expect.objectContaining({ chatRef: "tg:1001", proactive: true, text: "⛔ Не е приложено по график: Капучино 3,20 €\nЛимитът от 2 промени за този месец е достигнат (2/2). Нови промени от 1 ноември." })]);
    // The next tick does not try again.
    expect((await runTick({ store, messenger, now: new Date("2026-10-09T09:01:00.000Z") })).limited).toEqual([]);
    expect(await store.listDue(T0.toISOString(), venue.id)).toEqual([]);
  });

  it("applies it in the next month, with the usage line", async () => {
    const { store, messenger, cappuccino } = await setup(2, 2);
    const due = await cappuccino("scheduled", "2026-10-31T22:00:00.000Z"); // 1 Nov 00:00 Sofia
    const r = await runTick({ store, messenger, now: new Date("2026-10-31T22:00:00.000Z") });
    expect(r.applied).toEqual([due.id]);
    expect(messenger.sent.at(-1)?.text).toBe("✅ Приложено по график: Капучино 3,20 €\nПромени този месец: 1/2");
  });
});

describe("dashboard apply", () => {
  it("refuses past the limit, cancels the set and concludes the chat message with the same line", async () => {
    const { store, venue, messenger, cappuccino, price } = await setup(2, 2);
    const cs = await cappuccino("proposed");
    const r = await adminAction({ store, messenger, now: () => T0, baseUrl: "https://site.example" }, venue, "apply", cs.id);
    expect(r).toEqual({ ok: false, status: "cancelled", change_set_id: cs.id, error: "This month's limit of 2 changes is reached (2/2). New changes from 1 November." });
    expect(messenger.concluded[0]).toMatchObject({ messageRef: "42", short: "Лимитът от 2 промени за този месец е достигнат (2/2). Нови промени от 1 ноември." });
    expect(await price()).toBe(2.9);
  });

  it("still undoes at the limit (undo never counts)", async () => {
    const { store, venue, messenger, cappuccino, price } = await setup(3, 2);
    const cs = await cappuccino("proposed");
    const d = { store, messenger, now: () => T0, baseUrl: "https://site.example" };
    expect((await adminAction(d, venue, "apply", cs.id)).ok).toBe(true);
    expect(messenger.concluded[0].short).toBe("✅ Приложено от таблото.\nПромени този месец: 3/3");
    expect((await adminAction(d, venue, "undo", cs.id)).ok).toBe(true);
    expect(await price()).toBe(2.9);
  });
});

describe("agent propose", () => {
  async function agent(limit: number | null, used: number) {
    const s = await setup(limit, used);
    const member = (await s.store.findMember("tg:1001"))!;
    const deps: AgentDeps = { store: s.store, venueId: s.venue.id, chatRef: "tg:1001", member, messenger: s.messenger, now: () => T0, baseUrl: "https://site.example" };
    return { ...s, deps, tools: makeTools(deps) };
  }
  const LINE_BG = "Лимитът от 2 промени за този месец е достигнат (2/2). Нови промени от 1 ноември.";

  it("refuses to propose at the limit: no set is created, the error carries the owner's line and says not to retry", async () => {
    const { tools, store, venue, items, messenger } = await agent(2, 2);
    const before = (await store.listChangeSets(venue.id)).length;
    const r = await call(tools, "propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] });
    expect(r.error).toContain(LINE_BG);
    expect(r.error).toMatch(/do not retry/i);
    expect((await store.listChangeSets(venue.id)).length).toBe(before);
    expect(messenger.sent).toEqual([]);
    for (const [name, input] of [
      ["schedule_changes", { summary_bg: "x", summary_en: "x", apply_at: "2026-12-24T08:00:00+02:00", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] }],
      ["propose_bulk_price_change", { percent: 10, rounding: "0.10" }],
      ["propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_sold_out", item_id: items.Cappuccino.id, until: "next_opening" }] }],
    ] as const) {
      expect((await call(tools, name, input)).error, name).toContain(LINE_BG);
    }
    expect((await store.listChangeSets(venue.id)).length).toBe(before);
  });

  it("still proposes below the limit, and undo at the limit", async () => {
    const below = await agent(3, 2);
    const ok = await call(below.tools, "propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: below.items.Cappuccino.id, price_eur: 3.2 }] });
    expect(ok.status).toBe("proposed");
    const { tools } = await agent(2, 2);
    expect((await call(tools, "undo", { change_set_id: "last" })).status).toBe("proposed");
  });

  it("tells the model in the system prompt to relay the line instead of retrying", () => {
    expect(SYSTEM_PROMPT).toMatch(/monthly change limit/i);
  });
});

describe("instant sold-out", () => {
  it("applies below the limit and appends the usage line to the ✅ message", async () => {
    const { tools, messenger, items } = await (async () => {
      const s = await setup(5, 1);
      const member = (await s.store.findMember("tg:1001"))!;
      return { ...s, tools: makeTools({ store: s.store, venueId: s.venue.id, chatRef: "tg:1001", member, messenger: s.messenger, now: () => T0, baseUrl: "https://site.example" }) };
    })();
    const r = await call(tools, "propose_changes", { summary_bg: "Капучино свърши", summary_en: "Cappuccino sold out", changes: [{ op: "set_sold_out", item_id: items.Cappuccino.id, until: "next_opening" }] });
    expect(r.status).toBe("applied");
    expect(messenger.sent.at(-1)?.text).toMatch(/\nПромени този месец: 2\/5$/);
  });
});
