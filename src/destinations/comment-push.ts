// src/destinations/comment-push.ts
// The reply / moderation / undo loop both social adapters run over their social_reply and social_moderate rows. Idempotent
// through the accumulated result (`acc`, pre-filled from earlier attempts): a comment already replied to, moderated or gone
// is skipped. A reply is checkpointed as attempted right before its call; a retry of an attempted reply first looks for our
// reply under the comment (Meta may have taken it and answered without an id, or the answer was lost) and never posts twice.
// A comment Meta no longer has is recorded in `gone` and the loop goes on (a batch must not lose its other rows); every other
// error stops the push and is classified by the caller (socialFailure). Comment and reply texts are never logged.
import type { ModerateAction } from "../domain/types";
import { deleteReply, findOwnReply, moderateFacebook, moderateInstagram, replyFacebook, replyInstagram } from "../social/comments-graph";
import { MetaApiError, type GraphClient } from "./meta-graph";
import { commentNetworkOf, commentResultIn, type CommentResult, type SocialNetwork } from "./social-common";
import type { PushContext } from "./types";

const UNDO_ACTION: Record<ModerateAction, ModerateAction | null> = { hide: "unhide", unhide: "hide", delete: null };
const isGone = (e: unknown) => e instanceof MetaApiError && e.notFound;

export async function pushCommentChanges(ctx: PushContext, network: SocialNetwork, client: GraphClient, acc: CommentResult, save: () => Promise<void>): Promise<void> {
  const ownId = String(ctx.destination.config[network === "instagram" ? "ig_user_id" : "page_id"] ?? "");
  const done = {
    replied: new Set(acc.replied.map((x) => x.comment_id)),
    moderated: new Set(acc.moderated.map((x) => x.comment_id)),
    deletedReplies: new Set(acc.deleted_replies.map((x) => x.comment_id)),
    gone: new Set(acc.gone),
    kept: new Set(acc.kept),
    attempted: new Set(acc.attempted),
  };
  const markGone = (id: string) => {
    acc.gone.push(id);
    done.gone.add(id);
  };
  const markReplied = (id: string, replyId: string) => {
    acc.replied.push({ comment_id: id, reply_id: replyId });
    done.replied.add(id);
  };
  let original: CommentResult | null = null;
  const originalResult = async () => (original ??= ctx.changeSet.undoes_id && ctx.resultsOf ? commentResultIn(await ctx.resultsOf(ctx.changeSet.undoes_id)) : commentResultIn([]));
  for (const c of ctx.changes) {
    if (commentNetworkOf(c) !== network) continue;
    const id = c.entity_id;
    if (done.gone.has(id)) continue;
    if (c.entity === "social_reply") {
      if (c.after) {
        if (done.replied.has(id)) continue;
        const text = typeof c.after.reply_text === "string" ? c.after.reply_text : "";
        try {
          if (done.attempted.has(id)) {
            // An earlier attempt sent this reply without a confirmed id: look before replying again.
            const found = await findOwnReply(client, network, id, ownId, text);
            if (found) {
              markReplied(id, found);
              await save();
              continue;
            }
          } else {
            acc.attempted.push(id);
            done.attempted.add(id);
            await save();
          }
          markReplied(id, network === "instagram" ? await replyInstagram(client, id, text) : await replyFacebook(client, id, text));
        } catch (e) {
          if (!isGone(e)) throw e;
          markGone(id);
        }
        await save();
        continue;
      }
      // Undo of a reply: delete the reply the original push made (none recorded: nothing to delete).
      if (done.deletedReplies.has(id)) continue;
      const replyId = (await originalResult()).replied.find((x) => x.comment_id === id)?.reply_id ?? "";
      if (replyId) await deleteReply(client, replyId);
      acc.deleted_replies.push({ comment_id: id, reply_id: replyId });
      done.deletedReplies.add(id);
      await save();
      continue;
    }
    // social_moderate: the action to perform now (an undo row inverts it; a delete cannot be undone).
    const stored = (c.after ?? c.before ?? {}).action;
    if (stored !== "hide" && stored !== "unhide" && stored !== "delete") continue;
    const action: ModerateAction | null = c.after ? stored : UNDO_ACTION[stored];
    if (action === null) {
      if (!done.kept.has(id)) {
        acc.kept.push(id);
        done.kept.add(id);
        await save();
      }
      continue;
    }
    if (done.moderated.has(id)) continue;
    try {
      if (network === "instagram") await moderateInstagram(client, id, action);
      else await moderateFacebook(client, id, action);
      acc.moderated.push({ comment_id: id, action });
      done.moderated.add(id);
    } catch (e) {
      if (!isGone(e)) throw e;
      if (action === "delete") {
        acc.moderated.push({ comment_id: id, action }); // already gone: deleting it is done
        done.moderated.add(id);
      } else {
        markGone(id);
      }
    }
    await save();
  }
}
