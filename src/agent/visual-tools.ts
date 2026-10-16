// src/agent/visual-tools.ts
// The make_visual tool: turns a photo the owner sent into a finished Instagram picture (post 4:5 and/or story 9:16) and
// sends it to the chat. Nothing is published here: the agent then proposes social_post with the new picture, so the
// owner sees the picture with ✅ / ✏️ / ❌ under it (src/agent/social-tools.ts), which does not send it a second time.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { BACKDROPS } from "../visual/palette";
import type { AgentDeps, ToolKit } from "./tools";

const NAME_MAX = 40;

export const MakeVisualSchema = z.object({
  media_id: z.string().describe("The media_id of the owner's photo (not of an earlier picture: always start from the photo)."),
  dish: z.string().describe(`The name on the picture, as the owner said it, at most ${NAME_MAX} characters.`),
  price: z.string().optional().describe('The price as printed on the picture, in the venue\'s format ("4,30 €" for Bulgarian, "€4.30" for English). From the owner, else from get_menu for that item, else omit.'),
  line: z.string().optional().describe(`An optional short line under the price ("Със сърце", "Ново", "Само днес"), at most ${NAME_MAX} characters.`),
  colour: z.string().optional().describe(`Backdrop: one of ${BACKDROPS.join(", ")}, or a #rrggbb colour. Omit to let the picture pick one that suits the photo. Words: тюркоаз/синьо-зелено → teal, праскова → peach, крем/бежово → cream, зелено → sage, розово → rose, синьо → sky, жълто → butter, тъмно/черно → dark.`),
  formats: z.array(z.enum(["post", "story"])).describe('"post" (feed, 4:5) and/or "story" (9:16). "и като стори", "и стори" → both; "само стори" → ["story"]; otherwise ["post"].'),
});

export function visualTools(d: AgentDeps, k: ToolKit) {
  const visual = d.visual;
  if (!visual) return [];
  const make = betaZodTool({
    name: "make_visual",
    description: "Make a finished Instagram picture from a photo the owner sent: the dish cut out of its background, on a coloured backdrop, with the venue's name or logo, the dish name, the price and an optional line. Sends the picture(s) to the chat. Publishes nothing.",
    inputSchema: MakeVisualSchema,
    run: (input) =>
      k.attempt(async () => {
        if (d.member.role !== "owner") throw new Error("Making pictures for Instagram is the owner's decision; tell the owner to send this.");
        const dish = input.dish.trim();
        const line = input.line?.trim() || null;
        if (!dish || Array.from(dish).length > NAME_MAX) throw new Error(`The name on the picture must be 1–${NAME_MAX} characters; shorten it.`);
        if (line && Array.from(line).length > NAME_MAX) throw new Error(`The extra line must be at most ${NAME_MAX} characters; shorten it.`);
        const formats = input.formats.length ? [...new Set(input.formats)] : (["post"] as const);
        const r = await visual({ venueId: d.venueId, mediaId: input.media_id, dish, price: input.price?.trim() || null, line, colour: input.colour?.trim() || null, formats: [...formats] });
        // Each picture that reaches the chat is recorded, so the social_post that follows in this turn does not send it again.
        for (const p of r.pictures) if ((await d.messenger.sendPhoto(d.chatRef, p.url)) !== null) d.sentPhotos?.add(p.url);
        d.notes?.push(`visual from photo ${input.media_id}: ${r.pictures.map((p) => `${p.format} ${p.media_id}`).join(", ")} (backdrop ${r.backdrop}${r.kind === "photo" ? ", photo in a card: no clean cut-out" : ""})`);
        const social = d.social;
        const next = social && (social.instagram || social.facebook)
          ? "The picture(s) are in the chat. Now, in this same turn, call social_post with each new picture's media_id: the post picture with the *_post targets, the story picture with the *_story targets (networks as the owner asked; none named = every connected one). Caption in the venue's language from the name and line, short and warm. The owner decides with the buttons."
          : "The picture(s) are in the chat. Instagram and Facebook are not connected, so tell the owner in one short sentence that the picture is ready and that posting needs the \"Facebook and Instagram\" card on the dashboard.";
        return { pictures: r.pictures.map(({ format, media_id }) => ({ format, media_id })), backdrop: r.backdrop, cutout: r.kind === "cutout" ? "ok" : "fallback: the photo is shown in a card because nothing could be cut out cleanly; mention it in one short sentence", next };
      }),
  });
  return [make];
}
