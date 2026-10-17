// test/voice.test.ts
import { describe, expect, it } from "vitest";
import { audioContentType, audioFileName, makeTranscriber, whisperLang } from "@/src/bot/voice";

type Heard = { text: string; language?: string };
const CFG = { apiKey: "k", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3" };

/** A transcription client that records every request and answers them in turn (the last answer repeats; an Error is thrown). */
function fakeStt(...answers: (Heard | Error)[]) {
  const calls: Record<string, unknown>[] = [];
  const factory = () => ({
    audio: {
      transcriptions: {
        create: async (p: Record<string, unknown>) => {
          calls.push(p);
          const a = answers[Math.min(calls.length, answers.length) - 1];
          if (a instanceof Error) throw a;
          return a;
        },
      },
    },
  });
  return { calls, transcribe: makeTranscriber(CFG, factory as never) };
}
const bytes = new Uint8Array([1, 2]);

describe("makeTranscriber", () => {
  it("sends the bytes as an ogg file with the model and no language, asks for verbose_json, trims the result", async () => {
    const seen: Record<string, unknown>[] = [];
    const factory = (cfg: { apiKey: string; baseURL: string }) => {
      expect(cfg).toEqual({ apiKey: "k", baseURL: "https://api.groq.com/openai/v1" });
      return { audio: { transcriptions: { create: async (p: Record<string, unknown>) => { seen.push(p); return { text: "  Капучиното става три и двайсет ", language: "bulgarian" }; } } } };
    };
    const t = makeTranscriber({ apiKey: "k", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3" }, factory as never);
    expect(await t(new Uint8Array([1, 2]), "bg")).toEqual({ text: "Капучиното става три и двайсет", lang: "bg" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ model: "whisper-large-v3", response_format: "verbose_json" });
    expect(seen[0]).not.toHaveProperty("language"); // never forced: Whisper listens first
    expect((seen[0].file as File).name).toBe("voice.ogg");
  });
  it("names the file after the content type (m4a for audio/mp4, ogg by default)", async () => {
    const names: string[] = [];
    const factory = () => ({ audio: { transcriptions: { create: async (p: { file: File }) => { names.push(p.file.name); return { text: "x" }; } } } });
    const t = makeTranscriber({ apiKey: "k", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3" }, factory as never);
    await t(new Uint8Array([1]), "bg", "audio/mp4");
    await t(new Uint8Array([1]), "bg");
    expect(names).toEqual(["voice.m4a", "voice.ogg"]);
  });

  it("asks without a language and maps the language it heard", async () => {
    const { calls, transcribe } = fakeStt({ language: "german", text: "Ich möchte den Preis ändern" });
    expect(await transcribe(bytes, "bg")).toEqual({ text: "Ich möchte den Preis ändern", lang: "de" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "whisper-large-v3", response_format: "verbose_json" });
    expect(calls[0]).not.toHaveProperty("language");
  });

  it("Russian-labelled speech with no Russian-only letters is transcribed again as Bulgarian", async () => {
    const { calls, transcribe } = fakeStt({ language: "russian", text: "кафето е готово" }, { language: "bulgarian", text: " Кафето е готово. " });
    expect(await transcribe(bytes, "en", "audio/mp4")).toEqual({ text: "Кафето е готово.", lang: "bg" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toHaveProperty("language");
    expect(calls[1]).toMatchObject({ model: "whisper-large-v3", language: "bg" });
    expect([(calls[0].file as File).name, (calls[1].file as File).name]).toEqual(["voice.m4a", "voice.m4a"]); // the same note, twice
  });

  it.each(["ukrainian", "belarusian", "macedonian", "serbian"])("%s-labelled speech with no letter of its own is Bulgarian too: the second transcript, saved bg", async (label) => {
    const { calls, transcribe } = fakeStt({ language: label, text: "кафето е готово" }, { language: "bulgarian", text: "Кафето е готово." });
    expect(await transcribe(bytes, "bg")).toEqual({ text: "Кафето е готово.", lang: "bg" });
    expect(calls.map((c) => c.language)).toEqual([undefined, "bg"]);
  });

  it("Russian speech with ы stays Russian", async () => {
    const { calls, transcribe } = fakeStt({ language: "russian", text: "мы открыты" });
    expect(await transcribe(bytes, "bg")).toEqual({ text: "мы открыты", lang: "ru" });
    expect(calls).toHaveLength(1);
  });

  it.each(["ru", "uk", "be", "mk", "sr"])("a member stored as %s who speaks marker-less Cyrillic keeps the first transcript and no language switch", async (stored) => {
    const { calls, transcribe } = fakeStt({ language: "russian", text: "добавь пиццу в меню" });
    expect(await transcribe(bytes, stored)).toEqual({ text: "добавь пиццу в меню", lang: null });
    expect(calls).toHaveLength(1); // never forced to Bulgarian: the speaker may well be Russian
  });

  it("Macedonian-labelled speech with ј (a letter Serbian shares) is Macedonian: the label wins inside the family", async () => {
    const { calls, transcribe } = fakeStt({ language: "macedonian", text: "јас сум тука" });
    expect(await transcribe(bytes, "bg")).toEqual({ text: "јас сум тука", lang: "mk" });
    expect(calls).toHaveLength(1);
  });

  it("a label in the Bulgarian family over text of another language is that language by its letters", async () => {
    const { calls, transcribe } = fakeStt({ language: "russian", text: "make it a story please" });
    expect(await transcribe(bytes, "bg")).toEqual({ text: "make it a story please", lang: "en" });
    expect(calls).toHaveLength(1);
  });

  it("a label in the Bulgarian family over text that shows no language is no switch", async () => {
    const { transcribe } = fakeStt({ language: "serbian", text: "4.20" });
    expect(await transcribe(bytes, "bg")).toEqual({ text: "4.20", lang: null });
  });

  it("Bulgarian, English and every other mapped label is that language, in one call, even capitalised (Groq)", async () => {
    for (const [language, text, lang] of [["Bulgarian", "кафето е готово", "bg"], ["english", "make it a story please", "en"], ["Greek", "Ο καφές είναι έτοιμος", "el"], ["Haitian Creole", "Kafe a pare", "ht"]]) {
      const { calls, transcribe } = fakeStt({ language, text });
      expect(await transcribe(bytes, "bg")).toEqual({ text, lang });
      expect(calls).toHaveLength(1);
    }
  });

  it("no language field → detect from the text", async () => {
    const { calls, transcribe } = fakeStt({ text: "make it a story please" });
    expect(await transcribe(bytes, "bg")).toEqual({ text: "make it a story please", lang: "en" });
    expect(calls).toHaveLength(1);
    expect((await fakeStt({ text: "Капучиното е готово" }).transcribe(bytes, "en")).lang).toBe("bg");
    expect((await fakeStt({ text: "4.20" }).transcribe(bytes, "bg")).lang).toBeNull();
    expect((await fakeStt({ text: "добавь пиццу в меню" }).transcribe(bytes, "ru")).lang).toBeNull(); // the stored language is only the letters' tie-break
  });

  it("a label that cannot be mapped is detected from the text too", async () => {
    for (const language of ["klingon", "", "xx", "haw", "yue"]) {
      const { calls, transcribe } = fakeStt({ language, text: "Ο καφές είναι έτοιμος" });
      expect(await transcribe(bytes, "bg")).toEqual({ text: "Ο καφές είναι έτοιμος", lang: "el" });
      expect(calls).toHaveLength(1);
    }
  });

  it("a second request that fails keeps the first transcript, still Bulgarian by its letters, and logs no words", async () => {
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
    try {
      const { calls, transcribe } = fakeStt({ language: "russian", text: "кафето е готово" }, new Error("429 Too Many Requests"));
      expect(await transcribe(bytes, "bg")).toEqual({ text: "кафето е готово", lang: "bg" });
      expect(calls).toHaveLength(2);
    } finally { console.error = orig; }
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^\[bot\] .*429 Too Many Requests$/);
    expect(errs[0]).not.toContain("кафето"); // the log says why, never what was said
  });

  it("a failing first request rejects, so the owner gets the usual voice-failed line", async () => {
    const { transcribe } = fakeStt(new Error("HTTP 500"));
    await expect(transcribe(bytes, "bg")).rejects.toThrow("HTTP 500");
  });
});

describe("whisperLang", () => {
  it("reads Whisper's language names", () => {
    expect(whisperLang("bulgarian")).toBe("bg");
    expect(whisperLang("german")).toBe("de");
    expect(whisperLang("greek")).toBe("el");
    expect(whisperLang("english")).toBe("en");
    expect(whisperLang("russian")).toBe("ru");
    expect(whisperLang("haitian creole")).toBe("ht");
    expect(whisperLang("javanese")).toBe("jv"); // Whisper's own code for it, jw, is the retired one
    expect(whisperLang("norwegian")).toBe("no");
    expect(whisperLang("nynorsk")).toBe("nn");
    expect(whisperLang("tagalog")).toBe("tl");
  });
  it("ignores case and surrounding spaces (Groq capitalises the names)", () => {
    expect(whisperLang("Bulgarian")).toBe("bg");
    expect(whisperLang("GERMAN")).toBe("de");
    expect(whisperLang(" Haitian Creole ")).toBe("ht");
  });
  it("reads two-letter codes too", () => {
    expect(whisperLang("en")).toBe("en");
    expect(whisperLang("BG")).toBe("bg");
    expect(whisperLang("pt")).toBe("pt");
    expect(whisperLang("jw")).toBe("jv"); // Whisper's code for Javanese is the retired one
  });
  it("reads Whisper's alias names", () => {
    const aliases: [string, string][] = [
      ["castilian", "es"], ["flemish", "nl"], ["letzeburgesch", "lb"], ["moldavian", "ro"], ["moldovan", "ro"], ["pushto", "ps"],
      ["sinhalese", "si"], ["valencian", "ca"], ["burmese", "my"], ["myanmar", "my"], ["panjabi", "pa"], ["haitian", "ht"],
    ];
    for (const [name, code] of aliases) expect(whisperLang(name), name).toBe(code);
  });
  it("reads every language of Whisper's tokenizer table that has a two-letter code", () => {
    // Whisper's own list (code → the name verbose_json reports), checked against ICU's names when it was copied; haw and yue have no two-letter code.
    const table: Record<string, string> = {
      en: "english", zh: "chinese", de: "german", es: "spanish", ru: "russian", ko: "korean", fr: "french", ja: "japanese", pt: "portuguese", tr: "turkish",
      pl: "polish", ca: "catalan", nl: "dutch", ar: "arabic", sv: "swedish", it: "italian", id: "indonesian", hi: "hindi", fi: "finnish", vi: "vietnamese",
      he: "hebrew", uk: "ukrainian", el: "greek", ms: "malay", cs: "czech", ro: "romanian", da: "danish", hu: "hungarian", ta: "tamil", no: "norwegian",
      th: "thai", ur: "urdu", hr: "croatian", bg: "bulgarian", lt: "lithuanian", la: "latin", mi: "maori", ml: "malayalam", cy: "welsh", sk: "slovak",
      te: "telugu", fa: "persian", lv: "latvian", bn: "bengali", sr: "serbian", az: "azerbaijani", sl: "slovenian", kn: "kannada", et: "estonian", mk: "macedonian",
      br: "breton", eu: "basque", is: "icelandic", hy: "armenian", ne: "nepali", mn: "mongolian", bs: "bosnian", kk: "kazakh", sq: "albanian", sw: "swahili",
      gl: "galician", mr: "marathi", pa: "punjabi", si: "sinhala", km: "khmer", sn: "shona", yo: "yoruba", so: "somali", af: "afrikaans", oc: "occitan",
      ka: "georgian", be: "belarusian", tg: "tajik", sd: "sindhi", gu: "gujarati", am: "amharic", yi: "yiddish", lo: "lao", uz: "uzbek", fo: "faroese",
      ht: "haitian creole", ps: "pashto", tk: "turkmen", nn: "nynorsk", mt: "maltese", sa: "sanskrit", lb: "luxembourgish", my: "myanmar", bo: "tibetan", tl: "tagalog",
      mg: "malagasy", as: "assamese", tt: "tatar", ln: "lingala", ha: "hausa", ba: "bashkir", jw: "javanese", su: "sundanese",
    };
    expect(Object.keys(table)).toHaveLength(98);
    for (const [code, name] of Object.entries(table)) expect(whisperLang(name), name).toBe(code === "jw" ? "jv" : code);
  });
  it("is null for a name it does not know, a code that is no language, an empty label and no label", () => {
    expect(whisperLang("klingon")).toBeNull();
    expect(whisperLang("xx")).toBeNull();
    expect(whisperLang("zz")).toBeNull();
    expect(whisperLang("hawaiian")).toBeNull(); // no two-letter code
    expect(whisperLang("cantonese")).toBeNull();
    expect(whisperLang("haw")).toBeNull();
    expect(whisperLang("constructor")).toBeNull();
    expect(whisperLang("")).toBeNull();
    expect(whisperLang("  ")).toBeNull();
    expect(whisperLang(undefined)).toBeNull();
    expect(whisperLang(null as never)).toBeNull();
    expect(whisperLang(7 as never)).toBeNull();
  });
});

describe("audio file type", () => {
  it("treats video/mp4 as m4a", () => {
    expect(audioFileName("video/mp4")).toEqual({ name: "voice.m4a", type: "audio/mp4" });
    expect(audioFileName("audio/amr")).toEqual({ name: "voice.amr", type: "audio/amr" });
  });
  it("falls back to the file name's extension when the content type says nothing", () => {
    expect(audioContentType("application/octet-stream", "clip.m4a")).toBe("audio/mp4");
    expect(audioContentType("", "voice.AMR")).toBe("audio/amr");
    expect(audioContentType("application/octet-stream", "https://cdn/x.mp4?sig=1")).toBe("audio/mp4");
    expect(audioContentType("audio/ogg; codecs=opus", "x.m4a")).toBe("audio/ogg; codecs=opus");
    expect(audioContentType("application/octet-stream", "noext")).toBe("application/octet-stream");
    expect(audioContentType("")).toBe("");
  });
});
