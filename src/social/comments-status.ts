// src/social/comments-status.ts
// After a social push: the social_comments rows follow what the adapters stored (replied / moderated / deleted_replies / gone).
// Runs on the done result and on the partial result of a failed attempt, so a batch's rows that did go out are marked at once;
// each mark is skipped when the row already says so (a later attempt never moves replied_at).
import { commentResultIn } from "../destinations/social-common";
import type { CommentStatus, DestinationSync, SocialCommentPatch, Store } from "../store/types";

export async function afterSocialPush(store: Pick<Store, "findComment" | "updateComment">, sync: Pick<DestinationSync, "venue_id">, result: Record<string, unknown> | null, nowIso: string): Promise<void> {
  const r = commentResultIn([result]);
  const mark = async (commentId: string, patch: SocialCommentPatch, skipIf?: (c: { status: CommentStatus; reply_id: string | null }) => boolean) => {
    const c = await store.findComment(sync.venue_id, commentId);
    if (!c || skipIf?.(c)) return;
    await store.updateComment(c.id, patch);
  };
  for (const x of r.replied) await mark(x.comment_id, { status: "replied", reply_id: x.reply_id, replied_at: nowIso }, (c) => c.status === "replied" && c.reply_id === x.reply_id);
  for (const x of r.moderated) {
    if (x.action === "hide") await mark(x.comment_id, { status: "hidden", replied_at: nowIso }, (c) => c.status === "hidden");
    else if (x.action === "unhide") await mark(x.comment_id, { status: "ignored" }, (c) => c.status !== "hidden");
    else await mark(x.comment_id, { status: "deleted", replied_at: nowIso }, (c) => c.status === "deleted");
  }
  for (const x of r.deleted_replies) await mark(x.comment_id, { status: "ignored", reply_id: null }, (c) => c.status !== "replied");
  for (const id of r.gone) await mark(id, { status: "expired" }, (c) => c.status === "expired" || c.status === "deleted");
}
