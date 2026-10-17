# Conversation Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claudia speaks only the language the owner is using: if the owner writes or speaks Bulgarian, nothing Claudia sends is in English until the owner writes or speaks English.

**Architecture:** The member's stored `lang` becomes "the language of the owner's last message that showed one". Every inbound text, caption and voice note updates it; everything already reads `member.lang` (turn replies, previews, buttons, statuses, and the tick's reminders, digests and comment proposals through `langFor`). English detection is added to `detectLang`, voice notes stop forcing the stored language on the transcriber, previews stop printing the other language, and captions and picture text default to the conversation language.

**Tech Stack:** TypeScript, vitest; OpenAI-compatible speech-to-text (Groq by default).

**Spec:** the owner's rule from chat on 16 October 2026 (below).

### Rule (owner, 16 October 2026)

"Proposing, answering, everything in the same language you talk to it, so if I start talking Bulgarian I see nothing in English until I start writing or talking English."

**What the rule covers:** replies, proposal previews, buttons, status lines, reminders, digests, comment-reply proposals, error lines, and post captions and picture text by default.

**Exceptions:**
- A reply to a customer's comment is drafted in the customer's language, because the customer reads it. The proposal around it is in the owner's language.
- The website still stores both languages. Claudia writes the other language automatically; previews show only the owner's language plus one short line saying the other version was written.
- The owner's own words and a customer's comment are quoted as written.

## Global Constraints

- Bulgarian: any Cyrillic letter (unchanged).
- English: no Cyrillic and at least 2 different words from this list, matched whole and case-insensitively: the, an, is, was, to, for, of, and, or, in, on, at, with, from, it, this, that, my, our, we, you, please, can, could, would, will, make, add, remove, change, put, show, price, today, tomorrow, closed, open, sold, out, what, how, when, why. (Ruling 2026-10-16: a, i, be, are, post and set removed because Bulgarian typed in Latin letters uses them.) Anything else is `null` and keeps the current language (prices, emoji, dish names, Bulgarian written in Latin letters such as "kafeto e 4.20").
- A detected language different from `member.lang` is saved (`setMemberLang`) before the run starts.
- `/lang bg|en` still sets the language; the next message that shows the other language switches it again.
- Speech-to-text: no forced language; Bulgarian or English from the transcriber's `language` field; Russian, Macedonian, Serbian, Ukrainian or Belarusian → transcribe again with `bg`; any other language → transcribe again with the stored language; no `language` field → `detectLang(text)`.

## Review Focus

1. Mixed message "Flat white свърши": Cyrillic wins → Bulgarian. Test in Task 1.
2. Bulgarian in Latin letters "pusni post i story v instagram" (no counted words after the ruling): stays as it was. Test in Task 1.
3. Tick after a switch: the owner wrote English, the next reminder or comment proposal arrives in English. Test in Task 2.
4. A photo without a caption or a "4.20" text: the language does not change. Test in Task 2.
5. An English customer comment while the owner speaks Bulgarian: the wrapper is Bulgarian, the draft English. Test in Task 4.

---

### Task 1: detectLang recognises English

**Files:**
- Modify: `src/domain/format.ts`
- Test: `test/format.test.ts` (extend; create if absent)

**Interfaces:**
- Produces: `detectLang(text: string): Lang | null`, same signature, now returns `"en"` by the rule in Global Constraints.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ["Капучиното е 4,20", "bg"],
  ["Flat white свърши", "bg"],
  ["change the price of the cappuccino to 4.20", "en"],
  ["make it a story", "en"],
  ["4.20", null],
  ["Flat white 4.30", null],
  ["kafeto e 4.20", null],
  ["pusni post v instagram", null],
  ["ok 👍", null],
])("detectLang(%s) = %s", (text, lang) => expect(detectLang(text)).toBe(lang));
```

- [ ] **Step 2: Run** `npx vitest run test/format.test.ts` — expected: FAIL on the English rows.
- [ ] **Step 3: Implement** in `detectLang` with a module-level `Set` of the listed words and `text.toLowerCase().match(/[a-z']+/g)`.
- [ ] **Step 4: Run** — expected: PASS. Then `npx vitest run` — any test that relied on Latin text keeping `bg` is updated to the new rule, with the reason in the commit message.
- [ ] **Step 5: Commit** `git commit -m "detectLang: English needs two plain English words; Latin-letter Bulgarian keeps the current language"`

---

### Task 2: The owner's last language is remembered

**Files:**
- Modify: `src/bot/inbound.ts` (text, photo caption and voice paths; `/connect`)
- Test: `test/inbound.test.ts`, `test/tick.test.ts`

**Interfaces:**
- Consumes: `detectLang` (Task 1); `Store.setMemberLang` (exists).
- Produces: `followLanguage(d: BotDeps, member: Member, detected: Lang | null): Promise<Member>` in `src/bot/inbound.ts`: saves and returns the member with the new `lang` when `detected` differs, otherwise returns it unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it("a Bulgarian message saves bg for a member stored as en", async () => { /* member.lang "en", text "Капучиното е 4,20" → store member lang "bg"; the run's member.lang "bg" */ });
it("an English message saves en", async () => { /* member "bg", text "change the price to 4.20" → "en" */ });
it("a price or an uncaptioned photo changes nothing", async () => { /* "4.20" and a photo without caption → setMemberLang not called */ });
it("a voice note in Bulgarian saves bg", async () => { /* fake transcriber returns "капучиното е 4,20" (today's string result) → "bg" */ });
```

In `test/tick.test.ts`: `it("a reminder after the owner switched to English is in English", …)` — member stored `bg`, an inbound English message, then `runTick` → the reminder text is the English copy.

- [ ] **Step 2: Run** `npx vitest run test/inbound.test.ts test/tick.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement** `followLanguage` and call it in the text, photo-caption and voice paths (and for `/connect`'s detection) before `startRun`; pass the returned member to the run.
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Inbound: the owner's last language is saved, so proactive messages follow it"`

---

## Amendment (owner, 16 October 2026): every language, for chat and posts

The owner asked "fix it for all languages" and chose **chat and posts** (the website stays Bulgarian + English). Tasks 1–2 stand. The old Tasks 3–4 are replaced by Tasks 3–6 below.

**What changes:**
- The owner's conversation language can be any language (ISO 639-1 code), not just bg/en: replies, proposals, buttons, statuses, reminders and digests come in it.
- Bulgarian and English keep their hand-written texts. Every other language gets Claudia's fixed texts translated by a small model, once, then reused from a database cache.
- Dish names, quoted text, captions, customer comments and drafts addressed to customers are never translated.
- Captions default to the owner's language; picture text too, when the picture fonts cover its script (Latin and Cyrillic); otherwise the picture text is English and the caption is in the owner's language.
- Replies to customer comments are drafted in the commenter's language, whatever it is.

### Amended Global Constraints

- `ChatLang` = a lower-case ISO 639-1 code (`/^[a-z]{2}$/`). `Member.lang` becomes `ChatLang`; `Lang` ("bg" | "en") stays for site content and the hand-written copy. `baseLang(chat: ChatLang): Lang` = "bg" for "bg", otherwise "en".
- Database: `venue_members.lang` check widens from `in ('bg','en')` to `~ '^[a-z]{2}$'` (migration `supabase/migrations/2026-10-16-chat-lang.sql`, schema.sql updated); new table `translations (lang text, source_hash text, text text, created_at timestamptz, primary key (lang, source_hash))`, server-only (RLS on, no policies), in the same migration.
- Detection order for text (links are removed first, Task 2 ruling): (1) Cyrillic: letters ы э ё → "ru"; і ї є ґ → "uk"; ў → "be"; ѓ ќ ѕ → "mk"; ћ ђ → "sr"; ј љ њ џ without ѓ/ќ/ѕ → "sr"; otherwise "bg", except that a member stored as ru, uk, be, mk or sr keeps their language on Cyrillic without a marker letter (null). Two listed English words win over any other script when Latin letters are the majority ("change the price of Капучино to 4.20" → "en"). (2) Other scripts: Greek → "el"; Arabic → "ar"; Hebrew → "he"; Hiragana or Katakana → "ja"; Hangul → "ko"; Han only → "zh"; Thai → "th"; Georgian → "ka"; Armenian → "hy"; Devanagari → "hi". (3) Latin: the Task 1 English rule. (4) The classifier model is asked first, and its answer wins when it is the valid code of a known language ("en" included), for: Latin-only text of 4 or more Latin words; Cyrillic without a marker letter (English not winning) of 4 or more words in any script, from a member not stored as "bg" (a "bg" member never triggers the call). When it answers unknown, an invalid or unknown code, fails, times out or is not configured, (1)–(3) decide: the English rule for Latin text; for marker-less Cyrillic, null for ru/uk/be/mk/sr members and "bg" for the rest. Latin text of 2–3 words goes by the English rule only. The classifier reads at most the first 300 characters of the text, waits at most 3 s and is not retried (`{ timeout: 3000, maxRetries: 0 }`); it is never asked about voice transcripts or strangers' messages (fix rounds 1–2 of Task 3).
- Telegram's `language_code` at linking may be any language: normalised to its first two letters, lower case ("pt-br" → "pt").
- Models: `TRANSLATE_MODEL` and `LANG_CLASSIFY_MODEL` env, default `claude-haiku-5-5`.
- Never translated: text inside keep markers `⟦…⟧` (the markers are removed before sending, for every language); agent free-text replies (sent with `verbatim: true`, already in the owner's language).
- A failed translation or classification never blocks a message: send the base-language text; keep the current language.

### Task 3: Any conversation language (type, database, detection)

**Files:**
- Modify: `src/domain/types.ts` (`ChatLang`, `Member.lang`), `src/domain/format.ts` (`baseLang`, `languageName`, `detectScriptLang`), `src/bot/inbound.ts` (detection pipeline, linking hint), `src/bot/bot.ts` (hint normalisation), `src/agent/prompt.ts` ("Owner language" line), `src/server/deps.ts` (classifier wiring), `src/config.ts`
- Create: `src/bot/lang-classify.ts`, `supabase/migrations/2026-10-16-chat-lang.sql`
- Modify: `supabase/schema.sql`, both stores where `lang` is validated
- Test: `test/format.test.ts`, `test/inbound.test.ts`, `test/lang-classify.test.ts`, `test/prompt.test.ts`

**Interfaces:**
- Produces: `type ChatLang = string` (validated by `isChatLang(s): s is ChatLang`), `baseLang(chat: ChatLang): Lang`, `languageName(code: ChatLang): string` (English name via `Intl.DisplayNames(["en"], { type: "language" })`, the code itself when unknown), `detectScriptLang(text: string): ChatLang | null` (steps 1–3 of the detection order), `makeLangClassifier(client, model): (text: string) => Promise<ChatLang | null>`.
- Changes: `followLanguage(d, member, detected: ChatLang | null)` (from Task 2).

- [ ] **Step 1: Failing tests**

```ts
it.each([["Капучиното е 4,20", "bg"], ["Это кофе", "ru"], ["Ще піду", "uk"], ["Кафето е ѓубре", "mk"], ["Ђе је кафа", "sr"], ["Ο καφές", "el"], ["コーヒー", "ja"], ["커피", "ko"], ["咖啡", "zh"], ["change the price to 4.20", "en"], ["Flat white 4.30", null]])("detectScriptLang(%s)", (t, l) => expect(detectScriptLang(t)).toBe(l));
it("baseLang", () => { expect(baseLang("bg")).toBe("bg"); expect(baseLang("de")).toBe("en"); });
it("languageName", () => { expect(languageName("de")).toBe("German"); expect(languageName("el")).toBe("Greek"); });
// lang-classify: fake client returns "de" → "de"; "unknown" or "xx1" → null; a thrown error → null
// inbound: member "bg"; "Ich möchte den Preis ändern" with a classifier returning "de" → saved "de"; "Flat white 4.30" → classifier not called
// inbound: linking with Telegram language_code "pt-BR" → member lang "pt"
// prompt: Owner language line reads "Owner language: German." for "de"
```

- [ ] **Step 2: Run** `npx vitest run test/format.test.ts test/inbound.test.ts test/lang-classify.test.ts test/prompt.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** Widen `Member.lang`; let `npx tsc --noEmit -p .` list every place a `ChatLang` reaches a `Lang` parameter and pass `baseLang(...)` there (copy tables, `tr`, previews, buttons). Migration: drop the old check, add the new one; create `translations` (used by Task 5). The classifier prompt: "Which language is this message written in? Reply with only its ISO 639-1 code, or unknown." with `max_tokens` 5.
- [ ] **Step 4: Run** the full suite, tsc, lint — expected PASS.
- [ ] **Step 5: Commit** `git commit -m "Language: any conversation language, detected by script, English words or a small classifier"`

### Task 4: Voice notes in any language

**Files:** Modify `src/bot/voice.ts`, `src/bot/inbound.ts`; Test `test/voice.test.ts`, `test/inbound.test.ts` (fake transcribers move to the new result shape)

**Interfaces:**
- Produces: `type Transcriber = (bytes: Uint8Array, fallback: Lang, contentType?: string) => Promise<{ text: string; lang: ChatLang | null }>`; `whisperLang(name: string | undefined): ChatLang | null` (Whisper language names or codes → ISO 639-1; "bulgarian" → "bg", "german" → "de", "greek" → "el"; unknown → null).

- [ ] **Step 1: Failing tests**

```ts
it("asks without a language and maps the language it heard", async () => { /* no `language` param, response_format "verbose_json"; { language: "german" } → { lang: "de" } and no second call */ });
it("Russian-labelled speech with no Russian-only letters is transcribed again as Bulgarian", async () => { /* { language: "russian", text: "кафето е готово" } → second call language "bg" → lang "bg" */ });
it("Russian speech with ы stays Russian", async () => { /* { language: "russian", text: "мы открыты" } → lang "ru", one call */ });
it("no language field → detect from the text", async () => { /* { text: "make it a story please" } → "en" */ });
// inbound: transcriber { text: "Ich möchte…", lang: "de" } → member saved "de"
```

- [ ] **Step 2–4:** run `npx vitest run test/voice.test.ts test/inbound.test.ts`, implement (the Cyrillic family check reuses `detectScriptLang` on the transcript), run the full suite.
- [ ] **Step 5: Commit** `git commit -m "Voice: transcribed in the language spoken, any language"`

### Task 5: Translation of Claudia's fixed texts

**Files:**
- Create: `src/bot/translate.ts` (translator + `withTranslation` messenger wrapper)
- Modify: `src/bot/messenger.ts` (`SendOpts.verbatim?: boolean`), `src/server/deps.ts` (wrap the `ChannelRouter`), `src/store/types.ts` + `memory.ts` + `supabase.ts` (`getTranslation(lang, hash)`, `putTranslation(lang, hash, text)`), `src/domain/format.ts` (`keep(text)`; `quote`, `itemName`, `categoryName` return kept text), `src/agent/run.ts` (the agent's final reply is sent with `verbatim: true`), `src/social/comment-preview.ts` or wherever the customer comment and the draft are quoted (wrap both in `keep`)
- Test: `test/translate.test.ts`, `test/store-contract.ts`, `test/run.test.ts` (or the agent run test file)

**Interfaces:**
- Produces: `keep(text: string): string` (`⟦text⟧`), `unkeep(text: string): string` (removes the markers), `makeTranslator(client, model, store): (text: string, to: ChatLang) => Promise<string>` (hash = sha256 of the text; cache read before the model; cache write after; on any error returns the input), `withTranslation(inner: Messenger, d: { store: Store; translate: Translator }): Messenger`.
- Behaviour: for a member whose `lang` is "bg" or "en", or `opts.verbatim`, the wrapper only removes keep markers; otherwise it translates the text (and photo captions, proposal text, button labels, `conclude` and `edit` texts) into the member's language, then removes the markers. Unknown chat ref → no translation.

- [ ] **Step 1: Failing tests**

```ts
it("a German member gets translated text with kept parts unchanged", async () => { /* translate fake maps "Price ⟦Cappuccino⟧ → €4.20" to "Preis ⟦Cappuccino⟧ → €4.20"; sent text "Preis Cappuccino → €4.20" */ });
it("a Bulgarian member gets the text untouched, markers removed", async () => {});
it("verbatim replies are not translated", async () => {});
it("the cache answers the second time without the model", async () => { /* model called once for two identical sends */ });
it("a failing model sends the English text", async () => {});
it("proposal buttons are translated for a German member", async () => {});
```

- [ ] **Step 2–4:** run `npx vitest run test/translate.test.ts`, implement, run the full suite (existing tests that compare exact sent text must still pass: markers are always removed).
- [ ] **Step 5: Commit** `git commit -m "Translation: Claudia's fixed texts in any language, cached; names and quotes kept"`

### Task 6: Previews, captions, pictures and comment replies

(Old Task 4, extended.)

**Files:** Modify `src/domain/preview.ts`, `src/agent/social-tools.ts` (caption description), `src/agent/visual-tools.ts` (dish/line/price descriptions), `src/agent/prompt.ts` (language rule), `src/social/comments-draft.ts` (`commentLang` returns `ChatLang` via `detectScriptLang` and the classifier for Latin text; drafts in that language); Test `test/preview.test.ts`, `test/prompt.test.ts`, `test/comments-draft.test.ts`

- [ ] **Step 1: Failing tests**

```ts
it("a new dish previews in Bulgarian only", () => { /* no "Cappuccino", "Double espresso" or "EN:"; contains "(английският вариант за сайта е написан автоматично)" */ });
it("a holiday and an announcement preview in English only", () => { /* no Cyrillic; the English note "(the Bulgarian version for the site was written automatically)" once */ });
it("the prompt tells the agent to write only in the owner language", () => { expect(SYSTEM_PROMPT).toMatch(/never mix in another language/i); });
it("captions default to the owner language", () => { expect(SocialPostSchema.shape.caption.description).toMatch(/owner'?s current language/i); });
it("picture text falls back to English for scripts the picture fonts lack", () => { expect(MakeVisualSchema.shape.dish.description).toMatch(/Latin or Cyrillic/); });
it("a German comment gets a German draft", async () => { /* commentLang("Habt ihr Hafermilch?") with a classifier returning "de" → "de" */ });
it("an English comment while the owner speaks Bulgarian: wrapper Bulgarian, draft English", async () => {});
```

- [ ] **Step 2–4:** run `npx vitest run test/preview.test.ts test/prompt.test.ts test/comments-draft.test.ts`, implement (previews: drop the `/ ${other}` halves and the other-language description line; append the note once when a change writes both site languages; prompt rule: "Language: write every reply, question and caption in the Owner language; never mix in another language, except quoting the owner, quoting a customer, or a reply drafted for a customer in the customer's language. Picture text is in the Owner language when it uses Latin or Cyrillic letters, otherwise English."), run the full suite, tsc, lint.
- [ ] **Step 5: Commit** `git commit -m "Previews, captions, pictures and comment replies in the right language"`

### Amended Review Focus

1. A Bulgarian owner whose Telegram is set to English writes Bulgarian: everything switches to Bulgarian, including the next reminder (Task 2 test).
2. Bulgarian typed in Latin letters: no switch; the classifier may answer "bg" (fine) — test with a fake classifier answering "bg" (Task 3).
3. A German owner: the proposal arrives in German with the dish name unchanged and the caption unchanged (Task 5 test).
4. The translation model is down: the English text is sent (Task 5 test).
5. A Russian-labelled Bulgarian voice note: transcribed as Bulgarian (Task 4 test).
