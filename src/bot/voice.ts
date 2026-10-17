// src/bot/voice.ts
import OpenAI, { toFile } from "openai";
import { detectScriptLang, languageName } from "../domain/format";
import { isChatLang, type ChatLang } from "../domain/types";

/** What was said and the language it was said in; `lang` is null when the speech shows none (the member keeps their stored language). */
export interface Transcript {
  text: string;
  lang: ChatLang | null;
}
/**
 * `stored` is the member's stored language. It is never sent to the speech-to-text service and never forces a transcript: it is only
 * the tie-break detectScriptLang gives Cyrillic that has no letter of its own (src/domain/format.ts).
 */
export type Transcriber = (bytes: Uint8Array, stored: ChatLang, contentType?: string) => Promise<Transcript>;

/** The upload name and type for an audio content type: Telegram sends ogg/opus, WhatsApp ogg or amr, Messenger/Instagram mp4/aac. */
export function audioFileName(contentType = ""): { name: string; type: string } {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  // Messenger/Instagram voice clips are often served as video/mp4 (an audio-only mp4 container).
  if (ct === "audio/mp4" || ct === "audio/x-m4a" || ct === "audio/m4a" || ct === "video/mp4") return { name: "voice.m4a", type: "audio/mp4" };
  if (ct === "audio/aac") return { name: "voice.aac", type: "audio/aac" };
  if (ct === "audio/mpeg" || ct === "audio/mp3") return { name: "voice.mp3", type: "audio/mpeg" };
  if (ct === "audio/amr") return { name: "voice.amr", type: "audio/amr" };
  return { name: "voice.ogg", type: "audio/ogg" };
}

const BY_EXT: Record<string, string> = { m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", amr: "audio/amr", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg" };

/** The download's content type, or, when it says nothing (empty or application/octet-stream), one guessed from the file name's extension. */
export function audioContentType(contentType: string, name = ""): string {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return contentType;
  const ext = /\.([a-z0-9]+)$/i.exec(name.split("?")[0])?.[1]?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? contentType;
}

/**
 * Whisper's languages by the name its verbose_json `language` reports (its tokenizer's list, lower case; a server may capitalise them),
 * with the ISO 639-1 code each has here. Hawaiian and Cantonese have no two-letter code. Javanese is jv: Whisper's own jw is the retired
 * one. The last line holds the other names Whisper reads for the same languages, and jw.
 */
const WHISPER_LANGUAGES: ReadonlyMap<string, ChatLang> = new Map(
  Object.entries({
    english: "en", chinese: "zh", german: "de", spanish: "es", russian: "ru", korean: "ko", french: "fr", japanese: "ja", portuguese: "pt", turkish: "tr",
    polish: "pl", catalan: "ca", dutch: "nl", arabic: "ar", swedish: "sv", italian: "it", indonesian: "id", hindi: "hi", finnish: "fi", vietnamese: "vi",
    hebrew: "he", ukrainian: "uk", greek: "el", malay: "ms", czech: "cs", romanian: "ro", danish: "da", hungarian: "hu", tamil: "ta", norwegian: "no",
    thai: "th", urdu: "ur", croatian: "hr", bulgarian: "bg", lithuanian: "lt", latin: "la", maori: "mi", malayalam: "ml", welsh: "cy", slovak: "sk",
    telugu: "te", persian: "fa", latvian: "lv", bengali: "bn", serbian: "sr", azerbaijani: "az", slovenian: "sl", kannada: "kn", estonian: "et", macedonian: "mk",
    breton: "br", basque: "eu", icelandic: "is", armenian: "hy", nepali: "ne", mongolian: "mn", bosnian: "bs", kazakh: "kk", albanian: "sq", swahili: "sw",
    galician: "gl", marathi: "mr", punjabi: "pa", sinhala: "si", khmer: "km", shona: "sn", yoruba: "yo", somali: "so", afrikaans: "af", occitan: "oc",
    georgian: "ka", belarusian: "be", tajik: "tg", sindhi: "sd", gujarati: "gu", amharic: "am", yiddish: "yi", lao: "lo", uzbek: "uz", faroese: "fo",
    "haitian creole": "ht", pashto: "ps", turkmen: "tk", nynorsk: "nn", maltese: "mt", sanskrit: "sa", luxembourgish: "lb", myanmar: "my", tibetan: "bo", tagalog: "tl",
    malagasy: "mg", assamese: "as", tatar: "tt", hawaiian: "haw", lingala: "ln", hausa: "ha", bashkir: "ba", javanese: "jv", sundanese: "su", cantonese: "yue",
    castilian: "es", flemish: "nl", letzeburgesch: "lb", moldavian: "ro", moldovan: "ro", pushto: "ps", sinhalese: "si", valencian: "ca", burmese: "my", panjabi: "pa", haitian: "ht", jw: "jv",
  }),
);

/**
 * The conversation language for the label Whisper put on a voice note: its language name ("bulgarian", "German", "Haitian Creole"),
 * one of its alias names ("castilian") or a two-letter code ("en"), in any case. null for no label, a name it does not know, and a
 * code that is no known language (isChatLang and languageName, as for a classifier answer).
 */
export function whisperLang(name: string | undefined): ChatLang | null {
  if (typeof name !== "string") return null;
  const label = name.trim().toLowerCase();
  const code = WHISPER_LANGUAGES.get(label) ?? label;
  return isChatLang(code) && languageName(code) !== code ? code : null;
}

/** Whisper often labels Bulgarian speech with one of its neighbours; these are the languages detectScriptLang tells from Bulgarian only by letters of their own. */
const BULGARIAN_FAMILY: ReadonlySet<ChatLang> = new Set(["ru", "uk", "be", "mk", "sr"]);

interface SttClient {
  audio: { transcriptions: { create(p: { file: File; model: string; response_format: "verbose_json"; language?: string }): Promise<{ text: string; language?: string }> } };
}

const defaultFactory = (cfg: { apiKey: string; baseURL: string }): SttClient => new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }) as unknown as SttClient;

/**
 * Any OpenAI-compatible transcription endpoint (Groq by default) with a Whisper model that answers verbose_json. The first request
 * names no language: Whisper listens and labels what it heard (whisperLang). A label outside the Bulgarian family is the note's
 * language, and that one request is all; with no label, or one that cannot be mapped, the transcript's letters decide.
 *
 * Whisper often labels Bulgarian speech Russian, Macedonian, Serbian, Ukrainian or Belarusian, and Bulgarian has no letter those
 * lack, so for those labels the letters decide too (detectScriptLang with the stored language):
 * - Bulgarian (Cyrillic with no letter of its own, from a member not stored in that family): transcribed again with language "bg",
 *   because a transcript made in Russian mode is poor Bulgarian; if that request fails, the first transcript stays;
 * - no language (the same Cyrillic from a member stored as ru, who may well be Russian): the first transcript, no switch;
 * - a letter of the family: Whisper's label stands (ј љ њ џ are Macedonian letters too);
 * - anything else (English words, Greek letters): that language.
 */
export function makeTranscriber(cfg: { apiKey: string; baseUrl: string; model: string }, factory: (c: { apiKey: string; baseURL: string }) => SttClient = defaultFactory): Transcriber {
  const client = factory({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  return async (bytes, stored, contentType) => {
    const f = audioFileName(contentType);
    const file = await toFile(bytes, f.name, { type: f.type });
    const first = await client.audio.transcriptions.create({ file, model: cfg.model, response_format: "verbose_json" });
    const text = (first.text ?? "").trim();
    const heard = whisperLang(first.language);
    if (!heard) return { text, lang: detectScriptLang(text, stored) };
    if (!BULGARIAN_FAMILY.has(heard)) return { text, lang: heard };
    const letters = detectScriptLang(text, stored);
    if (letters === null) return { text, lang: null };
    if (letters !== "bg") return { text, lang: BULGARIAN_FAMILY.has(letters) ? heard : letters };
    try {
      const second = await client.audio.transcriptions.create({ file, model: cfg.model, response_format: "verbose_json", language: "bg" });
      return { text: (second.text ?? "").trim(), lang: "bg" };
    } catch (e) {
      console.error(`[bot] second transcription failed, keeping the first: ${e instanceof Error ? e.message : String(e)}`); // the transcript is never in it
      return { text, lang: "bg" };
    }
  };
}
