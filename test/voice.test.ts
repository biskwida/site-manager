// test/voice.test.ts
import { describe, expect, it } from "vitest";
import { audioContentType, audioFileName, makeTranscriber, whisperLang } from "@/src/bot/voice";

type Heard = { text: string; language?: string; segments?: { no_speech_prob?: number }[] };
const CFG = { apiKey: "k", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3" };

/** A transcription client that records every request and its options and answers them in turn (the last answer repeats; an Error is thrown). */
function fakeStt(...answers: (Heard | Error)[]) {
  const calls: Record<string, unknown>[] = [];
  const options: unknown[] = [];
  const factory = () => ({
    audio: {
      transcriptions: {
        create: async (p: Record<string, unknown>, o?: unknown) => {
          calls.push(p);
          options.push(o);
          const a = answers[Math.min(calls.length, answers.length) - 1];
          if (a instanceof Error) throw a;
          return a;
        },
      },
    },
  });
  return { calls, options, transcribe: makeTranscriber(CFG, factory as never) };
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

  describe("a label in the Bulgarian family (ru, uk, be, mk, sr) is placed by where the member is stored", () => {
    it("Russian-labelled speech with no Russian-only letters is transcribed again as Bulgarian", async () => {
      const { calls, transcribe } = fakeStt({ language: "russian", text: "кафето е готово" }, { language: "bulgarian", text: " Кафето е готово. " });
      expect(await transcribe(bytes, "en", "audio/mp4")).toEqual({ text: "Кафето е готово.", lang: "bg" });
      expect(calls).toHaveLength(2);
      expect(calls[0]).not.toHaveProperty("language");
      expect(calls[1]).toMatchObject({ model: "whisper-large-v3", language: "bg" });
      expect([(calls[0].file as File).name, (calls[1].file as File).name]).toEqual(["voice.m4a", "voice.m4a"]); // the same note, twice
    });

    it.each(["bg", "en", "de"])("a member stored as %s is never moved into Russian: even with ы the note is transcribed again as Bulgarian", async (stored) => {
      const { calls, transcribe } = fakeStt({ language: "russian", text: "Вы можете забрать кофе" }, { language: "bulgarian", text: "Можете да вземете кафето." });
      expect(await transcribe(bytes, stored)).toEqual({ text: "Можете да вземете кафето.", lang: "bg" });
      expect(calls.map((c) => c.language)).toEqual([undefined, "bg"]);
    });

    it.each(["ukrainian", "belarusian", "macedonian", "serbian"])("%s-labelled speech from a bg member is transcribed again as Bulgarian too", async (label) => {
      const { calls, transcribe } = fakeStt({ language: label, text: "кафето е готово" }, { language: "bulgarian", text: "Кафето е готово." });
      expect(await transcribe(bytes, "bg")).toEqual({ text: "Кафето е готово.", lang: "bg" });
      expect(calls.map((c) => c.language)).toEqual([undefined, "bg"]);
    });

    it("whatever letters the first transcript has, a member stored outside the family gets Bulgarian: Latin, Greek or numbers too", async () => {
      for (const text of ["make it a story please", "Ο καφές είναι έτοιμος", "4.20"]) {
        const { calls, transcribe } = fakeStt({ language: "russian", text }, { language: "bulgarian", text: "Направи го история." });
        expect(await transcribe(bytes, "bg")).toEqual({ text: "Направи го история.", lang: "bg" });
        expect(calls).toHaveLength(2);
      }
    });

    it("Russian speech with ы stays Russian for a member stored as ru: the first transcript, one call", async () => {
      const { calls, transcribe } = fakeStt({ language: "russian", text: "мы открыты" });
      expect(await transcribe(bytes, "ru")).toEqual({ text: "мы открыты", lang: "ru" });
      expect(calls).toHaveLength(1);
    });

    it.each([["ru", "russian"], ["uk", "ukrainian"], ["be", "belarusian"], ["mk", "macedonian"], ["sr", "serbian"]])("a member stored as %s, label %s, speaking Cyrillic with no letter of its own: no switch, the first transcript, one call", async (stored, label) => {
      const { calls, transcribe } = fakeStt({ language: label, text: "добавь пиццу в меню" });
      expect(await transcribe(bytes, stored)).toEqual({ text: "добавь пиццу в меню", lang: null }); // never forced to Bulgarian: the speaker may well be Russian
      expect(calls).toHaveLength(1);
    });

    it("a member stored as uk, label ukrainian, speaking with і: Ukrainian, one call", async () => {
      const { calls, transcribe } = fakeStt({ language: "ukrainian", text: "Додай піцу до меню" });
      expect(await transcribe(bytes, "uk")).toEqual({ text: "Додай піцу до меню", lang: "uk" });
      expect(calls).toHaveLength(1);
    });

    it("a member stored as mk, label macedonian, speaking with ј (a letter Serbian shares): Macedonian, the label wins inside the family", async () => {
      const { calls, transcribe } = fakeStt({ language: "macedonian", text: "јас сум тука" });
      expect(await transcribe(bytes, "mk")).toEqual({ text: "јас сум тука", lang: "mk" });
      expect(calls).toHaveLength(1);
    });

    it("a member stored in the family whose note shows no family language, English words or a price, is no switch either", async () => {
      for (const text of ["make it a story please", "4.20"]) {
        const { calls, transcribe } = fakeStt({ language: "russian", text });
        expect(await transcribe(bytes, "ru")).toEqual({ text, lang: null });
        expect(calls).toHaveLength(1);
      }
    });
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

  it("a second request that fails keeps the first transcript, still Bulgarian and never Russian, and logs no words", async () => {
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
    try {
      const { calls, transcribe } = fakeStt({ language: "russian", text: "Вы можете забрать кофе" }, new Error("429 Too Many Requests"));
      expect(await transcribe(bytes, "bg")).toEqual({ text: "Вы можете забрать кофе", lang: "bg" });
      expect(calls).toHaveLength(2);
    } finally { console.error = orig; }
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^\[bot\] .*429 Too Many Requests$/);
    expect(errs[0]).not.toContain("кофе"); // the log says why, never what was said
  });

  it("a failing first request rejects, so the owner gets the usual voice-failed line", async () => {
    const { transcribe } = fakeStt(new Error("HTTP 500"));
    await expect(transcribe(bytes, "bg")).rejects.toThrow("HTTP 500");
  });

  describe("empty transcripts", () => {
    it("an empty first transcript is returned as it is, with no language and no second request, whatever the label", async () => {
      for (const language of ["russian", "german", "bulgarian", undefined]) {
        const { calls, transcribe } = fakeStt({ language, text: "  " });
        expect(await transcribe(bytes, "bg"), String(language)).toEqual({ text: "", lang: null });
        expect(calls, String(language)).toHaveLength(1); // silence has nothing to ask again about; the owner gets the voice-failed line
      }
    });

    it("an empty second transcript keeps the first one, still Bulgarian", async () => {
      const { calls, transcribe } = fakeStt({ language: "russian", text: "кафето е готово" }, { language: "bulgarian", text: "  " });
      expect(await transcribe(bytes, "en")).toEqual({ text: "кафето е готово", lang: "bg" });
      expect(calls).toHaveLength(2);
    });
  });

  describe("silence: a stock phrase Whisper invents over a clip with no speech in it", () => {
    const THANKS = "Thank you for watching.";
    /** Runs `fn` with console.log collected (the transcriber logs when it takes a note for silence) and returns its result and the lines. */
    async function collecting<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
      const lines: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
      try {
        return { result: await fn(), lines };
      } finally { console.log = orig; }
    }

    it("a transcript whose every segment is probably silence is none: no text, no language, no second request", async () => {
      const { calls, transcribe } = fakeStt({ language: "english", text: THANKS, segments: [{ no_speech_prob: 0.92 }] });
      const { result } = await collecting(() => transcribe(bytes, "bg"));
      expect(result).toEqual({ text: "", lang: null });
      expect(calls).toHaveLength(1);
    });

    it("one segment with speech in it keeps the transcript", async () => {
      const { calls, transcribe } = fakeStt({ language: "english", text: THANKS, segments: [{ no_speech_prob: 0.92 }, { no_speech_prob: 0.1 }] });
      const { result, lines } = await collecting(() => transcribe(bytes, "bg"));
      expect(result).toEqual({ text: THANKS, lang: "en" });
      expect(calls).toHaveLength(1);
      expect(lines).toEqual([]);
    });

    it("no segments, no segments in it, or a segment without no_speech_prob: not every server sends them, so there is no filter", async () => {
      for (const segments of [undefined, [], [{}], [{ no_speech_prob: 0.95 }, {}], [{ no_speech_prob: 0.95 }, { no_speech_prob: undefined }]]) {
        const { transcribe } = fakeStt({ language: "english", text: THANKS, segments });
        expect(await transcribe(bytes, "bg"), JSON.stringify(segments)).toEqual({ text: THANKS, lang: "en" });
      }
    });

    it("0.6 and above is silence (Whisper's own no_speech_threshold), below it is speech", async () => {
      for (const [prob, silence] of [[0.6, true], [0.59, false], [1, true], [0, false]] as const) {
        const { transcribe } = fakeStt({ language: "english", text: THANKS, segments: [{ no_speech_prob: prob }] });
        const { result } = await collecting(() => transcribe(bytes, "bg"));
        expect(result, String(prob)).toEqual(silence ? { text: "", lang: null } : { text: THANKS, lang: "en" });
      }
    });

    it("a label in the Bulgarian family over silence makes no second request, and moves nobody", async () => {
      const { calls, transcribe } = fakeStt({ language: "russian", text: "Субтитры сделал DimaTorzok", segments: [{ no_speech_prob: 0.8 }, { no_speech_prob: 0.9 }] });
      const { result } = await collecting(() => transcribe(bytes, "bg")); // stored outside the family: without the filter this asks again as Bulgarian
      expect(result).toEqual({ text: "", lang: null });
      expect(calls).toHaveLength(1);
    });

    it("logs that it took the note for silence and how sure the model was, never the words", async () => {
      const { transcribe } = fakeStt({ language: "english", text: THANKS, segments: [{ no_speech_prob: 0.92 }, { no_speech_prob: 0.97 }] });
      const { lines } = await collecting(() => transcribe(bytes, "bg"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[bot\] .*silence/);
      expect(lines[0]).toContain("0.92");
      expect(lines[0]).not.toMatch(/thank|watching/i);
    });
  });

  describe("time limits", () => {
    it("the first request waits at most 30 s and is retried once; the second waits at most 20 s and is not retried", async () => {
      const { options, transcribe } = fakeStt({ language: "russian", text: "кафето е готово" }, { language: "bulgarian", text: "Кафето е готово." });
      await transcribe(bytes, "bg");
      expect(options).toEqual([{ timeout: 30000, maxRetries: 1 }, { timeout: 20000, maxRetries: 0 }]);
    });

    it("a note that needs only one request carries the first request's limits", async () => {
      const { options, transcribe } = fakeStt({ language: "german", text: "Ich möchte den Preis ändern" });
      await transcribe(bytes, "bg");
      expect(options).toEqual([{ timeout: 30000, maxRetries: 1 }]);
    });
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
