// src/visual/gemini.ts
// The Gemini image call behind "restyle a photo" (docs/superpowers/specs/2026-10-24-restyle-photo-design.md, decision 1).
// This is the only file that knows the Gemini wire format: geminiRequestBody() and parseGeminiResponse() hold every field
// name, so a correction after a live call is a change in those two functions only.
// Wire shape taken from the docs (ai.google.dev/api/interactions-api, the Interactions API reference), NOT verified live;
// test/smoke-restyle.test.ts is the verification. POST /v1beta/interactions, key in x-goog-api-key, input = a text part and an
// image part, response_format = a 4:5 1K JPEG, store:false so Google does not keep the owner's photo. The reply is an Interaction
// { id, status, steps[], errors? }: the picture is the last { type: "image", data } block in content[] of the step with
// type "model_output" (text and thought blocks may sit around it). The SDK helper output_image.data and the generateContent
// candidates[].content.parts[].inlineData shapes are read as fallbacks.
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
    store: false,
  };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The base64 picture in a 200 body: the last image block of a model_output step, else the older SDK / generateContent shapes. */
function imageData(body: Obj): string | null {
  const root = obj(body.interaction) ?? body;
  let found: string | null = null;
  for (const step of Array.isArray(root.steps) ? root.steps : []) {
    if (obj(step)?.type !== "model_output") continue;
    for (const block of Array.isArray(obj(step)?.content) ? (obj(step)!.content as unknown[]) : []) {
      if (obj(block)?.type === "image") found = str(obj(block)?.data) ?? found;
    }
  }
  if (found) return found;
  const direct = str(obj(root.output_image)?.data);
  if (direct) return direct;
  for (const c of Array.isArray(body.candidates) ? body.candidates : []) {
    const parts = obj(obj(c)?.content)?.parts;
    for (const p of Array.isArray(parts) ? parts : []) {
      const inline = obj(obj(p)?.inlineData) ?? obj(obj(p)?.inline_data);
      const data = str(inline?.data);
      if (data) return data;
    }
  }
  return null;
}

/** Whether a body with no picture says it was stopped: a failed or cancelled interaction, errors, or a safety-type reason. */
function wasStopped(body: Obj): boolean {
  const root = obj(body.interaction) ?? body;
  if (root.status === "failed" || root.status === "cancelled") return true;
  if (Array.isArray(root.errors) && root.errors.length > 0) return true;
  if (str(obj(body.promptFeedback)?.blockReason) || str(obj(body.prompt_feedback)?.block_reason)) return true;
  const reasons = (Array.isArray(body.candidates) ? body.candidates : []).map((c) => str(obj(c)?.finishReason) ?? str(obj(c)?.finish_reason) ?? "");
  return reasons.some((r) => /safety|prohibited|blocked/i.test(r));
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
  return wasStopped(body) ? { refused: true } : { none: true };
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
