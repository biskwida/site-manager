"use client";
import type { Lang } from "@/src/domain/types";

/** Resolves a media id to a loadable URL (null when unknown or not allowed). Built once per render in Template.tsx. */
export type MediaLookup = (id: string | null) => string | null;

/** Bilingual text with the Bulgarian fallback the whole site uses. */
export function pick(lang: Lang, bg: string, en: string): string {
  return (lang === "bg" ? bg : en) || bg || en;
}

/** Brief highlight behind a row or card that just changed (keyed by the change time so it re-triggers). Needs an `isolate` parent. */
export function Flash({ at }: { at: number | undefined }) {
  if (at === undefined) return null;
  return <span key={at} aria-hidden="true" className="n-flash" />;
}

/** Item name, dotted leader, display-face price: the menu-board line shared by rows and special cards. */
export function RowHead({ name, price, sold, as: Heading = "h3" }: { name: string; price: string; sold: boolean; as?: "h3" | "h4" }) {
  return (
    <div className="n-row-head">
      <Heading className={`n-name${sold ? " is-sold" : ""}`}>{name}</Heading>
      <span aria-hidden="true" className="n-lead" />
      <span className={`n-price${sold ? " is-sold" : ""}`}>{price}</span>
    </div>
  );
}

/** A translated sentence with its interpolated value kept on one line (times and dates must not break across lines). */
export function NoWrapArg({ text, arg }: { text: string; arg: string }) {
  const at = arg ? text.indexOf(arg) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="n-nowrap">{arg}</span>
      {text.slice(at + arg.length)}
    </>
  );
}
