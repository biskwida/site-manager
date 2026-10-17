// test/comments-draft.test.ts — the reply draft: prompt contents, the model call shape, JSON parsing, validation, fallback.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { makeLangClassifier, type LangClassifier } from "@/src/bot/lang-classify";
import { commentLang, draftContextOf, draftReply, draftSystemPrompt, DRAFT_KINDS, fallbackReply, parseDraft, REPLY_MAX, type DraftContext } from "@/src/social/comments-draft";
import { proposeForComments, type ProposeDeps } from "@/src/social/comments-propose";
import { at, connectedVenue, MIN, T0 } from "./comments-helpers";
import { makeDemo } from "./helpers";

type Reply = { stop_reason: string; content: unknown[] } | Error;
/** Records the request params and answers with the scripted message (or throws). */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); if (reply instanceof Error) throw reply; return reply; } } } };
  return { client: client as unknown as Anthropic, calls };
}
const text = (t: string): Reply => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });
/** A language classifier that answers `answer` (or throws it) and records what it was asked. */
function classifier(answer: string | null | Error) {
  const asked: string[] = [];
  const classify: LangClassifier = async (t) => {
    asked.push(t);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { asked, classify };
}
/** One fake model for both calls of a draft: the classifier's (max_tokens 5) and the drafting one; every request is recorded. */
function modelFor(classified: string, draft: string) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); return text(params.max_tokens === 5 ? classified : draft); } } } };
  return { client: client as unknown as Anthropic, calls };
}
/** Runs fn with console.error captured; returns what was logged. */
async function logged(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

async function ctx(comment = "Имате ли безглутенови?", author = "Мария", caption = "Днешното предложение: тиквена супа"): Promise<DraftContext> {
  const { store, venue } = await makeDemo();
  return draftContextOf(await store.getSite(venue.id), { author_name: author, text: comment, post_caption: caption });
}

describe("commentLang", () => {
  it("a German comment gets a German draft: the classifier names Latin text of two words or more", async () => {
    const { asked, classify } = classifier("de");
    expect(await commentLang("Habt ihr Hafermilch?", "bg", classify)).toBe("de");
    expect(asked).toEqual(["Habt ihr Hafermilch?"]);
  });
  it("any language the classifier names is the draft's: French, Spanish, Dutch, Turkish", async () => {
    for (const [comment, code] of [["Merci beaucoup!", "fr"], ["¿Tienen leche de avena?", "es"], ["Hebben jullie havermelk?", "nl"], ["Yulaf sütünüz var mı?", "tr"]]) {
      expect(await commentLang(comment, "bg", classifier(code).classify)).toBe(code);
    }
  });
  it("an English comment is English, named by the classifier or, without its answer, by default", async () => {
    expect(await commentLang("Do you have gluten-free?", "bg", classifier("en").classify)).toBe("en");
    expect(await commentLang("Do you have gluten-free?", "bg", classifier(null).classify)).toBe("en");
    expect(await commentLang("Do you have gluten-free?", "bg")).toBe("en");
    expect(await commentLang("Do you have gluten-free?", "bg", null)).toBe("en");
  });
  it("a classifier that cannot say (unknown, a failure) leaves English, and a failure is logged without the comment", async () => {
    const { asked, classify } = classifier(new Error("boom Habt ihr Hafermilch?"));
    let lang: unknown;
    const log = await logged(async () => { lang = await commentLang("Habt ihr Hafermilch?", "bg", classify); });
    expect(lang).toBe("en");
    expect(asked).toHaveLength(1);
    expect(log).toMatch(/\[comments\].*Error/);
    expect(log).not.toContain("Hafermilch");
    expect(await commentLang("Habt ihr Hafermilch?", "bg", classifier(null).classify)).toBe("en");
  });
  it("one Latin word is English without asking: Wow", async () => {
    const { asked, classify } = classifier("de");
    expect(await commentLang("Wow", "bg", classify)).toBe("en");
    expect(await commentLang("Wow 😍", "bg", classify)).toBe("en");
    expect(await commentLang("Merci", "bg", classify)).toBe("en");
    expect(asked).toEqual([]);
  });
  it("a comment without letters (an emoji, a number) follows the venue's language, without asking", async () => {
    const { asked, classify } = classifier("de");
    expect(await commentLang("😍😍", "bg", classify)).toBe("bg");
    expect(await commentLang("🔥🔥", "en", classify)).toBe("en");
    expect(await commentLang("5/5 ⭐⭐⭐⭐⭐", "bg", classify)).toBe("bg");
    expect(await commentLang("👍", "de", classify)).toBe("de");
    expect(await commentLang("", "bg", classify)).toBe("bg");
    expect(asked).toEqual([]);
  });
  it("Cyrillic is Bulgarian without asking, whatever the venue's language; a letter only Russian has makes it Russian", async () => {
    const { asked, classify } = classifier("de");
    expect(await commentLang("Имате ли овесено мляко?", "en", classify)).toBe("bg");
    expect(await commentLang("Имате ли овесено мляко?", "bg", classify)).toBe("bg");
    expect(await commentLang("Супер", "en", classify)).toBe("bg");
    expect(await commentLang("Вы открыты сегодня?", "bg", classify)).toBe("ru");
    expect(await commentLang("Чи працюєте ви сьогодні?", "bg", classify)).toBe("uk");
    expect(asked).toEqual([]);
  });
  it("other scripts are named by their letters, without asking: Greek, Arabic, Hebrew, Japanese, Korean, Chinese", async () => {
    const { asked, classify } = classifier("de");
    for (const [comment, code] of [["Έχετε γάλα βρώμης;", "el"], ["Ευχαριστούμε", "el"], ["هل لديكم حليب الشوفان؟", "ar"], ["יש לכם חלב שיבולת שועל?", "he"], ["オーツミルクはありますか？", "ja"], ["귀리 우유 있나요?", "ko"], ["你们有燕麦奶吗？", "zh"]]) {
      expect(await commentLang(comment, "bg", classify)).toBe(code);
    }
    expect(asked).toEqual([]);
  });
  it("a script the letters cannot place goes to the classifier like Latin text, and is English without its answer", async () => {
    const { asked, classify } = classifier("bn");
    expect(await commentLang("আপনাদের কাছে কি ওট দুধ আছে?", "bg", classify)).toBe("bn");
    expect(asked).toEqual(["আপনাদের কাছে কি ওট দুধ আছে?"]);
    expect(await commentLang("আপনাদের কাছে কি ওট দুধ আছে?", "bg", classifier(null).classify)).toBe("en");
    expect(await commentLang("আপনাদের কাছে কি ওট দুধ আছে?", "bg")).toBe("en");
    expect(await commentLang("ধন্যবাদ", "bg", classify)).toBe("en"); // one word
    expect(asked).toHaveLength(1);
  });
  it("a mixed comment goes by its letters, English winning when its words are most of it", async () => {
    const { asked, classify } = classifier("de");
    expect(await commentLang("Flat white свърши", "en", classify)).toBe("bg");
    expect(await commentLang("please change the price of Капучино to 4.20", "bg", classify)).toBe("en");
    expect(asked).toEqual([]);
  });
});

describe("fallbackReply", () => {
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
  it("answers in the commenter's language, whatever it is, with the venue's facts in English", async () => {
    const c = await ctx("Habt ihr Hafermilch?", "Jan");
    const p = draftSystemPrompt(c, "de");
    expect(p).toContain("Answer in German");
    expect(p).toContain(c.venue.tagline_en);
    expect(p).toContain(c.venue.about_en);
    expect(p).not.toContain(c.venue.tagline_bg);
    expect(p).toContain("€2.90"); // prices as the English facts print them
    expect(p).toContain("Mon 08:00–18:00");
    expect(p).toContain("Sun: closed");
    expect(draftSystemPrompt(c, "el")).toContain("Answer in Greek");
    expect(draftSystemPrompt(c, "bg")).toContain(c.venue.tagline_bg); // Bulgarian and English keep their own facts
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

describe("draftReply: the commenter's language", () => {
  it("a German comment gets a German draft: the classifier names it, the model is told to answer in German", async () => {
    const { client, calls } = modelFor("de", '{"reply": "Ja, wir haben jeden Tag Hafermilch.", "kind": "question"}');
    const r = await draftReply(client, { model: "draft-model", classify: makeLangClassifier(client, "classifier-model") }, await ctx("Habt ihr Hafermilch?", "Jan"));
    expect(r).toEqual({ reply: "Ja, wir haben jeden Tag Hafermilch.", kind: "question", fallback: false });
    expect(calls.map((c) => [c.model, c.max_tokens])).toEqual([["classifier-model", 5], ["draft-model", 1000]]);
    expect(String(calls[1].system)).toContain("Answer in German");
    const messages = calls[1].messages as { content: { text: string }[] }[];
    expect(messages[0].content[0].text).toContain("Habt ihr Hafermilch?");
  });
  it("asks the classifier about Latin text of two words or more only: not for Cyrillic, Greek, one word or an emoji", async () => {
    for (const [comment, language] of [["Имате ли овесено мляко?", "Bulgarian"], ["Έχετε γάλα βρώμης;", "Greek"], ["Wow", "English"], ["😍😍", "Bulgarian"]]) {
      const { client, calls } = modelFor("de", '{"reply": "ok", "kind": "praise"}');
      await draftReply(client, { model: "draft-model", classify: makeLangClassifier(client, "classifier-model") }, await ctx(comment, "Jan"));
      expect(calls.map((c) => c.model)).toEqual(["draft-model"]);
      expect(String(calls[0].system)).toContain(`Answer in ${language}`);
    }
  });
  it("a classifier that has no answer leaves the draft in English", async () => {
    const { client, calls } = modelFor("unknown", '{"reply": "Yes!", "kind": "question"}');
    await draftReply(client, { model: "draft-model", classify: makeLangClassifier(client, "classifier-model") }, await ctx("Habt ihr Hafermilch?", "Jan"));
    expect(String(calls[1].system)).toContain("Answer in English");
  });
  it("without a classifier a Latin comment is answered in English, as before", async () => {
    const { client, calls } = fakeClient(text('{"reply": "Yes!", "kind": "question"}'));
    await draftReply(client, { model: "m" }, await ctx("Habt ihr Hafermilch?", "Jan"));
    await draftReply(client, { model: "m", classify: null }, await ctx("Habt ihr Hafermilch?", "Jan"));
    expect(calls.map((c) => String(c.system).includes("Answer in English"))).toEqual([true, true]);
  });
  it("a 1,000-character comment reaches the classifier as 300 characters; the draft model still reads all of it", async () => {
    const long = "Wir haben heute frischen Apfelstrudel gesehen und fragen uns, ob ihr auch Hafermilch habt. ".repeat(20).slice(0, 1000);
    expect(long).toHaveLength(1000);
    const { client, calls } = modelFor("de", '{"reply": "Ja!", "kind": "question"}');
    await draftReply(client, { model: "draft-model", classify: makeLangClassifier(client, "classifier-model") }, await ctx(long, "Jan"));
    const classifierText = (calls[0].messages as { content: { text: string }[] }[])[0].content[0].text;
    expect(classifierText).toBe(long.slice(0, 300));
    expect(classifierText).toHaveLength(300);
    expect(JSON.stringify(calls[1].messages)).toContain(long);
  });
  it("the neutral line stands in at the base language of the commenter's: English for German, Bulgarian for Bulgarian", async () => {
    const german = await ctx("Habt ihr Hafermilch?", "Jan");
    const bulgarian = await ctx("Имате ли овесено мляко?");
    const { client } = modelFor("de", "I cannot help with that.");
    const classify = makeLangClassifier(client, "m");
    await logged(async () => {
      expect(await draftReply(client, { model: "m", classify }, german)).toEqual({ reply: "Thank you! Write to us at +359 2 000 0000 for details.", kind: "other", fallback: true });
      expect((await draftReply(null, { model: "m", classify }, german)).reply).toBe("Thank you! Write to us at +359 2 000 0000 for details.");
      expect((await draftReply(null, { model: "m", classify }, bulgarian)).reply).toBe("Благодарим! Пишете ни на +359 2 000 0000 за подробности.");
    });
  });
  it("never logs the comment, whether the classifier or the draft fails", async () => {
    const failing = classifier(new Error("boom Habt ihr Hafermilch?"));
    const log = await logged(async () => {
      const r = await draftReply(fakeClient(new Error("boom Habt ihr Hafermilch?")).client, { model: "m", classify: failing.classify }, await ctx("Habt ihr Hafermilch?", "Jan"));
      expect(r.fallback).toBe(true);
    });
    expect(failing.asked).toHaveLength(1);
    expect(log).toMatch(/\[comments\]/);
    expect(log).not.toContain("Hafermilch");
  });
});

describe("a customer's comment while the owner speaks Bulgarian", () => {
  it("an English comment while the owner speaks Bulgarian: wrapper Bulgarian, draft English", async () => {
    const v = await connectedVenue(); // the owner, tg:1001, speaks Bulgarian
    const { client, calls } = modelFor("en", '{"reply": "Yes, we have oat milk every day!", "kind": "question"}');
    const [comment] = await v.store.upsertComments(v.venue.id, [{
      network: "instagram", comment_id: "c1", post_ref: "media-1", parent_id: null, author_id: "u1", author_name: "Jane", text: "Do you have oat milk?",
      post_caption: "Днешното предложение: тиквена супа", seen_at: T0.toISOString(), status: "new", created_at: at(-10 * MIN).toISOString(),
    }]);
    const d: ProposeDeps = { store: v.store, messenger: v.messenger, now: () => T0, draft: (c) => draftReply(client, { model: "m", classify: makeLangClassifier(client, "m") }, c), log: () => undefined };
    const { sets } = await proposeForComments(d, await v.store.getVenue(v.venue.id), [comment], { mode: "each" });
    expect(sets).toHaveLength(1);
    expect(String(calls.at(-1)!.system)).toContain("Answer in English");
    const proposal = v.messenger.sent.find((m) => m.setId === sets[0].id)!;
    expect(proposal).toMatchObject({ chatRef: "tg:1001", lang: "bg" });
    // Claudia's words are Bulgarian; the customer's name and comment and the draft are as they are.
    expect(proposal.text).toBe("💬 Нов коментар под поста „Днешното предложение: тиквена супа“ (Instagram) от Jane: „Do you have oat milk?“\n\nПредложен отговор:\n„Yes, we have oat milk every day!“\n\nДа отговоря ли?");
    expect(v.messenger.raw.find((t) => t.startsWith("💬"))).toContain("„⟦Yes, we have oat milk every day!⟧“");
    expect(sets[0].preview_bg).toContain("→ „⟦Yes, we have oat milk every day!⟧“");
  });
});
