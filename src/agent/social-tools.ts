// src/agent/social-tools.ts
// The social_post tool: proposes publishing a photo the owner sent to the venue's Facebook Page and/or Instagram account.
// Before the ✅ / ✏️ / ❌ buttons the owner gets the exact picture for each place, labelled (previewPictures); the Instagram feed
// copy and the 9:16 story copy are made here, so what is approved is what is published.
// Nothing is published until the owner taps ✅ (src/destinations/store-hook.ts → facebook.ts / instagram.ts).
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { storyBackground } from "../domain/color";
import { previewPictures } from "../domain/social-preview";
import { SOCIAL_TARGETS, type Change, type SocialPostRow, type SocialTarget } from "../domain/types";
import type { Store } from "../store/types";
import { igFeedImage, storyImage } from "./social-image";
import { proposalText, type ToolDeps, type ToolKit } from "./tools";

export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAGS_MAX = 30;
export const IG_MENTIONS_MAX = 20;
/** Instagram's image size limit; the photo is read once at proposal time to check its shape and make the story picture. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const UNREADABLE = "Could not read this photo as an image; ask the owner to send it again as a regular photo.";

/** The photo's bytes, or why there are none: "too_large" (over Instagram's limit: a retry cannot help) or null (not fetched: a retry may). */
async function readPhoto(f: typeof fetch, url: string): Promise<Uint8Array | "too_large" | null> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.byteLength > MAX_PHOTO_BYTES ? "too_large" : bytes;
  } catch {
    return null;
  }
}

export const SocialPostSchema = z.object({
  summary_bg: z.string().min(1).describe("One line in Bulgarian, e.g. „Публикация: днешното предложение“"),
  summary_en: z.string().min(1).describe("The same line in English"),
  media_id: z.string().min(1).describe("The media_id of the photo the owner sent"),
  caption: z.string().describe("The post text, exactly as it will appear (hashtags included). In the venue's default language unless the owner gave the text. Stories show no caption."),
  targets: z.array(z.enum(SOCIAL_TARGETS as [SocialTarget, ...SocialTarget[]])).min(1).max(4).describe('Where to publish: facebook_post, facebook_story, instagram_post, instagram_story. "само стори", "като стори", "story only" or a story asked for without a post → only *_story; "само пост", "в профила", "във фийда", "post only" → only *_post; "и стори, и пост", "both" → both. A named network ("в инстаграм", "във фейсбук") → only that network. When the owner names neither story nor post: the feed post, on every connected network unless one is named. "прати стори само в инстаграм" → ["instagram_story"].'),
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

export function socialTools(d: ToolDeps, k: ToolKit) {
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
          if ((caption.match(/(^|[^\w@])@[A-Za-z0-9._]{1,30}/g) ?? []).length > IG_MENTIONS_MAX) throw new Error("Instagram allows at most 20 @-mentions in a caption; remove some.");
        }
        await k.ensureWithinLimit();
        await k.ensureNoPending();
        const s = await k.site();
        const row: SocialPostRow = { media_id: m.id, image_url: m.public_url, caption, targets };
        const stories = targets.some((t) => t.endsWith("_story"));
        if (targets.includes("instagram_post") || stories) {
          // Read once: the Instagram feed shape and the story picture both come from these bytes.
          const bytes = await readPhoto(d.fetch ?? fetch, m.public_url);
          if (bytes === "too_large") throw new Error("This photo is larger than 8 MB, Instagram's limit; ask the owner to send it again as a regular photo (not as a file) or a smaller one.");
          if (!bytes) throw new Error("Could not read the photo to prepare it for posting; try again in a moment.");
          if (targets.includes("instagram_post")) {
            // Instagram's feed takes 4:5..1.91:1 only: pad a taller or wider photo now, so the preview says so and the push only publishes.
            const shape = await igFeedImage(bytes);
            if (shape.kind === "unreadable") throw new Error(UNREADABLE);
            if (shape.kind === "unavailable") throw new Error(`Instagram feed posts must be between 4:5 (portrait) and 1.91:1 (landscape); this photo is outside that and cannot be padded on this server. Ask the owner for a less ${shape.ratio === "4:5" ? "tall" : "wide"} photo, or post it as a story or to Facebook only.`);
            if (shape.kind === "padded") {
              const copy = await d.store.saveMedia(d.venueId, shape.bytes, "image/jpeg");
              if (!/^https:\/\//.test(copy.public_url)) throw new Error("The padded copy for Instagram has no public https address (offline storage).");
              row.ig_feed_image_url = copy.public_url;
              row.ig_feed_ratio = shape.ratio;
            }
          }
          if (stories) {
            // Stories are 9:16: the whole photo on the café's colour. A photo that already is 9:16 is used as it is, and so is any
            // photo on a server without sharp (stories published the original before there was a copy).
            const story = await storyImage(bytes, storyBackground(s.venue.theme));
            if (story.kind === "unreadable") throw new Error(UNREADABLE);
            if (story.kind === "made") {
              const copy = await d.store.saveMedia(d.venueId, story.bytes, "image/jpeg");
              if (!/^https:\/\//.test(copy.public_url)) throw new Error("The 9:16 story copy has no public https address (offline storage).");
              row.story_image_url = copy.public_url;
            }
          }
        }
        const change: Change = { position: 0, op: "social_post", entity: "social_post", entity_id: m.id, before: null, after: row as unknown as Change["after"] };
        const p = k.previews(s, [change]);
        const cs = await d.store.createChangeSet({ venue_id: d.venueId, chat_ref: d.chatRef, summary_bg: input.summary_bg, summary_en: input.summary_en, ...p, source: d.source ?? "text", status: "proposed", changes: [change] });
        // The exact picture for each place, labelled, above the buttons. Only a picture make_visual already put in the chat this turn is
        // skipped; this proposal's own sends are not recorded, so a second proposal in the turn (even of the same file) shows all its
        // pictures just above its own buttons. A picture that cannot be sent (Meta's 24-hour window, a network error) never holds back the proposal.
        for (const pic of previewPictures(row, k.lang)) {
          if (!d.sentPhotos.has(pic.url)) await d.messenger.sendPhoto(d.chatRef, pic.url, pic.label);
        }
        const messageRef = await d.messenger.sendProposal(d.chatRef, proposalText(k.mine(p), k.lang, null, s.venue.tz), cs.id, k.lang);
        if (messageRef !== null) await d.store.updateChangeSet(cs.id, { message_ref: messageRef });
        return { change_set_id: cs.id, status: "proposed", preview: k.mine(p), next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
      }),
  });
  return [post];
}
