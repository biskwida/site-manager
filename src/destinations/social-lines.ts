// src/destinations/social-lines.ts
// Pure: the owner's confirmation line per social network from its sync row ("Facebook: публикувано ✅ <links>").
import type { Change, Lang } from "../domain/types";
import type { DestinationKind, SyncStatus } from "../store/types";
import { networkTargets, publishedIn, safeLink, type SocialNetwork } from "./social-common";
import { socialErrorText } from "./social-errors";

const NAME: Record<SocialNetwork, string> = { facebook: "Facebook", instagram: "Instagram" };

export function socialSyncLine(kind: SocialNetwork, status: SyncStatus, result: Record<string, unknown> | null, lastError: string | null, lang: Lang): string {
  const name = NAME[kind];
  const bg = lang === "bg";
  if (status === "pending") return bg ? `${name}: не успях да публикувам, ще опитам пак` : `${name}: publishing failed, will retry`;
  if (status === "failed") return bg ? `${name}: грешка: ${socialErrorText(lastError, lang)}` : `${name}: error: ${socialErrorText(lastError, lang)}`;
  const r = result ?? {};
  if (Array.isArray(r.manual_delete)) {
    const links = r.manual_delete.map((m) => safeLink((m as { permalink?: unknown }).permalink)).filter((x): x is string => !!x);
    if (r.manual_delete.length === 0) return bg ? `${name}: няма какво да се изтрие` : `${name}: nothing to delete`;
    const tail = links.length ? `: ${links.join(" ")}` : "";
    return bg ? `${name}: изтрийте публикацията ръчно${tail}` : `${name}: delete the post by hand${tail}`;
  }
  if (r.undo === true) {
    const deleted = Array.isArray(r.deleted) ? r.deleted.length : 0;
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
    if (undo) out.push(lang === "bg" ? `${NAME[network]}: не е свързан, публикацията не е изтрита` : `${NAME[network]}: not connected, the post was not deleted`);
    else out.push(lang === "bg" ? `${NAME[network]}: не е свързан, публикацията не е изпратена` : `${NAME[network]}: not connected, the post was not sent`);
  }
  return out;
}
