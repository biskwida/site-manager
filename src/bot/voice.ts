// src/bot/voice.ts
import OpenAI, { toFile } from "openai";
import type { Lang } from "../domain/types";

export type Transcriber = (bytes: Uint8Array, lang: Lang) => Promise<string>;

interface SttClient {
  audio: { transcriptions: { create(p: { file: File; model: string; language: string }): Promise<{ text: string }> } };
}

const defaultFactory = (cfg: { apiKey: string; baseURL: string }): SttClient => new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }) as unknown as SttClient;

/** Any OpenAI-compatible transcription endpoint (Groq by default). */
export function makeTranscriber(cfg: { apiKey: string; baseUrl: string; model: string }, factory: (c: { apiKey: string; baseURL: string }) => SttClient = defaultFactory): Transcriber {
  const client = factory({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  return async (bytes, lang) => {
    const file = await toFile(bytes, "voice.ogg", { type: "audio/ogg" });
    const r = await client.audio.transcriptions.create({ file, model: cfg.model, language: lang });
    return (r.text ?? "").trim();
  };
}
