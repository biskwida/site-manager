// src/destinations/social-lines.ts
// Pure: the owner's confirmation line per social network from its sync row ("Facebook: публикувано ✅ <links>").
import { NETWORK_NAMES, type Change, type Lang, type SocialTarget } from "../domain/types";
import type { DestinationKind, SyncStatus } from "../store/types";
import { networkTargets, publishedIn, safeLink, type SocialNetwork } from "./social-common";
import { socialErrorText } from "./social-errors";

const FORMAT: Record<SocialTarget, { bg: string; en: string }> = {
  facebook_post: { bg: "пост", en: "post" },
  facebook_story: { bg: "история", en: "story" },
  instagram_post: { bg: "пост", en: "post" },
  instagram_story: { bg: "история", en: "story" },
};

export function socialSyncLine(kind: SocialNetwork, status: SyncStatus, result: Record<string, unknown> | null, lastError: string | null, lang: Lang): string {
  const name = NETWORK_NAMES[kind];
  const bg = lang === "bg";
  const r = result ?? {};
  if (status !== "done") {
    // Say what did go out before the failure, so the owner does not post it again by hand.
    const out = publishedIn([r]);
    const links = out.map((p) => safeLink(p.permalink) ?? FORMAT[p.target][lang]);
    const tail = links.length ? (bg ? ` (вече публикувано: ${links.join(" ")})` : ` (already published: ${links.join(" ")})`) : "";
    if (status === "pending") return (bg ? `${name}: не успях да публикувам, ще опитам пак` : `${name}: publishing failed, will retry`) + tail;
    return (bg ? `${name}: грешка: ${socialErrorText(lastError, lang)}` : `${name}: error: ${socialErrorText(lastError, lang)}`) + tail;
  }
  if (Array.isArray(r.manual_delete)) {
    const links = r.manual_delete.map((m) => safeLink((m as { permalink?: unknown }).permalink)).filter((x): x is string => !!x);
    if (r.manual_delete.length === 0) return bg ? `${name}: няма какво да се изтрие` : `${name}: nothing to delete`;
    const tail = links.length ? `: ${links.join(" ")}` : "";
    return bg ? `${name}: изтрийте публикацията ръчно${tail}` : `${name}: delete the post by hand${tail}`;
  }
  if (r.undo === true) {
    const deleted = Array.isArray(r.deleted) ? r.deleted.length : 0;
    const stories = Array.isArray(r.stories) ? r.stories.length : 0;
    const storyNote = bg ? "историята изчезва сама до 24 часа" : "the story disappears on its own within 24 hours";
    if (deleted > 0 && stories > 0) return bg ? `${name}: изтрито ✅; ${storyNote}` : `${name}: deleted ✅; ${storyNote}`;
    if (stories > 0) return `${name}: ${storyNote}`;
    if (deleted === 0) return bg ? `${name}: няма какво да се изтрие` : `${name}: nothing to delete`;
    return bg ? `${name}: изтрито ✅` : `${name}: deleted ✅`;
  }
  const links = publishedIn([r]).map((p) => safeLink(p.permalink)).filter((x): x is string => !!x);
  const tail = links.length ? ` ${links.join(" ")}` : "";
  return bg ? `${name}: публикувано ✅${tail}` : `${name}: published ✅${tail}`;
}

/** "Instagram: не е свързан, публикацията не е изпратена" for each network the set targets without an active connection. */
export function socialMissingLines(changes: Change[], active: Set<DestinationKind>, lang: Lang): string[] {
  const out: string[] = [];
  for (const network of ["facebook", "instagram"] as const) {
    const rows = changes.filter((c) => networkTargets(c, network).length > 0);
    if (active.has(network) || rows.length === 0) continue;
    const undo = rows.every((c) => c.after === null);
    if (undo) out.push(lang === "bg" ? `${NETWORK_NAMES[network]}: не е свързан, публикацията не е изтрита` : `${NETWORK_NAMES[network]}: not connected, the post was not deleted`);
    else out.push(lang === "bg" ? `${NETWORK_NAMES[network]}: не е свързан, публикацията не е изпратена` : `${NETWORK_NAMES[network]}: not connected, the post was not sent`);
  }
  return out;
}
