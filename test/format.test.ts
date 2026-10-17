import { describe, expect, it } from "vitest";
import { baseLang, countLatinWords, countWords, detectLang, detectScriptLang, isLatinText, isMarkerlessCyrillic, languageName } from "@/src/domain/format";
import { isChatLang } from "@/src/domain/types";

describe("detectLang", () => {
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

  it("says nothing for an empty or blank message", () => {
    expect(detectLang("")).toBeNull();
    expect(detectLang("   ")).toBeNull();
  });

  it("lets any Cyrillic letter win over English words", () => {
    expect(detectLang("change the price на капучиното to 4.20")).toBe("bg");
  });

  it("needs two different listed words: one word, or the same word again, is not enough", () => {
    expect(detectLang("open")).toBeNull();
    expect(detectLang("Please")).toBeNull();
    expect(detectLang("the the the")).toBeNull();
    expect(detectLang("the price")).toBe("en");
  });

  it("matches whole words and ignores case", () => {
    expect(detectLang("MAKE IT A STORY")).toBe("en");
    expect(detectLang("Please Add oat milk")).toBe("en");
    // "to", "an", "open" and "in" sit inside these words but are not the words themselves
    expect(detectLang("tomato another opening inside")).toBeNull();
  });

  it("counts every word of the list", () => {
    const listed = [
      "the", "an", "is", "was", "to", "for", "of", "and", "or", "in", "on", "at", "with", "from", "it", "this", "that",
      "my", "our", "we", "you", "please", "can", "could", "would", "will",
      "make", "add", "remove", "change", "put", "show", "price", "today", "tomorrow", "closed", "open", "sold", "out",
      "what", "how", "when", "why",
    ];
    expect(listed).toHaveLength(43);
    const missed = listed.filter((word) => detectLang(`${word} ${word === "the" ? "please" : "the"}`) !== "en");
    expect(missed).toEqual([]);
  });

  // Bulgarian typed in Latin letters uses these six too (а, и, бе, аре, пост, сет), so they are not on the list.
  it.each(["a", "i", "be", "are", "post", "set"])("the word %s does not count towards English", (word) => {
    expect(detectLang(`the ${word}`)).toBeNull();
  });

  it.each([
    "pusni post i story v instagram",
    "napravi story, a ne post",
    "promeni cenata na kafeto na 4.20 i pusni post",
    "dobavi set za dvama i post",
    "are be, ne e taka",
  ])("Bulgarian typed in Latin letters stays null: %s", (text) => expect(detectLang(text)).toBeNull());

  it("still finds English that does not lean on those words", () => {
    expect(detectLang("are you open today")).toBe("en"); // you + open + today
    expect(detectLang("post it on instagram")).toBe("en"); // it + on
    expect(detectLang("make it a story")).toBe("en"); // make + it
    expect(detectLang("make a story")).toBeNull(); // "a" is not a second word
  });
});

describe("detectScriptLang", () => {
  it.each([["Капучиното е 4,20", "bg"], ["Это кофе", "ru"], ["Ще піду", "uk"], ["Кафето е ѓубре", "mk"], ["Ђе је кафа", "sr"], ["Ο καφές", "el"], ["コーヒー", "ja"], ["커피", "ko"], ["咖啡", "zh"], ["change the price to 4.20", "en"], ["Flat white 4.30", null]])("detectScriptLang(%s)", (t, l) => expect(detectScriptLang(t)).toBe(l));

  it.each([
    ["Мы открыты до 22:00", "ru"],
    ["ЭТО КОФЕ", "ru"],
    ["Ёлка у входа", "ru"],
    ["Їжа готова", "uk"],
    ["Єдина кава", "uk"],
    ["Ґанок", "uk"],
    ["Ў нас кава", "be"],
    ["Кава скончылася ў нас", "be"], // Belarusian writes ы too: ў, which only Belarusian has, decides
    ["Ѕвезда", "mk"],
    ["Ќе дојдам утре", "mk"], // ј alongside ќ is Macedonian, not Serbian
    ["Ћевапи су готови", "sr"],
    ["Љубав", "sr"],
    ["Његош", "sr"],
    ["Џем од јагода", "sr"],
    ["Дай ѝ кафе", "bg"],
    ["Баницата свърши", "bg"],
  ])("reads the Cyrillic letters only some languages have: %s → %s", (text, lang) => expect(detectScriptLang(text)).toBe(lang));

  it.each([
    ["مرحبا، القهوة جاهزة", "ar"],
    ["שלום, הקפה מוכן", "he"],
    ["抹茶ラテ", "ja"], // kanji with katakana is Japanese
    ["커피 珈琲", "ko"], // hanja with hangul is Korean
    ["กาแฟพร้อมแล้ว", "th"],
    ["ყავა მზადაა", "ka"],
    ["Սուրճը պատրաստ է", "hy"],
    ["कॉफी तैयार है", "hi"],
  ])("names the language of other scripts: %s → %s", (text, lang) => expect(detectScriptLang(text)).toBe(lang));

  it("lets English win over a dish named in another script, but only when the message is mostly English words", () => {
    expect(detectScriptLang("change the price of Капучино to 4.20")).toBe("en");
    expect(detectScriptLang("please add Μουσακάς to the menu at 12.50")).toBe("en");
    expect(detectScriptLang("Flat white свърши")).toBe("bg"); // no listed English word: any Cyrillic decides
    expect(detectScriptLang("смени цената на капучиното to 4.20 please")).toBe("bg"); // two English words, but more Cyrillic letters
    expect(detectScriptLang("Βάλε το flat white στο μενού")).toBe("el");
  });

  it("is null for what shows no language, and for Latin text the word list cannot place", () => {
    for (const text of ["", "   ", "4.20", "ok 👍", "kafeto e 4.20", "Ich möchte den Preis ändern", "pusni post i story v instagram"]) expect(detectScriptLang(text)).toBeNull();
  });

  it("goes by the English words alone for Latin text, so German with will and in reads as English (the classifier decides those)", () => {
    expect(detectScriptLang("Ich will den Preis in der Karte ändern")).toBe("en");
    expect(detectScriptLang("We zijn morgen open")).toBe("en");
  });

  it("keeps the stored language of a Russian, Ukrainian, Belarusian, Macedonian or Serbian speaker for Cyrillic without a marker letter", () => {
    for (const current of ["ru", "uk", "be", "mk", "sr"]) {
      expect(detectScriptLang("Добавь пиццу", current)).toBeNull();
      expect(detectScriptLang("Капучиното е 4,20", current)).toBeNull();
    }
    for (const current of ["bg", "en", "de", undefined, null]) expect(detectScriptLang("Добавь пиццу", current)).toBe("bg");
    expect(detectScriptLang("Ђе је кафа", "sr")).toBe("sr"); // a marker letter still decides
    expect(detectScriptLang("Мы открыты", "uk")).toBe("ru");
    expect(detectScriptLang("Ще піду", "ru")).toBe("uk");
    expect(detectScriptLang("change the price of Капучино to 4.20", "ru")).toBe("en"); // English words still win when Latin letters are the majority
  });
});

describe("isLatinText", () => {
  it("is true only when every letter is Latin", () => {
    for (const text of ["We zijn morgen open", "Ich möchte den Preis ändern", "change the price to 4.20 👍", "ça va"]) expect(isLatinText(text)).toBe(true);
    for (const text of ["", "4.20 👍", "change the price of Капучино to 4.20", "Ο καφές", "抹茶 latte"]) expect(isLatinText(text)).toBe(false);
  });
});

describe("conversation language helpers", () => {
  it("baseLang", () => { expect(baseLang("bg")).toBe("bg"); expect(baseLang("de")).toBe("en"); });
  it("baseLang keeps English and sends every other language to English", () => {
    for (const lang of ["en", "ru", "mk", "el", "zh"]) expect(baseLang(lang)).toBe("en");
  });

  it("languageName", () => { expect(languageName("de")).toBe("German"); expect(languageName("el")).toBe("Greek"); });
  it("languageName names Bulgarian and English as before, and gives back a code it does not know", () => {
    expect(languageName("bg")).toBe("Bulgarian");
    expect(languageName("en")).toBe("English");
    expect(languageName("pt")).toBe("Portuguese");
    expect(languageName("xx")).toBe("xx");
    expect(languageName("x1")).toBe("x1"); // malformed: no throw
  });

  it("isChatLang accepts only a lower-case two-letter code", () => {
    for (const ok of ["bg", "en", "de", "pt", "zh"]) expect(isChatLang(ok)).toBe(true);
    for (const bad of ["", "e", "PT", "pt-br", "pt_BR", "eng", "xx1", "d3", " de", null, undefined, 42]) expect(isChatLang(bad)).toBe(false);
  });

  it("countLatinWords counts runs of Latin letters, not numbers or other scripts", () => {
    expect(countLatinWords("Ich möchte den Preis ändern")).toBe(5);
    expect(countLatinWords("Flat white 4.30")).toBe(2);
    expect(countLatinWords("4.20 👍")).toBe(0);
    expect(countLatinWords("don't stop")).toBe(2);
    expect(countLatinWords("Капучиното е 4,20")).toBe(0);
  });
});

describe("isMarkerlessCyrillic and countWords", () => {
  it("isMarkerlessCyrillic: Cyrillic with no marker letter that English words do not win", () => {
    for (const text of ["Капучиното става три и двайсет", "Добавь пиццу в меню сегодня", "Flat white свърши днес"]) expect(isMarkerlessCyrillic(text)).toBe(true);
    for (const text of ["Мы открыты сегодня", "Ђе је кафа", "please change the price of Капучино to 4.20", "We zijn morgen open", "Ο καφές", "4.20", ""]) expect(isMarkerlessCyrillic(text)).toBe(false);
  });
  it("countWords counts words of any script, not numbers or emoji", () => {
    expect(countWords("Flat white свърши днес")).toBe(4);
    expect(countWords("Капучиното става три и двайсет")).toBe(5);
    expect(countWords("Баницата свърши днес 4,20 👍")).toBe(3);
    expect(countWords("don't stop")).toBe(2);
  });
  it("countWords: the counts the voice-note gate relies on (four words or more can switch the language)", () => {
    expect(countWords("make it a 4.20 😀")).toBe(3);
    expect(countWords("Thank you.")).toBe(2);
    expect(countWords("Продолжение следует")).toBe(2);
    expect(countWords("don’t do it now")).toBe(4);
  });
  it("countWords cuts a script written without spaces into the words it finds: one sentence is not one word", () => {
    // The least each sentence has (the segmenter finds 8 to 12 words in them), and a thank-you stays a few words at most: the exact count
    // is the ICU dictionary's, which changes between versions.
    const sentences: [string, number][] = [
      ["我想把卡布奇诺的价格改成四欧元", 6], // Chinese
      ["カプチーノの値段を四ユーロに変更してください", 6], // Japanese
      ["ฉันต้องการเปลี่ยนราคากาแฟเป็นสี่ยูโร", 5], // Thai
      ["ຂ້ອຍຕ້ອງການປ່ຽນລາຄາກາເຟເປັນສີ່ເອີໂຣ", 5], // Lao
      ["ខ្ញុំចង់ប្តូរតម្លៃកាហ្វេទៅជាបួនអឺរ៉ូ", 5], // Khmer
      ["ကျွန်တော်ကော်ဖီဈေးကိုလေးယူရိုပြောင်းချင်ပါတယ်", 5], // Burmese
    ];
    for (const [text, atLeast] of sentences) expect(countWords(text), text).toBeGreaterThanOrEqual(atLeast);
    for (const text of ["谢谢", "ありがとう", "ขอบคุณ", "ຂອບໃຈ", "អរគុណ"]) expect(countWords(text), text).toBeLessThan(4);
    expect(countWords("4.20 😀 谢谢")).toBe(countWords("谢谢")); // numbers and emoji are still not words
    expect(countWords("我想'价格")).toBe(countWords("我想 价格")); // an apostrophe between letters, which the segmenter splits off, is not a word either
  });
  it("countWords counts every spaced script exactly as it did, as runs of letters, whatever is glued to them", () => {
    const before = (text: string) => text.match(/\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu)?.length ?? 0;
    const texts = [
      "Flat white свърши днес", "Капучиното става три и двайсет", "Баницата свърши днес 4,20 👍", "don't stop", "don’t do it now", "l'homme est là", "Ich möchte den Preis ändern",
      "Ο καφές είναι έτοιμος", "나는 카푸치노 가격을 4유로로 바꾸고 싶어요", "أريد تغيير سعر الكابتشينو إلى أربعة يورو", "אני רוצה לשנות את מחיר הקפוצ'ינו", "मैं कैपुचीनो की कीमत चार यूरो करना चाहता हूँ",
      // letters joined by a ".", ":" or "_" or by digits with no space, which Intl.Segmenter alone would take for one word
      "готово.Идвайте", "т.е. утре", "U.S.A. today", "Mr.Smith", "Note:this", "foo_bar baz", "x2y3", "abc123def", "www.my-open-cafe.bg", "по-добре", "co-op and e-mail", "4.20 👍", "",
    ];
    for (const text of texts) expect(countWords(text), text).toBe(before(text));
    expect(countWords("готово.Идвайте")).toBe(2);
    expect(countWords("Mr.Smith")).toBe(2);
    expect(countWords("www.my-open-cafe.bg")).toBe(5);
  });
});
