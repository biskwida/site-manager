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
 * `stored` is the member's stored language. It is never sent to the speech-to-text service and never forces a transcript. It decides how
 * a label in the Bulgarian family (ru, uk, be, mk, sr) is read: a member stored outside the family is taken to speak Bulgarian and the
 * note is transcribed again as Bulgarian; a member stored inside it keeps the first transcript (see makeTranscriber). It is also the
 * tie-break detectScriptLang gives Cyrillic that has no letter of its own when there is no usable label (src/domain/format.ts).
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

/** The languages Whisper takes Bulgarian speech for; detectScriptLang tells them from Bulgarian only by letters of their own. */
const BULGARIAN_FAMILY: ReadonlySet<ChatLang> = new Set(["ru", "uk", "be", "mk", "sr"]);

interface SttClient {
  audio: {
    transcriptions: {
      create(
        p: { file: File; model: string; response_format: "verbose_json"; language?: string },
        options?: { timeout?: number; maxRetries?: number },
      ): Promise<{ text: string; language?: string; segments?: { no_speech_prob?: number }[] }>;
    };
  };
}

/** Whisper's own limit (its no_speech_threshold) for a segment it takes for silence. */
const NO_SPEECH = 0.6;
/**
 * The lowest no_speech_prob when every segment of a verbose_json answer is probably silence (0.6 or more), otherwise null. With no
 * segments, an empty list, or a segment without the number (not every OpenAI-compatible server sends it) there is no way to tell: null.
 */
function silenceOf(segments: { no_speech_prob?: number }[] | undefined): number | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  let lowest = Infinity;
  for (const segment of segments) {
    const p = segment?.no_speech_prob;
    if (typeof p !== "number" || !(p >= NO_SPEECH)) return null;
    lowest = Math.min(lowest, p);
  }
  return lowest;
}

/** The owner is waiting for the first transcript, and the SDK's own limit is ten minutes with two retries: 30 s and one retry. */
const FIRST_REQUEST = { timeout: 30000, maxRetries: 1 };
/** The second request only improves a transcript already in hand, which stays when it fails: 20 s and no retry. */
const SECOND_REQUEST = { timeout: 20000, maxRetries: 0 };

const defaultFactory = (cfg: { apiKey: string; baseURL: string }): SttClient => new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }) as unknown as SttClient;

/**
 * Any OpenAI-compatible transcription endpoint (Groq by default) with a Whisper model that answers verbose_json. The first request
 * names no language: Whisper listens and labels what it heard (whisperLang). A label outside the Bulgarian family is the note's
 * language, and that one request is all; with no label, or one that cannot be mapped, the transcript's letters decide.
 *
 * Whisper often labels Bulgarian speech Russian, Macedonian, Serbian, Ukrainian or Belarusian, and in Russian mode it writes Russian
 * words (ы, э), so for those labels the transcript's letters cannot tell Bulgarian from Russian: the member's stored language decides.
 * - Stored outside that family (bg, en, any other): the note is transcribed again with language "bg" and is Bulgarian, whatever
 *   letters the first transcript had, so a voice note never moves a Bulgarian owner into Russian (many have Telegram in English).
 *   If that second request fails or comes back empty, the first transcript stays.
 * - Stored inside it: the first transcript stands, no second request. The label is their language when the letters also show one of
 *   the family (ј љ њ џ are Macedonian letters too, so the label picks), otherwise no language: no switch.
 *
 * Silence is no transcript: an empty first transcript, and one that Whisper made up over a clip with no speech in it (it often invents
 * a stock phrase: "Thank you for watching.", "ご視聴ありがとうございました", "Субтитры сделал DimaTorzok"), which is taken for silence
 * when verbose_json has segments and every one has no_speech_prob 0.6 or more. It is returned as { text: "", lang: null } with no
 * second request, and handleVoice answers it with the voice-failed line, so no language is saved and nothing reaches the agent.
 * Without segments, or with a segment that lacks the number, there is no such filter. Each request has a time limit (FIRST_REQUEST,
 * SECOND_REQUEST).
 */
export function makeTranscriber(cfg: { apiKey: string; baseUrl: string; model: string }, factory: (c: { apiKey: string; baseURL: string }) => SttClient = defaultFactory): Transcriber {
  const client = factory({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  return async (bytes, stored, contentType) => {
    const f = audioFileName(contentType);
    const file = await toFile(bytes, f.name, { type: f.type });
    const first = await client.audio.transcriptions.create({ file, model: cfg.model, response_format: "verbose_json" }, FIRST_REQUEST);
    const text = (first.text ?? "").trim();
    if (!text) return { text, lang: null };
    const silence = silenceOf(first.segments);
    if (silence !== null) {
      console.log(`[bot] voice note taken for silence: every segment has no_speech_prob ${silence.toFixed(2)} or more`); // the transcript is never in it
      return { text: "", lang: null };
    }
    const heard = whisperLang(first.language);
    if (!heard) return { text, lang: detectScriptLang(text, stored) };
    if (!BULGARIAN_FAMILY.has(heard)) return { text, lang: heard };
    if (BULGARIAN_FAMILY.has(stored)) {
      const letters = detectScriptLang(text, stored);
      return { text, lang: letters !== null && BULGARIAN_FAMILY.has(letters) ? heard : null };
    }
    try {
      const second = await client.audio.transcriptions.create({ file, model: cfg.model, response_format: "verbose_json", language: "bg" }, SECOND_REQUEST);
      return { text: (second.text ?? "").trim() || text, lang: "bg" };
    } catch (e) {
      console.error(`[bot] second transcription failed, keeping the first: ${e instanceof Error ? e.message : String(e)}`); // the transcript is never in it
      return { text, lang: "bg" };
    }
  };
}
