// test/voice.test.ts
import { describe, expect, it } from "vitest";
import { audioContentType, audioFileName, makeTranscriber } from "@/src/bot/voice";

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
  it("names the file after the content type (m4a for audio/mp4, ogg by default)", async () => {
    const names: string[] = [];
    const factory = () => ({ audio: { transcriptions: { create: async (p: { file: File }) => { names.push(p.file.name); return { text: "x" }; } } } });
    const t = makeTranscriber({ apiKey: "k", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3" }, factory as never);
    await t(new Uint8Array([1]), "bg", "audio/mp4");
    await t(new Uint8Array([1]), "bg");
    expect(names).toEqual(["voice.m4a", "voice.ogg"]);
  });
});

describe("audio file type", () => {
  it("treats video/mp4 as m4a", () => {
    expect(audioFileName("video/mp4")).toEqual({ name: "voice.m4a", type: "audio/mp4" });
    expect(audioFileName("audio/amr")).toEqual({ name: "voice.amr", type: "audio/amr" });
  });
  it("falls back to the file name's extension when the content type says nothing", () => {
    expect(audioContentType("application/octet-stream", "clip.m4a")).toBe("audio/mp4");
    expect(audioContentType("", "voice.AMR")).toBe("audio/amr");
    expect(audioContentType("application/octet-stream", "https://cdn/x.mp4?sig=1")).toBe("audio/mp4");
    expect(audioContentType("audio/ogg; codecs=opus", "x.m4a")).toBe("audio/ogg; codecs=opus");
    expect(audioContentType("application/octet-stream", "noext")).toBe("application/octet-stream");
    expect(audioContentType("")).toBe("");
  });
});
