// src/visual/gemini.ts
// The Gemini image call behind "restyle a photo" (docs/superpowers/specs/2026-10-24-restyle-photo-design.md, decision 1).
// This is the only file that knows the Gemini wire format: geminiRequestBody() and parseGeminiResponse() hold every field
// name, so a correction after a live call is a change in those two functions only.
// Contract as specified (not yet checked against the live API): POST /v1beta/interactions with the key in x-goog-api-key,
// a text part and an image part as input, response_format asking for a 4:5 1K JPEG, the picture in output_image.data.
// The caller's AbortSignal goes straight to fetch, so a timeout surfaces as fetch's own TimeoutError/AbortError, which the
// restyle service maps to a timeout fallback. Errors carry the HTTP status only, never the response body or the key.
import type { GenerateOutcome, RestyleGenerate } from "./restyle";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export function geminiRequestBody(o: { model: string; prompt: string; mimeType: string; image: Uint8Array }) {
  return {
    model: o.model,
    input: [
      { type: "text", text: o.prompt },
      { type: "image", mime_type: o.mimeType, data: Buffer.from(o.image).toString("base64") },
    ],
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "4:5", image_size: "1K" },
  };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The base64 picture in a 200 body: interaction.output_image.data, or the older candidates[].content.parts[].inlineData shape. */
function imageData(body: Obj): string | null {
  const root = obj(body.interaction) ?? body;
  const direct = str(obj(root.output_image)?.data);
  if (direct) return direct;
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  for (const c of candidates) {
    const parts = obj(obj(c)?.content)?.parts;
    for (const p of Array.isArray(parts) ? parts : []) {
      const inline = obj(obj(p)?.inlineData) ?? obj(obj(p)?.inline_data);
      const data = str(inline?.data);
      if (data) return data;
    }
  }
  return null;
}

/** Whether a body with no picture says why: a prompt block reason, or a candidate that finished for a reason other than STOP. */
function hasBlockReason(body: Obj): boolean {
  if (str(obj(body.promptFeedback)?.blockReason) || str(obj(body.prompt_feedback)?.block_reason)) return true;
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  return candidates.some((c) => {
    const reason = str(obj(c)?.finishReason) ?? str(obj(c)?.finish_reason);
    return reason !== null && reason !== "STOP";
  });
}

export function parseGeminiResponse(status: number, text: string): GenerateOutcome {
  if (status === 400 && /safety|prohibited|blocked/i.test(text)) return { refused: true };
  if (status < 200 || status >= 300) throw new Error(`Gemini answered HTTP ${status}`);
  let body: Obj | null = null;
  try {
    body = obj(JSON.parse(text));
  } catch {
    // Not JSON: treated as no picture.
  }
  if (!body) return { none: true };
  const data = imageData(body);
  if (data) {
    const image = new Uint8Array(Buffer.from(data, "base64"));
    return image.length > 0 ? { image } : { none: true };
  }
  return hasBlockReason(body) ? { refused: true } : { none: true };
}

export function geminiGenerate(o: { apiKey: string; model: string; fetch?: typeof fetch }): RestyleGenerate {
  const f = o.fetch ?? fetch;
  return async ({ image, mimeType, prompt, signal }) => {
    const res = await f(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": o.apiKey },
      body: JSON.stringify(geminiRequestBody({ model: o.model, prompt, mimeType, image })),
      signal,
    });
    return parseGeminiResponse(res.status, await res.text());
  };
}
