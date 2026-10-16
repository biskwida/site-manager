// test/lang-classify.test.ts — the small-model language classifier: the call shape, which answers count, and failures.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { makeLangClassifier } from "@/src/bot/lang-classify";

type Reply = { stop_reason: string; content: unknown[] } | Error;
/** Records the request params and answers with the scripted message (or throws). */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); if (reply instanceof Error) throw reply; return reply; } } } };
  return { client: client as unknown as Anthropic, calls };
}
const answer = (t: string, stop_reason = "end_turn"): Reply => ({ stop_reason, content: [{ type: "text", text: t }] });
const MESSAGE = "Ich möchte den Preis ändern";

/** Runs fn with console.error captured; returns what was logged. */
async function logged(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return lines.join("\n");
}

describe("makeLangClassifier", () => {
  it("fake client returns de → de, with one call: the fixed question, five tokens, thinking off, the message as the user turn", async () => {
    const { client, calls } = fakeClient(answer("de"));
    expect(await makeLangClassifier(client, "claude-haiku-5-5")(MESSAGE)).toBe("de");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 5,
      thinking: { type: "disabled" },
      system: "Which language is this message written in? Reply with only its ISO 639-1 code, or unknown.",
      messages: [{ role: "user", content: [{ type: "text", text: MESSAGE }] }],
    });
  });

  it("reads a code the model wrote in capitals, with spaces, quotes or a full stop", async () => {
    for (const [text, code] of [["DE", "de"], [" pt.\n", "pt"], ["\"el\"", "el"], ["`it`", "it"]]) {
      expect(await makeLangClassifier(fakeClient(answer(text)).client, "m")(MESSAGE)).toBe(code);
    }
  });

  it.each(["unknown", "xx1", "German", "de-DE", "", "d"])("an answer that is not a two-letter code is null: %j", async (text) => {
    expect(await makeLangClassifier(fakeClient(answer(text)).client, "m")(MESSAGE)).toBeNull();
  });

  it("a thrown error → null, logged without the message", async () => {
    const { client } = fakeClient(new Error(`boom: ${MESSAGE}`));
    let result: unknown = "not called";
    const log = await logged(async () => { result = await makeLangClassifier(client, "m")(MESSAGE); });
    expect(result).toBeNull();
    expect(log).toMatch(/\[lang\]/);
    expect(log).not.toContain(MESSAGE);
    expect(log).not.toContain("möchte");
  });

  it("a refusal, a reply cut off by max_tokens or a reply without text is null", async () => {
    let result: unknown;
    const refused = await logged(async () => { result = await makeLangClassifier(fakeClient({ stop_reason: "refusal", content: [] }).client, "m")(MESSAGE); });
    expect(result).toBeNull();
    expect(refused).toMatch(/refusal/);
    const cut = await logged(async () => { result = await makeLangClassifier(fakeClient({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "", signature: "s" }] }).client, "m")(MESSAGE); });
    expect(result).toBeNull();
    expect(cut).toMatch(/max_tokens/);
    expect(await makeLangClassifier(fakeClient({ stop_reason: "end_turn", content: [] }).client, "m")(MESSAGE)).toBeNull();
  });
});
