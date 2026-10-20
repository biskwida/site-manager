// src/server/request-lang.ts — the language of an owner-facing server page: ?lang=, then the claudia-lang cookie, then Accept-Language.
import { cookies, headers } from "next/headers";
import { LANG_COOKIE, resolvePageLang, type PageLang } from "../auth/page-lang";

export const firstParam = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function readPageLang(query: string | string[] | undefined, fallback: PageLang = "bg"): Promise<PageLang> {
  return resolvePageLang({ query: firstParam(query), cookie: (await cookies()).get(LANG_COOKIE)?.value, acceptLanguage: (await headers()).get("accept-language") }, fallback);
}
