// src/auth/page-lang.ts
// Client-safe and pure: the language of an owner-facing page. `?lang=`, then the claudia-lang cookie, then Accept-Language, then Bulgarian.
export type PageLang = "bg" | "en";
export const LANG_COOKIE = "claudia-lang";

const isPageLang = (v: unknown): v is PageLang => v === "bg" || v === "en";

/** The first of bg or en in an Accept-Language header, by weight (q); null when it names neither. */
function fromAcceptLanguage(header: string | null | undefined): PageLang | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      return { lang: tag.trim().toLowerCase().split("-")[0], q: q === undefined ? 1 : Number(q), index };
    })
    .filter((r) => r.lang && !Number.isNaN(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked.map((r) => r.lang).find(isPageLang) ?? null;
}

/** `fallback` is the language when nothing names bg or en: Bulgarian for the app pages, English for the public landing. */
export function resolvePageLang(input: { query?: string | null; cookie?: string | null; acceptLanguage?: string | null }, fallback: PageLang = "bg"): PageLang {
  if (isPageLang(input.query)) return input.query;
  if (isPageLang(input.cookie)) return input.cookie;
  return fromAcceptLanguage(input.acceptLanguage) ?? fallback;
}
