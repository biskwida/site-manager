# Social Post Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the ✅ / ✏️ / ❌ buttons of every social post proposal, the owner sees the exact picture for each place it goes and the exact text, and stories are 9:16 images Claudia makes itself, so what is approved is what is published.

**Architecture:** `social_post` builds every image it will publish at proposal time (the Instagram 4:5 copy already exists; a new 9:16 story copy joins it), stores them as media, and sends them as labelled photos through the existing `Messenger.sendPhoto` before `sendProposal`. A per-turn set of already-sent photo URLs stops make_visual pictures from being sent twice. The destinations publish the stored story copy.

**Tech Stack:** TypeScript, Next.js 16 server code, sharp (already used by `src/agent/social-image.ts`), vitest.

**Spec:** the design approved by the owner in chat on 16 October 2026 (copied below; nothing else is in scope).

### Design (approved 16 October 2026)

1. Every time Claudia proposes a post, for any network: first the exact picture for each place, labelled (Instagram post at 4:5 with any padding, Facebook post, story at 9:16); a picture used by two places is sent once ("Instagram + Facebook").
2. Then the exact caption, word for word; when stories are included and the caption is not empty, a line says stories show no text.
3. Then ✅ / ✏️ / ❌ as now. ✏️ leads to a new proposal, which previews again.
4. Claudia makes the 9:16 story image: the photo, whole and centred, on the café's colour (the site theme now; the brand profile's colour once that exists). A photo that is already 9:16 is used as it is.
5. A picture Claudia already sent in the same turn (make_visual) is not sent again.
6. Same behaviour on Telegram, WhatsApp and Messenger.

## Global Constraints

- Story image: exactly 1080×1920 px, JPEG (Instagram accepts nothing else), photo never cropped (`fit: "contain"`), EXIF orientation applied first.
- "Already 9:16": width/height within 1% of 9/16; such a photo gets no copy.
- Story background: `venue.theme.background` when set, otherwise `venue.theme.accent` mixed 80% toward white (each channel `round(c + (255 - c) * 0.8)`).
- Labels in the owner's language: posts first, then stories; network order Instagram, Facebook.
- Pictures are best-effort: a failed `sendPhoto` never blocks the proposal.
- No schema change: `story_image_url` is an optional field inside the change row JSON.

## Review Focus

1. A phone photo with EXIF orientation 6 (taken upright, stored sideways): the story must be upright. Test in Task 1.
2. A make_visual post plus story followed by `social_post` in the same turn: no picture sent twice, labels still sent for any picture not yet shown. Test in Task 3.
3. `sendPhoto` returns null (Meta 24-hour window closed, network error): the proposal still goes out. Test in Task 3.
4. A proposal undone later (undo row, `after = null`): no pictures. Test in Task 3.
5. An old proposal row without `story_image_url` approved after the deploy: stories publish the original photo as before. Test in Task 4.

---

### Task 1: The 9:16 story image

**Files:**
- Modify: `src/agent/social-image.ts`
- Modify: `src/domain/color.ts`
- Test: `test/social-image-story.test.ts` (create), `test/domain-color.test.ts` (extend)

**Interfaces:**
- Produces: `storyImage(bytes: Uint8Array, background: string): Promise<StoryImage>` where `type StoryImage = { kind: "ok" } | { kind: "made"; bytes: Uint8Array } | { kind: "unavailable" } | { kind: "unreadable" }` (`ok` = already 9:16, use the photo as it is; `unavailable` = sharp could not load).
- Produces: `storyBackground(theme: Theme): string` in `src/domain/color.ts` (lower-case `#rrggbb`).

- [ ] **Step 1: Write the failing tests**

```ts
it("puts a 3:4 photo whole on a 1080×1920 canvas of the background colour", async () => {
  const photo = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
  const r = await storyImage(new Uint8Array(photo), "#e8f0ee");
  expect(r.kind).toBe("made");
  const meta = await sharp(Buffer.from((r as { bytes: Uint8Array }).bytes)).metadata();
  expect([meta.width, meta.height, meta.format]).toEqual([1080, 1920, "jpeg"]);
  // top band is background, centre is photo
  const { data } = await sharp(Buffer.from((r as { bytes: Uint8Array }).bytes)).extract({ left: 540, top: 10, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  expect(Math.abs(data[0] - 0xe8)).toBeLessThan(6);
});
it("returns ok for a photo already 9:16", async () => { /* 1080×1920 input → { kind: "ok" } */ });
it("applies EXIF orientation before framing", async () => { /* 1200×900 input with withMetadata({ orientation: 6 }) → made; the photo area is portrait (the colour band is at top and bottom, not left and right) */ });
it("reports unreadable bytes", async () => { /* new Uint8Array([1,2,3]) → { kind: "unreadable" } */ });
it("storyBackground uses the theme background, else the accent mixed 80% to white", () => {
  expect(storyBackground({ accent: "#3d6b4f", background: "#F4ECE0" })).toBe("#f4ece0");
  expect(storyBackground({ accent: "#3d6b4f" })).toBe("#d8e1dc");
});
```

- [ ] **Step 2: Run** `npx vitest run test/social-image-story.test.ts test/domain-color.test.ts` — expected: FAIL (`storyImage` / `storyBackground` not exported).

- [ ] **Step 3: Implement `storyImage` in `src/agent/social-image.ts`** with the file's existing `loadSharp()`: `.rotate()`, read size, `ok` when within 1% of 9/16, else `.resize(1080, 1920, { fit: "contain", background })`, `.jpeg({ quality: 90 })` (baseline, the feed copy's settings; final-review ruling); sharp missing → `unavailable`; decode error → `unreadable`. **Implement `storyBackground` in `src/domain/color.ts`** with the existing `parseHex`.

- [ ] **Step 4: Run** the same command — expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Social: 9:16 story image on the café's colour"`

---

### Task 2: Preview pictures and the "stories show no text" line

**Files:**
- Modify: `src/domain/types.ts` (`SocialPostRow`)
- Modify: `src/domain/social-preview.ts`
- Test: `test/social-preview.test.ts`

**Interfaces:**
- Produces: `SocialPostRow.story_image_url?: string` (our storage, https, JPEG 1080×1920).
- Produces: `previewPictures(row: SocialPostRow, lang: Lang): { url: string; label: string }[]` in `src/domain/social-preview.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
const row = (o: Partial<SocialPostRow>): SocialPostRow => ({ media_id: "m", image_url: "https://x/a.jpg", caption: "Hi", targets: [], ...o });
it("one picture for Instagram and Facebook posts when they share it", () => {
  expect(previewPictures(row({ targets: ["facebook_post", "instagram_post"] }), "bg")).toEqual([{ url: "https://x/a.jpg", label: "Instagram + Facebook пост" }]);
});
it("the padded copy for the Instagram post, the original for Facebook, the story copy for stories", () => {
  expect(previewPictures(row({ targets: ["facebook_post", "instagram_post", "instagram_story", "facebook_story"], ig_feed_image_url: "https://x/p.jpg", ig_feed_ratio: "4:5", story_image_url: "https://x/s.jpg" }), "en")).toEqual([
    { url: "https://x/p.jpg", label: "Instagram post" },
    { url: "https://x/a.jpg", label: "Facebook post" },
    { url: "https://x/s.jpg", label: "Instagram + Facebook story" },
  ]);
});
it("a story without its own copy shows the original", () => { /* targets ["instagram_story"], no story_image_url → [{ url: image_url, label: "Instagram история" }] for bg */ });
it("says stories show no text when a post and a story share a caption", () => {
  const lines = socialPreviewLines(change(row({ targets: ["instagram_post", "instagram_story"], caption: "Нова торта" })), "bg");
  expect(lines.at(-1)).toBe("  (историите се публикуват без текст)");
});
```

- [ ] **Step 2: Run** `npx vitest run test/social-preview.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement** the field and `previewPictures` (one picture per published file: `instagram_post` publishes `ig_feed_image_url ?? image_url`, `facebook_post` `image_url`, `*_story` `story_image_url ?? image_url`; the places that publish the same URL merge into one picture whose label joins the labels of its formats with ", ", where a format's label is its networks joined with " + " in Instagram, Facebook order, then the format word from the file's existing `FORMAT` table; posts before stories, pictures in the order their file first appears). Exact labels: bg "пост"/"история", en "post"/"story"; the English story line reads "Instagram + Facebook story", and a file that a post and a story both publish reads "Facebook post, Facebook story". Add the stories line (bg "(историите се публикуват без текст)", en "(stories are published without text)") to `socialPreviewLines` when the targets mix posts and stories and the caption is not empty.

- [ ] **Step 4: Run** — expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Social preview: pictures per place and the no-text line for stories"`

---

### Task 3: social_post sends the pictures before the buttons

**Files:**
- Modify: `src/agent/social-tools.ts`
- Modify: `src/agent/tools.ts` (`AgentDeps`)
- Modify: `src/agent/visual-tools.ts`
- Modify: `src/agent/run.ts` (create the per-turn set)
- Test: `test/agent-social-tool.test.ts`, `test/agent-visual-tool.test.ts`

**Interfaces:**
- Consumes: `storyImage`, `storyBackground` (Task 1); `previewPictures`, `SocialPostRow.story_image_url` (Task 2).
- Produces: `AgentDeps.sentPhotos?: Set<string>` (URLs sent to the owner's chat in this turn; run.ts sets `new Set()` per turn; make_visual adds every URL it sends).

- [ ] **Step 1: Write the failing tests** (in `test/agent-social-tool.test.ts`, with the file's existing fakes and a JPEG 900×1200 photo)

```ts
it("sends each picture with its label before the proposal", async () => {
  // targets instagram_post + instagram_story, theme accent #3d6b4f
  const photos = messenger.photos;
  expect(photos.map((p) => p.caption)).toEqual(["Instagram пост", "Instagram история"]);
  const proposal = messenger.sent.find((s) => s.setId)!;
  expect(Math.max(...photos.map((p) => Number(p.messageRef)))).toBeLessThan(Number(proposal.messageRef));
  const row = (await store.getChangeSet(proposal.setId!)).changes[0].after as SocialPostRow;
  expect(row.story_image_url).toMatch(/^https:\/\//);
});
it("does not resend a picture make_visual sent in this turn", async () => { /* deps.sentPhotos has the post picture URL → only the story picture is sent */ });
it("still proposes when a picture cannot be sent", async () => { /* messenger.sendPhoto returns null → the proposal is sent, tool result status "proposed" */ });
it("posts to stories without a copy when the photo is already 9:16", async () => { /* 1080×1920 photo → row.story_image_url undefined, one picture labelled story */ });
it("undoing a social post sends no pictures", async () => { /* propose, apply, then undo_change_set on it → messenger.photos unchanged by the undo proposal */ });
```

And in `test/agent-visual-tool.test.ts`: `it("records every picture it sends in sentPhotos", …)` — after make_visual, `deps.sentPhotos` holds each picture's URL.

- [ ] **Step 2: Run** `npx vitest run test/agent-social-tool.test.ts test/agent-visual-tool.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement.** In `social_post`: read the photo once when any Instagram post or any story is targeted (reuse the existing `readPhoto` bytes); for story targets call `storyImage(bytes, storyBackground(site.venue.theme))`; `made` → `saveMedia(venueId, bytes, "image/jpeg")` (https required, same check as the padded copy) → `row.story_image_url`; `unavailable` → keep the original (no refusal; stories published the original before this change); `unreadable` → the existing "Could not read this photo" error. After `createChangeSet` and before `sendProposal`: for each `previewPictures(row, k.lang)` entry whose URL is not in `d.sentPhotos`, `await d.messenger.sendPhoto(d.chatRef, url, label)`; social_post never adds to the set, so each proposal shows all its own pictures (final-review ruling). In make_visual: add each sent URL to `d.sentPhotos`.

- [ ] **Step 4: Run** the same command, then the whole suite `npx vitest run` — expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "social_post: the exact pictures, labelled, before the buttons; Claudia makes the 9:16 story"`

---

### Task 4: Publish the story copy

**Files:**
- Modify: `src/destinations/instagram.ts` (story `image_url`)
- Modify: `src/destinations/facebook.ts` (story photo upload `url`)
- Test: `test/destinations-social.test.ts`

**Interfaces:**
- Consumes: `SocialPostRow.story_image_url` (Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
it("Instagram publishes the story copy", async () => { /* row with story_image_url → the STORIES container request carries image_url = story_image_url */ });
it("Facebook uploads the story copy", async () => { /* the unpublished /photos call for facebook_story carries url = story_image_url */ });
it("an older row without a story copy publishes the original", async () => { /* no story_image_url → image_url, as before */ });
```

- [ ] **Step 2: Run** `npx vitest run test/destinations-social.test.ts` — expected: FAIL on the first two.

- [ ] **Step 3: Implement** both destinations publish `publishedUrl(row, target)` (src/domain/social-preview.ts), the rule the preview uses: the story copy for stories, the padded copy for the Instagram feed, else the original (Task 2 ruling).

- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit -p . && npm run -s lint` — expected: all pass, no errors.

- [ ] **Step 5: Commit** `git commit -m "Destinations: stories publish Claudia's 9:16 copy"`
