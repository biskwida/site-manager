import type { Category, ChatLang, Item, Lang, Weekday } from "./types";

/**
 * Plain English words; two different ones in a text without Cyrillic show English. Not on the list on purpose: a, i, be, are, post
 * and set, because Bulgarian typed in Latin letters uses them too (а, и, бе, аре, пост, сет: "pusni post i story v instagram").
 */
const ENGLISH_WORDS: ReadonlySet<string> = new Set([
  "the", "an", "is", "was", "to", "for", "of", "and", "or", "in", "on", "at", "with", "from", "it", "this", "that",
  "my", "our", "we", "you", "please", "can", "could", "would", "will",
  "make", "add", "remove", "change", "put", "show", "price", "today", "tomorrow", "closed", "open", "sold", "out",
  "what", "how", "when", "why",
  // Words of the photo flow (24 Oct 2026): "restyle this photo", "a nice picture" are three words, under the classifier's minimum, and
  // held only one listed word. None of these is used when Bulgarian is typed in Latin letters ("snimka", "sait", "oshte").
  "photo", "picture", "restyle", "website", "both", "yes", "nice", "beautiful", "aesthetic", "darker", "brighter", "more", "again",
]);

/** At least two different words of ENGLISH_WORDS, matched whole and in any case. */
function hasEnglishWords(text: string): boolean {
  const seen = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z']+/g) ?? []) {
    if (ENGLISH_WORDS.has(word)) seen.add(word);
    if (seen.size >= 2) return true;
  }
  return false;
}

/**
 * Bulgarian or English by the letters alone: "bg" when the text has any Cyrillic letter; "en" when it has none and at least two
 * different plain English words (ENGLISH_WORDS); null otherwise (a price, an emoji, a dish name, Bulgarian written in Latin letters
 * such as "kafeto e 4.20"). The two-language rule on its own: the owner's messages go through detectScriptLang, which tells more
 * languages apart, and a customer's comment through commentLang (src/social/comments-draft.ts), which also asks the classifier.
 */
export function detectLang(text: string): Lang | null {
  if (/\p{Script=Cyrillic}/u.test(text)) return "bg";
  return hasEnglishWords(text) ? "en" : null;
}

/**
 * Cyrillic letters that only some Cyrillic languages have, the most telling first; Cyrillic without any of them is Bulgarian.
 * ў (only Belarusian) is checked before ы э ё, which Belarusian writes too; ѓ ќ ѕ (Macedonian) before ј љ њ џ, which Macedonian
 * and Serbian share.
 */
const CYRILLIC_LANGS: readonly (readonly [RegExp, ChatLang])[] = [
  [/ў/iu, "be"],
  [/[ыэё]/iu, "ru"],
  [/[іїєґ]/iu, "uk"],
  [/[ѓќѕ]/iu, "mk"],
  [/[ћђјљњџ]/iu, "sr"],
];
/** The Cyrillic languages told apart by letters of their own (CYRILLIC_LANGS): be, ru, uk, mk, sr. */
const MARKED_CYRILLIC: ReadonlySet<ChatLang> = new Set(CYRILLIC_LANGS.map(([, lang]) => lang));
/** Scripts that name one language. Kana and Hangul come before Han: Japanese and Korean also write Chinese characters. */
const SCRIPT_LANGS: readonly (readonly [RegExp, ChatLang])[] = [
  [/\p{Script=Greek}/u, "el"],
  [/\p{Script=Arabic}/u, "ar"],
  [/\p{Script=Hebrew}/u, "he"],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "ja"],
  [/\p{Script=Hangul}/u, "ko"],
  [/\p{Script=Han}/u, "zh"],
  [/\p{Script=Thai}/u, "th"],
  [/\p{Script=Georgian}/u, "ka"],
  [/\p{Script=Armenian}/u, "hy"],
  [/\p{Script=Devanagari}/u, "hi"],
];
const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

/**
 * The language a text shows by its letters, or null when it shows none (a price, an emoji, a dish name, Bulgarian typed in Latin
 * letters, Latin text the English words cannot place). The letters are not always the last word: src/bot/inbound.ts asks the
 * classifier first about an owner's Latin text of four words or more and about marker-less Cyrillic of four words or more from a member
 * not stored as Bulgarian, and src/social/comments-draft.ts about a customer's Latin comment of two words or more:
 * 1. Cyrillic: Russian, Ukrainian, Belarusian, Macedonian or Serbian by the letters only they have (CYRILLIC_LANGS), else Bulgarian;
 *    but Cyrillic without such a letter is null for a member whose `current` language is one of those five, who keeps it
 *    ("Добавь пиццу" has no Russian-only letter).
 * 2. Greek, Arabic, Hebrew, Japanese, Korean, Chinese, Thai, Georgian, Armenian or Hindi by the script (SCRIPT_LANGS).
 * 3. Latin: English with two different plain English words (ENGLISH_WORDS).
 * Those English words win over another script when Latin letters are the majority: "change the price of Капучино to 4.20" names
 * a dish, it is English; "Flat white свърши" (no listed word) is Bulgarian.
 */
export function detectScriptLang(text: string, current?: ChatLang | null): ChatLang | null {
  const latin = count(text, /\p{Script=Latin}/gu);
  if (hasEnglishWords(text) && latin > count(text, /\p{L}/gu) - latin) return "en";
  if (/\p{Script=Cyrillic}/u.test(text)) {
    const marked = CYRILLIC_LANGS.find(([re]) => re.test(text))?.[1];
    if (marked) return marked;
    return current && MARKED_CYRILLIC.has(current) ? null : "bg";
  }
  return SCRIPT_LANGS.find(([re]) => re.test(text))?.[1] ?? null;
}

/** Whether every letter of a text is Latin, and it has at least one: no Cyrillic, Greek, Han or other letters. */
export function isLatinText(text: string): boolean {
  const latin = count(text, /\p{Script=Latin}/gu);
  return latin > 0 && latin === count(text, /\p{L}/gu);
}

/**
 * Cyrillic that no letter of CYRILLIC_LANGS marks and that English words do not win: what detectScriptLang calls Bulgarian
 * when it knows nothing else. Bulgarian has no letter Russian lacks, so such text can be either (src/bot/inbound.ts asks).
 */
export function isMarkerlessCyrillic(text: string): boolean {
  return detectScriptLang(text) === "bg";
}

/** The hand-written texts a conversation language starts from: Bulgarian for Bulgarian, English for every other language. */
export function baseLang(chat: ChatLang): Lang {
  return chat === "bg" ? "bg" : "en";
}

let languageNames: Intl.DisplayNames | undefined;
/** The English name of a conversation language ("de" → "German"), for the agent; the code itself when it is not a known one. */
export function languageName(code: ChatLang): string {
  try {
    languageNames ??= new Intl.DisplayNames(["en"], { type: "language" });
    return languageNames.of(code) ?? code;
  } catch {
    return code; // not a well-formed code
  }
}

/** Words written in Latin letters ("don't" is one word); numbers, emoji and other scripts do not count. */
export function countLatinWords(text: string): number {
  return count(text, /\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu);
}

/** A run of letters with the marks on them; an apostrophe between letters joins two runs ("don't" is one). */
const LETTER_RUN = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
let wordSegmenter: Intl.Segmenter | undefined;
/**
 * Words in letters of any script ("Flat white свърши днес" is four); numbers and emoji do not count. A run of letters is one word, which
 * is all there is to text in Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari and the like, or in Hangul alone: those count as they
 * always did. Chinese, Japanese, Thai, Lao, Khmer and Burmese are written without spaces, so a whole sentence is one run; each run is cut
 * into the words Intl.Segmenter finds in it, counting the segments that have a letter. The same cut falls where Hangul touches letters
 * of another script with no space ("삼성Galaxy" is two words, it was one), so counts rise only there and in those scripts. The segmenter
 * runs on the runs and not on the whole text because it joins letters around a ".", ":", "_" or digits ("Mr.Smith", "x2y3" are one
 * segment to it), which would change what text in the other scripts counts.
 */
export function countWords(text: string): number {
  wordSegmenter ??= new Intl.Segmenter("en", { granularity: "word" }); // "en": the root rules, whatever locale the server runs in
  let words = 0;
  for (const run of text.match(LETTER_RUN) ?? []) for (const part of wordSegmenter.segment(run)) if (/\p{L}/u.test(part.segment)) words++;
  return words;
}

export function tr(lang: Lang, bg: string, en: string): string {
  return lang === "bg" ? bg : en;
}

const KEEP_MARKERS = /[⟦⟧]/g;
/**
 * Text a translation must leave as written, inside a chat text: a dish or category name, the owner's quoted words, a caption, a
 * customer's comment or a reply drafted for one ("⟦Flat white⟧"). Only chat texts are marked (previews, proposals, statuses): the
 * same names on a website, in the wizard or on the dashboard never are, so itemName, categoryName and quote stay plain. Markers
 * inside the text are dropped, so kept parts never nest, and empty text stays empty. src/bot/translate.ts keeps these parts and
 * removes the markers before anything is sent.
 */
export function keep(text: string): string {
  const plain = unkeep(text);
  return plain ? `⟦${plain}⟧` : "";
}

/** The text without keep markers: what the owner reads in the chat, and what the dashboard and the draft banner show. */
export function unkeep(text: string): string {
  return text.replace(KEEP_MARKERS, "");
}

/** A change set's summaries and previews without keep markers, as the dashboard and the draft banner show them; the stored chat texts keep theirs. */
export function unkeepTexts<T extends Record<"summary_bg" | "summary_en" | "preview_bg" | "preview_en", string>>(cs: T): T {
  return { ...cs, summary_bg: unkeep(cs.summary_bg), summary_en: unkeep(cs.summary_en), preview_bg: unkeep(cs.preview_bg), preview_en: unkeep(cs.preview_en) };
}

/** "2,90 €" (bg) / "€2.90" (en). */
export function formatPrice(eur: number, lang: Lang): string {
  const fixed = eur.toFixed(2);
  return lang === "bg" ? `${fixed.replace(".", ",")} €` : `€${fixed}`;
}

export function itemName(i: Pick<Item, "name_bg" | "name_en">, lang: Lang): string {
  return (lang === "bg" ? i.name_bg : i.name_en) || i.name_bg || i.name_en;
}

export function categoryName(c: Pick<Category, "name_bg" | "name_en">, lang: Lang): string {
  return (lang === "bg" ? c.name_bg : c.name_en) || c.name_bg || c.name_en;
}

const DAYS: Record<Weekday, { bg: string; en: string }> = {
  mon: { bg: "пон", en: "Mon" },
  tue: { bg: "вт", en: "Tue" },
  wed: { bg: "ср", en: "Wed" },
  thu: { bg: "четв", en: "Thu" },
  fri: { bg: "пет", en: "Fri" },
  sat: { bg: "съб", en: "Sat" },
  sun: { bg: "нед", en: "Sun" },
};
export function weekdayLabel(day: Weekday, lang: Lang): string {
  return DAYS[day][lang];
}

/** Typographic quotes per language. */
export function quote(text: string, lang: Lang): string {
  return lang === "bg" ? `„${text}“` : `“${text}”`;
}
