// src/bot/lang-classify.ts
// One small-model call that names the language of a text when its letters cannot: an owner's Latin text of four words or more
// ("Ich will den Preis in der Karte ändern"), their Cyrillic without a marker letter when they are not stored as Bulgarian
// (src/bot/inbound.ts decides when to ask), or a customer's comment of two words or more (src/social/comments-draft.ts). It reads at
// most the first 300 characters of any text. Never throws and never logs the text or the answer: a failed or timed-out call, a
// refusal, "unknown" or anything that is not the code of a known language is null, and the caller falls back to the letters (the
// English word list for an owner's Latin text, English for a comment).
import Anthropic from "@anthropic-ai/sdk";
import { languageName } from "../domain/format";
import { isChatLang, type ChatLang } from "../domain/types";

export type LangClassifier = (text: string) => Promise<ChatLang | null>;

const QUESTION =
  "Which language is this message written in? Reply with only its ISO 639-1 code, or unknown. If the message is only a dish or product name, a brand, or a list of names, reply unknown. Bulgarian written in Latin letters (shliokavitsa) is bg.";
/** The owner is waiting for the turn to start: a slow answer is no answer. */
const REQUEST_OPTIONS = { timeout: 3000, maxRetries: 0 };
/** The classifier is shown at most this many characters of a text: enough to name its language, and a pasted menu or a long comment need not travel in full. */
const MAX_CHARS = 300;

/**
 * A failed call for the log: the error's class ("APIConnectionTimeoutError", "RateLimitError 429"), never its message, which can
 * echo the request. The SDK's errors keep the default name "Error", so the class comes from the constructor; a timeout is
 * named by instanceof, since a minified build may rename classes. src/bot/translate.ts logs its failures the same way.
 */
export function failureOf(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "APIConnectionTimeoutError";
  if (!(e instanceof Error)) return "unknown error";
  const name = e.name !== "Error" ? e.name : e.constructor.name;
  return e instanceof Anthropic.APIError && e.status ? `${name} ${e.status}` : name;
}

/**
 * The model's reply as a code: case, spaces, quotes, backticks and a full stop around it are dropped; the rest must be the
 * two-letter code of a language Intl knows by name ("zz" is not).
 */
function codeOf(reply: string): ChatLang | null {
  const code = reply.trim().toLowerCase().replace(/^["'`*.\s]+|["'`*.\s]+$/g, "");
  return isChatLang(code) && languageName(code) !== code ? code : null;
}

export function makeLangClassifier(client: Anthropic, model: string): LangClassifier {
  return async (text) => {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create(
        {
          model,
          max_tokens: 5,
          // Thinking counts toward max_tokens and would use up the five before the answer, so it is off: claude-haiku-5-5 accepts
          // that up to effort high. No server-side `fallbacks`: none exists for the small model.
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          system: QUESTION,
          // Cut at a character (code point), never between the two halves of an emoji.
          messages: [{ role: "user", content: [{ type: "text", text: Array.from(text).slice(0, MAX_CHARS).join("") }] }],
        },
        REQUEST_OPTIONS,
      );
    } catch (e) {
      console.error("[lang] classify call failed:", failureOf(e));
      return null;
    }
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      console.error("[lang] classify answer unusable:", res.stop_reason);
      return null;
    }
    return codeOf(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  };
}
