// test/wizard-texts.test.ts
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { draftTexts, DraftTextsSchema, TEXTS_MAX_FACTS, type DraftTexts } from "@/src/wizard/texts";
import { forbiddenSchemaKeys } from "./helpers";

type Reply = { stop_reason: string; content: unknown[] } | Error;
/** Records the request params and answers with the scripted message (or throws). */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}
const TEXTS: DraftTexts = {
  tagline_bg: " Кафе и тишина на ъгъла ",
  tagline_en: "Coffee and quiet on the corner",
  about_bg: "Малко квартално кафене.",
  about_en: "A small neighbourhood café.",
  welcome_bg: "Добре дошли!",
  welcome_en: "Welcome!",
  footer_note_bg: "Приемаме карти.",
  footer_note_en: "Cards accepted.",
};
const toolUse = (input: unknown): Reply => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "draft_texts", input }] });

describe("draftTexts", () => {
  it("sends the facts and the owner's language, one strict tool, auto tool choice", async () => {
    const { client, calls } = fakeClient(toolUse(TEXTS));
    const r = await draftTexts(client, { model: "claude-opus-5-5" }, "Кафене в Лозенец, печем баница сутрин, кучета добре дошли", "bg");
    expect(r).toEqual({ ...TEXTS, tagline_bg: "Кафе и тишина на ъгъла" });
    expect(calls).toHaveLength(1);
    const p = calls[0];
    expect(p).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    expect(p).not.toHaveProperty("thinking");
    const tools = p.tools as { name: string; strict?: boolean; input_schema: { additionalProperties?: boolean; required?: string[] } }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "draft_texts", strict: true });
    expect(tools[0].input_schema.additionalProperties).toBe(false);
    expect(tools[0].input_schema.required).toEqual(["tagline_bg", "tagline_en", "about_bg", "about_en", "welcome_bg", "welcome_en", "footer_note_bg", "footer_note_en"]);
    expect(typeof p.system).toBe("string");
    expect(p.system as string).toContain("draft_texts");
    expect(p.system as string).toMatch(/exactly once/);
    expect(p.system as string).toMatch(/40.{1,3}120 words/);
    expect(p.system as string).toMatch(/Bulgarian/);
    expect(p.system as string).toMatch(/English/);
    const messages = p.messages as { role: string; content: { type: string; text: string }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0].type).toBe("text");
    expect(messages[0].content[0].text).toContain("Лозенец");
    expect(messages[0].content[0].text).toContain("Bulgarian");
    expect(messages[0].content[0].text).toContain("draft_texts");
  });
  it("sends a tool input schema of plain described strings: no length constraints, no $schema", async () => {
    const { client, calls } = fakeClient(toolUse(TEXTS));
    await draftTexts(client, { model: "m" }, "f", "bg");
    const schema = (calls[0].tools as { input_schema: Record<string, unknown> }[])[0].input_schema;
    expect(forbiddenSchemaKeys(JSON.parse(JSON.stringify(schema)))).toEqual([]);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(TEXTS)) {
      expect(props[key]).toMatchObject({ type: "string" });
      expect(typeof props[key].description).toBe("string");
    }
    expect(props.about_bg.description).toMatch(/40.{1,3}120 words/);
  });
  it("names English when the owner writes in English and cuts the facts at the limit", async () => {
    const { client, calls } = fakeClient(toolUse(TEXTS));
    const facts = `  ${"x".repeat(TEXTS_MAX_FACTS + 50)}  `;
    await draftTexts(client, { model: "m" }, facts, "en");
    const text = (calls[0].messages as { content: { text: string }[] }[])[0].content[0].text;
    expect(text).toContain("English");
    expect(text).not.toContain("Bulgarian");
    expect(text).toContain("x".repeat(TEXTS_MAX_FACTS));
    expect(text).not.toContain("x".repeat(TEXTS_MAX_FACTS + 1));
  });
  it("maps refusal, errors, missing calls and empty texts", async () => {
    expect(await draftTexts(fakeClient({ stop_reason: "refusal", content: [] }).client, { model: "m" }, "f", "en")).toBe("refused");
    expect(await draftTexts(fakeClient({ stop_reason: "max_tokens", content: [] }).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "no" }] }).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "other_tool", input: TEXTS }] }).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient(toolUse({ ...TEXTS, tagline_bg: "" })).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient(toolUse({ ...TEXTS, about_en: "   " })).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient(toolUse({ ...TEXTS, welcome_bg: 42 })).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient(toolUse({ tagline_bg: "a" })).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient(new Error("boom")).client, { model: "m" }, "f", "en")).toBe("error");
  });
  it("accepts an empty footer note and trims every field", async () => {
    const r = await draftTexts(fakeClient(toolUse({ ...TEXTS, footer_note_bg: " ", footer_note_en: "", welcome_en: "  Welcome!  " })).client, { model: "m" }, "f", "bg");
    expect(r).toEqual({ ...TEXTS, tagline_bg: "Кафе и тишина на ъгъла", footer_note_bg: "", footer_note_en: "" });
  });
  it("DraftTextsSchema lists all eight texts as required strings", () => {
    expect(DraftTextsSchema.safeParse(TEXTS).success).toBe(true);
    expect(DraftTextsSchema.safeParse({ ...TEXTS, extra: "x" })).toMatchObject({ success: true, data: TEXTS }); // unknown keys are stripped, not kept
    const { footer_note_en: _omitted, ...missing } = TEXTS;
    void _omitted;
    expect(DraftTextsSchema.safeParse(missing).success).toBe(false);
  });
});

const live = process.env.ANTHROPIC_API_KEY ? it : it.skip;
live("LIVE: a real call drafts eight non-empty texts in both languages", async () => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await draftTexts(client, { model: process.env.AGENT_MODEL ?? "claude-opus-5-5" }, "Малко кафене в Лозенец. Печем баница всяка сутрин. Кучетата са добре дошли. Приемаме карти.", "bg");
  if (r === "refused" || r === "error") throw new Error(`live texts returned ${r}`);
  expect(r.tagline_bg.length).toBeGreaterThan(0);
  expect(r.tagline_en.length).toBeGreaterThan(0);
  expect(r.about_bg.length).toBeGreaterThan(0);
  expect(r.about_en.length).toBeGreaterThan(0);
  expect(r.welcome_bg.length).toBeGreaterThan(0);
  expect(r.welcome_en.length).toBeGreaterThan(0);
}, 120_000);
