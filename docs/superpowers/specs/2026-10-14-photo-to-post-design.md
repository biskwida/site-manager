# Photo → Instagram picture (design)

Date: 2026-10-14. Status: draft for the owner's review.

## What the owner gets

The owner sends a dish or drink photo and says what it is ("направи пост: флат уайт, 4,30, със сърце"). The bot sends back the **finished picture**: the subject cut out of its background, placed on a coloured backdrop, with the venue's name or logo, the dish name, the price and an optional short line. Nothing is published yet. The owner can ask for changes ("в праскова", "цена 4,50", "напиши 'Ново'", "и като стори") and gets a new picture each time. When it looks right, posting goes through the existing Instagram/Facebook flow with its usual preview and ✅ tap.

Scope for v1:
- Pictures only (Instagram feed post 4:5, 1080×1350; story 9:16, 1080×1920). No Reels.
- One template ("cut-out on colour"), the look tested on 2026-10-13 with the flat white.
- Telegram, Messenger and WhatsApp all receive the picture.
- Bulgarian and English text on the picture, following the venue's default language unless the owner writes the text.

Out of scope: Reels and video, several templates, brand kits beyond the venue's existing logo and accent colour, scheduling posts.

## Flow

1. Photo arrives (with words, or held and then joined to the next message, as today).
2. The agent calls the new tool **`make_visual`** with the photo's `media_id`, the text fields, a colour and the format(s).
3. `make_visual` asks the **visual service** to render. The service cuts the subject out (cached per photo), renders the picture(s), converts to JPEG (Instagram accepts only JPEG), stores each as venue media and returns the new media ids and URLs.
4. The bot **sends the picture(s) to the chat** as photo messages.
5. **[Choice A, recommended]** Right under the picture the bot puts the usual proposal: "• Post: Instagram (post)" with ✅ Публикувай / ✏️ Промени / ❌ Откажи. ✅ publishes through `social_post`; ✏️ or any message asking for a change re-renders and replaces the proposal.
   **[Choice B]** The picture comes alone with one line ("Това е постът. Кажи какво да променя, или 'пусни го в Instagram'."). Posting is a separate request that then shows the ✅ proposal. One more step, more control.
6. The memory line for the turn records the new media ids ("visual: post m-…, story m-…, from photo m-…, cut-out m-…") so "пусни го", "и стори" or "по-тъмен фон" in later messages work.

If Instagram/Facebook is not connected, the picture is still made and sent, with one line saying how to connect.

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/visual/template.tsx` | The picture layout as a pure JSX function of `{ cutoutUrl, venueName, logoUrl?, dish, price, line?, colours, format }`. | none |
| `src/visual/palette.ts` | Named backdrops (teal, peach, cream, sage, rose, slate, dark) as hex pairs `{ bg, deep }`, plus the default pick from the photo's average colour (warm photo → cool backdrop and the reverse). | none |
| `src/visual/render.ts` | `next/og` `ImageResponse` → PNG → JPEG (sharp), fonts Prata + Golos Text (latin and cyrillic, from `@fontsource`). | template, palette |
| `src/visual/cutout.ts` | Background removal with `@imgly/background-removal-node` (local model, no paid API), then trim to the subject. | onnxruntime-node |
| `app/api/visual/route.ts` | The **visual service**: POST with the internal secret; loads the photo, reuses or makes the cut-out, renders the requested formats, saves them as media, returns ids/urls. `maxDuration = 60`. The only function that bundles the model. | cutout, render, store |
| `src/agent/visual-tools.ts` | The `make_visual` tool: validates the media id belongs to the venue, calls the service through an injected `VisualClient`, sends the picture(s) via `messenger.sendPhoto`, records memory notes, and (choice A) opens the `social_post` proposal. | VisualClient, messenger, social tools |
| `Messenger.sendPhoto(chatRef, url, caption?)` | New on every channel: Telegram `sendPhoto`, Messenger image attachment by URL, WhatsApp `image` by link, console log. | channels |
| Prompt rule 11 | When to call `make_visual`, the colour words, "и като стори", re-render on change requests. | prompt |

Why a separate service route: the model and runtime are 130 MB+. Importing them from the agent would put them into every bot function (Telegram, Meta, admin) and slow every cold start. The route is called over HTTP from the tool; nothing else imports `cutout.ts`. Next's `outputFileTracingIncludes` adds the model files to that route only; Linux binaries only.

## Data

- No migration. Cut-outs and rendered pictures are ordinary `media` rows (`is_gallery = false`), so they never appear in the site gallery.
- Cut-out cache: the service looks for a media row whose `storage_path` is `<venue>/cutouts/<photo media id>.png` before running the model (one new store method `getMediaByPath`).
- Memory notes: a turn may carry extra `notes` (string list) that `run.ts` appends to the memory outcome, so the agent sees the ids next turn.

## Errors

- Cut-out fails or finds no subject: render the original photo in a rounded card on the same backdrop (still a usable post) and say so in one line.
- Service times out or errors: the tool returns a clear error; the agent tells the owner to try again; nothing is half-saved.
- Media id from another venue or unknown: refused, as in `social_post`.
- Text too long for the layout: the template shrinks the dish name to two lines, then truncates the extra line; the tool rejects a dish name over 40 characters with a message the agent can act on.

## Testing

- Unit: palette pick; template returns the right size for post/story; tool validation, memory notes, `sendPhoto` calls and (choice A) the proposal, with a fake `VisualClient`; `sendPhoto` on each channel against the existing fakes.
- Route: with a fake cut-out (no model in tests), returns ids, reuses the cache on the second call.
- Real check before merge: deploy a Vercel **preview**, send a real photo to the test venue on Telegram, measure cold and warm time (target under 25 s cold, 10 s warm), check the picture and an Instagram test post.

## Cost

Background removal and rendering run inside our own Vercel functions: no per-picture fee. Function time is a few seconds per picture.
