# Menu Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the owner asks for a clean website photo ("махни фона", "бял фон", "смени снимката на капучиното в сайта с обработената"), Claudia makes a plain product photo: only the object, centred on pure white, square, with no text, circle or shadow. She proposes it as the item's photo, and she never uses the Instagram card for this.

**Architecture:**
- **Cutout cleanup.** The existing local cutout (`@imgly/background-removal-node` in the `/api/visual` function) gains a step that keeps only the main object. Stray fragments such as a table corner are dropped.
- **New render.** A second render path composes that cutout on a 1200×1200 white square with sharp, with no satori card. The `/api/visual` route serves both kinds.
- **New agent tool.** `make_menu_photo(media_id, item_id)` makes the photo, sends it to the chat and returns its `media_id`. The agent then proposes `set_item_image` with it, through the usual ✅/✏️/❌ flow.
- **Price fix.** make_visual takes the price from the menu when it knows the item, formatted by the code, so the price is never guessed.

**Tech Stack:** TypeScript, vitest, sharp 0.35 (raw pixel access), `@imgly/background-removal-node` 1.4.5 (existing), Next.js route `app/api/visual`.

**Spec:** the owner's request "if I say make it like the rest, can it see what most of the menu items' backdrops are and propose the same?" (17 Oct; Task 2b), and the owner's chat with Claudia on 17 October 2026 (6 screenshots) and the owner's answers ("Write a plan first"; shape: "Match the site").
- The request: "Can you remove the background make it white and change the picture of the cappuccino form the website with the processed one".
- The owner's corrections: "I want it all white like the rest of the menu items on the site and I want the cappuccino centred"; "I don't want the background shadow and the circle I want all white background also you've captured a pice of the table on the left we want just the cup and it to be centerded".
- What went wrong, from the screenshots and the code:
  - make_visual is the only picture tool, and it always draws the card: name, price pill, grey circle and shadow.
  - The cutout kept a piece of the table, because there is no largest-object filtering in `src/visual/cutout.ts`.
  - The price on the card was guessed (3,20 € against 4,00 € on the menu) and its format changed between cards (€4.00, 3,20 €, 4,00 €).

**Base branch:** build on `build/conversation-language` (it contains PR #15 and the language work, which both touch `src/agent/visual-tools.ts` and `src/agent/prompt.ts`), so this PR goes after those two.

## Global Constraints

- **Menu photo:** 1200×1200 JPEG, baseline, quality 90, sRGB, background `#ffffff`.
  - The object's bounding box is scaled to fit inside a centred 912×660 box (12% white margin left and right) and centred on both axes. No upscaling beyond 2× the cutout's own size.
  - No text, logo, circle, shadow or rotation.
- **Why square with a 912×660 box ("Match the site"):** every template shows item photos with `object-fit: cover`. Furna, kvartal and lumen tiles are 1:1, mehana uses circles, the classic and nocturne list rows are 64–80 px squares, and the specials are 4:3 or 16:9. A 16:9 slot crops a square to its central 675 px band, so an object at most 660 px tall and centred stays whole in every slot. Mehana's circle cuts the corners, which the white margins cover.
- **Main object:**
  - Alpha above 16 counts as object.
  - 8-connected components are computed on a mask downscaled so its longer side is at most 512 px.
  - Keep the largest component and any component at least 25% of its area. Everything else becomes transparent at full resolution.
  - Then trim, as today.
- **Failure handling:** if the cutout is null (nothing found), or the kept object is under 3% of the photo, no picture is made. The tool answers: "Could not separate the object from this photo; ask the owner for a photo of the item alone on a plain surface, taken straight on."
- **make_visual price:**
  - When `item_id` is given, the printed price is `formatPrice(item.price_eur, pictureLang)`, where `pictureLang = baseLang(owner lang)`. Any `price` the model passed is ignored.
  - Without `item_id`, the price is the owner's text or omitted, never invented.
- **Stored text:** menu photos never carry text, so they need no keep markers and no translation.

## Review Focus

1. **A cup with a thin handle,** or a glass with a stem: the handle or stem must survive the main-object step. Use alpha > 16 with 8-connectivity, and test a ring with a 2-px-wide handle (Task 1).
2. **Two equal pieces** (two cookies, a croissant and a cup): both are kept, because each is ≥ 25% of the largest (Task 1).
3. **An object touching the photo edge,** or a very small object: it is still centred, with no upscale above 2×, and under 3% of the photo it is refused (Task 2).
4. **Asking for a white-background website photo:** this must call make_menu_photo, never make_visual. A post or story request still uses make_visual. Pinned in the prompt test (Task 3).
5. **make_visual for a menu dish:** the printed price equals the menu price in the owner's format, even when the model passes a different one (Task 4).

---

### Task 1: Keep only the main object in the cutout

**Files:**
- Create: `src/visual/main-object.ts`
- Modify: `src/visual/cutout.ts` (call it before the trim)
- Test: `test/visual-main-object.test.ts`

**Interfaces:**
- Produces: `keepMainObject(png: Uint8Array): Promise<{ png: Uint8Array; coverage: number }>`. It returns the PNG with only the main object opaque (other pixels' alpha set to 0, untrimmed), plus `coverage`, the kept object's share of all pixels (0..1).

- [ ] **Step 1: Failing tests.** Build the PNGs with sharp from raw RGBA buffers.

```ts
it("drops a small fragment beside the main object", async () => { /* 400x400: filled circle r=120 at (200,200) + 30x30 square at (10,370) → square's pixels alpha 0, circle kept */ });
it("keeps two pieces of similar size", async () => { /* two circles r=80 and r=70 → both kept */ });
it("keeps a thin handle attached to the cup", async () => { /* ring r=100 + 2-px-wide arc handle touching it → handle pixels still opaque */ });
it("treats faint alpha (≤16) as background", async () => { /* a 50x50 patch at alpha 10 is not a component */ });
it("reports coverage", async () => { /* circle r=120 in 400x400 → coverage ≈ 0.28 (±0.02) */ });
```

- [ ] **Step 2: Run** `npx vitest run test/visual-main-object.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
  - Read the raw RGBA with `sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })`.
  - Build the downscaled mask (longer side ≤ 512, nearest neighbour; a pixel is on when its alpha is > 16).
  - Label the mask with an iterative 8-connected flood fill, using an explicit stack and no recursion.
  - Choose the kept labels, then zero alpha at full resolution wherever the scaled-up label is not kept.
  - In `cutout.ts`, after `removeBackground`, apply `keepMainObject`, then use its `coverage` in place of the existing 3% alpha-mean check, then trim.
- [ ] **Step 4: Run.** Expected: PASS. Then run `npx vitest run`.
- [ ] **Step 5: Commit** `git commit -m "Cutout keeps only the main object: stray fragments such as a table corner are dropped"`

---

### Task 2: The menu photo render and service

**Files:**
- Create: `src/visual/menu-photo.ts`
- Modify:
  - `src/visual/service.ts` (`makeMenuPhoto`)
  - `src/server/visual.ts` (the body accepts `{ kind: "menu", venueId, mediaId }`)
  - `src/visual/client.ts` (`menuPhoto(...)` on the VisualClient)
  - `app/api/visual/route.ts`
- Test: `test/visual-menu-photo.test.ts`, `test/visual-route.test.ts`, `test/visual-service.test.ts`

**Interfaces:**
- Produces:
  - `renderMenuPhoto(cutoutPng: Uint8Array): Promise<Uint8Array>`, which returns the JPEG described in Global Constraints.
  - `makeMenuPhoto(d, { venueId, mediaId }): Promise<{ media_id: string; url: string } | { error: "no_object" }>`. It reuses the cached cutout at `${venueId}/cutouts/${mediaId}.png` when present, else runs `cutout` and caches it, as `makeVisual` does.
  - `VisualClient.menuPhoto(req)` over the same authenticated route.

- [ ] **Step 1: Failing tests**

```ts
it("puts the object on pure white, square, centred", async () => { /* cutout = red 300x200 rectangle PNG → 1200x1200 JPEG; corners (5,5),(1195,1195) are white (each channel ≥ 250); the red box's centre is within 2 px of (600,600) */ });
it("fits the object inside the 912x660 box", async () => { /* a tall 200x600 cutout → its height on the output ≤ 660 */ });
it("never upscales more than 2x", async () => { /* a 50x50 cutout → output object ≤ 100x100 */ });
it("is a baseline JPEG", async () => { /* sharp metadata: format jpeg, isProgressive false, width 1200, height 1200 */ });
it("refuses when the cutout finds nothing", async () => { /* cutout → null → { error: "no_object" }, nothing saved */ });
it("reuses the cached cutout", async () => { /* second call → cutout not run again */ });
it("the route serves kind menu with the same secret check", async () => {});
```

- [ ] **Step 2: Run** `npx vitest run test/visual-menu-photo.test.ts test/visual-service.test.ts test/visual-route.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with sharp:
  - Trim the cutout.
  - Resize it with `fit: "inside"` into 912×660, `withoutEnlargement` past 2× (compute the scale yourself).
  - Composite it, centred, onto `sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#ffffff" } })`.
  - Encode with `.jpeg({ quality: 90 })`.
  - Save with `store.saveMedia(venueId, jpeg, "image/jpeg")`.
- [ ] **Step 4: Run.** Expected: PASS. Then run the full suite.
- [ ] **Step 5: Commit** `git commit -m "Menu photo: the object alone, centred on a white square"`

---

### Task 2b: "Make it like the rest": match the menu's house style

**Owner, 17 Oct 2026:** "if I say make it like the rest can it see what most of the menu items backdrops are and propose the same?"

**Files:**
- Create: `src/visual/house-style.ts`
- Modify: `src/visual/service.ts` (`makeMenuPhoto` takes the style), `src/visual/menu-photo.ts` (background colour and fill as inputs)
- Test: `test/visual-house-style.test.ts`, `test/visual-menu-photo.test.ts`

**Interfaces:**
- Produces: `houseStyle(photos: Uint8Array[]): Promise<{ background: string; fill: number; matched: number; of: number } | null>`.
  - `photos` are the venue's current item photos (every item with an `image_media_id`, at most 30, read through the existing `read`).
  - For each photo, sample the outer 4% ring of pixels. The photo has a plain backdrop when the ring's per-channel standard deviation is ≤ 12; that backdrop is the ring's median colour.
  - Plain backdrops within ΔE (CIE76) 10 of each other form one group.
  - The largest group wins when it holds at least 2 photos and at least half of the photos read. `background` is that group's median `#rrggbb`. `fill` is the median share of the photo's longer side taken by the object, read from the non-backdrop bounding box and clamped to 0.5..0.85.
  - Otherwise the result is `null`: too few photos, or busy or mixed backdrops.
- `renderMenuPhoto(cutoutPng, { background = "#ffffff", fill })`:
  - with `fill`, the fit box becomes `fill × 1200` wide and at most 660 high;
  - without it, use Task 2's 912×660.
- `makeMenuPhoto(d, { venueId, mediaId, style: "match" | "white" })`:
  - `"match"` uses `houseStyle` and falls back to white when it is `null`;
  - the result says which was used: `{ media_id, url, style: { background, matched, of } | "white", reason?: "no_photos" | "mixed" }`.

- [ ] **Step 1: Failing tests**

```ts
it("finds the shared backdrop of most item photos", async () => { /* 3 photos with a #f4efe6 ring and a dark centre object + 1 busy photo → background ≈ #f4efe6, matched 3 of 4 */ });
it("returns null when the backdrops disagree", async () => { /* #ffffff, #222222, #c8e6d0 → null */ });
it("returns null with fewer than 2 photos", async () => {});
it("reads the object size from the others", async () => { /* objects filling ~60% → fill ≈ 0.6 */ });
it("a matched menu photo uses that background and size", async () => { /* corners ≈ #f4efe6; object width ≈ 0.6 × 1200 */ });
it("falls back to white and says why", async () => { /* no item photos → style "white", reason "no_photos" */ });
```

- [ ] **Step 2: Run** `npx vitest run test/visual-house-style.test.ts test/visual-menu-photo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with sharp raw pixels (no new dependency). The ΔE uses the sRGB → Lab conversion in a small helper next to `src/visual/palette.ts`, reusing what is there if it already converts.
- [ ] **Step 4: Run.** Expected: PASS, then the full suite.
- [ ] **Step 5: Commit** `git commit -m "Menu photo matches the menu's house style: the backdrop and size most item photos share"`

**Task 3 changes accordingly:**
- `make_menu_photo` takes `style: "match" | "white"`.
  - Default `"match"` when the owner says "like the rest", "като другите" or "same as the menu".
  - `"white"` when they say "white" or "бял фон".
- The tool's result tells the agent what it found, and the agent says it in one line:
  - "Used the cream backdrop 3 of your 4 menu photos share."
  - "Your other items have no photos, so I used white."
  - "Your menu photos have different backdrops, so I used white."

---

### Task 3: The make_menu_photo tool and the prompt rule

**Files:**
- Modify:
  - `src/agent/visual-tools.ts` (new tool next to make_visual)
  - `src/agent/prompt.ts`
  - `src/domain/preview.ts`, only if the `set_item_image` preview needs the picture. It does not: the photo is sent before the proposal, as in the post preview.
- Test: `test/agent-visual-tool.test.ts`, `test/prompt.test.ts`

**Interfaces:**
- Consumes: `VisualClient.menuPhoto` (Task 2).
- Produces: the tool `make_menu_photo { media_id: string; item_id: string }`, available only to the owner role and only when `d.visual` is present.
  - The item must exist; otherwise the error is "item_id not found; use an id from get_menu."
  - On success it sends the photo with the caption "Снимка за менюто" / "Menu photo" (`sendPhoto`; the URL is recorded in `sentPhotos`).
  - It returns `{ media_id, next: "Propose set_item_image for item <id> with this media_id now (propose_changes). Say nothing else about the picture." }`.
  - On `no_object` it returns the Global Constraints refusal text as the error.

- [ ] **Step 1: Failing tests**

```ts
it("makes the menu photo, sends it, and tells the agent to propose set_item_image", async () => {});
it("refuses an unknown item", async () => {});
it("passes on the no-object refusal", async () => {});
it("is not offered without the picture service or to staff", async () => {});
it("the prompt sends website photo requests to make_menu_photo", () => {
  expect(SYSTEM_PROMPT).toMatch(/make_menu_photo/);
  expect(SYSTEM_PROMPT).toMatch(/never make_visual for a website/i);
});
```

- [ ] **Step 2: Run** `npx vitest run test/agent-visual-tool.test.ts test/prompt.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The prompt gets a new numbered rule, keeping the numbering continuous:
  - "Website/menu photos: when the owner asks to clean a photo for the website or menu (remove the background, white background, 'обработи я', 'махни фона'), call make_menu_photo with the photo and the item, then propose set_item_image with the media_id it returns; never make_visual for a website photo, and never put its card on the site."
  - "make_visual is only for Instagram/Facebook posts and stories."
  - "A photo the owner sends as it is ('това е новата снимка') still goes straight to set_item_image (rule 8)."
- [ ] **Step 4: Run.** Expected: PASS. Then run the full suite, tsc and lint.
- [ ] **Step 5: Commit** `git commit -m "make_menu_photo: a clean website photo, proposed as the item's photo"`

---

### Task 4: make_visual prints the menu price

**Files:**
- Modify: `src/agent/visual-tools.ts`
- Test: `test/agent-visual-tool.test.ts`

**Interfaces:**
- Produces: `MakeVisualSchema.item_id?: string`, described as "the menu item when the dish is on the menu; the price then comes from the menu".
  - With `item_id`, the price sent to the service is `formatPrice(item.price_eur, baseLang(owner lang))`, whatever `price` says.
  - An unknown `item_id` gives the error "item_id not found; use an id from get_menu."

- [ ] **Step 1: Failing tests**

```ts
it("prints the menu price for a menu item, in the owner's format", async () => { /* item Cappuccino price_eur 4, owner bg, model passes price "3,20 €" → service receives "4,00 €" */ });
it("an English owner gets €4.00", async () => {});
it("without item_id the model's price is used as before", async () => {});
```

- [ ] **Step 2: Run** `npx vitest run test/agent-visual-tool.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Also update the price description: "Omit when you pass item_id; else the owner's price, else omit — never estimate."
- [ ] **Step 4: Run.** Expected: PASS. Then run the full suite.
- [ ] **Step 5: Commit** `git commit -m "make_visual: the menu price, formatted by the code, for menu items"`
