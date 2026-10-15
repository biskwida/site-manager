// src/agent/comment-tools.ts
// Agent tools for customer comments under the venue's Facebook/Instagram posts: how the owner is notified (set_comment_mode),
// and (Task 9) what is waiting and replying. Registered only when a network is connected. set_comment_mode is an ordinary
// proposal through the agent's propose path (source of the turn, ✅/✏️/❌ buttons); a set made only of set_comment_mode rows
// never counts toward the monthly change limit (countsTowardLimit, src/domain/limits.ts). Nothing is posted by the agent itself.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { copy } from "../bot/copy";
import { commentModeLabel } from "../domain/comment-preview";
import { COMMENT_MODES, type CommentMode } from "../domain/types";
import type { AgentDeps, ToolKit } from "./tools";

export const SetCommentModeSchema = z.object({
  mode: z.enum(COMMENT_MODES as [CommentMode, ...CommentMode[]]).describe('"each" = a proposal for every new comment within 15 minutes; "digest" = one batch a day at digest_hour; "off" = comments only on the dashboard, no messages. "спри известията за коментари" → off; "веднъж дневно в 10" → digest with digest_hour 10; "уведомявай ме за всеки коментар" → each.'),
  digest_hour: z.number().int().min(0, "digest_hour must be 0–23").max(23, "digest_hour must be 0–23").optional().describe("Local hour (0–23, the venue's time zone) for the daily digest; keeps the current hour when omitted. Only meaningful with mode digest."),
});

export function commentTools(d: AgentDeps, k: ToolKit) {
  const social = d.social;
  if (!social || (!social.facebook && !social.instagram)) return [];

  const setMode = betaZodTool({
    name: "set_comment_mode",
    description: "Change how the owner hears about new customer comments under the venue's Facebook/Instagram posts: each (one proposal per comment), digest (one batch a day at digest_hour, venue time) or off (dashboard only). Owner only. Proposed with the buttons like any change; never counts toward the monthly change limit.",
    inputSchema: SetCommentModeSchema,
    run: (input) =>
      k.attempt(async () => {
        const hour = input.digest_hour ?? (await d.store.getVenue(d.venueId)).comment_digest_hour;
        return k.propose({
          summary_bg: copy("bg").commentModeSummary(commentModeLabel(input.mode, hour, "bg")),
          summary_en: copy("en").commentModeSummary(commentModeLabel(input.mode, hour, "en")),
          changes: [{ op: "set_comment_mode", mode: input.mode, ...(input.digest_hour !== undefined ? { digest_hour: input.digest_hour } : {}) }],
        }, null);
      }),
  });

  return [setMode];
}
