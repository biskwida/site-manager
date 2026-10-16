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
- English: no Cyrillic and at least 2 different words from this list, matched whole and case-insensitively: the, a, an, is, are, was, be, to, for, of, and, or, in, on, at, with, from, it, this, that, my, our, we, i, you, please, can, could, would, will, make, add, remove, change, set, put, show, post, price, today, tomorrow, closed, open, sold, out, what, how, when, why. Anything else is `null` and keeps the current language (prices, emoji, dish names, Bulgarian written in Latin letters such as "kafeto e 4.20").
- A detected language different from `member.lang` is saved (`setMemberLang`) before the run starts.
- `/lang bg|en` still sets the language; the next message that shows the other language switches it again.
- Speech-to-text: no forced language; Bulgarian or English from the transcriber's `language` field; Russian, Macedonian, Serbian, Ukrainian or Belarusian → transcribe again with `bg`; any other language → transcribe again with the stored language; no `language` field → `detectLang(text)`.

## Review Focus

1. Mixed message "Flat white свърши": Cyrillic wins → Bulgarian. Test in Task 1.
2. Bulgarian in Latin letters "pusni post v instagram" (one listed word): stays as it was. Test in Task 1.
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

### Task 3: Voice notes are transcribed in the language spoken

**Files:**
- Modify: `src/bot/voice.ts`
- Modify: `src/bot/inbound.ts` (the voice path uses the returned language)
- Modify: the fake transcribers in `test/inbound.test.ts` (and any other test that builds one) to the new `{ text, lang }` result
- Test: `test/voice.test.ts`, `test/inbound.test.ts`

**Interfaces:**
- Produces: `type Transcriber = (bytes: Uint8Array, fallback: Lang, contentType?: string) => Promise<{ text: string; lang: Lang | null }>`.
- Produces: `sttLang(language: string | undefined): Lang | "bg-family" | "other" | null` in `src/bot/voice.ts` ("bulgarian"/"bg" → bg; "english"/"en" → en; russian, macedonian, serbian, ukrainian, belarusian or their codes → "bg-family"; any other → "other"; missing → null).

- [ ] **Step 1: Write the failing tests**

```ts
it("asks without a language and reads it back", async () => { /* fake client: first call has no language and response_format "verbose_json"; returns { text, language: "bulgarian" } → { text, lang: "bg" } */ });
it("transcribes again in Bulgarian when Russian is detected", async () => { /* first { language: "russian" } → second call language "bg" → lang "bg" */ });
it("uses the fallback for any other language", async () => { /* { language: "german" } → second call language = fallback */ });
it("without a language field it detects from the text", async () => { /* { text: "make it a story please" } → lang "en" */ });
it.each([["Bulgarian", "bg"], ["en", "en"], ["mk", "bg-family"], ["german", "other"], [undefined, null]])("sttLang(%s)", (s, r) => expect(sttLang(s)).toBe(r));
// test/inbound.test.ts
it("a voice note uses the language the transcriber heard", async () => { /* member "bg", transcriber { text: "make it a story please", lang: "en" } → member saved "en" */ });
```

- [ ] **Step 2: Run** `npx vitest run test/voice.test.ts test/inbound.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement** in `makeTranscriber` (widen the `SttClient` type for `response_format` and the optional `language` field); the inbound voice path uses `detected = r.lang ?? detectLang(r.text)`.
- [ ] **Step 4: Run** `npx vitest run` — expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Voice: no forced language; Bulgarian or English read back from the transcriber"`

---

### Task 4: Previews, captions and pictures in one language

**Files:**
- Modify: `src/domain/preview.ts` (new item, holiday, announcement, texts)
- Modify: `src/agent/social-tools.ts` (caption description), `src/agent/visual-tools.ts` (price and line descriptions), `src/agent/prompt.ts` (rule 4 and a new language rule)
- Test: `test/preview.test.ts`, `test/prompt.test.ts` (or the file that checks rule numbering), `test/comments-draft.test.ts`

**Interfaces:**
- Produces: preview lines without the other language; one note line per change set that writes both languages: bg "(английският вариант за сайта е написан автоматично)", en "(the Bulgarian version for the site was written automatically)".

- [ ] **Step 1: Write the failing tests**

```ts
it("a new dish previews in Bulgarian only", () => {
  const text = previewText(siteWith(...), [addItem({ name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "Двойно еспресо", desc_en: "Double espresso" })], "bg");
  expect(text).not.toMatch(/Cappuccino|Double espresso|EN:/);
  expect(text).toContain("(английският вариант за сайта е написан автоматично)");
});
it("a holiday and an announcement preview in English only", () => { /* lang "en" → no Cyrillic in the text; the English note line once */ });
it("the prompt tells the agent to write only in the owner language", () => { expect(SYSTEM_PROMPT).toMatch(/never mix in the other language/i); });
it("the social_post caption defaults to the owner language", () => { expect(SocialPostSchema.shape.caption.description).toMatch(/owner'?s current language/i); });
it("a customer comment in English: the proposal wrapper is Bulgarian, the draft English", async () => { /* owner lang bg, comment "Do you have oat milk?" → wrapper lines Cyrillic, draft Latin */ });
```

- [ ] **Step 2: Run** `npx vitest run test/preview.test.ts test/prompt.test.ts test/comments-draft.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement.** In `preview.ts`, drop the `/ ${other}` halves and the other-language description line; append the note line once when any change writes both languages. In the tool descriptions, caption and picture text "in the owner's current language (the Owner language line) unless the owner asks for another language or gives the text". In `prompt.ts`, add after the existing rules: "Language: write every reply, question and caption in the Owner language; never mix in the other language, except quoting the owner, quoting a customer, or a reply drafted for a customer in the customer's language." Keep rule numbers continuous.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit -p . && npm run -s lint` — expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Previews, captions and pictures speak the owner's language only"`
