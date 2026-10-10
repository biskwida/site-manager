// src/destinations/wp-errors.ts
// Pure (no imports, safe in client components): owner-facing text for a stored WordPress sync error. Sync rows and
// destinations keep `last_error` as "<code>: <message>" when the plugin answered with an error code.

const KNOWN: Record<string, { bg: string; en: string }> = {
  sm_unauthorized: { bg: "връзката с WordPress вече не е валидна; свържете сайта отново с /connect", en: "the WordPress connection is no longer valid; reconnect with /connect" },
  sm_replace_failed: { bg: "текстът на страницата е променен; поискайте промяната отново", en: "the page text has changed; ask for the change again" },
  sm_upload_failed: { bg: "снимката не можа да се качи", en: "the photo could not be uploaded" },
  sm_redirect: { bg: "сайтът пренасочи заявката към друг адрес; свържете го отново с крайния му адрес чрез /connect", en: "the site redirected the request to another address; reconnect it with its final address using /connect" },
  sm_builder_unsupported: { bg: "тази страница е направена с редактор, който не поддържаме", en: "this page uses an editor we do not support" },
};

/** The stored form of an error: "<code>: <message>", or the bare message when there is no code. */
export function formatSyncError(code: string | undefined, message: string): string {
  return code ? `${code}: ${message}` : message;
}

/** Splits a stored error into its code (a word with an underscore, e.g. sm_unauthorized, http_500) and message. */
export function parseSyncError(stored: string): { code: string | null; message: string } {
  const m = stored.match(/^([a-z]+_[a-z0-9_]+): ([\s\S]*)$/);
  return m ? { code: m[1], message: m[2] } : { code: null, message: stored };
}

/** Text for the owner: the known codes in their language, anything else as the plugin's (or our) message. */
export function wpErrorText(stored: string | null | undefined, lang: "bg" | "en"): string {
  if (!stored) return "";
  const { code, message } = parseSyncError(stored);
  const known = code ? KNOWN[code] : undefined;
  return known ? known[lang] : message;
}
