// src/wizard/texts.ts
// "Write for me": tagline, about, welcome and footer note in both languages from a few facts the owner typed.
// Pure helper: the HTTP route (src/server/wizard-ai.ts) validates the body, injects the client and maps the outcomes to statuses.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Lang } from "../domain/types";
import { errorSummary, wireSchema } from "./tool-schema";

export const TEXTS_MAX_FACTS = 2000;

export interface DraftTexts {
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  welcome_bg: string;
  welcome_en: string;
  footer_note_bg: string;
  footer_note_en: string;
}

// Tool input schema = plain strings with descriptions only; the Messages API rejects length constraints in a tool's input_schema
// (lengths are described in the prompt and blank required texts are caught after the call).
export const DraftTextsSchema = z.object({
  tagline_bg: z.string().describe("Up to 12 words, Bulgarian"),
  tagline_en: z.string().describe("Up to 12 words, English"),
  about_bg: z.string().describe("40–120 words about the place, Bulgarian"),
  about_en: z.string().describe("40–120 words about the place, English"),
  welcome_bg: z.string().describe("One or two sentences greeting a guest, Bulgarian"),
  welcome_en: z.string().describe("One or two sentences greeting a guest, English"),
  footer_note_bg: z.string().describe("One short practical line (cards, pets, wifi, terrace), Bulgarian; may be empty"),
  footer_note_en: z.string().describe("The same line in English; may be empty"),
}) satisfies z.ZodType<DraftTexts>;

const TOOL_NAME = "draft_texts";
/** The wire definition: one tool, strict so the model's input always matches the schema (additionalProperties: false, all keys required). */
const TOOL_DEF: Anthropic.Beta.BetaTool = {
  name: TOOL_NAME,
  description: "Returns the venue's website texts in Bulgarian and English.",
  input_schema: wireSchema(DraftTextsSchema),
  strict: true,
};

const SYSTEM = `You write the short texts for a small café, bar or restaurant website in Bulgaria, from facts the owner typed. Reply by calling the draft_texts tool exactly once; no prose. The only valid reply is that single tool call.
Rules:
- Write each language natively: Bulgarian that sounds like a Bulgarian wrote it, English that sounds like an English speaker wrote it. Never translate word for word; the two versions may differ in wording as long as the facts match. The owner's facts come in one language; write the other language yourself.
- Use only the facts given. Do not invent awards, years, ratings, prices or opening hours. If a fact is missing, leave it out rather than guessing.
- tagline: up to 12 words, no exclamation marks. about: 40–120 words, warm and plain, no marketing clichés. welcome: one or two sentences. footer_note: one short practical line taken from the facts (cards, pets, wifi, terrace); empty when the facts say nothing practical.
- Plain text only: no emoji, no markdown, no quotes around the texts.`;

/**
 * Never throws: "refused" on a safety refusal, "error" on anything else (call failure, truncated reply, no tool call,
 * invalid tool input, a blank required text). Facts and model output are never logged.
 */
export async function draftTexts(client: Anthropic, cfg: { model: string }, facts: string, lang: Lang): Promise<DraftTexts | "refused" | "error"> {
  const language = lang === "bg" ? "Bulgarian" : "English";
  const text = `The owner wrote these facts in ${language}:\n\n${facts.trim().slice(0, TEXTS_MAX_FACTS)}\n\nCall draft_texts once with all eight texts.`;
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Forced tool_choice is rejected by claude-opus-5-5; the prompt asks for exactly one call and strict keeps the schema.
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      tools: [TOOL_DEF],
      system: SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text }] }],
    });
  } catch (e) {
    console.error("[wizard] texts call failed:", errorSummary(e));
    return "error";
  }
  if (res.stop_reason === "refusal") return "refused";
  if (res.stop_reason === "max_tokens") return "error";
  const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!call) return "error";
  const parsed = DraftTextsSchema.safeParse(call.input);
  if (!parsed.success) {
    console.error("[wizard] texts: tool input failed validation:", parsed.error.issues.length, "issues");
    return "error";
  }
  const d = parsed.data;
  const out: DraftTexts = {
    tagline_bg: d.tagline_bg.trim(),
    tagline_en: d.tagline_en.trim(),
    about_bg: d.about_bg.trim(),
    about_en: d.about_en.trim(),
    welcome_bg: d.welcome_bg.trim(),
    welcome_en: d.welcome_en.trim(),
    footer_note_bg: d.footer_note_bg.trim(),
    footer_note_en: d.footer_note_en.trim(),
  };
  // A footer note may be empty; everything else must be there, or the owner would get blank fields.
  if (!out.tagline_bg || !out.tagline_en || !out.about_bg || !out.about_en || !out.welcome_bg || !out.welcome_en) return "error";
  return out;
}
