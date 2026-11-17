// Pure (safe in client components): the owner's confirmation line for a Google listing push, from its sync row
// ("Google listing: updated ✅", "Google профил: не е обновен, ще опитам пак"); for a review reply "Google: reply published ✅".
import { NETWORK_NAMES, type Lang } from "../domain/types";
import type { SyncStatus } from "../store/types";
import { GOOGLE_EDIT_URL } from "./google-api";
import { commentResultIn, hasCommentResult } from "./social-common";
import { socialErrorText } from "./social-errors";
import { commentParts } from "./social-lines";
import { parseSyncError } from "./wp-errors";

/** Codes whose own text the owner reads after "Google listing: "; any other failure sends them to the profile. */
const TEXT_CODES: ReadonlySet<string> = new Set(["sm_google_revoked", "sm_google_scope", "sm_google_permission", "sm_google_no_hours", "sm_google_invalid", "sm_google_api_disabled", "sm_google_not_found"]);

export function googleSyncLine(status: SyncStatus, result: Record<string, unknown> | null, lastError: string | null, lang: Lang): string {
  const bg = lang === "bg";
  const name = bg ? "Google профил" : "Google listing";
  if (status === "pending") return bg ? `${name}: не е обновен, ще опитам пак` : `${name}: not updated — I'll retry`;
  if (status === "failed") {
    const code = lastError ? parseSyncError(lastError).code : null;
    if (code && TEXT_CODES.has(code)) return `${name}: ${socialErrorText(lastError, lang)}`;
    return bg ? `${name}: не е обновен. Отворете профила си и го променете ръчно: ${GOOGLE_EDIT_URL}` : `${name}: not updated. Open your profile to change it by hand: ${GOOGLE_EDIT_URL}`;
  }
  const replies = commentResultIn([result]);
  if (hasCommentResult(replies)) return `${NETWORK_NAMES.google}: ${commentParts(replies, bg).join("; ")}`;
  const hours = (result?.hours ?? null) as { conflict?: unknown; reviewing?: unknown; long_closure?: unknown } | null;
  let line = hours?.reviewing === true ? (bg ? `${name}: изпратено, Google го преглежда` : `${name}: sent, Google is reviewing`) : bg ? `${name}: обновен ✅` : `${name}: updated ✅`;
  if (hours?.long_closure === true) {
    line += bg
      ? " (7+ дни затворено: Google ще го покаже като „временно затворено\" само ако го зададете в профила си)"
      : " (7+ days closed: Google may show this as temporarily closed only if you set it in your profile)";
  }
  if (hours?.conflict === true) line += bg ? " (работното време в Google остава както е; различава се от сайта)" : " (the regular hours on Google stay as they are; they differ from the website)";
  return line;
}
