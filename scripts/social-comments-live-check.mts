// scripts/social-comments-live-check.mts
// Against a REAL Instagram professional account: lists the comments under the account's latest post through our own reader
// (src/social/comments-graph.ts), replies to one chosen by id through our writer, reads the reply back, then deletes it. The
// same code path as production minus the poll and the proposal (Meta's API cannot post a comment as another user, so the
// comment itself is written by hand in the Instagram app first). Reading the reply back checks that its `from.id` is the
// professional account id the Instagram connect stores as `ig_user_id` (`/me` user_id): the re-reply guard in
// src/destinations/comment-push.ts (findOwnReply) and the poller's own-comment mark both depend on that match.
// Needs IG_TEST_TOKEN (Instagram Login user token with instagram_business_manage_comments) in the env file. Never prints the token.
// Run: npm run social:comments-live -- [--comment <ig-comment-id>] [--reply "…"] [--keep]
//  or: npx tsx --env-file=<.env.local> scripts/social-comments-live-check.mts [--comment <ig-comment-id>] [--reply "…"] [--keep]
import { GraphClient, IG_GRAPH, metaFetch } from "../src/destinations/meta-graph";
import { deleteReply, fetchInstagramComments, findOwnReply, replyInstagram } from "../src/social/comments-graph";

const args = process.argv.slice(2);
let commentId = "";
let reply = "Благодарим! (тест от Site Manager)";
let keep = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--comment" && args[i + 1]) commentId = args[++i];
  else if (args[i] === "--reply" && args[i + 1]) reply = args[++i];
  else if (args[i] === "--keep") keep = true;
}
const token = process.env.IG_TEST_TOKEN ?? "";

async function main() {
  if (!token) throw new Error("IG_TEST_TOKEN is missing (set it in .env.local)");
  const client = new GraphClient(IG_GRAPH, token, fetch);
  const me = await client.get<{ id?: string; user_id?: string; username?: string }>("/me?fields=id,user_id,username");
  if (!me.user_id) throw new Error("token check failed: no user_id");
  // What the connect stores (src/server/social-connect.ts): ig_user_id = /me user_id as a string of digits.
  const igUserId = String(me.user_id);
  const isOwn = (authorId: string) => authorId !== "" && (authorId === igUserId || authorId === me.id);
  console.log(`== Instagram account @${me.username} (ig_user_id ${igUserId}, app-scoped id ${me.id ?? "?"})`);
  const media = await metaFetch<{ data?: { id: string; caption?: string; permalink?: string }[] }>(fetch, `${IG_GRAPH}/${encodeURIComponent(igUserId)}/media?fields=id,caption,permalink&limit=1`, { headers: { authorization: `Bearer ${token}` } });
  const latest = media.data?.[0];
  if (!latest) throw new Error("the account has no posts");
  console.log(`== latest post ${latest.id} ${latest.permalink ?? ""}\n   "${(latest.caption ?? "").slice(0, 80)}"`);
  const comments = await fetchInstagramComments(client, latest.id);
  console.log(`== ${comments.length} comment(s)`);
  for (const c of comments) console.log(`   ${c.parent_id ? "  ↳ " : ""}${c.comment_id} ${c.author_name} (from ${c.author_id || "?"}): ${c.text.slice(0, 80)} (${c.created_at})`);
  // Auto-pick: a top-level customer comment the venue has not answered yet (a --keep rerun never replies twice).
  const answered = new Set(comments.filter((c) => c.parent_id !== null && isOwn(c.author_id)).map((c) => c.parent_id));
  const target = commentId ? comments.find((c) => c.comment_id === commentId) : comments.find((c) => c.parent_id === null && !isOwn(c.author_id) && !answered.has(c.comment_id));
  if (!target) {
    console.log(commentId ? `comment ${commentId} is not under the latest post` : "no unanswered top-level customer comment to reply to; write one in the Instagram app and run again with --comment <id>");
    process.exitCode = 1;
    return;
  }
  if (target.parent_id !== null) {
    console.log(`comment ${target.comment_id} is a reply; Instagram can reply to top-level comments only`);
    process.exitCode = 1;
    return;
  }
  console.log(`== reply to ${target.comment_id} (${target.author_name}): "${reply}"`);
  const replyId = await replyInstagram(client, target.comment_id, reply);
  console.log(`   posted reply ${replyId}`);

  // From here a live reply exists on a public account: whatever fails, it is deleted (unless --keep) or its id is printed.
  let ok = false;
  try {
    const after = await fetchInstagramComments(client, latest.id);
    const seen = after.find((c) => c.comment_id === replyId);
    console.log(`   reader sees it under its parent: ${seen ? `yes (parent ${seen.parent_id})` : "NO"}`);
    const fromId = seen?.author_id ?? "";
    const fromMatches = fromId !== "" && fromId === igUserId;
    console.log(`   its from.id ${fromId || "(missing)"} equals the stored ig_user_id ${igUserId}: ${fromMatches ? "yes" : `NO${fromId && fromId === me.id ? " (it is the app-scoped id)" : ""}`}`);
    // The exact lookup the push runs after a lost answer, so a retry never posts the reply twice.
    const guard = await findOwnReply(client, "instagram", target.comment_id, igUserId, reply);
    console.log(`   re-reply guard (findOwnReply) finds it: ${guard === replyId ? "yes" : guard ? `another reply ${guard}` : "NO"}`);
    ok = !!seen && fromMatches && guard === replyId;
  } catch (e) {
    console.error(`   check failed after posting reply ${replyId}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (keep) {
      console.log(`   reply ${replyId} kept (--keep)`);
    } else {
      try {
        await deleteReply(client, replyId);
        console.log("   reply deleted");
      } catch (e) {
        ok = false;
        console.error(`   could NOT delete reply ${replyId} (${e instanceof Error ? e.message : String(e)}); delete it by hand in the Instagram app`);
      }
    }
  }
  console.log(ok ? "\nSOCIAL COMMENTS LIVE CHECK OK" : "\nSOCIAL COMMENTS LIVE CHECK FAILED");
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  // MetaApiError messages carry Meta's text and code, never the token (it rides in the Authorization header).
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
