// test/theme.test.ts
// Background and accent colour from the chat: the tool schema, the agent tool flow, the prompt rule and the public feed.
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "@/src/agent/prompt";
import { ChangeInputSchema } from "@/src/agent/tool-schemas";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { applyChanges, invertChanges, planChanges } from "@/src/domain/changes";
import { publicSiteState } from "@/src/server/site";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("set_theme tool schema", () => {
  const ok = (v: unknown) => ChangeInputSchema.safeParse(v).success;
  it("accepts an accent, a background, both, and background null (back to the design's default)", () => {
    expect(ok({ op: "set_theme", accent: "#6E1F1B" })).toBe(true);
    expect(ok({ op: "set_theme", background: "#1f3d2b" })).toBe(true);
    expect(ok({ op: "set_theme", accent: "#6e1f1b", background: "#f3eadb" })).toBe(true);
    expect(ok({ op: "set_theme", background: null })).toBe(true);
  });
  it("rejects an empty theme change and anything that is not #rrggbb", () => {
    expect(ok({ op: "set_theme" })).toBe(false);
    expect(ok({ op: "set_theme", accent: "green" })).toBe(false);
    expect(ok({ op: "set_theme", background: "#fff" })).toBe(false);
    expect(ok({ op: "set_theme", background: "тъмнозелено" })).toBe(false);
    expect(ok({ op: "set_theme", accent: null })).toBe(false);
  });
  it("names the missing keys in the error", () => {
    const r = ChangeInputSchema.safeParse({ op: "set_theme" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/accent, background or both/);
  });
});

async function setup(over: Partial<AgentDeps> = {}) {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember("tg:1001"))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: "https://site.example", ...over };
  return { ...demo, messenger, tools: makeTools(deps) };
}

describe("set_theme through the agent tools", () => {
  it("get_site shows the background as null until one is set", async () => {
    const { tools } = await setup();
    const r = await call(tools, "get_site", {});
    expect((r.venue as { theme: unknown }).theme).toEqual({ accent: "#2f6b4f", background: null });
  });
  it("proposes a dark green background with the hex, its name and the text colour in the preview", async () => {
    const { tools, store, venue } = await setup();
    const r = await call(tools, "propose_changes", { summary_bg: "Фон: тъмнозелено #1f3d2b", summary_en: "Background: dark green #1f3d2b", changes: [{ op: "set_theme", background: "#1F3D2B" }] });
    expect(r).toMatchObject({ status: "proposed", preview: "• Фон: по подразбиране → #1f3d2b (тъмнозелено, светъл текст)" });
    const cs = await store.findProposed(venue.id, "tg:1001");
    expect(cs?.preview_en).toBe("• Background: design default → #1f3d2b (dark green, light text)");
    expect(cs?.changes[0]).toMatchObject({ op: "set_theme", entity: "venue", after: { theme: { accent: "#2f6b4f", background: "#1f3d2b" } } });
  });
  it("refuses a mid-tone background with an error the model can act on", async () => {
    const { tools } = await setup();
    const r = await call(tools, "propose_changes", { summary_bg: "Сив фон", summary_en: "Grey background", changes: [{ op: "set_theme", background: "#808080" }] });
    expect(r.error).toMatch(/mid-tone.*darker or lighter shade/);
  });
  it("is the owner's decision, not staff's", async () => {
    const demo = await makeDemo();
    const staff = (await demo.store.findMember("tg:1002"))!;
    const tools = makeTools({ store: demo.store, venueId: demo.venue.id, chatRef: "tg:1002", member: staff, messenger: new FakeMessenger(), now: () => T0, baseUrl: "https://site.example" });
    const r = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_theme", background: "#1f3d2b" }] });
    expect(r.error).toMatch(/only the owner/);
  });
});

describe("public feed theme", () => {
  it("always carries background, null when unset", async () => {
    const { store, venue } = await makeDemo();
    const pub = publicSiteState(await store.getSite(venue.id));
    expect(pub.venue.theme).toEqual({ accent: "#2f6b4f", background: null });
  });
  it("carries the owner's background once applied, and null again after undo", async () => {
    const { store, venue } = await makeDemo();
    const s0 = await store.getSite(venue.id);
    const changes = planChanges(s0, [{ op: "set_theme", background: "#1f3d2b", accent: "#d9a05b" }], { newId: () => "n", now: T0.toISOString() });
    const s1 = applyChanges(s0, changes);
    expect(publicSiteState(s1).venue.theme).toEqual({ accent: "#d9a05b", background: "#1f3d2b" });
    expect(publicSiteState(applyChanges(s1, invertChanges(changes))).venue.theme).toEqual({ accent: "#2f6b4f", background: null });
  });
});

describe("prompt", () => {
  it("tells the model how to turn colour words into a readable hex and to name the hex", () => {
    expect(SYSTEM_PROMPT).toMatch(/set_theme/);
    expect(SYSTEM_PROMPT).toMatch(/тъмнозелено/);
    expect(SYSTEM_PROMPT).toMatch(/navy/);
    expect(SYSTEM_PROMPT).toMatch(/mid-tone/i);
    expect(SYSTEM_PROMPT).toMatch(/background: null/);
    expect(SYSTEM_PROMPT).toMatch(/hex/);
  });
});
