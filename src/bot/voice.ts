// src/bot/voice.ts
import OpenAI, { toFile } from "openai";
import type { Lang } from "../domain/types";

export type Transcriber = (bytes: Uint8Array, lang: Lang, contentType?: string) => Promise<string>;

/** The upload name and type for an audio content type: Telegram sends ogg/opus, WhatsApp ogg or amr, Messenger/Instagram mp4/aac. */
export function audioFileName(contentType = ""): { name: string; type: string } {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  // Messenger/Instagram voice clips are often served as video/mp4 (an audio-only mp4 container).
  if (ct === "audio/mp4" || ct === "audio/x-m4a" || ct === "audio/m4a" || ct === "video/mp4") return { name: "voice.m4a", type: "audio/mp4" };
  if (ct === "audio/aac") return { name: "voice.aac", type: "audio/aac" };
  if (ct === "audio/mpeg" || ct === "audio/mp3") return { name: "voice.mp3", type: "audio/mpeg" };
  if (ct === "audio/amr") return { name: "voice.amr", type: "audio/amr" };
  return { name: "voice.ogg", type: "audio/ogg" };
}

const BY_EXT: Record<string, string> = { m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", amr: "audio/amr", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg" };

/** The download's content type, or, when it says nothing (empty or application/octet-stream), one guessed from the file name's extension. */
export function audioContentType(contentType: string, name = ""): string {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return contentType;
  const ext = /\.([a-z0-9]+)$/i.exec(name.split("?")[0])?.[1]?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? contentType;
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
