// src/bot/lang-classify.ts
// One small-model call that names the language of an owner's message when its letters cannot (Latin text of three words or more
// that the English word list does not place, "Ich möchte den Preis ändern"; src/bot/inbound.ts decides when to ask). Never throws
// and never logs the message or the answer: a failed call, a refusal, "unknown" or anything that is not a two-letter code is null,
// and the member's language stays as it is.
import type Anthropic from "@anthropic-ai/sdk";
import { isChatLang, type ChatLang } from "../domain/types";
import { errorSummary } from "../wizard/tool-schema";

export type LangClassifier = (text: string) => Promise<ChatLang | null>;

const QUESTION = "Which language is this message written in? Reply with only its ISO 639-1 code, or unknown.";

/** The model's reply as a code: case, spaces, quotes, backticks and a full stop around it are dropped; anything else must already be one. */
function codeOf(reply: string): ChatLang | null {
  const code = reply.trim().toLowerCase().replace(/^["'`*.\s]+|["'`*.\s]+$/g, "");
  return isChatLang(code) ? code : null;
}

export function makeLangClassifier(client: Anthropic, model: string): LangClassifier {
  return async (text) => {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: 5,
        // Thinking counts toward max_tokens and would use up the five before the answer, so it is off: claude-haiku-5-5 accepts
        // that up to effort high. No server-side `fallbacks`: none exists for the small model.
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        system: QUESTION,
        messages: [{ role: "user", content: [{ type: "text", text }] }],
      });
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
