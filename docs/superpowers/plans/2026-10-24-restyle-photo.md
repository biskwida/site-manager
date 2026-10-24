# Restyle a photo with AI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the owner says "restyle this photo" / "make it aesthetic" (any language), Claudia returns the same product in an aesthetic Instagram-ready photograph made by Gemini, then asks post / website / both; redo with a mood word; monthly and trial caps; clean fallback to today's card; an off-by-default "made with AI" label.

**Architecture:** A new service `restylePhoto` in `src/visual/restyle.ts` (store + read + an injected `generate` function, like `makeVisual`) does prompt, caps, saving and fallback; `src/visual/gemini.ts` is the one place that talks to the Gemini API. The service is reached through the existing `/api/visual` route as `kind: "restyle"` and a `restyle` method on `VisualClient`. The agent gets one new tool `restyle_photo` (owner only, `ensureEntitled("social")`) plus one prompt rule; `social_post` learns to label restyled media when the venue's `ai_label` flag is on.

**Tech Stack:** TypeScript (Next.js app routes on Vercel), zod, `@anthropic-ai/sdk` `betaZodTool`, Supabase (Postgres + Storage), vitest (`npm test` = `vitest run`; tests live in `test/*.test.ts`, helpers `test/helpers.ts` `makeDemo`, `test/tool-call.ts` `call`), Gemini API over `fetch` (no SDK dependency).

**Spec:** `docs/superpowers/specs/2026-10-24-restyle-photo-design.md` (read it first; its "Decisions from the builder check" are binding).

## Global Constraints

- Model `gemini-nano-banana-2.1`; endpoint `POST https://generativelanguage.googleapis.com/v1beta/interactions`; header `x-goog-api-key`; output JPEG `aspect_ratio: "4:5"`, `image_size: "1K"`; call budget 40 s. If the live API's field names differ from the spec, follow https://ai.google.dev/gemini-api/docs/image-generation and note the difference in `gemini.ts`'s header comment.
- Media path for results: `restyle/<source media id>/<n>.jpg` (saved with `store.saveMedia(venueId, bytes, "image/jpeg", { name })`, so the storage path is `<venueId>/restyle/<src>/<n>.jpg`). `n` is 1, 2, 3; a 4th generation is refused; a media whose path contains `/restyle/` is refused as a source.
- Caps: `RESTYLE_MONTHLY_LIMIT` default 30 source photos per calendar month in the venue's `tz` (`monthWindow`); `RESTYLE_TRIAL_LIMIT` default 5 source photos over the whole trial (`inFreeTrial(venue)` from `src/billing/entitlements.ts`); the stricter wins. Count distinct source ids among saved `restyle/` media, never attempts.
- Config: `GEMINI_API_KEY` (optional; absent = feature off), `RESTYLE_MONTHLY_LIMIT`, `RESTYLE_TRIAL_LIMIT`, `RESTYLE_MODEL` (default `gemini-nano-banana-2.1`). Never log the key, the prompt output or the photo.
- Owner-facing text in Bulgarian and English keyed on `k.lang === "bg"`, matching the tone of `visual-tools.ts` (short, plain). Chat caption of the result: "Restyled" / „Разкрасена". Label suffix (only when `ai_label` is on): " · made with AI" / " · създадено с AI".
- Never call Claudia an "AI assistant" anywhere (prompt, copy, comments).
- Default photo flow (`make_visual`, `make_menu_photo`) unchanged; all existing tests keep passing. Prettier/eslint as the repo has them (`npm run lint`, `npm run typecheck` if present — check `package.json` scripts).
- Commit after each task on branch `build/restyle`; never merge; the owner merges the PR.

## Review Focus

Inputs the spec implies but no task's tests would otherwise exercise; each line's test is added to the owning task below.

1. **A PNG or HEIC source photo** — the owner's phone often sends PNG; Gemini must get the real mime type, and the result is still saved as JPEG. (Task 3: `sniffType` test.)
2. **Two owners racing past the cap** — acceptable per spec, but the 31st photo after the cap must still be refused without a Gemini call. (Task 3: `generate` not called when the cap is reached.)
3. **Grandfathered venue (no plan, no trial, `billing_status` null)** — must get the monthly 30, not the trial 5, and no entitlement refusal while billing is off. (Task 3 + Task 5.)
4. **Timeout from Gemini** — `AbortSignal.timeout(40_000)` must surface as `fallback: "card", reason: "timeout"`, not as a thrown error that the route turns into HTTP 500. (Task 4.)
5. **Label on when the caption is already at Instagram's 2,200-character limit** — the suffix must be counted in the IG length check, so the check runs after the suffix is added. (Task 6.)

---

### Task 1: Store — media under a path prefix, and the `ai_label` venue flag

**Files:**
- Create: `supabase/migrations/2026-10-24-ai-label.sql`
- Modify: `supabase/schema.sql` (the venues table: same column), `src/domain/types.ts` (Venue), `src/store/types.ts` (Store, VenuePatch), `src/store/supabase.ts` (`toVenue`, new method), `src/store/memory.ts` (venue defaults, new method), `scripts/venue-set.mts`
- Test: `test/store-media-prefix.test.ts` (new), `test/venue-set.test.ts` if one exists (check with `ls test | grep venue-set`), else cover the parser in the new test file

**Interfaces:**
- Produces: `Venue.ai_label: boolean` (null in the DB = false); `VenuePatch` accepts `ai_label`.
- Produces: `Store.listMediaByPathPrefix(venueId: string, prefix: string, range?: { from: string; to: string }): Promise<Media[]>` — `prefix` is relative to the venue folder (e.g. `"restyle/"` or `"restyle/<src>/"`); `range` is ISO instants, `from` inclusive, `to` exclusive, matched on `created_at`; result ordered by `created_at` ascending.
- Produces: `venue:set --slug <slug> --ai-label on|off`.

- [ ] **Step 1: Write the failing tests** in `test/store-media-prefix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeDemo } from "./helpers";

describe("listMediaByPathPrefix", () => {
  it("returns only media under the prefix, oldest first, and filters by created_at range", async () => {
    const { store, venue } = await makeDemo();
    await store.saveMedia(venue.id, new Uint8Array([1]), "image/jpeg", { name: "restyle/a/1.jpg" });
    await store.saveMedia(venue.id, new Uint8Array([2]), "image/jpeg", { name: "restyle/a/2.jpg" });
    await store.saveMedia(venue.id, new Uint8Array([3]), "image/jpeg", { name: "restyle/b/1.jpg" });
    await store.saveMedia(venue.id, new Uint8Array([4]), "image/jpeg"); // plain photo
    const all = await store.listMediaByPathPrefix(venue.id, "restyle/");
    expect(all.map((m) => m.storage_path.split("/").slice(1).join("/"))).toEqual(["restyle/a/1.jpg", "restyle/a/2.jpg", "restyle/b/1.jpg"]);
    expect(await store.listMediaByPathPrefix(venue.id, "restyle/a/")).toHaveLength(2);
    const future = { from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" };
    expect(await store.listMediaByPathPrefix(venue.id, "restyle/", future)).toEqual([]);
  });
  it("ai_label defaults to false and can be set", async () => {
    const { store, venue } = await makeDemo();
    expect(venue.ai_label).toBe(false);
    expect((await store.updateVenue(venue.id, { ai_label: true })).ai_label).toBe(true);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run test/store-media-prefix.test.ts` → FAIL (`listMediaByPathPrefix is not a function`, `ai_label` undefined).

- [ ] **Step 3: Migration** `supabase/migrations/2026-10-24-ai-label.sql` in the style of `2026-10-19-site-mode.sql` (header comment naming this plan; `do $$ … if not exists … alter table public.venues add column ai_label boolean` nullable, no default; safe to re-run; `npm run db:apply -- supabase/migrations/2026-10-24-ai-label.sql` line). Add the same column to `supabase/schema.sql`. Server-only column: do not add it to the anon grant list.

- [ ] **Step 4: Types and stores.** `Venue.ai_label: boolean` with a doc comment ("captions and Instagram's is_ai_generated for restyled pictures; null in the DB = off"). `VenuePatch` gains `"ai_label"`. `toVenue`: `ai_label: r.ai_label === true`. Memory store venue defaults: `ai_label: v.ai_label ?? false`. Implement `listMediaByPathPrefix` in both stores: memory filters `s.media` by `storage_path.startsWith(`${venueId}/${prefix}`)` and `created_at` in range, sorted ascending; Supabase uses `.eq("venue_id", venueId).like("storage_path", `${venueId}/${prefix}%`)` plus `.gte("created_at", from).lt("created_at", to)` when a range is given, `.order("created_at")`. Escape `%` and `_` in the prefix for `like` (uuids and "restyle/" contain neither, but write the escape).

- [ ] **Step 5: `venue:set --ai-label on|off`** — add `"ai-label"` to `FLAGS`, parse `on|off` (anything else → `bad(new Error('--ai-label takes "on" or "off"'))`), `patch.ai_label = v`, print `ai label:       off -> on` in the report; update `USAGE`.

- [ ] **Step 6: Run** `npx vitest run test/store-media-prefix.test.ts` → PASS; then `npm test` → all green.

- [ ] **Step 7: Commit** — `git add -A supabase src/domain/types.ts src/store scripts/venue-set.mts test/store-media-prefix.test.ts && git commit -m "Store: media under a path prefix, ai_label venue flag"`.

---

### Task 2: Config — Gemini key, model and restyle limits

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts` (exists? `ls test | grep config`; if not, create `test/config-restyle.test.ts` using the same `loadConfig`/env pattern other config tests use — read `src/config.ts` lines 140–210 for how `optional()` and validation errors are written)

**Interfaces:**
- Produces on `Config`: `geminiApiKey: string | null`, `restyleModel: string` (default `"gemini-nano-banana-2.1"`), `restyleMonthlyLimit: number` (default 30), `restyleTrialLimit: number` (default 5).

- [ ] **Step 1: Failing test**: with no `GEMINI_API_KEY` → `geminiApiKey === null`, defaults 30 / 5 / the model string; with `RESTYLE_MONTHLY_LIMIT=abc` → throws `/RESTYLE_MONTHLY_LIMIT/`; with `RESTYLE_MONTHLY_LIMIT=0` → 0 (allowed: feature registered but every photo refused).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** next to `trialDays` (same whole-number validation, 0..10000), doc comments naming the env keys.
- [ ] **Step 4: Run** → PASS; `npm test` green.
- [ ] **Step 5: Commit** — `git commit -am "Config: GEMINI_API_KEY and restyle limits"`.

---

### Task 3: The restyle service (prompt, caps, saving, fallback)

**Files:**
- Create: `src/visual/restyle.ts`
- Test: `test/visual-restyle.test.ts`

**Interfaces:**
- Consumes: `Store.listMediaByPathPrefix` (Task 1), `monthWindow(now, tz)` from `src/domain/limits.ts`, `inFreeTrial(venue)` from `src/billing/entitlements.ts`, `sniffType(bytes)` from `src/visual/service.ts` (export it if it is not exported).
- Produces (all exported from `src/visual/restyle.ts`):

```ts
export type Mood = "default" | "darker" | "brighter" | "minimal";
export const MOODS: readonly Mood[];
export const RESTYLE_MAX_GENERATIONS = 3;
export const RESTYLE_TIMEOUT_MS = 40_000;
/** The constant prompt: the research template with the mood's CHANGE and LIGHT lines; item = the item name or "the product in the photo". */
export function restylePrompt(mood: Mood, item: string | null): string;
export type GenerateOutcome = { image: Uint8Array } | { refused: true } | { none: true };
export type RestyleGenerate = (input: { image: Uint8Array; mimeType: string; prompt: string; signal: AbortSignal }) => Promise<GenerateOutcome>;
export interface RestyleDeps {
  store: Store;
  read: (url: string) => Promise<Uint8Array | null>;
  generate: RestyleGenerate;
  limits: { monthly: number; trial: number };
  now?: () => Date;
}
export interface RestyleRequest { venueId: string; mediaId: string; mood?: Mood; item?: string | null }
export type RestyleRefusal = "source_is_restyle" | "too_many_generations" | "monthly_limit" | "trial_limit" | "no_photo";
export type RestyleResult =
  | { media_id: string; url: string; generation: number; mood: Mood }
  | { fallback: "card"; reason: "refused" | "no_image" | "timeout" | "error" }
  | { error: RestyleRefusal; used?: number; limit?: number };
export function restylePhoto(deps: RestyleDeps, req: RestyleRequest): Promise<RestyleResult>;
```

Order inside `restylePhoto`: load media (`no_photo` when missing or not this venue) → `source_is_restyle` when `storage_path` includes `/restyle/` → generations under `restyle/<src>/` ≥ 3 → `too_many_generations` → caps (trial first when `inFreeTrial(venue)`: distinct sources under `restyle/` with no range vs `limits.trial`; then monthly: distinct sources in `monthWindow(now, venue.tz)` vs `limits.monthly`; a redo of a source already counted this window does not count again) → read bytes (`no_photo` when null) → `generate` with `AbortSignal.timeout(RESTYLE_TIMEOUT_MS)` → `{refused}` → `fallback refused`; `{none}` → `fallback no_image`; thrown `TimeoutError`/`AbortError` → `fallback timeout`; any other throw → `fallback error` (log the error's class name only) → save `restyle/<src>/<n>.jpg` → result.

- [ ] **Step 1: Failing tests** in `test/visual-restyle.test.ts` (setup like `test/visual-service.test.ts`: `makeDemo`, `read` from `demo.store.files`, a `generate` spy returning `{ image: JPEG }`):
  - `restylePrompt("default", "Flat white")` contains `exact reference for the Flat white`, `a light oak table by a window`, `5500K`; `restylePrompt("darker", null)` contains `dark slate counter` and `the product in the photo`; `brighter` → `white marble`; `minimal` → `#d2c8b7`. Every mood contains the LOCK, CAMERA (`vertical 4:5`), REALISM and AVOID (`hands, people, text, logos`) lines.
  - saves the result at `<venueId>/restyle/<src>/1.jpg`, returns `generation 1`, `mood "default"`; the `generate` spy received `mimeType "image/png"` for a PNG source (Review Focus 1) and the prompt for the mood.
  - second and third calls on the same source → generations 2 and 3; the fourth → `{ error: "too_many_generations" }` and `generate` not called.
  - a `restyle/` media as source → `{ error: "source_is_restyle" }`.
  - monthly cap: `limits.monthly = 2`, three different sources → third returns `{ error: "monthly_limit", used: 2, limit: 2 }`, `generate` called twice only (Review Focus 2); a redo of source 1 still works at the cap.
  - trial cap: venue with `billing_status: "trialing"`, `stripe_subscription_id: null`, `limits.trial = 1` → second source → `{ error: "trial_limit" }`; a grandfathered venue (`billing_status: null`) with `limits.trial = 1, monthly = 30` is not stopped (Review Focus 3).
  - `generate` → `{ refused: true }` → `{ fallback: "card", reason: "refused" }` and nothing saved under `restyle/`; `{ none: true }` → `no_image`; `generate` throws `new DOMException("x", "TimeoutError")` → `timeout`; throws `Error` → `error`.
- [ ] **Step 2: Run** `npx vitest run test/visual-restyle.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/visual/restyle.ts`** per the Interfaces block. The prompt constant is the research template (`docs/research/2026-10-18-ai-visuals.md` §4) with the four CHANGE/LIGHT pairs from the spec's decision 1. Distinct sources = the path segment after `restyle/`.
- [ ] **Step 4: Run** → PASS; `npm test` green.
- [ ] **Step 5: Commit** — `git add src/visual/restyle.ts src/visual/service.ts test/visual-restyle.test.ts && git commit -m "Visual: restylePhoto service with moods, caps and fallback"`.

---

### Task 4: Gemini adapter, route `kind: "restyle"`, client `restyle`, wiring, smoke test

**Files:**
- Create: `src/visual/gemini.ts`, `test/visual-gemini.test.ts`, `test/smoke-restyle.test.ts`
- Modify: `src/server/visual.ts` (zod body + dispatch), `src/visual/client.ts` (`restyle` method), `app/api/visual/route.ts` (pass `restyle` deps when the key is set), `src/server/deps.ts:191` (client gets `restyle: config.geminiApiKey !== null`), `test/visual-route.test.ts`
- Also: `.env.example` (or wherever env keys are documented — `grep -rl TRIAL_DAYS --include='*.md' --include='*.example' .`): the four new keys.

**Interfaces:**
- Produces: `geminiGenerate(o: { apiKey: string; model: string; fetch?: typeof fetch }): RestyleGenerate` in `src/visual/gemini.ts`. Request body per Global Constraints; `{ refused: true }` when the response has no image and a finish/safety reason or HTTP 400 mentioning safety/prohibited; `{ none: true }` when 200 with no `output_image`; HTTP 429/5xx and network errors throw (the service maps them to `error`); the caller's `signal` is passed to `fetch`.
- Produces: `RestyleBody = { kind: "restyle", venueId, mediaId, mood?: Mood, item?: string (≤ 60 chars) }` in `src/server/visual.ts`; `handleVisualRequest(req, { secret, visual, restyle?: RestyleDeps })` answers 200 with the `RestyleResult` JSON for every result shape (refusals and fallbacks are 200 — they are owner outcomes, not server errors), 400 for a bad body, 404 `{ error: "restyle is not configured" }` when `restyle` is absent.
- Produces: `VisualClient.restyle?: (req: RestyleRequest) => Promise<RestyleResult>`; `httpVisualClient(o: { …; restyle?: boolean })` attaches the method only when `o.restyle` is true.

- [ ] **Step 1: Failing tests.** `test/visual-gemini.test.ts` with a fake `fetch`: asserts the URL, the `x-goog-api-key` header, the body (`model`, `input[0].type === "text"`, `input[1].type === "image"` with base64 of the bytes and the mime type, `response_format` 4:5 / 1K / image/jpeg); 200 with `interaction.output_image.data` → `{ image }` decoded; 200 without an image → `{ none: true }`; 400 whose body mentions `SAFETY` → `{ refused: true }`; 503 → throws. `test/visual-route.test.ts`: `kind: "restyle"` with the secret returns 200 and the service result (inject `restyle: { …, generate: async () => ({ image: JPEG }) }`), 404 when no `restyle` deps, 400 for `mood: "neon"`; `httpVisualClient({ …, restyle: true }).restyle` posts `kind: "restyle"`, and without `restyle: true` the method is undefined.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement** `gemini.ts`, the route body/dispatch, the client method, `deps.ts` flag, and `route.ts`: `restyle: deps.config.geminiApiKey ? { store, read, generate: geminiGenerate({ apiKey, model: config.restyleModel, fetch: deps.fetch }), limits: { monthly: config.restyleMonthlyLimit, trial: config.restyleTrialLimit } } : undefined`. The route's `read` uses a 15 s timeout today; keep it. `maxDuration` 60 stays (40 s call + read + save).
- [ ] **Step 4: Smoke test** `test/smoke-restyle.test.ts`: `describe.skipIf(!process.env.RESTYLE_SMOKE)`; reads `GEMINI_API_KEY` from env, loads a small real JPEG from `test/fixtures` (add one 600×750 coffee photo if none exists; keep under 200 KB), calls `geminiGenerate` with `restylePrompt("default", "latte")`, asserts an image of > 10 KB came back and writes it to the scratch dir named in the test comment for a human look. Document in the file header: `RESTYLE_SMOKE=1 GEMINI_API_KEY=… npx vitest run test/smoke-restyle.test.ts`. Run it once yourself only if the key is in `.env.local` of the worktree (`grep -c GEMINI_API_KEY .env.local`); if the live API rejects a field name, fix `gemini.ts` to the docs and note it in its header comment. Never print the key or the response body.
- [ ] **Step 5: Run** `npm test` → green (smoke skipped in CI).
- [ ] **Step 6: Commit** — `git add -A src/visual src/server app/api/visual test .env.example && git commit -m "Visual: Gemini restyle through /api/visual kind=restyle"`.

---

### Task 5: The `restyle_photo` tool and the prompt rule

**Files:**
- Modify: `src/agent/visual-tools.ts`, `src/agent/prompt.ts` (new rule 17 after rule 16; renumber nothing else), `src/agent/tools.ts` only if `AgentDeps` needs a comment update
- Test: `test/agent-restyle-tool.test.ts` (new; setup copied from `test/agent-social-tool.test.ts` with `visual` a fake `VisualClient` whose `restyle` is a spy), `test/prompt.test.ts` (rule assertions)

**Interfaces:**
- Consumes: `VisualClient.restyle` (Task 4), `k.ensureEntitled("social")`, `k.site()`, `d.messenger.sendPhoto`, `d.sentPhotos`, `d.notes`.
- Produces: tool `restyle_photo`, `RestylePhotoSchema = z.object({ media_id: z.string(), mood: z.enum(["default","darker","brighter","minimal"]).optional(), item_id: z.string().optional() })` exported for the prompt test. Registered by `visualTools` only when `visual.restyle` exists (after `makeMenu` in the returned array).
- Tool result JSON:
  - success: `{ media_id, generation, mood, next }` where `next` tells the agent, in one short message in the Owner language, to ask *post it / put it on the website as the photo of <item name> / both* (when `item_id` was given name the item; else "which item" is part of the question listing likely matches from get_menu), and to name the redo words once (`darker`, `brighter`, `more minimal` / „по-тъмна", „по-светла", „по-минималистична") only on generation 1.
  - fallback: `{ fallback: "card", reason, next }` — `next` carries the spec's decision 2 by intent: "for a post offer make_visual on the same media_id in this same message; for the website call make_menu_photo; when the owner only said restyle, say it couldn't be restyled and ask which of the two they want. Say people/faces when reason is refused."
  - refusals are thrown as tool errors with the owner line (BG/EN): `monthly_limit` → "That's the 30 restyles for this month; from the 1st again." / „Това бяха 30-те разкрасявания за този месец; от 1-во число отново." (number from `limit`); `trial_limit` → "The trial includes 5 restyled photos; the plan has 30 a month." / BG equivalent; `too_many_generations` → "Three versions is the most for one photo; send it again as a new photo if you want more." / BG; `source_is_restyle` → "Send the original photo; restyling always starts from it." / BG; `no_photo` → the existing NO-photo wording used by make_visual.
- Prompt rule 17 (`src/agent/prompt.ts`), one paragraph in the tone of rules 13/16: when the `restyle_photo` tool exists and the owner asks to make a photo look good — "restyle", "make it aesthetic", "make it beautiful/nicer/pro", "like a professional photo", „разкраси", „направи я красива / естетична / професионална", „разкраси снимката" — call `restyle_photo` with the photo's media_id (and item_id when the dish is clear from the photo or words); **only on request: the default "make a post" flow stays make_visual**; show nothing else until the tool answers; a mood word as the next message („по-тъмна", "darker", "brighter", "more minimal") means `restyle_photo` again with the same source media_id and that mood; after a restyled picture, "post it" → social_post with the returned media_id, "website" → propose_changes set_item_image with it (never make_menu_photo on a restyled picture), "both" → both in one turn; on `fallback` follow its `next`.

- [ ] **Step 1: Failing tests** `test/agent-restyle-tool.test.ts`:
  - `restyle_photo` is registered only when `visual.restyle` exists (`tools.map(t => t.name)`).
  - staff (`tg:1002`) → error `/owner/`.
  - owner: the spy is called with `{ venueId, mediaId, mood: "default", item: "<item name_bg/en per k.lang>" }` when `item_id` given, `item: null` without; the messenger received one photo with caption „Разкрасена" for lang bg; `sentPhotos` has the url; result has `generation 1`, `next` mentioning `social_post` and `set_item_image` and the redo words; generation 2 result's `next` has no redo words.
  - spy returns `{ fallback: "card", reason: "refused" }` → result `{ fallback: "card", reason: "refused", next: /make_visual/ }` and no photo sent.
  - spy returns `{ error: "monthly_limit", used: 30, limit: 30 }` → thrown owner line containing `30`.
  - Admin plan with billing on: set `store.billingConfig` as the social-tool tests do and `plan: "admin"` → the `ensureEntitled` not-in-plan line (copy from `test/agent-social-tool.test.ts`'s plan-gate test). Billing off + grandfathered venue → allowed (Review Focus 3).
  - `test/prompt.test.ts`: `SYSTEM_PROMPT` matches `/restyle_photo/`, `/разкраси/`, `/make it aesthetic/i`, `/only on request|only when the owner asks/i`, and still matches the existing make_visual assertions.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the tool in `visual-tools.ts` (pattern of `make_menu_photo`: `k.attempt`, owner check, `await k.ensureEntitled("social")`, item lookup via `k.site()` when `item_id` given → `item_id not found; use an id from get_menu.`), `d.notes?.push(`restyle from photo ${media_id}: ${result.media_id} (${mood}, generation n)`)`, and rule 17 in `prompt.ts`.
- [ ] **Step 4: Run** → PASS; `npm test` green.
- [ ] **Step 5: Commit** — `git add src/agent test/agent-restyle-tool.test.ts test/prompt.test.ts && git commit -m "Agent: restyle_photo tool and prompt rule"`.

---

### Task 6: The AI label (off by default) in `social_post` and Instagram

**Files:**
- Modify: `src/domain/types.ts` (`SocialPostRow.ai_generated?: boolean`), `src/agent/social-tools.ts` (caption suffix + flag), `src/destinations/instagram.ts:146` (body field), `src/destinations/facebook.ts` only if a caption is built there from the row (read it; the caption is already in `row.caption`, so likely no change)
- Test: `test/agent-social-tool.test.ts` (two cases), `test/destinations-social-retry.test.ts` or the Instagram adapter test (`ls test | grep -i instagram`): one case

**Interfaces:**
- Consumes: `Venue.ai_label` (Task 1); media `storage_path` containing `/restyle/`.
- Produces: when `venue.ai_label === true` and the media's `storage_path` includes `/restyle/`: `row.caption = caption + " · made with AI"` (lang en) or `" · създадено с AI"` (lang bg) — the suffix language follows `k.lang` — and `row.ai_generated = true`; otherwise the row is unchanged (no `ai_generated` key). The Instagram adapter sends `is_ai_generated: true` in the `/{ig_user_id}/media` body for `instagram_post` and `instagram_story` when `row.ai_generated` is true.

- [ ] **Step 1: Failing tests.** In `test/agent-social-tool.test.ts`: (a) venue `ai_label: true`, photo saved with `{ name: "restyle/src/1.jpg" }` → the proposal's row caption ends with „ · създадено с AI" (lang bg) and `ai_generated === true`; the same with a plain photo → caption unchanged, no `ai_generated`; `ai_label` false + restyled photo → unchanged. (b) Review Focus 5: a 2,195-character caption with the label on → the tool refuses with the 2,200 line (suffix counted). Adapter test: a row with `ai_generated: true` → the fake Meta's recorded `/media` body has `is_ai_generated: true`; without it the key is absent.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in `social-tools.ts` right after `caption` is trimmed and the media `m` is loaded (move the IG length/hashtag checks after the suffix), and in `instagram.ts` body construction.
- [ ] **Step 4: Run** → PASS; `npm test` green.
- [ ] **Step 5: Commit** — `git commit -am "Social: optional 'made with AI' label and is_ai_generated for restyled pictures"`.

---

### Task 7: Whole-branch check and the PR

**Files:** none new; `docs/superpowers/specs/2026-10-24-restyle-photo-design.md` gets a one-line "Built: PR #<n>" note only after the PR exists.

- [ ] **Step 1:** `npm run typecheck` (or `npx tsc --noEmit`), `npm run lint`, `npm test` → all green; fix anything that is not.
- [ ] **Step 2:** Read the diff `git diff main...HEAD --stat` and confirm every spec section maps to code: trigger phrases (Task 5), service (3), model/prompt (3, 4), result path/caption/sentPhotos (3, 5), post/website/both (5 `next`), redo (3, 5), limits (1–3, 5), config (2), fallback (3–5), labelling (1, 6), tests, rollout.
- [ ] **Step 3:** Push `git push -u origin build/restyle` and open the PR against `main` with `gh pr create` — title "Restyle a photo with AI (Gemini) in the bot", body: what the owner can now say, the four env keys (names only, no values), the migration to apply (`npm run db:apply -- supabase/migrations/2026-10-24-ai-label.sql`), the smoke-test command, "ai_label is off; turn on with venue:set --ai-label on", and the production check from the spec's Rollout. End the body with the attribution line from the session's instructions. Do **not** merge.
