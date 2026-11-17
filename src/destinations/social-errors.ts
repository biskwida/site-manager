// src/destinations/social-errors.ts
// Pure (safe in client components): owner-facing text for a stored Facebook/Instagram/Google sync error ("<code>: <message>").
import { parseSyncError, wpErrorText } from "./wp-errors";

const KNOWN: Record<string, { bg: string; en: string }> = {
  sm_meta_token: { bg: "връзката вече не е валидна; свържете отново от таблото", en: "the connection is no longer valid; reconnect from the dashboard" },
  sm_meta_permission: { bg: "липсва разрешение за публикуване; свържете отново от таблото и разрешете публикуването", en: "permission to publish is missing; reconnect from the dashboard and allow publishing" },
  sm_meta_unreachable: { bg: "Meta не отговори", en: "Meta did not answer" },
  sm_ig_container: { bg: "Instagram не прие снимката (трябва да е JPEG, до 8 MB)", en: "Instagram did not accept the photo (it must be a JPEG up to 8 MB)" },
  sm_ig_processing: { bg: "Instagram още обработва снимката", en: "Instagram is still processing the photo" },
  sm_fb_check: { bg: "не е ясно дали публикацията излезе; проверете страницата и, ако я няма, поискайте я отново", en: "it is unclear whether the post went out; check the Page and, if it is not there, ask again" },
  sm_fb_unknown: { bg: "Facebook не потвърди публикацията", en: "Facebook did not confirm the post" },
  sm_reply_unknown: { bg: "Meta не потвърди отговора", en: "Meta did not confirm the reply" },
  sm_ig_publish_unknown: { bg: "Instagram не потвърди публикацията", en: "Instagram did not confirm the post" },
  sm_social_not_connected: { bg: "не е свързан; свържете от таблото", en: "not connected; connect it from the dashboard" },
  sm_google_revoked: { bg: "връзката вече не е валидна; свържете Google отново от таблото", en: "the connection is no longer valid; connect Google again from the dashboard" },
  sm_google_scope: { bg: "липсва разрешение за управление на профила; свържете Google отново и го разрешете", en: "the permission to manage the profile is missing; connect Google again and allow it" },
  sm_google_permission: { bg: "този Google акаунт вече не управлява профила; поискайте достъп „Мениджър\" от собственика и свържете отново", en: "this Google account no longer manages the profile; ask the profile owner for Manager access and connect again" },
  sm_google_no_hours: { bg: "Google иска работно време, преди да приеме почивни дни. Кажете ми първо работното време", en: "Google needs opening hours before it can take holidays — tell me your hours first" },
  // Followed by Google's own message (see socialErrorText).
  sm_google_invalid: { bg: "Google отказа работното време:", en: "Google refused the hours:" },
  sm_google_api_disabled: { bg: "Google API още не е включен за Claudia; пишете ни", en: "the Google API is not enabled for Claudia yet; write to us" },
  sm_google_not_found: { bg: "Google вече няма този профил или отзив", en: "Google no longer has this profile or review" },
};


/** The known codes in the owner's language (sm_google_invalid followed by Google's message); anything else as Meta's (or our) message. */
export function socialErrorText(stored: string | null | undefined, lang: "bg" | "en"): string {
  if (!stored) return "";
  const { code, message } = parseSyncError(stored);
  const known = code ? KNOWN[code] : undefined;
  if (known && code === "sm_google_invalid") return `${known[lang]} ${message}`;
  return known ? known[lang] : wpErrorText(stored, lang);
}
