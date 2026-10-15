// src/domain/comment-preview.ts
// Preview lines for social_reply and social_moderate rows (replies and moderation of customer comments on the venue's
// Facebook Page / Instagram account), and the set_comment_mode label. Pure; both languages; undo-safe (an inverted row has
// after = null).
import { quote, tr } from "./format";
import { NETWORK_NAMES, type Change, type Lang, type Row } from "./types";

export const EXCERPT_MAX = 60;

/** The first line of a comment, at most `max` characters, "…" when cut. */
export function excerpt(text: string, max = EXCERPT_MAX): string {
  const all = text.trim();
  const line = all.split("\n")[0].trim();
  const chars = Array.from(line);
  const cut = line.length < all.length || chars.length > max;
  return cut ? `${chars.slice(0, max - 1).join("")}…` : line;
}

/** "при всеки" / "веднъж дневно в 10:00" / "изключени" for a venue's comment_mode + comment_digest_hour. */
export function commentModeLabel(mode: unknown, digestHour: unknown, lang: Lang): string {
  if (mode === "each") return tr(lang, "при всеки", "each comment");
  if (mode === "off") return tr(lang, "изключени", "off");
  const hour = `${String(digestHour ?? 9).padStart(2, "0")}:00`;
  return tr(lang, `веднъж дневно в ${hour}`, `once a day at ${hour}`);
}

function rowOf(c: Change): Row {
  return c.after ?? c.before ?? {};
}
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function commentPreviewLines(c: Change, lang: Lang): string[] {
  const row = rowOf(c);
  const network = str(row.network);
  const net = network in NETWORK_NAMES ? NETWORK_NAMES[network as keyof typeof NETWORK_NAMES] : network;
  const author = str(row.author_name) || tr(lang, "клиент", "a customer");
  const text = quote(excerpt(str(row.comment_text)), lang);
  if (c.entity === "social_reply") {
    if (c.after === null) return [`• ${tr(lang, `Изтрива отговора на коментара от ${author}`, `Deletes the reply to ${author}'s comment`)} (${net})`];
    return [`• ${tr(lang, `Отговор на коментар от ${author}`, `Reply to a comment by ${author}`)} (${net}): ${text} → ${quote(str(row.reply_text), lang)}`];
  }
  const action = str(row.action);
  if (c.after === null) {
    // Undo of a moderation: a hidden comment is shown again; a deleted one is gone for good.
    if (action === "delete") return [`• ${tr(lang, `Коментарът от ${author} е изтрит и не може да бъде върнат`, `${author}'s comment was deleted and cannot be restored`)} (${net})`];
    if (action === "unhide") return [`• ${tr(lang, `Скрива коментар от ${author}`, `Hides a comment by ${author}`)} (${net}): ${text}`];
    return [`• ${tr(lang, `Показва отново коментара от ${author}`, `Shows ${author}'s comment again`)} (${net})`];
  }
  if (action === "delete") return [`• ${tr(lang, `Изтрива коментар от ${author}`, `Deletes a comment by ${author}`)} (${net}): ${text}`, `  (${tr(lang, "изтриването не може да се отмени", "a deletion cannot be undone")})`];
  if (action === "unhide") return [`• ${tr(lang, `Показва отново коментара от ${author}`, `Shows ${author}'s comment again`)} (${net})`];
  return [`• ${tr(lang, `Скрива коментар от ${author}`, `Hides a comment by ${author}`)} (${net}): ${text}`];
}
