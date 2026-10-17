// src/bot/lang-classify.ts
// One small-model call that names the language of an owner's Latin-script message (four words or more, "Ich will den Preis in
// der Karte ändern"; src/bot/inbound.ts decides when to ask). Never throws and never logs the message or the answer: a failed or
// timed-out call, a refusal, "unknown" or anything that is not the code of a known language is null, and inbound.ts falls back
// to the English word list.
import type Anthropic from "@anthropic-ai/sdk";
import { languageName } from "../domain/format";
import { isChatLang, type ChatLang } from "../domain/types";
import { errorSummary } from "../wizard/tool-schema";

export type LangClassifier = (text: string) => Promise<ChatLang | null>;

const QUESTION =
  "Which language is this message written in? Reply with only its ISO 639-1 code, or unknown. If the message is only a dish or product name, a brand, or a list of names, reply unknown.";
/** The owner is waiting for the turn to start: a slow answer is no answer. */
const REQUEST_OPTIONS = { timeout: 3000, maxRetries: 0 };

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
          messages: [{ role: "user", content: [{ type: "text", text }] }],
        },
        REQUEST_OPTIONS,
      );
    } catch (e) {
      console.error("[lang] classify call failed:", errorSummary(e));
      return null;
    }
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      console.error("[lang] classify answer unusable:", res.stop_reason);
      return null;
    }
    return codeOf(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  };
}
