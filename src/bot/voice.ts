// src/bot/voice.ts
import OpenAI, { toFile } from "openai";
import type { Lang } from "../domain/types";

export type Transcriber = (bytes: Uint8Array, lang: Lang, contentType?: string) => Promise<string>;

/** The upload name and type for an audio content type: Telegram sends ogg/opus, WhatsApp ogg or amr, Messenger/Instagram mp4/aac. */
export function audioFileName(contentType = ""): { name: string; type: string } {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct === "audio/mp4" || ct === "audio/x-m4a" || ct === "audio/m4a") return { name: "voice.m4a", type: "audio/mp4" };
  if (ct === "audio/aac") return { name: "voice.aac", type: "audio/aac" };
  if (ct === "audio/mpeg" || ct === "audio/mp3") return { name: "voice.mp3", type: "audio/mpeg" };
  if (ct === "audio/amr") return { name: "voice.amr", type: "audio/amr" };
  return { name: "voice.ogg", type: "audio/ogg" };
}

interface SttClient {
  audio: { transcriptions: { create(p: { file: File; model: string; language: string }): Promise<{ text: string }> } };
}

const defaultFactory = (cfg: { apiKey: string; baseURL: string }): SttClient => new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }) as unknown as SttClient;

/** Any OpenAI-compatible transcription endpoint (Groq by default). */
export function makeTranscriber(cfg: { apiKey: string; baseUrl: string; model: string }, factory: (c: { apiKey: string; baseURL: string }) => SttClient = defaultFactory): Transcriber {
  const client = factory({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  return async (bytes, lang, contentType) => {
    const f = audioFileName(contentType);
    const file = await toFile(bytes, f.name, { type: f.type });
    const r = await client.audio.transcriptions.create({ file, model: cfg.model, language: lang });
    return (r.text ?? "").trim();
  };
}
