# Aesthetic, viral-looking pictures and videos from the owner's phone photo (18 Oct 2026)

**The request.** The owner sends Claudia a photo of an item (a cappuccino, a cake, a bottle, a dress). Claudia turns it into an aesthetic Instagram picture (4:5 post, 9:16 story) and a short vertical video. Order of preference: (1) an existing skill, (2) another AI service, (3) Claude makes it itself.

**Short answer:**
- **Skill:** use `banana` (Gemini) for pictures and fal `genmedia` for video. Both work only with a paid API key, and both serve Claude Code sessions, not the bot.
- **Bot:** Claudia should call the Gemini API directly:
  - Nano Banana 2.1 for the styled picture, about 0.03–0.04 € each.
  - Gemini Omni 1.1 Flash for a 6 s 9:16 clip made from that picture, about 0.53 €.
  - Total: about **7–8 € per café per month** for 20 pictures and 8 videos.
- **Claude alone (code, no AI generation):** free, and good for clean templates with name and price. It cannot make a believable styled scene. The test below shows why.

Prices are list prices found on 18 Oct 2026, at about 1 USD = 0.87 EUR. Each source tag marks where a figure came from:
- [O] = official page
- [S] = secondary source
- [U] = could not be confirmed

Full tables and every URL are in the two working reports, summarised here.

## 1. What I tried first: Claude alone, no AI service

I took the latte photo the Coffique owner sent (`site-manager-demo-video/public/coffique/user-photo.jpg`, a phone shot on a wooden bar with the street and a laptop in frame). Script: [`assets/2026-10-18-ai-visuals/code-only-still.py`](assets/2026-10-18-ai-visuals/code-only-still.py). It applies:
- the existing free cut-out
- a warm greige backdrop in Coffique's colours
- soft window light
- contact and long shadows
- a slight warm grade
- film grain

Result: [`assets/2026-10-18-ai-visuals/code-only-latte-post.jpg`](assets/2026-10-18-ai-visuals/code-only-latte-post.jpg).

**Verdict:** clean and on-brand, but it reads as *pasted*. The cup floats, the shadow doesn't sit under it, and there is no surface, reflection or depth of field. Code can't relight a photo or invent a believable table. This is the same limit as today's `make_visual` (cut-out on colour). It stays the right tool for text, price and logo layers, and as the free fallback.

I also tried Canva's AI image editing (connected to your account). The upload step was blocked by Claude Code's permission check, so I didn't go further. You can allow `create-upload-url` for the Canva connector if you want to compare it. It would use your Canva AI credits.

## 2. Skills (checked with `npx skills find`, 30 queries; nothing installed)

No skill does the whole job. Every one is instructions that call a paid model API. Most of the huge install counts are copies of other skills: the six `*/superpowers` mirrors show 300K–800K installs, while the originals have 6–14. Ignore those counts.

| Skill | Why | Needs | Licence |
|---|---|---|---|
| **`agricidaniel/banana-claude@banana`** (900 installs, 1.1k ★, all 3 security audits pass) | Edits the **real photo** with Gemini: frozen brief, reference image keeps the product, 4:5 and 9:16, cost estimate and approval before each paid call | `GEMINI_API_KEY` | MIT |
| **`fal-ai-community/skills@genmedia`** + `@commercial`, `@ugc` (252 ★, updated 17 Oct) | One key for image edits and image-to-video (Seedance, Kling, Veo, Omni), with prices from the CLI | `FAL_KEY` | no licence file |
| `coreyhaines31/marketingskills@image` (83k installs, 55k ★) | Free guide to model choice and prompts. Completes the `video` / `social` / `ad-creative` set already installed | — | MIT |

Already installed and still useful:
- `make-post` (free cut-out and Remotion templates)
- `remotion-*` skills
- `video`, `social`, `social-content`, `ad-creative`

Skipped:
- the inference.sh skills (tied to their gateway)
- eachlabs (unknown aggregator)
- muapi, pilioai, klingai-tech (too little evidence)
- HeyGen hyperframes (overlaps Remotion)

## 3. Other AI services

**Model names have changed since spring. Don't build on:**
- `gpt-image-1` (shuts down 23 Oct 2026)
- Veo 3.1 previews on the Gemini API (shut down 22 Oct 2026; replaced by **Gemini Omni 1.1 Flash**)
- Imagen 4 on the Gemini API (removed 17 Aug)

**Pictures (edit from the real photo):**

| Model | € per image | Notes |
|---|---|---|
| **Gemini Nano Banana 2.1** | ≈ 0.029 at 1K, 0.044 at 2K [O] | GA 6 Oct 2026. Up to 14 reference images. Best of its group on product fidelity. SynthID watermark. Paid tier doesn't train on your data. |
| Nano Banana Pro | ≈ 0.12 [O] | Premium. Same fidelity as Nano Banana 2.1 in Photoroom's test. |
| OpenAI gpt-image-2.5 (sunburst/flare) | ≈ 0.01–0.11, token-billed [S] | Best typography. Up to 2 min per image. EU data residency possible. |
| FLUX 3 / FLUX 3 Klein (BFL) | ≈ 0.042 / 0.008 [O/S] | EU terms. C2PA. Klein is cheap but weak on fidelity. |
| Seedream 5.0, Qwen Image 3.0 | ≈ 0.03–0.04 [O] | Fine for posters. Product fidelity unknown. |
| Photoroom API (AI backgrounds) | ≈ 0.087 [O] | Keeps the real cut-out pixels and generates only the background. Best for labels and packaging. Paris, GDPR. |

**No model keeps the product perfect.** Photoroom's benchmark covered 850 products and 3,400 generations: the best models kept every detail only **27–29% of the time** [S, clothing and accessories]. Distorted logos and text were the most common failure.

**Video (made from the styled picture, 9:16):**

| Model | ≈ € per 6 s clip | Notes |
|---|---|---|
| **Gemini Omni 1.1 Flash** 720p | 0.53 [O] | #1 on the video leaderboards in Sept 2026. Image reference, first and last frame, audio included. You must set 9:16 because the default is 16:9. |
| Kling 3.0 Std (silent) | 0.44 [S] | Start and end frame. 3–15 s. |
| Kling 2.5 Turbo Pro (fal) | 0.37 [O] | Cheapest mainstream option. |
| Seedance 1.5 Pro (silent) / 2.0 | 0.14 / 0.79 [O] | 2.0 handles pours and steam well [S]. BytePlus runs in Asia; EU region unconfirmed. |
| MiniMax H3, Runway Gen-4 Turbo, Wan 3.0, Luma Ray 3.2, Pika | 0.21–0.52 | Alternatives. |

Video generation takes tens of seconds to minutes, so it has to run as a background job, not inside the webhook turn.

**Cost per café per month** (20 pictures + 8 videos, 1.5 tries each):

| Stack | ≈ € per month |
|---|---|
| Cheapest: Nano Banana 2.1 1K + Seedance 1.5 Pro | 2.5 |
| **Balanced: Nano Banana 2.1 2K + Gemini Omni 720p** | **7.7** |
| Best: Nano Banana Pro + Omni 1080p | 13 |

## 4. How to make it look aesthetic, not "AI"

1. **Edit, don't generate.** Use the owner's photo as the reference, and in the prompt name everything that must stay: shape, toppings, cup, portion, label. Change only the scene and the light. The food must look like what is sold.
2. **Check every result.** A cheap vision call compares the original and the result, and rejects added or changed items (retry with a new seed). For labelled items such as wine or packaging, paste the real cut-out onto the generated scene.
3. **Make the video from the final picture.** The video model then only animates (steam, a slow push-in, a pour), which keeps the item from drifting. Use one motion per clip, a 5–6 s length, and "no text, no music, no speech".
4. **Add the Bulgarian text ourselves** with the existing satori/Remotion templates. No source confirms that any model writes Bulgarian correctly, so generate scenes with "no text, no logos".
5. **Use the reel rules from 15 Oct:**
   - one language per reel
   - no unconfirmed claims
   - at most two colours
   - a calm pace (about 10 s, three shots)
   - never end on a dark frame

Image prompt template (adapted from practitioner guides):
```
Use the uploaded photo as the exact reference for the <item>.
LOCK: shape, proportions, colours, toppings, cup/plate, portion, label and logo placement. Add or remove nothing on the item.
CHANGE: place it on <a light oak table by a window | marble counter | warm greige seamless backdrop in #d2c8b7>.
LIGHT: soft window light from the upper left, 5500K, gentle contact shadow.
CAMERA: slightly elevated 35 mm look, shallow depth of field, vertical 4:5, empty space at the top.
REALISM: natural texture, a few crumbs or droplets, no plastic gloss.
AVOID: extra food, hands, people, text, logos, watermarks, duplicates.
```

Video prompt template (coffee):
```
Single continuous shot, 9:16. The camera pushes in very slowly toward the cup. Soft backlit steam rises in thin threads.
Everything else stays still and unchanged. Natural window light, shallow depth of field. No music, no speech, no text.
```

## 5. Labelling and law

- **Instagram:** the Graph API has `is_ai_generated` on `POST /{ig_user_id}/media` (changelog 22 Jun 2026). It works with Instagram Login. It shows "AI info" under the account name. On a carousel, set it on the parent container only.
  - Default: `true` for every generated video, and for any picture whose scene was generated.
  - Whether light retouching needs it [U].
- **EU AI Act Art. 50** applies from 2 Aug 2026; systems already on the market have a grace period to 2 Dec 2026. Generated or manipulated content must carry a machine-readable mark, and deepfakes need a visible label.
  - Keep the SynthID or C2PA marks the models add.
  - Set the Instagram flag.
  - Get legal advice before launch. This note is not legal advice.
- **Consumer honesty:** the post must show the real dish. No invented toppings or portions.
- **People:** keep them out of the generated images. Meta reportedly cuts reach for undisclosed AI people [U].

## 6. Recommendation

1. **Now, to test by hand:** you create a Gemini API key on the paid tier, because the free tier lets Google use the data, and add it as `GEMINI_API_KEY` in `.env.local` yourself, not in chat. I install `banana` (and fal `genmedia` if we want to compare video models). Then we run the latte, the Biscoff cake and one non-food item through:
   - picture → vision check → our text template → Omni 6 s clip
   - Compare the results with the code-only version above.
2. **Then in Claudia** (after the test, with a spec as usual):
   - a `style_photo` step inside `make_visual` (Nano Banana 2.1 + vision check; falls back to today's cut-out)
   - `make_reel` as a background job (Omni; Kling 2.5 Turbo as the cheap fallback)
   - video publishing in the Instagram adapter (REELS), with `is_ai_generated`
   - a monthly cap per café
   - the same ✅ preview as every other change
3. **Price it in:** at about 8 € a month per café it fits the plans. It also fits the 2026-10-16 to-do and the "beat Meta Muse" idea: Claudia directs, edits and posts.

## Open points

- Bulgarian text quality in any model (run a 10-sample test).
- EU data residency for Gemini Omni and Nano Banana on the Gemini API, as opposed to Vertex Frankfurt.
- Real generation times.
- Exact licence wording for a SaaS making content for clients: OpenAI, Kling, Seedance, Runway.
- Whether light AI retouching needs the "AI info" label.

## Sources (main ones)

- Gemini pricing, deprecations, image and Omni docs: https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/deprecations, https://ai.google.dev/gemini-api/docs/image-generation, https://ai.google.dev/gemini-api/docs/omni
- OpenAI pricing and deprecations: https://developers.openai.com/api/docs/pricing, https://developers.openai.com/api/docs/deprecations
- BFL: https://docs.eu.bfl.ai/quick_start/pricing · Photoroom: https://www.photoroom.com/api/pricing · fal: https://fal.ai/pricing · Runway: https://docs.dev.runwayml.com/guides/pricing/ · BytePlus ModelArk, Alibaba Model Studio, MiniMax and Luma pricing pages (URLs in the working report)
- Photoroom fidelity benchmark: https://www.photoroom.com/blog/top-editing-image-models-maintain-product-details-only-28-of-the-time
- Instagram media reference and changelog (`is_ai_generated`): https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- EU AI Act Art. 50 factsheet: https://digital-strategy.ec.europa.eu/en/factpages/quick-facts-transparency-rules-ai-systems
- Skills: https://skills.sh, https://github.com/agricidaniel/banana-claude, https://github.com/fal-ai-community/skills

## 7. Hand tests, 18–19 Oct 2026

- **Gemini Flash Lite Image (free, by hand), the latte:** a big step up from the code-only version. It's clearly the owner's cup: the green rim, the speckled cup, the board and the spoon. It sits on a real oak table with window light and a shadow, in 4:5. The latte art was redrawn (simpler heart) and the spoon moved. The free output carries the visible ✦ mark; the paid API carries only the invisible SynthID. Comparison: [`assets/2026-10-18-ai-visuals/latte-compare.jpg`](assets/2026-10-18-ai-visuals/latte-compare.jpg).
- **Dreamina / Seedance (free daily credits), the cheesecake, image to video:** the slice stayed faithful (shape, caramel top, corner crumbs, Biscoff pieces, base), with a slow calm push-in and warm light. Problems: it came out 16:9 (choose 9:16), it has a visible "Dreamina AI" watermark on the free tier, and the corner crumbs turned slightly round.
- **Our own camera motion instead of AI video:** the `PhotoReel` template in `~/Projects/site-manager-demo-video` (`src/claudia/PhotoReel.tsx`, props `props/photo-reel-latte-{ai,phone}.json`). It has three shots: a push-in with name and price, a close-up of the detail, and a closing card with the logo. It runs about 10 s with music. Rendered from the AI picture and from the phone photo (`out/photo-reel-latte-{ai,phone}.mp4`). The AI-generation cost of the motion is 0 €.

## 8. To do

- **Picture templates (styles) for Claudia:** a small set of AI prompt templates the owner can pick from, or that Claudia picks by item:
  1. cosy café (oak table, window light)
  2. minimal studio (the brand colour as a seamless backdrop)
  3. viral flash close-up
  4. photo dump (2×2)
  5. collage

  Each template locks the item and names its scene, light, camera and colours. On top of each, our own text, price and logo layer goes in the café's fonts and colours.
- **Reel templates:** `PhotoReel` (from one picture), the existing `ReelV2` (cut-out on colour), and later a multi-picture reel (3 AI pictures → 3 shots).
- **Chosen provider (recommendation):** see the answer of 19 Oct. Default to Gemini Nano Banana 2 via the Gemini API.
