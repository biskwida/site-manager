// test/wizard-extract.test.ts
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  checkExtractFiles,
  EXTRACT_MAX_IMAGE_BYTES,
  EXTRACT_MAX_PDF_BYTES,
  ExtractFilesSchema,
  extractMenu,
  postProcessExtract,
  type ExtractResult,
} from "@/src/wizard/extract";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PDF_STUB = Buffer.from("%PDF-1.4\n%stub\n").toString("base64");

type Reply = { stop_reason: string; content: unknown[] } | Error;
/** Records the request params and answers with the scripted message (or throws). */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}
const toolUse = (input: unknown): Reply => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "extract_menu", input }] });

const RAW: ExtractResult = {
  categories: [
    {
      name_bg: " Кафе ",
      name_en: "Coffee",
      items: [
        { name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "С прясно мляко", desc_en: "With fresh milk", price_eur: 5, currency_seen: "BGN", allergens: [] },
        { name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, currency_seen: "EUR", allergens: [99, 7, 7] },
        { name_bg: "Торта", name_en: "Cake", desc_bg: "с орехи", desc_en: "with walnuts", price_eur: 9999, currency_seen: "unknown", allergens: [] },
        { name_bg: "Вода", name_en: "Water", desc_bg: "", desc_en: "", price_eur: 0, currency_seen: "unknown", allergens: [] },
      ],
    },
  ],
  notes_bg: "Една цена не се чете.",
  notes_en: "One price is unreadable.",
};
/** What the model can actually send: strict mode keeps every allergen code within 1–14. */
const VALID: ExtractResult = {
  ...RAW,
  categories: [{ ...RAW.categories[0], items: RAW.categories[0].items.map((it) => ({ ...it, allergens: it.allergens.filter((a) => a <= 14) })) }],
};

describe("extractMenu request shape", () => {
  it("sends image and document blocks, one strict tool, auto tool choice and the agent's beta flags", async () => {
    const { client, calls } = fakeClient(toolUse(VALID));
    const r = await extractMenu(client, { model: "claude-opus-5-5" }, [
      { media_type: "image/png", data: PNG_1x1 },
      { media_type: "application/pdf", data: PDF_STUB },
    ]);
    expect(r).not.toBe("error");
    expect(calls).toHaveLength(1);
    const p = calls[0];
    expect(p).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    // No forced tool choice and no thinking budget: both are rejected by claude-opus-5-5.
    expect(p).not.toHaveProperty("thinking");
    const tools = p.tools as { name: string; strict?: boolean; input_schema: { additionalProperties?: boolean; required?: string[] } }[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("extract_menu");
    expect(tools[0].strict).toBe(true);
    expect(tools[0].input_schema.additionalProperties).toBe(false);
    expect(tools[0].input_schema.required).toEqual(["categories", "notes_bg", "notes_en"]);
    expect(typeof p.system).toBe("string");
    expect(p.system as string).toContain("1.95583");
    expect(p.system as string).toContain("extract_menu");
    expect(p.system as string).toMatch(/exactly once/);
    expect(p.system as string).toMatch(/Bulgarian/);
    expect(p.system as string).toMatch(/English/);
    const messages = p.messages as { role: string; content: { type: string; source?: Record<string, string>; text?: string }[] }[];
    expect(messages).toHaveLength(1);
    const msg = messages[0];
    expect(msg.role).toBe("user");
    expect(msg.content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1x1 } });
    expect(msg.content[1]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF_STUB } });
    expect(msg.content[2].type).toBe("text");
    expect(msg.content[2].text).toContain("extract_menu");
    expect(msg.content).toHaveLength(3);
  });
});

describe("postProcessExtract", () => {
  it("converts BGN, merges suggested allergens, clamps and rounds prices, trims names", () => {
    const out = postProcessExtract(RAW); // the pure step also tolerates codes the schema would reject
    expect(out.categories[0].name_bg).toBe("Кафе");
    expect(out.categories[0].name_en).toBe("Coffee");
    const [cap, esp, cake, water] = out.categories[0].items;
    expect(cap.price_eur).toBe(2.56); // 5.00 BGN / 1.95583 = 2.5565 → 2.56
    expect(cap.currency_seen).toBe("BGN");
    expect(cap.allergens).toEqual([7]); // "мляко" / "milk" / "капучино" suggest 7
    expect(esp.price_eur).toBe(1.8);
    expect(esp.currency_seen).toBe("EUR");
    expect(esp.allergens).toEqual([7]); // 99 dropped, 7 deduplicated
    expect(cake.price_eur).toBe(500); // clamped to PRICE_MAX
    expect(cake.allergens).toEqual([1, 8]); // "торта" / "cake" → gluten, "орехи" / "walnuts" → nuts
    expect(water.price_eur).toBe(0.1); // unreadable price → PRICE_MIN, the owner fixes it in review
    expect(water.currency_seen).toBe("unknown");
    expect(out.notes_bg).toBe("Една цена не се чете.");
    expect(out.notes_en).toBe("One price is unreadable.");
  });
  it("does not mutate its input and treats a non-finite price as unreadable", () => {
    const input: ExtractResult = {
      categories: [{ name_bg: "X", name_en: "X", items: [{ name_bg: " Чай ", name_en: " Tea ", desc_bg: " ", desc_en: " ", price_eur: Number.NaN, currency_seen: "BGN", allergens: [3] }] }],
      notes_bg: " ",
      notes_en: " ",
    };
    const before = structuredClone(input);
    const out = postProcessExtract(input);
    expect(out.categories[0].items[0]).toEqual({ name_bg: "Чай", name_en: "Tea", desc_bg: "", desc_en: "", price_eur: 0.1, currency_seen: "BGN", allergens: [3] });
    expect(out.notes_bg).toBe("");
    expect(out.notes_en).toBe("");
    expect(input).toEqual(before);
  });
});

describe("extractMenu outcomes", () => {
  const files = [{ media_type: "image/jpeg" as const, data: PNG_1x1 }];
  it("returns the post-processed result on tool_use", async () => {
    const { client } = fakeClient(toolUse(VALID));
    const r = await extractMenu(client, { model: "m" }, files);
    expect(r).not.toBe("refused");
    expect(r).not.toBe("error");
    expect((r as ExtractResult).categories[0].items[0].price_eur).toBe(2.56);
    expect((r as ExtractResult).categories[0].items[1].allergens).toEqual([7]);
  });
  it("maps refusal, max_tokens, a missing tool call, invalid input and a thrown error", async () => {
    expect(await extractMenu(fakeClient({ stop_reason: "refusal", content: [] }).client, { model: "m" }, files)).toBe("refused");
    expect(await extractMenu(fakeClient({ stop_reason: "max_tokens", content: [] }).client, { model: "m" }, files)).toBe("error");
    expect(await extractMenu(fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "I cannot see a menu." }] }).client, { model: "m" }, files)).toBe("error");
    expect(await extractMenu(fakeClient({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "other_tool", input: RAW }] }).client, { model: "m" }, files)).toBe("error");
    expect(await extractMenu(fakeClient(toolUse({ categories: "nope" })).client, { model: "m" }, files)).toBe("error");
    expect(await extractMenu(fakeClient(toolUse(RAW)).client, { model: "m" }, files)).toBe("error"); // allergen code 99 is outside the schema
    expect(await extractMenu(fakeClient(new Error("boom")).client, { model: "m" }, files)).toBe("error");
  });
  it("enforces the file limits before calling the model", async () => {
    const { client, calls } = fakeClient(toolUse(VALID));
    expect(base64Bytes(PNG_1x1)).toBe(70);
    expect(base64Bytes("QUJD")).toBe(3);
    expect(base64Bytes("QUI=")).toBe(2);
    expect(base64Bytes("QQ==")).toBe(1);
    expect(base64Bytes("QU JD\n")).toBe(3);
    expect(checkExtractFiles([])).toMatchObject({ code: "bad_request" });
    expect(checkExtractFiles(Array(7).fill(files[0]))).toMatchObject({ code: "bad_request", en: "Up to 6 files at a time." });
    expect(checkExtractFiles(Array(6).fill(files[0]))).toBeNull();
    const bigImage = { media_type: "image/jpeg" as const, data: "A".repeat(Math.ceil((EXTRACT_MAX_IMAGE_BYTES + 3) / 3) * 4) };
    expect(checkExtractFiles([bigImage])).toMatchObject({ code: "too_large" });
    const bigPdf = { media_type: "application/pdf" as const, data: "A".repeat(Math.ceil((EXTRACT_MAX_PDF_BYTES + 3) / 3) * 4) };
    expect(checkExtractFiles([bigPdf])).toMatchObject({ code: "too_large" });
    // A PDF may be larger than an image: the same payload passes as a PDF but not as an image.
    expect(checkExtractFiles([{ media_type: "application/pdf", data: bigImage.data }])).toBeNull();
    expect(checkExtractFiles([{ media_type: "image/png", data: PNG_1x1 }])).toBeNull();
    await expect(extractMenu(client, { model: "m" }, [bigPdf])).rejects.toThrow(/too large/);
    await expect(extractMenu(client, { model: "m" }, [])).rejects.toThrow(/bad request/);
    expect(calls).toHaveLength(0);
  });
  it("ExtractFilesSchema accepts images and PDFs only, 1 to 6 of them", () => {
    expect(ExtractFilesSchema.safeParse({ files: [{ media_type: "image/webp", data: "QUJD" }] }).success).toBe(true);
    expect(ExtractFilesSchema.safeParse({ files: [{ media_type: "application/pdf", data: "QUJD" }] }).success).toBe(true);
    expect(ExtractFilesSchema.safeParse({ files: [{ media_type: "text/plain", data: "QUJD" }] }).success).toBe(false);
    expect(ExtractFilesSchema.safeParse({ files: [{ media_type: "image/png", data: "" }] }).success).toBe(false);
    expect(ExtractFilesSchema.safeParse({ files: [] }).success).toBe(false);
    expect(ExtractFilesSchema.safeParse({ files: Array(7).fill({ media_type: "image/png", data: "QUJD" }) }).success).toBe(false);
    expect(ExtractFilesSchema.safeParse({}).success).toBe(false);
  });
});

const live = process.env.ANTHROPIC_API_KEY ? it : it.skip;
live("LIVE: a real call with a 1×1 PNG returns a structured (probably empty) menu", async () => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await extractMenu(client, { model: process.env.AGENT_MODEL ?? "claude-opus-5-5" }, [{ media_type: "image/png", data: PNG_1x1 }]);
  if (r === "refused" || r === "error") throw new Error(`live extract returned ${r}`);
  expect(Array.isArray(r.categories)).toBe(true);
  expect(typeof r.notes_en).toBe("string");
}, 120_000);
