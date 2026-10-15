// test/comments-draft.test.ts — the reply draft: prompt contents, the model call shape, JSON parsing, validation, fallback.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { commentLang, draftContextOf, draftReply, draftSystemPrompt, DRAFT_KINDS, fallbackReply, parseDraft, REPLY_MAX, type DraftContext } from "@/src/social/comments-draft";
import { makeDemo } from "./helpers";

type Reply = { stop_reason: string; content: unknown[] } | Error;
/** Records the request params and answers with the scripted message (or throws). */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); if (reply instanceof Error) throw reply; return reply; } } } };
  return { client: client as unknown as Anthropic, calls };
}
const text = (t: string): Reply => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

async function ctx(comment = "Имате ли безглутенови?", author = "Мария", caption = "Днешното предложение: тиквена супа"): Promise<DraftContext> {
  const { store, venue } = await makeDemo();
  return draftContextOf(await store.getSite(venue.id), { author_name: author, text: comment, post_caption: caption });
}

describe("commentLang and fallbackReply", () => {
  it("answers Cyrillic in Bulgarian, Latin in English, emoji-only in the venue's language", () => {
    expect(commentLang("Имате ли безглутенови?", "en")).toBe("bg");
    expect(commentLang("Do you have gluten-free?", "bg")).toBe("en");
    expect(commentLang("🔥🔥", "bg")).toBe("bg");
    expect(commentLang("🔥🔥", "en")).toBe("en");
  });
  it("names the venue's phone when there is one", () => {
    expect(fallbackReply({ phone: "+359 2 000 0000" }, "bg")).toBe("Благодарим! Пишете ни на +359 2 000 0000 за подробности.");
    expect(fallbackReply({ phone: "+359 2 000 0000" }, "en")).toBe("Thank you! Write to us at +359 2 000 0000 for details.");
    expect(fallbackReply({ phone: "" }, "bg")).toBe("Благодарим! Пишете ни за подробности.");
    expect(fallbackReply({ phone: "" }, "en")).toBe("Thank you! Write to us for details.");
  });
});

describe("parseDraft", () => {
  it("reads the JSON object out of plain or fenced text and validates it", () => {
    expect(parseDraft('{"reply": "Да, имаме.", "kind": "question"}')).toEqual({ reply: "Да, имаме.", kind: "question" });
    expect(parseDraft('Here you go:\n```json\n{"reply":"Thanks!","kind":"praise"}\n```')).toEqual({ reply: "Thanks!", kind: "praise" });
    expect(parseDraft('{"reply": "  spaced  ", "kind": "weird"}')).toEqual({ reply: "spaced", kind: "other" });
    expect(parseDraft('{"reply": "", "kind": "spam"}')).toEqual({ reply: "", kind: "spam" }); // spam/abuse need no reply
    expect(parseDraft('{"reply": "", "kind": "question"}')).toBeNull();
    expect(parseDraft(`{"reply": "${"x".repeat(REPLY_MAX + 1)}", "kind": "other"}`)).toBeNull();
    expect(parseDraft("no json here")).toBeNull();
    expect(parseDraft('{"kind": "praise"}')).toBeNull();
    expect(parseDraft("[1,2]")).toBeNull();
    expect(DRAFT_KINDS).toEqual(["question", "praise", "complaint", "spam", "abuse", "other"]);
  });
});

describe("draftSystemPrompt", () => {
  it("carries the venue facts, the menu with prices and allergens, the hours, the caption and the rules", async () => {
    const c = await ctx();
    const p = draftSystemPrompt(c, "bg");
    expect(p).toContain("Кафене „Ъгъла“");
    expect(p).toContain(c.venue.tagline_bg);
    expect(p).toContain(c.venue.about_bg);
    expect(p).toContain("Капучино: 2,90 €");
    expect(p).toMatch(/алергени: 7/);
    expect(p).toContain("пон 08:00–18:00");
    expect(p).toContain("нед: затворено");
    expect(p).toContain("Днешното предложение: тиквена супа");
    expect(p).toContain("+359 2 000 0000");
    for (const rule of ["Bulgarian", "1–2 sentences", "never invent", "apolog", "never argue", "assistant", "emoji", '"kind"', "spam", "abuse"]) expect(p).toContain(rule);
    expect(draftSystemPrompt(c, "en")).toContain("€2.90"); // menu names stay in the venue's default language
  });
});

describe("draftReply", () => {
  it("calls the small model once with low effort and ~1000 tokens, and returns the parsed reply", async () => {
    const { client, calls } = fakeClient(text('{"reply": "Да, имаме безглутенов хляб всеки ден.", "kind": "question"}'));
    const r = await draftReply(client, { model: "claude-haiku-5-5" }, await ctx());
    expect(r).toEqual({ reply: "Да, имаме безглутенов хляб всеки ден.", kind: "question", fallback: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1000, output_config: { effort: "low" } });
    expect(calls[0]).not.toHaveProperty("thinking");
    expect(calls[0]).not.toHaveProperty("tools");
    expect(calls[0]).not.toHaveProperty("fallbacks"); // no server-side fallback for the small model
    const messages = calls[0].messages as { role: string; content: { type: string; text: string }[] }[];
    expect(messages[0].content[0].text).toContain("Имате ли безглутенови?");
    expect(messages[0].content[0].text).toContain("Мария");
    expect(String(calls[0].system)).toContain("Answer in Bulgarian");
  });
  it("tells the model the comment's language", async () => {
    const { client, calls } = fakeClient(text('{"reply": "Yes, we do!", "kind": "question"}'));
    await draftReply(client, { model: "m" }, await ctx("Do you have oat milk?", "Jane"));
    expect(String(calls[0].system)).toContain("Answer in English");
  });
  it("falls back to the neutral line when the call fails, is refused, is empty or invalid, or there is no client", async () => {
    const c = await ctx();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fallback = { reply: "Благодарим! Пишете ни на +359 2 000 0000 за подробности.", kind: "other", fallback: true };
    expect(await draftReply(fakeClient(new Error("boom Имате ли безглутенови?")).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(fakeClient({ stop_reason: "refusal", content: [] }).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(fakeClient(text("I cannot help with that.")).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(fakeClient(text('{"reply": "", "kind": "question"}')).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(fakeClient({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"reply": "Да' }] }).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(fakeClient(text(`{"reply": "${"x".repeat(REPLY_MAX + 1)}", "kind": "praise"}`)).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(null, { model: "m" }, c)).toEqual(fallback);
    const en = await draftReply(null, { model: "m" }, await ctx("Do you deliver?", "Jane"));
    expect(en.reply).toBe("Thank you! Write to us at +359 2 000 0000 for details.");
    expect(errors.mock.calls.flat().join(" ")).not.toContain("безглутенови");
    errors.mockRestore();
  });
  it("reads a fenced JSON answer that follows some prose", async () => {
    const { client } = fakeClient(text('Sure.\n```json\n{"reply": "Благодарим ви!", "kind": "praise"}\n```'));
    expect(await draftReply(client, { model: "m" }, await ctx("Страхотно кафе!"))).toEqual({ reply: "Благодарим ви!", kind: "praise", fallback: false });
  });
  it("puts the venue name, the menu with prices and the post caption into the system prompt", async () => {
    const { client, calls } = fakeClient(text('{"reply": "Да!", "kind": "question"}'));
    await draftReply(client, { model: "m" }, await ctx());
    const system = String(calls[0].system);
    expect(system).toContain("Кафене „Ъгъла“");
    expect(system).toContain("Капучино: 2,90 €");
    expect(system).toContain("Днешното предложение: тиквена супа");
  });
  it("keeps a spam verdict with an empty reply", async () => {
    const r = await draftReply(fakeClient(text('{"reply": "", "kind": "spam"}')).client, { model: "m" }, await ctx("Buy followers at spam.example", "bot"));
    expect(r).toEqual({ reply: "", kind: "spam", fallback: false });
  });
});
