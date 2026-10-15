// src/server/legal.ts
// Server-only helpers for the public /privacy and /data-deletion pages (app/privacy, app/data-deletion).
import type { Lang } from "../domain/types";

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,24}$/;

/** PRIVACY_CONTACT_EMAIL when it looks like an address; null otherwise (the pages then point to the bot instead). */
export function privacyContactEmail(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.PRIVACY_CONTACT_EMAIL?.trim();
  return v && EMAIL_RE.test(v) ? v : null;
}

/** These pages default to Bulgarian; `?lang=en` renders English on the server too (the client toggle takes over after hydration). */
export function pageLang(raw: string | string[] | undefined): Lang {
  return (Array.isArray(raw) ? raw[0] : raw) === "en" ? "en" : "bg";
}
