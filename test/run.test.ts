// test/run.test.ts
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AgentDeps } from "@/src/agent/tools";
import { pickEffort, runTurn } from "@/src/agent/run";
import { appendMemory } from "@/src/agent/memory";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

/** A fake Anthropic client: records the params, optionally runs scripted tool calls, returns a final message. */
function fakeClient(script: { tool: string; input: unknown }[] = [], final: { stop_reason: string; text: string } = { stop_reason: "end_turn", text: "Готово." }) {
  const calls: Record<string, unknown>[] = [];
  const toolResults: string[] = [];
  const client = {
    beta: {
      messages: {
        toolRunner(params: Record<string, unknown>) {
          calls.push(params);
          const run = (async () => {
            const tools = params.tools as { name: string; run: (i: unknown) => Promise<string> }[];
            for (const step of script) toolResults.push(await tools.find((t) => t.name === step.tool)!.run(step.input));
            return { stop_reason: final.stop_reason, content: [{ type: "text", text: final.text }] };
          })();
          return { then: run.then.bind(run) };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls, toolResults };
}

async function setup() {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember(1001))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatId: 1001, member, messenger, now: () => T0, baseUrl: "https://site.example" };
  return { ...demo, messenger, deps };
}

describe("pickEffort", () => {
  it("raises effort for images, bulk and scheduling cues", () => {
    expect(pickEffort("medium", { hasImage: false, text: "Капучиното става 3,20" })).toBe("medium");
    expect(pickEffort("medium", { hasImage: true, text: "" })).toBe("high");
    expect(pickEffort("medium", { hasImage: false, text: "Вдигни всички кафета с 10%" })).toBe("high");
    expect(pickEffort("medium", { hasImage: false, text: "From Monday the latte is 3.50" })).toBe("high");
    expect(pickEffort("low", { hasImage: false, text: "затворени сме утре" })).toBe("high");
    expect(pickEffort("high", { hasImage: false, text: "hi" })).toBe("high");
  });
});

describe("runTurn", () => {
  it("sends the right params, memory and image block, relays the final text and stores memory", async () => {
    const { deps, messenger, store, venue } = await setup();
    await appendMemory(store, venue.id, 1001, { at: T0.toISOString(), owner: "здравей", agent: "Здравейте!" }, T0);
    const { client, calls } = fakeClient([], { stop_reason: "end_turn", text: "Готово, върнах я." });
    const out = await runTurn(deps, { text: "това е новата корица", source: "photo", image: { data: "AAAA", media_type: "image/jpeg" }, mediaId: "m-1" }, { model: "claude-opus-5-5", effort: "medium" }, client);
    expect(out).toBe("Готово, върнах я.");
    const p = calls[0];
    expect(p).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "high" }, tool_choice: { type: "auto", disable_parallel_tool_use: true }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect((p.tools as unknown[]).length).toBe(9);
    const msg = (p.messages as { content: { type: string; text?: string; source?: { data: string } }[] }[])[0];
    expect(msg.content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    expect(msg.content[1].text).toContain("Owner: здравей");
    expect(msg.content[1].text).toContain("media_id: m-1");
    expect(msg.content[1].text).toContain("GMT+03:00");
    expect(messenger.sent[0]).toMatchObject({ chatId: 1001, text: "Готово, върнах я." });
    const conv = await store.getConversation(venue.id, 1001);
    expect(conv?.turns).toHaveLength(2);
    expect(conv?.turns[1]).toMatchObject({ owner: "[photo] това е новата корица", agent: "Готово, върнах я." });
  });
  it("records the proposal outcome and does not relay an empty final text", async () => {
    const { deps, messenger, store, venue, items } = await setup();
    const { client } = fakeClient([{ tool: "propose_changes", input: { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] } }], { stop_reason: "end_turn", text: "" });
    await runTurn(deps, { text: "капучиното става три и двайсет", source: "voice" }, { model: "m", effort: "medium" }, client);
    expect(messenger.sent).toHaveLength(1); // only the proposal
    expect(messenger.sent[0].setId).toBeDefined();
    const conv = await store.getConversation(venue.id, 1001);
    expect(conv?.turns[0].outcome).toBe("proposed: Капучино 3,20 € (waiting for the owner's decision)");
  });
  it("tells the owner when the model refuses or errors", async () => {
    const { deps, messenger } = await setup();
    const { client } = fakeClient([], { stop_reason: "refusal", text: "" });
    expect(await runTurn(deps, { text: "x", source: "text" }, { model: "m", effort: "medium" }, client)).toBe("refused");
    expect(messenger.sent[0].text).toBe("Не мога да изпълня това. Опитайте с друга формулировка.");
    const boom = { beta: { messages: { toolRunner() { throw new Error("network down"); } } } } as unknown as Anthropic;
    expect(await runTurn(deps, { text: "x", source: "text" }, { model: "m", effort: "medium" }, boom)).toBe("error");
    expect(messenger.sent[1].text).toBe("Възникна грешка. Опитайте отново след малко.");
  });
  it("passes correctionFor from memory into the tools", async () => {
    const { deps, store, venue, items } = await setup();
    const { setCorrection } = await import("@/src/agent/memory");
    const site = await store.getSite(venue.id);
    const { planChanges } = await import("@/src/domain/changes");
    const old = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", tg_message_id: 7, changes: planChanges(site, [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.5 }], { newId: () => "n", now: T0.toISOString() }) });
    await setCorrection(store, venue.id, 1001, old.id, T0);
    const { client } = fakeClient([{ tool: "propose_changes", input: { summary_bg: "y", summary_en: "y", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.4 }] } }], { stop_reason: "end_turn", text: "" });
    await runTurn(deps, { text: "не, 3,40", source: "text" }, { model: "m", effort: "medium" }, client);
    expect((await store.getChangeSet(old.id)).status).toBe("cancelled");
    expect(await store.findProposed(venue.id, 1001)).not.toBeNull();
  });
});
