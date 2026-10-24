// test/smoke-restyle.test.ts
// Live check of the Gemini restyle call; skipped unless RESTYLE_SMOKE is set, so `npm test` and CI never touch the network.
//   RESTYLE_SMOKE=1 GEMINI_API_KEY=... npx vitest run test/smoke-restyle.test.ts
// Optional: RESTYLE_SMOKE_PHOTO=/path/to/real-latte.jpg (default: the plain generated test/fixtures/restyle-smoke.jpg),
// RESTYLE_MODEL=... to try another model. The restyled picture is written to
// .superpowers/sdd/2026-10-24-restyle-photo/smoke-out.jpg (git-ignored) for a human look. Never prints the key or the response.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { geminiGenerate } from "@/src/visual/gemini";
import { restylePrompt } from "@/src/visual/restyle";

const OUT = resolve(__dirname, "../.superpowers/sdd/2026-10-24-restyle-photo/smoke-out.jpg");

describe.skipIf(!process.env.RESTYLE_SMOKE)("restyle smoke (live Gemini)", () => {
  it("returns a restyled picture of more than 10 KB", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    expect(apiKey, "GEMINI_API_KEY must be set").toBeTruthy();
    const image = new Uint8Array(readFileSync(process.env.RESTYLE_SMOKE_PHOTO ?? resolve(__dirname, "fixtures/restyle-smoke.jpg")));
    const generate = geminiGenerate({ apiKey: apiKey!, model: process.env.RESTYLE_MODEL || "gemini-nano-banana-2.1" });
    const out = await generate({ image, mimeType: "image/jpeg", prompt: restylePrompt("default", "latte"), signal: AbortSignal.timeout(60_000) });
    expect(out).toHaveProperty("image");
    const picture = (out as { image: Uint8Array }).image;
    expect(picture.length).toBeGreaterThan(10_000);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, picture);
  }, 70_000);
});
