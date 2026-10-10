// src/wizard/extract.ts
// Reads menu photos / a PDF with Claude and returns structured items for the owner to review. Nothing is inserted here.
// Pure helper: the HTTP route (src/server/wizard-ai.ts) checks the limits, injects the client and maps the outcomes to statuses.
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ALLERGENS, isAllergenCode, suggestAllergens } from "../domain/allergens";
import { clampPrice, round2 } from "../domain/pricing";

export const BGN_PER_EUR = 1.95583;
export const EXTRACT_MAX_FILES = 6;
export const EXTRACT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const EXTRACT_MAX_PDF_BYTES = 10 * 1024 * 1024;
export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ExtractMediaType = (typeof IMAGE_MEDIA_TYPES)[number] | "application/pdf";

export interface ExtractFile {
  media_type: ExtractMediaType;
  /** base64, no data: prefix */
  data: string;
}
export const ExtractFilesSchema = z.object({
  files: z
    .array(z.object({ media_type: z.enum([...IMAGE_MEDIA_TYPES, "application/pdf"]), data: z.string().min(1) }))
    .min(1)
    .max(EXTRACT_MAX_FILES),
});

export interface ExtractResult {
  categories: {
    name_bg: string;
    name_en: string;
    items: {
      name_bg: string;
      name_en: string;
      desc_bg: string;
      desc_en: string;
      /** EUR after postProcessExtract; the number printed on the menu before it. */
      price_eur: number;
      currency_seen: "EUR" | "BGN" | "unknown";
      allergens: number[];
    }[];
  }[];
  notes_bg: string;
  notes_en: string;
}

const ExtractedItem = z.object({
  name_bg: z.string().describe("Dish name in natural Bulgarian"),
  name_en: z.string().describe("Dish name in natural English"),
  desc_bg: z.string().describe("One short sentence in Bulgarian, or empty"),
  desc_en: z.string().describe("One short sentence in English, or empty"),
  price_eur: z.number().describe("The number printed on the menu, unchanged. The server converts BGN to EUR. 0 when unreadable"),
  currency_seen: z.enum(["EUR", "BGN", "unknown"]).describe("The currency shown next to the price"),
  allergens: z.array(z.number().int().min(1).max(14)).describe("EU allergen codes 1–14 you can tell from the name or description; empty when unsure"),
});
export const ExtractResultSchema = z.object({
  categories: z.array(z.object({ name_bg: z.string(), name_en: z.string(), items: z.array(ExtractedItem) })),
  notes_bg: z.string().describe("Anything the owner should check, in Bulgarian; empty when nothing"),
  notes_en: z.string().describe("The same in English"),
}) satisfies z.ZodType<ExtractResult>;

const tool = betaZodTool({
  name: "extract_menu",
  description: "Returns the menu read from the attached photos or PDF pages, grouped by the menu's own sections, in Bulgarian and English.",
  inputSchema: ExtractResultSchema,
  run: async () => "ok", // never executed: we read the tool_use block ourselves
}) as Anthropic.Beta.BetaTool; // betaZodTool always builds a custom tool (name + input_schema); its union type cannot say so

/** The wire definition: one tool, strict so the model's input always matches the schema (additionalProperties: false, all keys required). */
const TOOL_DEF: Anthropic.Beta.BetaTool = { name: tool.name, description: tool.description, input_schema: tool.input_schema, strict: true };

const SYSTEM = `You read photos or PDF pages of a café, bar or restaurant menu and transcribe them as structured data by calling the extract_menu tool exactly once. Do not answer in prose; the only valid reply is that single tool call.
Rules:
- Return every dish you can read, grouped by the menu's own sections, in the menu's order. Do not invent dishes, prices or ingredients.
- Write name_bg and desc_bg in natural Bulgarian and name_en and desc_en in natural English. When the menu has one language, write the other one yourself as a native speaker would: never a literal, word-for-word translation and never a transliteration. Never leave a field in the wrong language.
- price_eur holds the number printed next to the dish, unchanged, even when the currency is лв or BGN; the server converts BGN at 1 EUR = 1.95583 BGN. Set currency_seen to "BGN" for лв/BGN/лева, "EUR" for €/EUR/евро, "unknown" when no currency is visible. When both are printed, use the EUR number and "EUR". A dish without a readable price gets 0.
- allergens: EU allergen codes ${ALLERGENS.map((a) => `${a.code}=${a.en}`).join(", ")}. Add a code only when the name or description makes it clear; leave the list empty when unsure.
- Descriptions are one short sentence or empty. Illegible or doubtful parts are described in notes_bg and notes_en (one or two sentences each), which are empty when there is nothing to say.
- When the files show no menu at all, call extract_menu with an empty categories list and say so in the notes.`;

/** Decoded size of a base64 string without decoding it. */
export function base64Bytes(data: string): number {
  const s = data.replace(/\s+/g, "");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

/** Null when the files may be sent; otherwise the error the route returns (400). */
export function checkExtractFiles(files: ExtractFile[]): { code: "bad_request" | "too_large"; bg: string; en: string } | null {
  if (files.length === 0) return { code: "bad_request", bg: "Качете поне един файл.", en: "Upload at least one file." };
  if (files.length > EXTRACT_MAX_FILES) return { code: "bad_request", bg: `До ${EXTRACT_MAX_FILES} файла наведнъж.`, en: `Up to ${EXTRACT_MAX_FILES} files at a time.` };
  for (const f of files) {
    const bytes = base64Bytes(f.data);
    if (f.media_type === "application/pdf" && bytes > EXTRACT_MAX_PDF_BYTES) return { code: "too_large", bg: "PDF файлът е над 10 MB.", en: "The PDF is over 10 MB." };
    if (f.media_type !== "application/pdf" && bytes > EXTRACT_MAX_IMAGE_BYTES) return { code: "too_large", bg: "Снимката е над 5 MB.", en: "The image is over 5 MB." };
  }
  return null;
}

/** BGN → EUR, cents, clamp, allergen suggestions merged in, names trimmed. Pure: the input is not touched. */
export function postProcessExtract(r: ExtractResult): ExtractResult {
  return {
    categories: r.categories.map((c) => ({
      name_bg: c.name_bg.trim(),
      name_en: c.name_en.trim(),
      items: c.items.map((it) => {
        const raw = Number.isFinite(it.price_eur) ? it.price_eur : 0;
        const eur = it.currency_seen === "BGN" ? raw / BGN_PER_EUR : raw;
        const text = `${it.name_en} ${it.desc_en} ${it.name_bg} ${it.desc_bg}`;
        const allergens = [...new Set([...it.allergens.filter(isAllergenCode), ...suggestAllergens(text)])].sort((a, b) => a - b);
        return {
          name_bg: it.name_bg.trim(),
          name_en: it.name_en.trim(),
          desc_bg: it.desc_bg.trim(),
          desc_en: it.desc_en.trim(),
          price_eur: clampPrice(round2(eur)),
          currency_seen: it.currency_seen,
          allergens,
        };
      }),
    })),
    notes_bg: r.notes_bg.trim(),
    notes_en: r.notes_en.trim(),
  };
}

function contentBlocks(files: ExtractFile[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = files.map((f) =>
    f.media_type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
      : { type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } },
  );
  blocks.push({ type: "text", text: `Transcribe the menu in the ${files.length === 1 ? "attached file" : `${files.length} attached files`} by calling extract_menu once.` });
  return blocks;
}

/**
 * Never throws for model-side problems: "refused" on a safety refusal, "error" on anything else (call failure,
 * truncated reply, no tool call, invalid tool input). Throws only for a limit violation (the route checks first).
 * File contents and model output are never logged.
 */
export async function extractMenu(client: Anthropic, cfg: { model: string }, files: ExtractFile[]): Promise<ExtractResult | "refused" | "error"> {
  const limit = checkExtractFiles(files);
  if (limit) throw new Error(`extract: ${limit.en} (${limit.code === "too_large" ? "too large" : "bad request"})`);
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
      messages: [{ role: "user", content: contentBlocks(files) }],
    });
  } catch (e) {
    console.error("[wizard] extract call failed:", e instanceof Error ? e.message : "unknown error");
    return "error";
  }
  if (res.stop_reason === "refusal") return "refused";
  if (res.stop_reason === "max_tokens") return "error";
  const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === tool.name);
  if (!call) return "error";
  const parsed = ExtractResultSchema.safeParse(call.input);
  if (!parsed.success) {
    console.error("[wizard] extract: tool input failed validation:", parsed.error.issues.length, "issues");
    return "error";
  }
  return postProcessExtract(parsed.data);
}
