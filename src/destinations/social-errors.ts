// src/destinations/social-errors.ts
// Pure (safe in client components): owner-facing text for a stored Facebook/Instagram sync error ("<code>: <message>").
import { parseSyncError, wpErrorText } from "./wp-errors";

const KNOWN: Record<string, { bg: string; en: string }> = {
  sm_meta_token: { bg: "връзката вече не е валидна; свържете отново от таблото", en: "the connection is no longer valid; reconnect from the dashboard" },
  sm_meta_permission: { bg: "липсва разрешение за публикуване; свържете отново от таблото и разрешете публикуването", en: "permission to publish is missing; reconnect from the dashboard and allow publishing" },
  sm_meta_unreachable: { bg: "Meta не отговори", en: "Meta did not answer" },
  sm_ig_container: { bg: "Instagram не прие снимката (трябва да е JPEG, до 8 MB)", en: "Instagram did not accept the photo (it must be a JPEG up to 8 MB)" },
  sm_ig_processing: { bg: "Instagram още обработва снимката", en: "Instagram is still processing the photo" },
  sm_social_not_connected: { bg: "не е свързан; свържете от таблото", en: "not connected; connect it from the dashboard" },
};

/** The known codes in the owner's language; anything else as Meta's (or our) message. */
export function socialErrorText(stored: string | null | undefined, lang: "bg" | "en"): string {
  if (!stored) return "";
  const { code } = parseSyncError(stored);
  const known = code ? KNOWN[code] : undefined;
  return known ? known[lang] : wpErrorText(stored, lang);
}
