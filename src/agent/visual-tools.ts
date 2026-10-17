// src/agent/visual-tools.ts
// The make_visual tool: turns a photo the owner sent into a finished Instagram picture (post 4:5 and/or story 9:16) and
// sends it to the chat. Nothing is published here: the agent then proposes social_post with the new picture, so the
// owner sees the picture with ✅ / ✏️ / ❌ under it (src/agent/social-tools.ts), which does not send it a second time.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { formatPrice } from "../domain/format";
import { FORMAT } from "../domain/social-preview";
import type { Lang } from "../domain/types";
import { BACKDROPS } from "../visual/palette";
import type { MenuPhotoResult } from "../visual/service";
import type { Format } from "../visual/template";
import type { ToolDeps, ToolKit } from "./tools";

const NAME_MAX = 40;
/** The caption of each picture in the chat: its format word (the table social_post's labels use), capitalised, in the owner's language. */
const formatCaption = (format: Format, lang: Lang): string => FORMAT[format][lang].replace(/^./, (c) => c.toUpperCase());

/**
 * Which language the words on the picture are in. The fonts (src/visual/fonts) have Cyrillic and the basic Latin subset (Western
 * European letters: ä é ß €), not Latin Extended (ł č š ş ğ ő ă ...) nor Greek, Arabic or Japanese, which would print as empty boxes:
 * those pictures say it in English (the caption under them stays in the owner's language).
 */
const PICTURE_LANGUAGE =
  "In the owner's current language (the Owner language line) unless the owner asks for another language or gives the text. " +
  "Picture text uses the Owner language only when it is written in Latin or Cyrillic letters the picture fonts cover (Bulgarian, English and Western European Latin), otherwise English. " +
  "Latin Extended letters (ł č š ş ğ ő ă and the like: Polish, Czech, Turkish, Romanian, Croatian…) are not covered, so in those languages, and in any other script, the picture text is English. " +
  "The caption stays in the owner's language.";

export const MakeVisualSchema = z.object({
  media_id: z.string().describe("The media_id of the owner's photo (not of an earlier picture: always start from the photo)."),
  dish: z.string().describe(`The name on the picture, as the owner said it, at most ${NAME_MAX} characters. ${PICTURE_LANGUAGE}`),
  item_id: z.string().optional().describe("The menu item when the dish is on the menu; the price then comes from the menu. Id from get_menu. Omit it when the owner states a different price for the picture (a promotion, \"за 3,50 днес\"): their price goes in `price`."),
  price: z.string().optional().describe(`The price as printed on the picture, in the picture's language ("4,30 €" for Bulgarian, "€4.30" for English). Omit when you pass item_id; else the owner's price (also a promotion price for a menu dish, with no item_id), else omit — never estimate. ${PICTURE_LANGUAGE}`),
  line: z.string().optional().describe(`An optional short line under the price ("Със сърце", "Ново", "Само днес"), at most ${NAME_MAX} characters. ${PICTURE_LANGUAGE}`),
  colour: z.string().optional().describe(`Backdrop: one of ${BACKDROPS.join(", ")}, or a #rrggbb colour. Omit to let the picture pick one that suits the photo. Words: тюркоаз/синьо-зелено → teal, праскова → peach, крем/бежово → cream, зелено → sage, розово → rose, синьо → sky, жълто → butter, тъмно/черно → dark.`),
  formats: z.array(z.enum(["post", "story"])).describe('"post" (feed, 4:5) and/or "story" (9:16). "и като стори", "и стори" → both; "само стори" → ["story"]; otherwise ["post"].'),
});

export const MakeMenuPhotoSchema = z.object({
  media_id: z.string().describe("The media_id of the owner's photo of the item (not of an earlier picture: always start from the photo)."),
  item_id: z.string().describe("The id of the menu item the photo is for, from get_menu."),
  style: z.enum(["match", "white"]).optional().describe('"match" when the owner says "like the rest", "като другите" or "same as the menu": the backdrop and object size most of the menu photos share. "white" for "white" or "бял фон", and when the owner says nothing about the backdrop (omitted = "white").'),
});

const NO_OBJECT = "Could not separate the object from this photo; ask the owner for a photo of the item alone on a plain surface, taken straight on.";

/** The one line the agent tells the owner about the backdrop that was used; null for plain white that was asked for. */
function menuPhotoNote(r: Extract<MenuPhotoResult, { media_id: string }>): string | null {
  if (r.style !== "white") return `Used the backdrop ${r.style.background} that ${r.style.matched} of your ${r.style.of} menu photos share.`;
  switch (r.reason) {
    case "no_photos": return "Your other items have no photos, so I used white.";
    case "too_few": return "Only one other item has a photo, so I used white.";
    case "unreadable": return "I couldn't read your other menu photos, so I used white.";
    case "mixed": return "Your menu photos have different backdrops, so I used white.";
    default: return null;
  }
}

export function visualTools(d: ToolDeps, k: ToolKit) {
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
        // A menu item's price is the menu's, printed by the code in the picture's language: whatever the model passed as `price` is ignored.
        let price = input.price?.trim() || null;
        if (input.item_id !== undefined) {
          const item = (await k.site()).items.find((i) => i.id === input.item_id);
          if (!item) throw new Error("item_id not found; use an id from get_menu.");
          price = formatPrice(item.price_eur, k.lang);
        }
        const r = await visual({ venueId: d.venueId, mediaId: input.media_id, dish, price, line, colour: input.colour?.trim() || null, formats: [...formats] });
        // Each picture carries its format as its label, and each one that reaches the chat is recorded, so the social_post that
        // follows in this turn does not send it again.
        for (const p of r.pictures) {
          if ((await d.messenger.sendPhoto(d.chatRef, p.url, formatCaption(p.format, k.lang))) !== null) d.sentPhotos.add(p.url);
        }
        d.notes?.push(`visual from photo ${input.media_id}: ${r.pictures.map((p) => `${p.format} ${p.media_id}`).join(", ")} (backdrop ${r.backdrop}${r.kind === "photo" ? ", photo in a card: no clean cut-out" : ""})`);
        const social = d.social;
        const next = social && (social.instagram || social.facebook)
          ? "The picture(s) are in the chat. Now, in this same turn, call social_post with each new picture's media_id: the post picture with the *_post targets, the story picture with the *_story targets (networks as the owner asked; none named = every connected one). Caption in the owner's current language (the Owner language line) from the name and line, short and warm. The owner decides with the buttons."
          : "The picture(s) are in the chat. Instagram and Facebook are not connected, so tell the owner in one short sentence that the picture is ready and that posting needs the \"Facebook and Instagram\" card on the dashboard.";
        return { pictures: r.pictures.map(({ format, media_id }) => ({ format, media_id })), backdrop: r.backdrop, cutout: r.kind === "cutout" ? "ok" : "fallback: the photo is shown in a card because nothing could be cut out cleanly; mention it in one short sentence", next };
      }),
  });
  const menuPhoto = visual.menuPhoto?.bind(visual);
  if (!menuPhoto) return [make];
  const makeMenu = betaZodTool({
    name: "make_menu_photo",
    description: "Clean an owner's photo for the website or menu: the item cut out of its background, centred on a plain backdrop (white, or the one the other menu photos share), no text. Sends the photo to the chat. Changes nothing on the site: propose set_item_image with the media_id it returns. Use it, never make_visual, for any photo that goes on the website.",
    inputSchema: MakeMenuPhotoSchema,
    run: (input) =>
      k.attempt(async () => {
        if (d.member.role !== "owner") throw new Error("Making pictures for the website is the owner's decision; tell the owner to send this.");
        const site = await k.site();
        if (!site.items.some((i) => i.id === input.item_id)) throw new Error("item_id not found; use an id from get_menu.");
        const r = await menuPhoto({ venueId: d.venueId, mediaId: input.media_id, itemId: input.item_id, style: input.style ?? "white" });
        if ("error" in r) throw new Error(NO_OBJECT);
        if ((await d.messenger.sendPhoto(d.chatRef, r.url, k.lang === "bg" ? "Снимка за менюто" : "Menu photo")) !== null) d.sentPhotos.add(r.url);
        d.notes?.push(`menu photo from photo ${input.media_id}: ${r.media_id}`);
        const note = menuPhotoNote(r);
        return { media_id: r.media_id, ...(note ? { note } : {}), next: `Propose set_item_image for item ${input.item_id} with this media_id now (propose_changes). Say nothing else about the picture.${note ? " Tell the owner the note in one short line in the Owner language." : ""}` };
      }),
  });
  return [make, makeMenu];
}
