// src/agent/social-tools.ts
// The social_post tool: proposes publishing a photo the owner sent to the venue's Facebook Page and/or Instagram account.
// Nothing is published until the owner taps ✅ (src/destinations/store-hook.ts → facebook.ts / instagram.ts).
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SOCIAL_TARGETS, type Change, type SocialPostRow, type SocialTarget } from "../domain/types";
import type { Store } from "../store/types";
import { proposalText, type AgentDeps, type ToolKit } from "./tools";

export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAGS_MAX = 30;

export const SocialPostSchema = z.object({
  summary_bg: z.string().min(1).describe("One line in Bulgarian, e.g. „Публикация: днешното предложение“"),
  summary_en: z.string().min(1).describe("The same line in English"),
  media_id: z.string().min(1).describe("The media_id of the photo the owner sent"),
  caption: z.string().describe("The post text, exactly as it will appear (hashtags included). In the venue's default language unless the owner gave the text. Stories show no caption."),
  targets: z.array(z.enum(SOCIAL_TARGETS as [SocialTarget, ...SocialTarget[]])).min(1).max(4).describe("Where to publish: facebook_post, facebook_story, instagram_post, instagram_story. Default: the feed post on every connected network; stories only when the owner asks."),
});

/** Which networks the venue has connected for posting (an errored connection still counts: its next push tells the owner). */
export async function socialConnections(store: Store, venueId: string): Promise<{ facebook: boolean; instagram: boolean }> {
  const kinds = new Set((await store.listDestinations(venueId)).filter((d) => d.status !== "disconnected").map((d) => d.kind));
  return { facebook: kinds.has("facebook"), instagram: kinds.has("instagram") };
}

/** A JPEG by its stored file name or URL (Telegram photos are JPEG; Instagram accepts nothing else). */
function isJpeg(m: { storage_path: string; public_url: string }): boolean {
  return /\.jpe?g$/i.test(m.storage_path) || /\.jpe?g(\?|$)/i.test(m.public_url);
}

export function socialTools(d: AgentDeps, k: ToolKit) {
  const social = d.social;
  if (!social || (!social.facebook && !social.instagram)) return [];

  const post = betaZodTool({
    name: "social_post",
    description: "Propose publishing a photo the owner sent to the venue's own Facebook Page and/or Instagram account, as a feed post and/or a story, with the given caption. Published only after the owner taps ✅; undo deletes Facebook posts, Instagram posts must be deleted by hand.",
    inputSchema: SocialPostSchema,
    run: (input) =>
      k.attempt(async () => {
        if (d.member.role !== "owner") throw new Error("Posting on Facebook and Instagram is only the owner's decision; tell the owner to send this.");
        const targets = SOCIAL_TARGETS.filter((t) => input.targets.includes(t));
        const connectedTargets = SOCIAL_TARGETS.filter((t) => social[t.startsWith("facebook_") ? "facebook" : "instagram"]);
        for (const network of ["facebook", "instagram"] as const) {
          if (!social[network] && targets.some((t) => t.startsWith(`${network}_`))) {
            const name = network === "facebook" ? "Facebook" : "Instagram";
            throw new Error(`${name} is not connected for this venue (the owner connects it on the dashboard, "Facebook and Instagram" card). Use only: ${connectedTargets.join(", ")}.`);
          }
        }
        const m = await d.store.getMedia(input.media_id);
        if (!m || m.venue_id !== d.venueId) throw new Error(`media_id "${input.media_id}" not found for this venue; use the id of a photo you received.`);
        if (!/^https:\/\//.test(m.public_url)) throw new Error("This photo has no public https address, so Facebook and Instagram cannot fetch it (offline storage). Tell the owner posting works on the hosted site.");
        const caption = input.caption.trim();
        if (targets.some((t) => t.startsWith("instagram_")) && !isJpeg(m)) throw new Error("Instagram accepts only JPEG photos and this one is not a JPEG. Ask the owner to send it as a regular photo (not as a file), or post it to Facebook only.");
        if (targets.includes("instagram_post")) {
          if (Array.from(caption).length > IG_CAPTION_MAX) throw new Error(`The caption is longer than Instagram's 2,200 characters; shorten it.`);
          if ((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > IG_HASHTAGS_MAX) throw new Error("Instagram allows at most 30 hashtags in a caption; remove some.");
        }
        const row: SocialPostRow = { media_id: m.id, image_url: m.public_url, caption, targets };
        const change: Change = { position: 0, op: "social_post", entity: "social_post", entity_id: m.id, before: null, after: row as unknown as Change["after"] };
        await k.ensureNoPending();
        const s = await k.site();
        const p = k.previews(s, [change]);
        const cs = await d.store.createChangeSet({ venue_id: d.venueId, chat_ref: d.chatRef, summary_bg: input.summary_bg, summary_en: input.summary_en, ...p, source: d.source ?? "text", status: "proposed", changes: [change] });
        const messageRef = await d.messenger.sendProposal(d.chatRef, proposalText(k.mine(p), k.lang, null, s.venue.tz), cs.id, k.lang);
        if (messageRef !== null) await d.store.updateChangeSet(cs.id, { message_ref: messageRef });
        return { change_set_id: cs.id, status: "proposed", preview: k.mine(p), next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
      }),
  });
  return [post];
}
