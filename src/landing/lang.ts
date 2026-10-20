// src/landing/lang.ts
// The landing page's language rules, as plain functions so they are tested without a browser. The server picks the first language
// (?lang=, the claudia-lang cookie, Accept-Language, English); these decide what the browser does with it after hydration.
import { LANG_COOKIE, type PageLang } from "../auth/page-lang";

/** The landing's own localStorage key (unchanged from the standalone landing). */
export const LANG_STORAGE_KEY = "claudia-lang";

const isLang = (v: unknown): v is PageLang => v === "bg" || v === "en";

/**
 * The language to show once the page is in the browser: a valid `?lang=` wins over everything, then a language the visitor chose
 * earlier (localStorage) replaces the server's guess, else the server's language stays.
 */
export function resolveClientLang(o: { search: string; stored: string | null; initial: PageLang }): PageLang {
  const fromUrl = new URLSearchParams(o.search).get("lang");
  if (isLang(fromUrl)) return fromUrl;
  return isLang(o.stored) ? o.stored : o.initial;
}

/** The Set-Cookie text (document.cookie form) that remembers the language for the server-rendered pages. */
export function langCookie(lang: PageLang, secure: boolean): string {
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Remember the language in localStorage and in the claudia-lang cookie. Never throws (blocked storage is fine). */
export function persistLang(lang: PageLang, io: { storage: Pick<Storage, "setItem"> | null; setCookie: (cookie: string) => void; secure: boolean }): void {
  try {
    io.storage?.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* storage blocked: the cookie below still works */
  }
  try {
    io.setCookie(langCookie(lang, io.secure));
  } catch {
    /* cookies blocked */
  }
}
