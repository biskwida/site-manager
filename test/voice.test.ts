// test/voice.test.ts
import { describe, expect, it } from "vitest";
import { makeTranscriber } from "@/src/bot/voice";

describe("makeTranscriber", () => {
  it("sends the bytes as an ogg file with the model and language, trims the result", async () => {
    const seen: Record<string, unknown>[] = [];
    const factory = (cfg: { apiKey: string; baseURL: string }) => {
      expect(cfg).toEqual({ apiKey: "k", baseURL: "https://api.groq.com/openai/v1" });
      return { audio: { transcriptions: { create: async (p: Record<string, unknown>) => { seen.push(p); return { text: "  Капучиното става три и двайсет " }; } } } };
    };
    const t = makeTranscriber({ apiKey: "k", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3" }, factory as never);
    expect(await t(new Uint8Array([1, 2]), "bg")).toBe("Капучиното става три и двайсет");
    expect(seen[0]).toMatchObject({ model: "whisper-large-v3", language: "bg" });
    expect((seen[0].file as File).name).toBe("voice.ogg");
  });
});
