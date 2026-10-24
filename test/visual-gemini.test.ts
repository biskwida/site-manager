// test/visual-gemini.test.ts
import { describe, expect, it, vi } from "vitest";
import { geminiGenerate, geminiRequestBody, parseGeminiResponse } from "@/src/visual/gemini";

const IN = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
const OUT = new Uint8Array([0xff, 0xd8, 9, 8, 7, 6]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const interaction = (data: string, status = "completed") => ({
  id: "i1",
  status,
  steps: [
    { type: "user_input", content: [{ type: "text", text: "p" }] },
    { type: "model_output", content: [{ type: "text", text: "Here you go" }, { type: "image", mime_type: "image/jpeg", data }] },
  ],
});
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function setup(res: () => Response | Promise<Response>) {
  const fake = vi.fn<typeof fetch>(async () => res());
  const generate = geminiGenerate({ apiKey: "KEY-123", model: "gemini-test", fetch: fake });
  const call = (signal: AbortSignal = new AbortController().signal) => generate({ image: IN, mimeType: "image/jpeg", prompt: "make it nice", signal });
  return { fake, call };
}

describe("geminiGenerate", () => {
  it("posts the interaction request with the key header, the prompt, the photo and the 4:5 1K jpeg format", async () => {
    const { fake, call } = setup(() => reply(200, interaction(b64(OUT))));
    const signal = new AbortController().signal;
    await call(signal);
    const [url, init] = fake.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("KEY-123");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.signal).toBe(signal);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("gemini-test");
    expect(body.input[0]).toEqual({ type: "text", text: "make it nice" });
    expect(body.input[1]).toEqual({ type: "image", mime_type: "image/jpeg", data: b64(IN) });
    expect(body.response_format).toEqual({ type: "image", mime_type: "image/jpeg", aspect_ratio: "4:5", image_size: "1K" });
    expect(body.store).toBe(false);
    expect(JSON.stringify(url)).not.toContain("KEY-123");
  });

  it("returns the decoded image from the model_output step's image block", async () => {
    const { call } = setup(() => reply(200, interaction(b64(OUT))));
    expect(await call()).toEqual({ image: OUT });
  });

  it("returns { none } when a 200 carries no image, or an empty one", async () => {
    expect(await setup(() => reply(200, { id: "i1", status: "completed", steps: [] })).call()).toEqual({ none: true });
    expect(await setup(() => reply(200, interaction(""))).call()).toEqual({ none: true });
    expect(await setup(() => reply(200, "not json")).call()).toEqual({ none: true });
    expect(await setup(() => reply(200, { id: "i1", status: "incomplete", steps: [{ type: "model_output", content: [{ type: "text", text: "cut off" }] }] })).call()).toEqual({ none: true });
    expect(await setup(() => reply(200, { candidates: [{ finishReason: "MAX_TOKENS" }] })).call()).toEqual({ none: true });
  });

  it("returns { refused } for a 400 that mentions safety, and for a 200 with a block reason and no image", async () => {
    expect(await setup(() => reply(400, { error: { message: "Blocked: SAFETY" } })).call()).toEqual({ refused: true });
    expect(await setup(() => reply(400, { error: { message: "prohibited content" } })).call()).toEqual({ refused: true });
    expect(await setup(() => reply(200, { id: "i1", status: "failed", steps: [] })).call()).toEqual({ refused: true });
    expect(await setup(() => reply(200, { id: "i1", status: "cancelled", steps: [] })).call()).toEqual({ refused: true });
    expect(await setup(() => reply(200, { id: "i1", status: "completed", steps: [], errors: [{ message: "x" }] })).call()).toEqual({ refused: true });
    expect(await setup(() => reply(200, { promptFeedback: { blockReason: "SAFETY" } })).call()).toEqual({ refused: true });
    expect(await setup(() => reply(200, { candidates: [{ finishReason: "IMAGE_SAFETY" }] })).call()).toEqual({ refused: true });
  });

  it("throws for other 4xx, 429 and 5xx with the status but neither the body nor the key", async () => {
    for (const status of [400, 403, 429, 503]) {
      const { call } = setup(() => reply(status, "SECRET-BODY KEY-123"));
      const err = await call().then(() => null, (e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain(String(status));
      expect(err!.message).not.toContain("SECRET-BODY");
      expect(err!.message).not.toContain("KEY-123");
    }
  });

  it("lets a network error and the caller's abort propagate unwrapped", async () => {
    const boom = new TypeError("fetch failed");
    expect(await setup(() => { throw boom; }).call().catch((e) => e)).toBe(boom);
    const abort = new DOMException("timed out", "TimeoutError");
    expect(await setup(() => { throw abort; }).call().catch((e) => e)).toBe(abort);
  });
});

describe("parseGeminiResponse", () => {
  it("also reads the candidates[].content.parts[].inlineData / inline_data shapes", () => {
    expect(parseGeminiResponse(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "x" }, { inlineData: { data: b64(OUT) } }] } }] }))).toEqual({ image: OUT });
    expect(parseGeminiResponse(200, JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { data: b64(OUT) } }] } }] }))).toEqual({ image: OUT });
  });
  it("also reads the SDK output_image shape, with or without an interaction wrapper", () => {
    expect(parseGeminiResponse(200, JSON.stringify({ output_image: { data: b64(OUT) } }))).toEqual({ image: OUT });
    expect(parseGeminiResponse(200, JSON.stringify({ interaction: { output_image: { data: b64(OUT) } } }))).toEqual({ image: OUT });
  });
  it("takes the last image block of the model_output step, whatever blocks surround it", () => {
    const other = new Uint8Array([1, 2, 3]);
    const body = { steps: [{ type: "model_output", content: [{ type: "thought", text: "t" }, { type: "image", data: b64(other) }, { type: "text", text: "x" }, { type: "image", data: b64(OUT) }, { type: "text", text: "y" }] }] };
    expect(parseGeminiResponse(200, JSON.stringify(body))).toEqual({ image: OUT });
  });
});

describe("geminiRequestBody", () => {
  it("is the one place that names the wire fields", () => {
    expect(geminiRequestBody({ model: "m", prompt: "p", mimeType: "image/png", image: IN })).toMatchObject({ model: "m", input: [{ type: "text" }, { type: "image", mime_type: "image/png" }] });
  });
});
