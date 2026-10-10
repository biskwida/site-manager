# Site Manager Templates & Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A café owner picks one of three templates, fills a web wizard with live preview (menu can be extracted by Claude from a photo or PDF), publishes, connects Telegram, and gets their own site deployed automatically as a new Vercel project that the Telegram agent manages from then on.

**Architecture:** Templates live once in `src/templates/<id>` and render both inside Site Manager (`/[slug]`, previews, drafts) and inside a thin per-venue Next.js shell (`templates/shell`) that is deployed through the Vercel REST API with inline files and reads the venue's public JSON feed. The wizard keeps a `WizardDraft` JSON on a `status: draft` venue until publish, which materialises categories, items, texts and an auto-applied image change set. Deploy starts when the owner redeems the Telegram invite; the tick and the status endpoint poll Vercel. Everything runs offline with the memory store and a `FakeDeployer`.

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript 5.9, Tailwind 4 (`@tailwindcss/turbopack`), zod 4.6, @anthropic-ai/sdk 0.133 (`claude-opus-5-5`), Supabase (Postgres + Storage), grammy 1.46, vitest 5, Vercel REST API (`/v11/projects`, `/v13/deployments`, `/v3/deployments/{id}/events`, `/v10/projects/{id}/domains`), next/font/google with Cyrillic subsets, qrcode.react.

**Spec:** `docs/superpowers/specs/2026-10-10-site-manager-templates-design.md` (its "Interface contracts" section is binding for every task).

## Global Constraints

- Every user-facing string exists in Bulgarian and English and both read naturally; BG is listed first in copy maps; the venue's `default_lang` decides the initial language.
- Fonts come from `next/font/google` with `subsets: ["latin", "cyrillic"]`; a font without a Cyrillic subset is a defect (this overrides any design skill's font list).
- Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `VERCEL_TOKEN`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`) are read only in `src/config.ts` and used only in `src/server/**`, `src/deploy/**`, `src/wizard/extract.ts`, `src/wizard/texts.ts`, `scripts/**` and route handlers; never in `src/templates/**`, `src/i18n/**`, `app/**/components/**` or any `"use client"` file. Never log tokens, full provider responses, or Telegram file URLs.
- Offline-first: `SITE_MANAGER_STORE=memory` plus `FakeDeployer` must exercise every flow; the default `npm test` never touches the network. Live checks are opt-in by env.
- Draft venues (`status: "draft"`) are invisible to anonymous readers (RLS) and to `loadSite` without the draft token; `/api/site/[slug]` returns 404 for them.
- Vercel project names are derived from the validated slug (`^[a-z0-9][a-z0-9-]{1,38}$`, not in `RESERVED_SLUGS`); the production URL is always read back from the API, never assumed.
- Prices stay in EUR cents semantics (`PRICE_MIN` 0.10, `PRICE_MAX` 500); allergen codes 1–14 only.
- Design tasks (3, 4, 9) must invoke `impeccable` (which reads `.impeccable.md` in the repo root), `design-taste-frontend`, `emil-design-eng`, `high-end-visual-design`, `apple-design` and `frontend-design` before coding and record it in the report; reviewers of those tasks run `review-animations` and `web-design-guidelines`. Motion: transform/opacity only, interruptible, respects `prefers-reduced-motion`.
- Mobile first: no horizontal scroll at 360 px, tap targets ≥ 44 px, body text contrast ≥ 4.5:1, visible focus rings.
- Tests live in `test/*.test.ts` (vitest, node environment, `@/` alias); component tests use `renderToStaticMarkup` inside `LangProvider`; `npm test`, `npm run typecheck` and `npm run build` must be green at the end of every task that touches `app/**`.
- Commit after every green step with a conventional message; never commit `.env*` (except `.env.example`) or `src/templates/current.ts`.

## Review Focus

1. **A slug the owner changes after uploading photos** — media rows carry the venue id, not the slug, so photos must survive the rename; the published site must show them (Task 7 `publishDraft` test uploads before the final slug is set).
2. **Publishing twice or refreshing the done page** — a second `POST /publish` on a live venue must return the same slug and a 409, never create a second invite or a second deploy; the done page must keep working from the cookie after publish (Task 7 test "publish is idempotent", Task 10 status test).
3. **Vercel says READY but the alias is not assigned yet** — `status()` must report `building` until `aliasAssigned` is true, otherwise the owner gets a dead URL (Task 6 test "ready without alias stays building").
4. **A menu photo in BGN with mixed items (e.g. "4,50 лв")** — extraction must convert at 1.95583, round to cents, keep `currency_seen: "BGN"`, and the review UI must show the conversion note (Task 8 test, Task 9 ExtractReview renders the note).
5. **A venue whose template is switched while a deploy is still building** — `set_template` must refuse with 409 while `deploy.status` is `pending` or `building` (Task 10 test).

---

## Controller rulings (binding; they override any conflicting sentence inside a task)

Tasks were written in parallel. Where two tasks disagree, these rulings decide. Each implementer reads the rulings that name their task.

- **R1 Links (Tasks 3, 4, 9):** every template builds its Home/Menu links with `pageHref(slug, "home" | "menu")` from `src/templates/shared/links.ts` (Task 2). No `/${slug}` literals in `src/templates/**`. The deployed shell sets `NEXT_PUBLIC_SITE_STANDALONE=1` so the same code links to `/` and `/menu` there.
- **R2 Draft bars (Tasks 3, 4):** templates never call the admin API and never render Apply/Reject. `app/[slug]/page.tsx` renders `DraftBanner` (kept under `app/[slug]/components`) as a sibling before the template. A template may show a passive "Draft preview" label from `draft.summary_bg/en` and must honour `live=false` (no polling). `DraftInfo` is the superset defined in Task 1: `{ id, status, summary_bg, summary_en, preview_bg, preview_en, key }`.
- **R3 Draft cookie (Tasks 2, 7, 10):** one module, `src/server/draft-cookie.ts`, created in **Task 7** with exactly these exports: `DRAFT_COOKIE = "sm_draft"`, `draftCookieValue(id, token)`, `parseDraftCookie(value): { id: string; token: string } | null`, `venueFromDraftCookie(store, value, pathId): Promise<Venue | null>` (hash-compares via `sha256Hex`, checks `pathId` when given). Task 7 does not create `src/server/draft-cookie.ts`; wherever Task 7's text says `draft-cookie`, read `draft-cookie`. Task 10 imports it instead of creating it (its "Create src/server/draft-cookie.ts" step becomes "verify it exists; add any missing export from this list"). Task 2's inline cookie parsing in `app/[slug]/load.ts` stays as written (it predates the module).
- **R4 Wizard schema file (Tasks 1, 7):** Task 1 creates `src/wizard/schema.ts` with the contract's types and constants only. Task 7 replaces the file with the full version (zod schemas, `emptyDraft`, `validateForPublish`) keeping every exported name and type from Task 1 identical.
- **R5 Clock (Tasks 3, 4):** use `useNow(initial)` from `src/templates/shared/useLiveSite.ts` (Task 2) instead of a template-local `useClock`; delete the local hook.
- **R6 Custom domain (Tasks 6, 11):** `VercelDeployer.addDomain` and `FakeDeployer.addDomain` are implemented in Task 6 as written there. Task 11 does **not** modify `src/deploy/vercel.ts` or `src/deploy/fake.ts`; `src/deploy/vercel-domains.ts` keeps only the pure `normalizeDomain` (and `instructionsFrom` if Task 11's UI needs it), and `test/deploy-vercel-domains.test.ts` exercises Task 6's `VercelDeployer.addDomain` through an injected fetch. Task 11 adds the optional `custom_domain?: string | null` to `DeployInfo` in `src/domain/types.ts`.
- **R7 Template switch while deploying (Task 10):** `set_template` returns 409 `{ error }` (BG/EN) while `deploy.status` is `pending` or `building`; otherwise it calls `deployer.redeploy` directly and sets `deploy.status = "building"` with the new `template`. `startDeploy` (Task 6) is not used for switches.
- **R8 Fonts in tests (Tasks 2–4, 9, 10):** the global `vi.mock("next/font/google")` lives in `test/setup.ts` (Task 2, registered in `vitest.config.mts`). Per-file mocks in later tasks are allowed but not required; never import `src/templates` from `src/server/**`.
- **R9 Registry placeholders (Tasks 2–4):** Task 2 registers `nocturne` and `lumen` as the classic `def` with their own ids (placeholders). Tasks 3 and 4 replace those two lines with `import { def as nocturne } from "./nocturne"` / `"./lumen"`.
- **R10 Draft token after publish (Tasks 6, 7, 10):** `publishDraft` keeps `draft_token_hash` (the done page and `/status` authenticate with the cookie for 7 days). `cleanupDrafts` deletes only `status = "draft"` venues older than 48 h; a published venue is never deleted by the tick.
- **R11 Dictionary edits (all UI tasks):** `src/i18n/dicts.ts` is edited by several sequential tasks; if a quoted anchor has moved, append the new keys at the end of the same dictionary block and keep BG first.
- **R12 Design skills (Tasks 3, 4, 9):** before writing any component, invoke `impeccable` (reads `.impeccable.md`), `design-taste-frontend`, `emil-design-eng`, `high-end-visual-design`, `apple-design`, `frontend-design`; state the one-line Design Read in the report. Reviewers of these tasks run `review-animations` and `web-design-guidelines`.
- **R13 Done page inputs (Tasks 9, 10):** Task 9's Review step redirects to `/new/<id>/done?code=<invite_code>&key=<admin_token>` after `POST /publish`; Task 10's fallbacks (issue a new invite when `?code=` is missing and no owner exists; `getAdminToken` when `?key=` is missing) stay.
- **R14 Tick nudge (Tasks 6, 10):** `handleTickRequest` with `?key=<admin token>` runs the per-venue tick including `pollDeployments` (Task 6 wires `deployer` into it); `DoneStatus` may POST it every 30 s for 10 minutes while publishing, and `/api/new/[id]/status` polls the deployer itself (Task 7).
- **R15 Rate-limit salt (Tasks 1, 12):** `rateSalt` defaults to `"dev-salt"` even in strict mode so production keeps working before `RATE_SALT` is set; Task 12 documents setting it.
- **R16 Accent defaults (Tasks 3, 4, 7):** `src/wizard/schema.ts` (full version from Task 7) exports `TEMPLATE_ACCENT_DEFAULTS: Record<TemplateId, string>`; Task 7's implementer copies the real values from `src/templates/nocturne/index.ts` and `src/templates/lumen/index.ts` (both exist by then) and adds a test (`test/wizard-schema.test.ts`, using the global font mock from `test/setup.ts`) asserting `TEMPLATE_ACCENT_DEFAULTS[id] === TEMPLATES[id].accentDefault` for every id.
- **R17 Anthropic client on the server (Task 8):** `ServerDeps` gains `anthropic: Anthropic | null`, built once in `makeServerDeps` from `o.client ?? (config.anthropicApiKey ? new Anthropic({ apiKey }) : null)`; wizard AI routes return 503 `ai_unavailable` when it is null. This is a spec addition.
- **R18 No forced tool choice (Task 8):** `claude-opus-5-5` rejects `tool_choice: { type: "tool", name }`; `extractMenu` and `draftTexts` use `tool_choice: { type: "auto", disable_parallel_tool_use: true }`, `strict: true` on the single tool, and a prompt rule to call it exactly once; a response without the tool call is `"error"`. The spec's "Claude helpers" paragraph is updated accordingly.
- **R19 Draft cookie exports (Task 7, supersedes the file name in R3's Task 7 text):** the module is `src/server/draft-cookie.ts` and exports `DRAFT_COOKIE`, `COOKIE_NAME` (same value), `draftCookieValue`, `parseDraftCookie`, `readDraftFromCookies`, `venueFromDraftCookie`. Task 7's `draft-cookie.ts` text applies to this file name; Task 10 imports from it.
- **R20 Slug uniqueness (Task 7):** only live venues block a slug; drafts keep their `draft-<8hex>` row slug until publish; the second of two drafts choosing the same slug gets 409 `slug_taken` at publish. `validateForPublish` rejects empty and `draft-*` slugs.

---

### Task 1: Schema, domain types and Store additions (template, business type, status, deploy, draft token, rate limits)

> **Rulings that apply to this task:** R4, R15 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Create: `src/server/hash.ts`, `src/wizard/schema.ts` (types and constants only; Task 7 adds the zod schemas to this same file), `test/hash.test.ts`
- Modify: `src/domain/types.ts`, `src/store/types.ts`, `src/store/memory.ts`, `src/store/supabase.ts`, `supabase/schema.sql`, `supabase/policies.sql`, `scripts/check-rls.mts`, `src/config.ts`, `src/server/site.ts`, `src/seed/demo.ts`, `.env.example`, `test/fixtures.ts`
- Test: `test/store-contract.ts` (covers memory and the opt-in Supabase run), `test/config.test.ts`, `test/site-server.test.ts`, `test/hash.test.ts`

**Interfaces:**
- Consumes: nothing new (first task of the branch). Existing `Store`, `Venue`, `NewVenue`, `loadSite`, `loadConfig`.
- Produces (verbatim from the spec contracts): `TemplateId`, `TEMPLATE_IDS`, `BusinessType`, `BUSINESS_TYPES`, `VenueStatus`, `DeployStatus`, `DeployInfo`, `DraftInfo` in `src/domain/types.ts`; `Venue` gains `template`, `business_type`, `status`, `deploy`, `wizard_draft`; `VenuePatch` and `NewVenue` extensions in `src/store/types.ts`; `Store.updateVenue(id, patch)`, `setDeploy(id, deploy)`, `listVenues(opts?)`, `setDraftToken(id, tokenHash)`, `findVenueByDraftToken(tokenHash)`, `listMembers(venueId)`, `deleteVenue(id)`, `bumpRateLimit(key, windowMs, max, now)`; `sha256Hex(s)`, `newDraftToken()` in `src/server/hash.ts`; `WizardDraft`, `WizardCategory`, `WizardItem`, `WizardStep`, `WIZARD_STEPS`, `SLUG_RE`, `RESERVED_SLUGS` in `src/wizard/schema.ts`; `Config.vercelToken`, `vercelTeamId`, `rateSalt`, `maxSitesPerDay`, `telegramBotUsername`; `loadSite(store, slug, { draftId?, key?, draftToken? })` returning `null` for a draft venue unless the token matches; `DraftInfo.key`.

Decisions this task fixes (the spec leaves them open; the controller may override):
- `DraftInfo` keeps the fields the existing `DraftBanner` needs (`status`, `preview_bg`, `preview_en`) and adds the spec's `key` (the admin key from the URL, so a template never has to read `useSearchParams`). Superset of the contract, nothing renamed.
- `WizardDraft` must exist for `Venue.wizard_draft` to be typed, so this task creates `src/wizard/schema.ts` with the contract's **types and constants only**. Task 7 appends `WizardDraftSchema`, `WizardPatchSchema`, `emptyDraft`, `validateForPublish` to the same file without changing these declarations.
- `rateSalt` defaults to `"dev-salt"` in every mode (strict and lenient) so the existing production deployment keeps booting before `RATE_SALT` is added; Task 12 documents that production must set it.
- Rate limiting in Supabase is one SQL function (`public.bump_rate_limit`) called through `rpc` so the increment is atomic; the memory store keeps a `Map`.
- `created_ip_hash` from the spec's data-model prose is not added: the rate-limit keys already carry the IP hash and nothing reads the column.

- [ ] **Step 1: Extend the domain types**

In `src/domain/types.ts` replace the `Venue` interface:

```ts
export interface Venue {
  id: string;
  slug: string;
  name: string;
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  address: string;
  phone: string;
  maps_url: string;
  instagram: string;
  cover_media_id: string | null;
  logo_media_id: string | null;
  hours: WeekHours;
  tz: string;
  default_lang: Lang;
  theme: { accent: string };
  created_at: string;
}
```

with:

```ts
export type TemplateId = "classic" | "nocturne" | "lumen";
export const TEMPLATE_IDS: readonly TemplateId[] = ["classic", "nocturne", "lumen"];
export type BusinessType = "cafe" | "bar" | "restaurant";
export const BUSINESS_TYPES: readonly BusinessType[] = ["cafe", "bar", "restaurant"];
export type VenueStatus = "draft" | "live";
export type DeployStatus = "pending" | "building" | "ready" | "error";
export interface DeployInfo {
  provider: "vercel" | "fake";
  project_id: string;
  deployment_id: string;
  /** Real production URL from the provider, with https://; null until the first deployment is ready. */
  url: string | null;
  status: DeployStatus;
  /** Short, secret-free. */
  error: string | null;
  /** Template that was deployed. */
  template: TemplateId;
  /** ISO; set on every status transition (pollDeployments measures its 20-minute timeout from it). */
  updated_at: string;
}
/** Moved here from src/server/site.ts (which re-exports it) so templates can import it. */
export interface DraftInfo {
  id: string;
  status: string;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
  /** The admin key the preview link carried; the banner's Apply/Reject calls use it. */
  key: string;
}

export interface Venue {
  id: string;
  slug: string;
  name: string;
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  address: string;
  phone: string;
  maps_url: string;
  instagram: string;
  cover_media_id: string | null;
  logo_media_id: string | null;
  hours: WeekHours;
  tz: string;
  default_lang: Lang;
  theme: { accent: string };
  template: TemplateId;
  business_type: BusinessType;
  status: VenueStatus;
  deploy: DeployInfo | null;
  /** The wizard's unpublished form; null for every live venue. */
  wizard_draft: WizardDraft | null;
  created_at: string;
}
```

and add at the top of the file, after the `Lang` lines:

```ts
import type { WizardDraft } from "../wizard/schema";
```

(`src/wizard/schema.ts` imports types from this file too; both imports are `import type`, so the cycle is erased at compile time.)

- [ ] **Step 2: Create `src/wizard/schema.ts` (types and constants only)**

```ts
// src/wizard/schema.ts
// Types and constants of the wizard draft. Task 7 appends the zod schemas (WizardDraftSchema, WizardPatchSchema),
// emptyDraft and validateForPublish to this file; nothing declared here changes then.
import type { BusinessType, Lang, TemplateId, WeekHours } from "../domain/types";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
export const RESERVED_SLUGS = ["new", "admin", "api", "embed", "draft", "demo", "www", "static", "_next"];

export type WizardStep = "template" | "basics" | "look" | "hours" | "menu" | "texts" | "photos" | "review" | "done";
export const WIZARD_STEPS: readonly WizardStep[] = ["template", "basics", "look", "hours", "menu", "texts", "photos", "review", "done"];

export interface WizardItem {
  key: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  image_media_id: string | null;
}
export interface WizardCategory {
  key: string;
  name_bg: string;
  name_en: string;
  items: WizardItem[];
}
export interface WizardDraft {
  template: TemplateId;
  business_type: BusinessType;
  name: string;
  slug: string;
  default_lang: Lang;
  address: string;
  phone: string;
  instagram: string;
  maps_url: string;
  hours: WeekHours;
  theme: { accent: string };
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  texts: { welcome: { bg: string; en: string }; footer_note: { bg: string; en: string } };
  logo_media_id: string | null;
  cover_media_id: string | null;
  gallery_media_ids: string[];
  categories: WizardCategory[];
  /** Last step the owner reached. */
  step: WizardStep;
}
```

- [ ] **Step 3: Write the failing hash test and `src/server/hash.ts`**

```ts
// test/hash.test.ts
import { describe, expect, it } from "vitest";
import { newDraftToken, sha256Hex } from "@/src/server/hash";

describe("hash", () => {
  it("sha256Hex is the standard hex digest", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("newDraftToken is 64 hex chars and unique", () => {
    const a = newDraftToken();
    const b = newDraftToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
```

Run `npm test -- test/hash.test.ts` → fails: `Cannot find module '@/src/server/hash'`.

```ts
// src/server/hash.ts
// Server-only helpers (node:crypto). Never import from client components.
import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** 32 random bytes as hex: the wizard's draft token (only its sha256 is stored). */
export function newDraftToken(): string {
  return randomBytes(32).toString("hex");
}
```

Run `npm test -- test/hash.test.ts` → 2 passed.

- [ ] **Step 4: Extend the Store interface**

In `src/store/types.ts` change the import line to:

```ts
import type {
  BusinessType, Category, Change, ChangeSet, ChangeSetStatus, ChangeSource, Conversation, DeployInfo, Item, Lang, Media, Member, Role, SiteState, SiteTextKey, TemplateId, Venue, VenueStatus, WeekHours,
} from "../domain/types";
import type { WizardDraft } from "../wizard/schema";
```

Extend `NewVenue` (append after `theme?: { accent: string };`):

```ts
  template?: TemplateId;
  business_type?: BusinessType;
  status?: VenueStatus;
  wizard_draft?: WizardDraft | null;
```

Add after the `ChangeSetPatch` type:

```ts
export type VenuePatch = Partial<Pick<Venue,
  "slug" | "name" | "tagline_bg" | "tagline_en" | "about_bg" | "about_en" | "address" | "phone" | "maps_url" | "instagram" |
  "hours" | "tz" | "default_lang" | "theme" | "template" | "business_type" | "status" | "wizard_draft">>;
```

Replace the venues block of the `Store` interface (`createVenue` … `clearVenueContent`) with:

```ts
  // venues
  createVenue(v: NewVenue): Promise<Venue>;
  getVenue(id: string): Promise<Venue>;
  getVenueBySlug(slug: string): Promise<Venue | null>;
  /** All venues (oldest first); `status` filters; `deploying: true` keeps only deploy.status in ("pending","building"). */
  listVenues(opts?: { status?: VenueStatus; deploying?: boolean }): Promise<Venue[]>;
  /** Throws on an unknown id or a slug that another venue already has. Keys set to undefined are ignored. */
  updateVenue(id: string, patch: VenuePatch): Promise<Venue>;
  setDeploy(id: string, deploy: DeployInfo | null): Promise<void>;
  /** Stores the sha256 of the wizard's draft token (null clears it). */
  setDraftToken(id: string, tokenHash: string | null): Promise<void>;
  findVenueByDraftToken(tokenHash: string): Promise<Venue | null>;
  /** Deletes the venue and everything that hangs off it: content, members, invites, tokens, change sets, media rows (storage objects stay). */
  deleteVenue(id: string): Promise<void>;
  /** Everything for one venue, including inactive items (the site filters with domain/effective). */
  getSite(venueId: string): Promise<SiteState>;
  insertCategory(c: NewCategory): Promise<Category>;
  insertItem(i: NewItem): Promise<Item>;
  setSiteText(venueId: string, key: SiteTextKey, text_bg: string, text_en: string): Promise<void>;
  /** Deletes the venue's menu, texts, holidays, announcements, media rows and change sets (demo reset). Members, invites and tokens stay. */
  clearVenueContent(venueId: string): Promise<void>;
```

In the members block add after `findMember`:

```ts
  listMembers(venueId: string): Promise<Member[]>;
```

Append a new block before the closing `}` of `Store`:

```ts
  // rate limits
  /** Sliding window counter. Returns true when the call is allowed (count after increment <= max). */
  bumpRateLimit(key: string, windowMs: number, max: number, now: string): Promise<boolean>;
```

- [ ] **Step 5: Write the failing contract tests**

Append inside the `describe` of `test/store-contract.ts`, before its closing `});`:

```ts
    it("gives new venues the classic template, café type and live status, and accepts overrides", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t10", name: "Test" });
      expect(v).toMatchObject({ template: "classic", business_type: "cafe", status: "live", deploy: null, wizard_draft: null });
      const d = await s.createVenue({ slug: "t10d", name: "Draft", template: "nocturne", business_type: "bar", status: "draft" });
      expect(d).toMatchObject({ template: "nocturne", business_type: "bar", status: "draft" });
      expect((await s.listVenues()).map((x) => x.id)).toEqual(expect.arrayContaining([v.id, d.id]));
      expect((await s.listVenues({ status: "draft" })).map((x) => x.id)).toEqual([d.id]);
      expect((await s.listVenues({ status: "live" })).map((x) => x.id)).toContain(v.id);
      expect((await s.listVenues({ status: "live" })).map((x) => x.id)).not.toContain(d.id);
    });

    it("updates venue fields and refuses a taken slug", async () => {
      const s = await make();
      const a = await s.createVenue({ slug: "t11a", name: "A" });
      await s.createVenue({ slug: "t11b", name: "B" });
      const u = await s.updateVenue(a.id, { name: "A2", template: "lumen", status: "draft", theme: { accent: "#112233" }, tagline_en: undefined });
      expect(u).toMatchObject({ id: a.id, name: "A2", template: "lumen", status: "draft", theme: { accent: "#112233" }, tagline_en: "" });
      expect(await s.getVenue(a.id)).toEqual(u);
      const renamed = await s.updateVenue(a.id, { slug: "t11c" });
      expect(renamed.slug).toBe("t11c");
      expect((await s.getVenueBySlug("t11c"))?.id).toBe(a.id);
      expect(await s.getVenueBySlug("t11a")).toBeNull();
      await expect(s.updateVenue(a.id, { slug: "t11b" })).rejects.toThrow(/t11b/);
      await expect(s.updateVenue("00000000-0000-0000-0000-000000000000", { name: "x" })).rejects.toThrow();
      await expect(s.updateVenue(a.id, { slug: "t11c" })).resolves.toMatchObject({ slug: "t11c" }); // own slug is fine
    });

    it("stores the wizard draft JSON and clears it", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t12", name: "Test", status: "draft" });
      const draft = {
        template: "classic" as const, business_type: "cafe" as const, name: "X", slug: "t12", default_lang: "bg" as const,
        address: "", phone: "", instagram: "", maps_url: "", hours: v.hours, theme: { accent: "#2f6b4f" },
        tagline_bg: "", tagline_en: "", about_bg: "", about_en: "", texts: { welcome: { bg: "", en: "" }, footer_note: { bg: "", en: "" } },
        logo_media_id: null, cover_media_id: null, gallery_media_ids: [], categories: [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [] }], step: "menu" as const,
      };
      await s.updateVenue(v.id, { wizard_draft: draft });
      expect((await s.getVenue(v.id)).wizard_draft).toEqual(draft);
      await s.updateVenue(v.id, { wizard_draft: null, status: "live" });
      expect(await s.getVenue(v.id)).toMatchObject({ wizard_draft: null, status: "live" });
    });

    it("tracks deployments and lists the ones in flight", async () => {
      const s = await make();
      const a = await s.createVenue({ slug: "t13a", name: "A" });
      const b = await s.createVenue({ slug: "t13b", name: "B" });
      const c = await s.createVenue({ slug: "t13c", name: "C" });
      const base = { provider: "fake" as const, project_id: "p", deployment_id: "d", url: null, error: null, template: "classic" as const, updated_at: NOW };
      await s.setDeploy(a.id, { ...base, status: "pending" });
      await s.setDeploy(b.id, { ...base, status: "building" });
      await s.setDeploy(c.id, { ...base, status: "ready", url: "https://c.example.test" });
      expect((await s.getVenue(a.id)).deploy).toEqual({ ...base, status: "pending" });
      expect((await s.listVenues({ deploying: true })).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
      await s.setDeploy(a.id, { ...base, status: "error", error: "boom" });
      expect((await s.listVenues({ deploying: true })).map((x) => x.id)).toEqual([b.id]);
      await s.setDeploy(b.id, null);
      expect(await s.listVenues({ deploying: true })).toEqual([]);
      expect((await s.getVenue(b.id)).deploy).toBeNull();
    });

    it("finds a draft by its token hash and lists members", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t14", name: "Test", status: "draft" });
      expect(await s.findVenueByDraftToken("a".repeat(64))).toBeNull();
      await s.setDraftToken(v.id, "a".repeat(64));
      expect((await s.findVenueByDraftToken("a".repeat(64)))?.id).toBe(v.id);
      await s.setDraftToken(v.id, null);
      expect(await s.findVenueByDraftToken("a".repeat(64))).toBeNull();
      await s.upsertMember({ venue_id: v.id, tg_chat_id: 21, role: "owner", lang: "bg" });
      await s.upsertMember({ venue_id: v.id, tg_chat_id: 22, role: "staff", lang: "en" });
      const members = await s.listMembers(v.id);
      expect(members.map((m) => [m.tg_chat_id, m.role]).sort()).toEqual([[21, "owner"], [22, "staff"]]);
      expect(await s.listMembers("00000000-0000-0000-0000-000000000000")).toEqual([]);
    });

    it("deletes a venue with everything attached", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t15", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0 });
      await s.upsertMember({ venue_id: v.id, tg_chat_id: 31, role: "owner", lang: "bg" });
      const code = await s.createInvite(v.id, "staff", LATER);
      const token = await s.getAdminToken(v.id);
      await s.setDraftToken(v.id, "b".repeat(64));
      await s.createChangeSet({ venue_id: v.id, chat_id: 31, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [] });
      await s.deleteVenue(v.id);
      expect(await s.getVenueBySlug("t15")).toBeNull();
      await expect(s.getVenue(v.id)).rejects.toThrow();
      expect(await s.findMember(31)).toBeNull();
      expect(await s.redeemInvite(code, 32, "bg", NOW)).toBeNull();
      expect(await s.findVenueByAdminToken(token)).toBeNull();
      expect(await s.findVenueByDraftToken("b".repeat(64))).toBeNull();
      expect(await s.listProposedBefore("2027-01-01T00:00:00.000Z", v.id)).toEqual([]);
      await expect(s.deleteVenue(v.id)).resolves.toBeUndefined(); // idempotent
    });

    it("counts rate limits in a sliding window", async () => {
      const s = await make();
      const key = `rl-${crypto.randomUUID()}`;
      const hour = 3_600_000;
      expect(await s.bumpRateLimit(key, hour, 2, NOW)).toBe(true);
      expect(await s.bumpRateLimit(key, hour, 2, NOW)).toBe(true);
      expect(await s.bumpRateLimit(key, hour, 2, NOW)).toBe(false);
      expect(await s.bumpRateLimit(key, hour, 2, "2026-10-09T09:59:00.000Z")).toBe(false); // still inside the window
      expect(await s.bumpRateLimit(key, hour, 2, "2026-10-09T10:00:00.000Z")).toBe(true); // window elapsed: count restarts at 1
      expect(await s.bumpRateLimit(`${key}-other`, hour, 1, NOW)).toBe(true); // keys are independent
      expect(await s.bumpRateLimit(`${key}-other`, hour, 1, NOW)).toBe(false);
    });
```

Run `npm test -- test/store-memory.test.ts` → the new cases fail (`s.updateVenue is not a function`, `toMatchObject` missing `template`, …). TypeScript errors are expected until Step 6.

- [ ] **Step 6: Implement the memory store**

In `src/store/memory.ts` change the imports to:

```ts
import { applyChanges } from "../domain/changes";
import type { Category, ChangeSet, Conversation, DeployInfo, Item, Lang, Media, Member, Role, SiteState, SiteTextKey, Venue, VenueStatus } from "../domain/types";
import { DEFAULT_HOURS, extensionFor, newInviteCode, newToken, type ChangeSetPatch, type ExpiredTimer, type NewCategory, type NewChangeSet, type NewItem, type NewVenue, type Store, type VenuePatch } from "./types";
```

Add two maps to the class fields (after `files = new Map<string, Uint8Array>();`):

```ts
  draftTokens = new Map<string, string>(); // venue id -> sha256 of the draft token
  rateLimits = new Map<string, { count: number; window_start: number }>();
```

In `createVenue` add after `theme: clone(v.theme ?? { accent: "#2f6b4f" }),`:

```ts
      template: v.template ?? "classic",
      business_type: v.business_type ?? "cafe",
      status: v.status ?? "live",
      deploy: null,
      wizard_draft: v.wizard_draft ? clone(v.wizard_draft) : null,
```

Replace `listVenues` with:

```ts
  async listVenues(opts: { status?: VenueStatus; deploying?: boolean } = {}) {
    return [...this.sites.values()]
      .map((s) => s.venue)
      .filter((v) => (!opts.status || v.status === opts.status) && (!opts.deploying || (v.deploy !== null && (v.deploy.status === "pending" || v.deploy.status === "building"))))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(clone);
  }
  async updateVenue(id: string, patch: VenuePatch): Promise<Venue> {
    const s = this.site(id);
    if (patch.slug !== undefined && [...this.sites.values()].some((x) => x.venue.id !== id && x.venue.slug === patch.slug)) throw new Error(`slug ${patch.slug} already exists`);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (s.venue as unknown as Record<string, unknown>)[k] = clone(v);
    return clone(s.venue);
  }
  async setDeploy(id: string, deploy: DeployInfo | null) {
    this.site(id).venue.deploy = deploy ? clone(deploy) : null;
  }
  async setDraftToken(id: string, tokenHash: string | null) {
    this.site(id);
    if (tokenHash === null) this.draftTokens.delete(id);
    else this.draftTokens.set(id, tokenHash);
  }
  async findVenueByDraftToken(tokenHash: string) {
    for (const [venueId, h] of this.draftTokens) if (h === tokenHash && this.sites.has(venueId)) return this.getVenue(venueId);
    return null;
  }
  async deleteVenue(id: string) {
    if (!this.sites.has(id)) return;
    this.sites.delete(id);
    this.draftTokens.delete(id);
    this.tokens.delete(id);
    for (const [chatId, m] of this.members) if (m.venue_id === id) this.members.delete(chatId);
    for (const [code, inv] of this.invites) if (inv.venue_id === id) this.invites.delete(code);
    for (const [setId, cs] of this.sets) if (cs.venue_id === id) this.sets.delete(setId);
    for (const key of [...this.conversations.keys()]) if (key.startsWith(`${id}:`)) this.conversations.delete(key);
    for (const path of [...this.files.keys()]) if (path.startsWith(`${id}/`)) this.files.delete(path);
  }
```

Add after `findMember`:

```ts
  async listMembers(venueId: string) {
    return [...this.members.values()].filter((m) => m.venue_id === venueId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(clone);
  }
```

Append before the class's closing `}`:

```ts
  async bumpRateLimit(key: string, windowMs: number, max: number, now: string) {
    const t = Date.parse(now);
    const cur = this.rateLimits.get(key);
    const row = cur && cur.window_start + windowMs > t ? { count: cur.count + 1, window_start: cur.window_start } : { count: 1, window_start: t };
    this.rateLimits.set(key, row);
    return row.count <= max;
  }
```

- [ ] **Step 7: Update the fixtures and the seed, then run the memory contract**

In `test/fixtures.ts` add to the object returned by `venue()` after `theme: { accent: "#2f6b4f" },`:

```ts
    template: "classic",
    business_type: "cafe",
    status: "live",
    deploy: null,
    wizard_draft: null,
```

In `src/seed/demo.ts` add to `DEMO_VENUE` after `theme: { accent: "#2f6b4f" },`:

```ts
  template: "classic",
  business_type: "cafe",
```

Run `npm test -- test/store-memory.test.ts` → all cases pass (the eleven existing ones and the seven new ones). Run `npm run typecheck` → errors only in `src/store/supabase.ts` (`Class 'SupabaseStore' incorrectly implements interface 'Store'`) and `src/server/site.ts` is still fine; fix Supabase next.

- [ ] **Step 8: SQL schema and policies**

Append to `supabase/schema.sql` right after the `create table if not exists public.venues (…);` statement (before `venue_members`):

```sql
-- Templates, wizard drafts and deployments (idempotent column adds; constraints re-created so re-runs pick up new ids).
alter table public.venues add column if not exists template text not null default 'classic';
alter table public.venues add column if not exists business_type text not null default 'cafe';
alter table public.venues add column if not exists status text not null default 'live';
alter table public.venues add column if not exists deploy jsonb;
alter table public.venues add column if not exists wizard_draft jsonb;
alter table public.venues add column if not exists draft_token_hash text;
alter table public.venues drop constraint if exists venues_template_check;
alter table public.venues add constraint venues_template_check check (template in ('classic', 'nocturne', 'lumen'));
alter table public.venues drop constraint if exists venues_business_type_check;
alter table public.venues add constraint venues_business_type_check check (business_type in ('cafe', 'bar', 'restaurant'));
alter table public.venues drop constraint if exists venues_status_check;
alter table public.venues add constraint venues_status_check check (status in ('draft', 'live'));
create unique index if not exists venues_draft_token_idx on public.venues (draft_token_hash) where draft_token_hash is not null;
create index if not exists venues_status_idx on public.venues (status, created_at);

create table if not exists public.rate_limits (
  key text primary key,
  count int not null,
  window_start timestamptz not null
);

-- Atomic sliding-window counter; true when the call is allowed (count after increment <= p_max). Service role only (see policies.sql).
create or replace function public.bump_rate_limit(p_key text, p_window_ms int, p_max int, p_now timestamptz) returns boolean language sql as $$
  with up as (
    insert into public.rate_limits as r (key, count, window_start) values (p_key, 1, p_now)
    on conflict (key) do update set
      count = case when r.window_start + make_interval(secs => p_window_ms / 1000.0) <= p_now then 1 else r.count + 1 end,
      window_start = case when r.window_start + make_interval(secs => p_window_ms / 1000.0) <= p_now then p_now else r.window_start end
    returning r.count as n
  )
  select n <= p_max from up;
$$;
```

In `supabase/policies.sql`:

1. After `alter table public.conversations enable row level security;` add:

```sql
alter table public.rate_limits enable row level security;
```

2. Change the first `revoke all` line to:

```sql
revoke all on public.venue_members, public.venue_invites, public.venue_admin_tokens, public.change_sets, public.changes, public.conversations, public.rate_limits from anon, authenticated;
revoke execute on function public.bump_rate_limit(text, int, int, timestamptz) from anon, authenticated, public;
```

3. Replace the `do $$ … end $$;` block that creates the `anon read` policies with:

```sql
-- Anon sees only live venues and their content; wizard drafts are reachable solely through the server with the draft token.
drop policy if exists "anon read venues" on public.venues;
create policy "anon read venues" on public.venues for select to anon, authenticated using (status = 'live');
do $$
declare t text;
begin
  foreach t in array array['site_texts', 'categories', 'items', 'holidays', 'announcements', 'media'] loop
    execute format('drop policy if exists "anon read %1$s" on public.%1$I', t);
    execute format('create policy "anon read %1$s" on public.%1$I for select to anon, authenticated using (exists (select 1 from public.venues v where v.id = %1$I.venue_id and v.status = ''live''))', t);
  end loop;
end $$;
-- venue_members, venue_invites, venue_admin_tokens, change_sets, changes, conversations, rate_limits: RLS on, no policies => invisible to anon.
```

Note for the implementer: the column grant `grant select on public.venues … to anon` stays as is; the policy now hides draft rows and the `draft_token_hash`, `wizard_draft` and `deploy` columns are only ever read by the server (the browser never selects venues directly; `src/lib/supabase-browser.ts` only subscribes to realtime). Apply with `npm run db:apply` when Supabase keys are present (skip offline).

- [ ] **Step 9: `scripts/check-rls.mts` gains the draft and rate-limit checks**

Insert after the `for (const t of ["venue_members", …]) { … }` loop:

```ts
const drafts = await db.from("venues").select("id").eq("status", "draft").limit(1);
check("anon sees no draft venues", !drafts.error && (drafts.data?.length ?? 0) === 0, drafts.error?.code ?? `${drafts.data?.length ?? 0} rows`);
const rl = await db.from("rate_limits").select("*").limit(1);
check("anon cannot read rate_limits", !!rl.error || (rl.data?.length ?? 0) === 0, rl.error?.code ?? `${rl.data?.length ?? 0} rows`);
const bump = await db.rpc("bump_rate_limit", { p_key: "rls-check", p_window_ms: 1000, p_max: 1, p_now: new Date().toISOString() });
check("anon cannot call bump_rate_limit", !!bump.error, bump.error?.code ?? "no error");
```

Run `npm run check:rls` only when `.env.local` has Supabase keys; offline it throws `Missing NEXT_PUBLIC_SUPABASE_URL`, which is expected.

- [ ] **Step 10: Implement the Supabase store**

In `src/store/supabase.ts`:

1. Imports become:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Announcement, BusinessType, Category, Change, ChangeSet, Conversation, DeployInfo, Holiday, Item, Lang, Media, Member, Role, SiteState, SiteText, SiteTextKey, TemplateId, Venue, VenueStatus } from "../domain/types";
import type { WizardDraft } from "../wizard/schema";
import { DEFAULT_HOURS, extensionFor, newInviteCode, newToken, type ChangeSetPatch, type ExpiredTimer, type NewCategory, type NewChangeSet, type NewItem, type NewVenue, type Store, type VenuePatch } from "./types";
```

2. In `toVenue` add after `theme: (r.theme as Venue["theme"]) ?? { accent: "#2f6b4f" },`:

```ts
    template: (r.template as TemplateId) ?? "classic",
    business_type: (r.business_type as BusinessType) ?? "cafe",
    status: (r.status as VenueStatus) ?? "live",
    deploy: (r.deploy as DeployInfo | null) ?? null,
    wizard_draft: (r.wizard_draft as WizardDraft | null) ?? null,
```

3. Replace `createVenue` and `listVenues`:

```ts
  async createVenue(v: NewVenue) {
    const row = {
      ...v,
      slug: `${this.slugPrefix}${v.slug}`,
      hours: v.hours ?? DEFAULT_HOURS,
      theme: v.theme ?? { accent: "#2f6b4f" },
      template: v.template ?? "classic",
      business_type: v.business_type ?? "cafe",
      status: v.status ?? "live",
      wizard_draft: v.wizard_draft ?? null,
    };
    return this.venue(await must(this.db.from("venues").insert(row).select("*").single(), "createVenue"));
  }
  async listVenues(opts: { status?: VenueStatus; deploying?: boolean } = {}) {
    let q = this.db.from("venues").select("*").order("created_at");
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.deploying) q = q.in("deploy->>status", ["pending", "building"]);
    return (await must(q, "listVenues")).map((r) => this.venue(r));
  }
  async updateVenue(id: string, patch: VenuePatch) {
    const clean: Row = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (typeof clean.slug === "string") clean.slug = `${this.slugPrefix}${clean.slug}`;
    if (Object.keys(clean).length === 0) return this.getVenue(id);
    const { data, error } = await this.db.from("venues").update(clean).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.code === "23505" ? `slug ${patch.slug} already exists` : `updateVenue ${id}: ${error.message} [${error.code ?? ""}]`);
    if (!data) throw new Error(`updateVenue ${id}: not found`);
    return this.venue(data);
  }
  async setDeploy(id: string, deploy: DeployInfo | null) {
    await mustRows(this.db.from("venues").update({ deploy }).eq("id", id).select("id"), `setDeploy ${id}`);
  }
  async setDraftToken(id: string, tokenHash: string | null) {
    await mustRows(this.db.from("venues").update({ draft_token_hash: tokenHash }).eq("id", id).select("id"), `setDraftToken ${id}`);
  }
  async findVenueByDraftToken(tokenHash: string) {
    const { data, error } = await this.db.from("venues").select("*").eq("draft_token_hash", tokenHash).maybeSingle();
    if (error) throw new Error(`findVenueByDraftToken: ${error.message}`);
    return data ? this.venue(data) : null;
  }
  async deleteVenue(id: string) {
    if (badVenue(id)) return;
    const { error } = await this.db.from("venues").delete().eq("id", id);
    if (error) throw new Error(`deleteVenue ${id}: ${error.message}`);
  }
```

4. Add after `findMember`:

```ts
  async listMembers(venueId: string) {
    if (badVenue(venueId)) return [];
    return (await must(this.db.from("venue_members").select("*").eq("venue_id", venueId).order("created_at"), "listMembers")).map(toMember);
  }
```

5. Append before the class's closing `}`:

```ts
  async bumpRateLimit(key: string, windowMs: number, max: number, now: string) {
    const { data, error } = await this.db.rpc("bump_rate_limit", { p_key: key, p_window_ms: windowMs, p_max: max, p_now: now });
    if (error) throw new Error(`bumpRateLimit: ${error.message}`);
    return data === true;
  }
```

Run `npm run typecheck` → clean. Run `npm test` → green (the Supabase contract stays skipped offline; the live run `SUPABASE_CONTRACT=1 npx tsx --env-file=.env.local node_modules/vitest/vitest.mjs run test/store-supabase.test.ts` must pass after `npm run db:apply` when keys exist).

- [ ] **Step 11: Config and `.env.example`**

In `src/config.ts` add to the `Config` interface after `demoVenueSlug: string;`:

```ts
  /** Vercel token scoped to the team that hosts the venue sites; null disables real deploys (FakeDeployer). */
  vercelToken: string | null;
  vercelTeamId: string | null;
  /** Salt for hashed IPs in rate-limit keys. */
  rateSalt: string;
  maxSitesPerDay: number;
  /** For https://t.me/<bot>?start=<code> links on the wizard's done page. */
  telegramBotUsername: string | null;
```

In `loadConfig`, after the `effort` check add:

```ts
  const maxSites = Number(optional("MAX_SITES_PER_DAY") ?? 50);
  if (!Number.isInteger(maxSites) || maxSites < 1) throw new Error("MAX_SITES_PER_DAY must be a positive integer");
```

and to the returned object after `demoVenueSlug: …,`:

```ts
    vercelToken: optional("VERCEL_TOKEN"),
    vercelTeamId: optional("VERCEL_TEAM_ID"),
    rateSalt: optional("RATE_SALT") ?? "dev-salt",
    maxSitesPerDay: maxSites,
    telegramBotUsername: optional("TELEGRAM_BOT_USERNAME")?.replace(/^@/, "") ?? null,
```

Append to `.env.example`:

```
# Automatic venue sites on Vercel (Pro team). Token: Vercel → Account Settings → Tokens, scope = the team; server-only, never NEXT_PUBLIC_.
VERCEL_TOKEN=
# Team id (team_…) from Vercel → Team Settings → General; empty for a personal account.
VERCEL_TEAM_ID=
# Salt for the hashed IPs in the wizard's rate limits; generate: openssl rand -hex 16
RATE_SALT=
# Sites the wizard may create per day across all visitors (default 50)
MAX_SITES_PER_DAY=50
# Bot username without @ (from @BotFather), for the https://t.me/<bot>?start=<code> link on the wizard's done page
TELEGRAM_BOT_USERNAME=
```

Add to `test/config.test.ts` inside the `describe`:

```ts
  it("reads the deploy and wizard keys with defaults", () => {
    expect(loadConfig(full)).toMatchObject({ vercelToken: null, vercelTeamId: null, rateSalt: "dev-salt", maxSitesPerDay: 50, telegramBotUsername: null });
    expect(loadConfig({ ...full, VERCEL_TOKEN: "v", VERCEL_TEAM_ID: "team_1", RATE_SALT: "s", MAX_SITES_PER_DAY: "7", TELEGRAM_BOT_USERNAME: "@site_manager_bot" })).toMatchObject({ vercelToken: "v", vercelTeamId: "team_1", rateSalt: "s", maxSitesPerDay: 7, telegramBotUsername: "site_manager_bot" });
    expect(() => loadConfig({ ...full, MAX_SITES_PER_DAY: "0" })).toThrow(/MAX_SITES_PER_DAY/);
  });
```

Run `npm test -- test/config.test.ts` → 5 passed.

- [ ] **Step 12: `loadSite` hides drafts and re-exports `DraftInfo`**

Add to `test/site-server.test.ts` inside the `describe`:

```ts
  it("hides a draft venue unless the draft token matches, and passes the key into the draft info", async () => {
    const { store, venue } = await makeDemo();
    const draft = await store.createVenue({ slug: "mydraft", name: "Draft", status: "draft" });
    const token = newDraftToken();
    await store.setDraftToken(draft.id, sha256Hex(token));
    expect(await loadSite(store, "mydraft")).toBeNull();
    expect(await loadSite(store, "mydraft", { draftToken: "wrong" })).toBeNull();
    const ok = await loadSite(store, "mydraft", { draftToken: token });
    expect(ok?.state.venue.id).toBe(draft.id);
    expect(ok?.draft).toBeNull();
    // the token of one draft does not open another
    const other = await store.createVenue({ slug: "otherdraft", name: "Other", status: "draft" });
    expect(await loadSite(store, "otherdraft", { draftToken: token })).toBeNull();
    expect(other.status).toBe("draft");
    // a live venue ignores draftToken
    expect((await loadSite(store, "agala", { draftToken: "anything" }))?.state.venue.id).toBe(venue.id);
    // DraftInfo carries the key
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [] });
    const key = await store.getAdminToken(venue.id);
    expect((await loadSite(store, "agala", { draftId: cs.id, key }))?.draft).toMatchObject({ id: cs.id, key });
  });
```

and the imports:

```ts
import { newDraftToken, sha256Hex } from "@/src/server/hash";
```

Run `npm test -- test/site-server.test.ts` → the new case fails (`loadSite` returns the draft state). Then replace `src/server/site.ts` with:

```ts
// src/server/site.ts
import { applyChanges } from "../domain/changes";
import type { DraftInfo, SiteState } from "../domain/types";
import type { Store } from "../store/types";
import { sha256Hex } from "./hash";

export type { DraftInfo } from "../domain/types";

export interface LoadSiteOptions {
  /** A pending change set to preview on top of the live state; needs `key`. */
  draftId?: string | null;
  /** The admin key from the URL. */
  key?: string | null;
  /** The wizard's draft token (from the sm_draft cookie); required to see a venue with status "draft". */
  draftToken?: string | null;
}

/** Live state for a slug; with a valid admin key and a pending draft id, the state with that draft applied on top. Draft venues are null without a matching draft token. */
export async function loadSite(store: Store, slug: string, opts: LoadSiteOptions = {}): Promise<{ state: SiteState; draft: DraftInfo | null } | null> {
  const venue = await store.getVenueBySlug(slug);
  if (!venue) return null;
  if (venue.status === "draft") {
    if (!opts.draftToken) return null;
    const owner = await store.findVenueByDraftToken(sha256Hex(opts.draftToken));
    if (!owner || owner.id !== venue.id) return null;
  }
  let state = await store.getSite(venue.id);
  let draft: DraftInfo | null = null;
  if (opts.draftId && opts.key) {
    const owner = await store.findVenueByAdminToken(opts.key);
    if (owner && owner.id === venue.id) {
      try {
        const cs = await store.getChangeSet(opts.draftId);
        if (cs.venue_id === venue.id) {
          draft = { id: cs.id, status: cs.status, summary_bg: cs.summary_bg, summary_en: cs.summary_en, preview_bg: cs.preview_bg, preview_en: cs.preview_en, key: opts.key };
          if (cs.status === "proposed" || cs.status === "scheduled") {
            try {
              state = applyChanges(state, cs.changes);
            } catch (e) {
              console.error("[site] draft apply failed:", e instanceof Error ? e.message : e);
            }
          }
        }
      } catch {
        draft = null;
      }
    }
  }
  return { state, draft };
}
```

`app/[slug]/components/SiteView.tsx` and `DraftBanner.tsx` keep importing `DraftInfo` from `@/src/server/site` until Task 2 moves them (the re-export keeps them compiling).

Run `npm test -- test/site-server.test.ts` → 2 passed. Run `npm test` → all green; `npm run typecheck` → clean; `npm run lint` → clean.

- [ ] **Step 13: Commit**

```bash
git add src/domain/types.ts src/wizard/schema.ts src/server/hash.ts src/store/types.ts src/store/memory.ts src/store/supabase.ts supabase/schema.sql supabase/policies.sql scripts/check-rls.mts src/config.ts src/server/site.ts src/seed/demo.ts .env.example test/fixtures.ts test/store-contract.ts test/config.test.ts test/site-server.test.ts test/hash.test.ts
git commit -m "Store: templates, business type, venue status, deploy info, draft tokens, rate limits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: opus

---


### Task 2: Template registry; move the current site components to `src/templates/classic`; `app/[slug]` dispatches on `venue.template`

> **Rulings that apply to this task:** R3, R8, R9 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Move (`git mv`, content unchanged unless a fragment is listed below):
  - `app/[slug]/components/SiteView.tsx` → `src/templates/classic/Template.tsx` (rewritten root, see Step 5)
  - `app/[slug]/components/SiteHeader.tsx` → `src/templates/classic/SiteHeader.tsx`
  - `app/[slug]/components/TodayStatus.tsx` → `src/templates/classic/TodayStatus.tsx`
  - `app/[slug]/components/Specials.tsx` → `src/templates/classic/Specials.tsx`
  - `app/[slug]/components/Highlights.tsx` → `src/templates/classic/Highlights.tsx`
  - `app/[slug]/components/AboutHours.tsx` → `src/templates/classic/AboutHours.tsx`
  - `app/[slug]/components/Gallery.tsx` → `src/templates/classic/Gallery.tsx`
  - `app/[slug]/components/MenuList.tsx` → `src/templates/classic/MenuList.tsx`
  - `app/[slug]/components/SiteFooter.tsx` → `src/templates/classic/SiteFooter.tsx`
  - `app/[slug]/components/bits.tsx` → `src/templates/classic/bits.tsx` (two fragments change, Step 4)
  - `app/[slug]/components/useLiveSite.tsx` → `src/templates/shared/useLiveSite.ts` (rewritten without Supabase, Step 3)
- Keep in place: `app/[slug]/components/DraftBanner.tsx` (it calls the admin API, which the deployed shell does not have; one import and one line change)
- Create: `src/templates/index.ts`, `src/templates/shared/media.ts`, `src/templates/shared/types.ts`, `src/templates/shared/format.ts`, `src/templates/shared/links.ts`, `src/templates/classic/index.ts`, `src/templates/classic/fonts.ts`, `test/setup.ts`, `test/templates-boundary.test.ts`, `test/templates-classic.test.ts`
- Modify: `app/[slug]/page.tsx`, `app/[slug]/menu/page.tsx`, `app/[slug]/load.ts`, `.gitignore`, `vitest.config.mts`

**Interfaces:**
- Consumes: `TemplateId`, `BusinessType`, `DraftInfo`, `SiteState`, `Media` from `src/domain/types` (Task 1); `Venue.template` (Task 1); `loadSite(store, slug, { draftId, key, draftToken })` (Task 1).
- Produces (verbatim from the spec contracts): `TemplateProps`, `TemplateDef`, `TEMPLATES`, `getTemplate(id)` in `src/templates/index.ts`; `mediaUrl(m, opts?)` and `findMedia(media, id)` in `src/templates/shared/media.ts`; `useLiveSite(initial, feedUrl, live): { state; changed }` and `useNow(initial): number` in `src/templates/shared/useLiveSite.ts`; `Changed` in `src/templates/shared/types.ts`; `pageHref(slug, page)` in `src/templates/shared/links.ts` (every template builds its Home/Menu links with it; the deployed shell sets `NEXT_PUBLIC_SITE_STANDALONE=1` so the same code links to `/` and `/menu` there); `def: TemplateDef` from `src/templates/classic/index.ts`; `Template` from `src/templates/classic/Template.tsx`; `fontVars` from `src/templates/classic/fonts.ts`; the global `next/font/google` mock in `test/setup.ts` (any test may import a template's `index.ts` thanks to it).

No visual change: every moved component keeps its markup and CSS classes byte for byte. The only DOM differences on `/[slug]`: (1) the draft banner is rendered by the page as a sibling *before* the template root instead of as the root's first child (its own classes are unchanged, it never used `--accent`); (2) the template root `<div>` gains the two `next/font` variable class names and `font-family: var(--font-body)` (Onest, which `body` already uses), so the computed fonts are identical.

Facts verified in the repo for this task: `next/font/google` is an **empty module under vitest** (`Literata is not a function`), so tests mock it globally (Step 1); `renderToStaticMarkup` of the current `SiteView` inside `LangProvider` works under vitest with `next/link` and `next/image` (no jsdom needed); `Literata` and `Onest` both list the `cyrillic` subset in `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`.

- [ ] **Step 1: Global `next/font/google` mock for vitest**

```ts
// test/setup.ts
// next/font/google is an empty module outside the Next build. Any name imported from it becomes a loader that returns
// stable class/variable names, so template registries (index.ts → fonts.ts) can be imported by tests.
import { vi } from "vitest";

vi.mock("next/font/google", () => {
  const skip = new Set(["then", "default", "__esModule", "__vi_mock__"]);
  return new Proxy({}, {
    get(_target, name) {
      if (typeof name !== "string" || skip.has(name)) return undefined;
      return () => ({ className: `font-${name}`, variable: `font-var-${name}`, style: { fontFamily: name } });
    },
    has(_target, name) {
      return typeof name === "string" && !skip.has(name);
    },
  });
});
```

In `vitest.config.mts` add `setupFiles` to the `test` block:

```ts
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
  },
```

(If a later test still sees `is not a function`, the fallback is to copy the `vi.mock(...)` call to the top of that test file; vitest hoists it.)

- [ ] **Step 2: Shared types, media and format re-exports**

```ts
// src/templates/shared/types.ts
/** Ids whose content just changed → the change time (ms); drives the flash highlight. */
export type Changed = ReadonlyMap<string, number>;
```

```ts
// src/templates/shared/media.ts
import type { Media } from "@/src/domain/types";

const SUPABASE_HOST = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null;
  } catch {
    return null;
  }
})();

/**
 * The media's public URL when it may be shown: https on a Supabase host (next.config remotePatterns), plus `blob:` and
 * `data:` URLs in the wizard preview only. Anything else (memory store `memory://`, http, foreign hosts) is null.
 */
export function mediaUrl(m: Media | null | undefined, opts: { preview?: boolean } = {}): string | null {
  if (!m) return null;
  const url = m.public_url;
  if (opts.preview && (url.startsWith("blob:") || url.startsWith("data:"))) return url;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname.endsWith(".supabase.co") || u.hostname === SUPABASE_HOST) ? url : null;
  } catch {
    return null;
  }
}

export function findMedia(media: readonly Media[], id: string | null | undefined): Media | null {
  return id ? media.find((m) => m.id === id) ?? null : null;
}
```

```ts
// src/templates/shared/format.ts
// One import surface for templates; everything here is inside the shell manifest's domain closure.
export { categoryName, formatPrice, itemName, tr, weekdayLabel } from "@/src/domain/format";
export { ALLERGENS, allergenName } from "@/src/domain/allergens";
export { isSoldOut, liveAnnouncements, visibleItems } from "@/src/domain/effective";
export { todayStatus } from "@/src/domain/hours";
export { formatDate, formatDateTime, hhmm, localDate, localTime, localWeekday } from "@/src/time";
```

```ts
// src/templates/shared/links.ts
// In the main app a venue lives at /<slug> and /<slug>/menu; a deployed venue site serves the same template at / and /menu.
// The shell's next.config.ts inlines NEXT_PUBLIC_SITE_STANDALONE=1 at build time, so this is a compile-time constant there.
const STANDALONE = process.env.NEXT_PUBLIC_SITE_STANDALONE === "1";

/** Internal link to a template page. Templates must use this for their Home/Menu links (never `/${slug}` literals). */
export function pageHref(slug: string, page: "home" | "menu"): string {
  if (STANDALONE) return page === "home" ? "/" : "/menu";
  return page === "home" ? `/${slug}` : `/${slug}/menu`;
}
```

- [ ] **Step 3: Move and rewrite `useLiveSite` (poll only, no Supabase)**

```bash
mkdir -p src/templates/shared src/templates/classic
git mv "app/[slug]/components/useLiveSite.tsx" src/templates/shared/useLiveSite.ts
```

Replace its content with:

```ts
// src/templates/shared/useLiveSite.ts
"use client";
import { useEffect, useRef, useState } from "react";
import type { SiteState } from "@/src/domain/types";
import type { Changed } from "./types";

const POLL_MS = 5000;
const CLOCK_MS = 15000;

function signature(s: SiteState): Map<string, string> {
  const m = new Map<string, string>();
  for (const i of s.items) m.set(i.id, JSON.stringify([i.name_bg, i.name_en, i.desc_bg, i.desc_en, i.price_eur, i.allergens, i.image_media_id, i.sold_out_until, i.is_special, i.special_expires_at, i.active]));
  m.set("venue", JSON.stringify(s.venue));
  return m;
}

/**
 * Polls `feedUrl` (the public feed: `{ state: SiteState }`) every 5 s while `live`. `changed` maps ids whose content just
 * changed to the change time, for the flash. No realtime: this hook also runs inside deployed venue sites that have no Supabase keys.
 */
export function useLiveSite(initial: SiteState, feedUrl: string, live: boolean): { state: SiteState; changed: Changed } {
  const [state, setState] = useState(initial);
  const [changed, setChanged] = useState<Changed>(new Map());
  const seq = useRef(0);
  const prev = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (!live) return; // a draft preview shows a fixed state and never polls
    prev.current ??= signature(initial);
    let stop = false;
    const load = async () => {
      const mine = ++seq.current;
      try {
        const res = await fetch(feedUrl, { cache: "no-store" });
        if (!res.ok || mine !== seq.current || stop) return; // a newer request already started; drop this stale response
        const data = (await res.json()) as { state: SiteState };
        if (mine !== seq.current || stop) return;
        const sig = signature(data.state);
        const at = Date.now();
        const diff = new Map<string, number>();
        for (const [id, v] of sig) if (prev.current?.get(id) !== v) diff.set(id, at);
        prev.current = sig;
        if (diff.size) setChanged((c) => new Map([...c, ...diff]));
        setState(data.state);
      } catch {
        // keep the last good state; the next poll retries
      }
    };
    const poll = window.setInterval(() => void load(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(poll);
    };
    // `initial` only seeds the first signature; the page remounts the template (keyed) when the server state source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedUrl, live]);

  return { state, changed };
}

/** Wall clock for open/closed and timers: starts from the server's `now` (hydration-safe) and ticks every 15 s. */
export function useNow(initial: number): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(clock);
  }, []);
  return now;
}
```

- [ ] **Step 4: Move the classic components**

```bash
git mv "app/[slug]/components/SiteView.tsx" src/templates/classic/Template.tsx
for f in SiteHeader TodayStatus Specials Highlights AboutHours Gallery MenuList SiteFooter bits; do git mv "app/[slug]/components/$f.tsx" "src/templates/classic/$f.tsx"; done
```

`TodayStatus`, `Specials`, `AboutHours`, `Gallery`, `MenuList`, `SiteFooter` are **not edited**: their imports are `./bits`, `@/src/domain/*`, `@/src/i18n`, `@/src/time`, `next/link`, `next/image`, which resolve unchanged from the new folder and are all inside the import boundary.

`SiteHeader` and `Highlights` get their Home/Menu hrefs from `pageHref` (identical output in the main app: `/agala`, `/agala/menu`):

`src/templates/classic/SiteHeader.tsx`, add the import after `import { LangToggle, useLang } from "@/src/i18n";`:

```ts
import { pageHref } from "../shared/links";
```

and replace

```ts
    { href: `/${slug}`, label: t("site.home"), current: page === "home" },
    { href: `/${slug}/menu`, label: t("site.menu"), current: page === "menu" },
```
with
```ts
    { href: pageHref(slug, "home"), label: t("site.home"), current: page === "home" },
    { href: pageHref(slug, "menu"), label: t("site.menu"), current: page === "menu" },
```

`src/templates/classic/Highlights.tsx`, add the import after `import { useLang } from "@/src/i18n";`:

```ts
import { pageHref } from "../shared/links";
```

and replace `<Link href={`/${slug}/menu`}` with `<Link href={pageHref(slug, "menu")}` (the rest of that line is unchanged).

In `src/templates/classic/bits.tsx` replace the header (everything from `"use client";` through the end of the `mediaUrl` function) with:

```tsx
"use client";
import Image from "next/image";
import type { SiteState } from "@/src/domain/types";
import { findMedia, mediaUrl as sharedMediaUrl } from "../shared/media";

export type { Changed } from "../shared/types";

/** The media's public URL when next/image may load it (https on a Supabase host, as in next.config remotePatterns); otherwise null. */
export function mediaUrl(state: SiteState, id: string | null): string | null {
  return sharedMediaUrl(findMedia(state.media, id));
}
```

The `SiteImage` and `Flash` components below it stay exactly as they are.

- [ ] **Step 5: The classic `Template.tsx`, `fonts.ts` and `index.ts`**

Replace the whole content of `src/templates/classic/Template.tsx` with:

```tsx
"use client";
import type { CSSProperties } from "react";
import type { TemplateProps } from "../index";
import { useLiveSite, useNow } from "../shared/useLiveSite";
import { AboutHours } from "./AboutHours";
import { fontVars } from "./fonts";
import { Gallery } from "./Gallery";
import { Highlights } from "./Highlights";
import { MenuList } from "./MenuList";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { Specials } from "./Specials";
import { TodayStatus } from "./TodayStatus";

/** Classic: warm editorial, cream paper (Literata + Onest). Markup and classes are the former app/[slug] SiteView. */
export function Template({ state: initial, now: initialNow, slug, page, live, feedUrl }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = /^#[0-9a-f]{6}$/i.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2f6b4f";
  return (
    <div style={{ "--accent": accent, fontFamily: "var(--font-body)" } as CSSProperties} className={`${fontVars} flex flex-1 flex-col`}>
      <SiteHeader state={state} slug={slug} page={page} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 sm:px-6">
        <TodayStatus state={state} now={now} />
        {page === "home" ? (
          <>
            <Specials state={state} now={now} changed={changed} />
            <Highlights state={state} now={now} slug={slug} changed={changed} />
            <AboutHours state={state} now={now} />
            <Gallery state={state} />
          </>
        ) : (
          <MenuList state={state} now={now} changed={changed} />
        )}
      </main>
      <SiteFooter state={state} />
    </div>
  );
}
```

```ts
// src/templates/classic/fonts.ts
// next/font/google at module scope; both subsets include Cyrillic (Bulgarian is the default language).
import { Literata, Onest } from "next/font/google";

export const display = Literata({ subsets: ["latin", "cyrillic"], variable: "--font-display", display: "swap", axes: ["opsz"] });
export const body = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-body", display: "swap" });
/** Class string that defines --font-display and --font-body on the element it is applied to. */
export const fontVars = `${display.variable} ${body.variable}`;
```

```ts
// src/templates/classic/index.ts
import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "classic",
  name_bg: "Класика",
  name_en: "Classic",
  tagline_bg: "Топла, списанийна страница върху кремава хартия.",
  tagline_en: "Warm, editorial pages on cream paper.",
  business_types: ["cafe", "restaurant"],
  accentDefault: "#2f6b4f",
  fontVars,
  Component: Template,
};
```

- [ ] **Step 6: The registry**

```ts
// src/templates/index.ts
// Single source for site designs: app/[slug] (preview, drafts, fallback) renders through here; a deployed venue site gets one
// template through the generated src/templates/current.ts instead.
// Runtime imports of this module are for app/** only; templates import only its types (the shell manifest does not ship this file).
import type { ComponentType } from "react";
import { TEMPLATE_IDS, type BusinessType, type DraftInfo, type SiteState, type TemplateId } from "@/src/domain/types";
import { def as classic } from "./classic";

export interface TemplateProps {
  state: SiteState;
  /** Server time in ms when the page rendered; templates tick from it with useNow. */
  now: number;
  slug: string;
  page: "home" | "menu";
  draft: DraftInfo | null;
  /** Poll the feed (false for draft previews and the wizard preview). */
  live: boolean;
  /** Absolute or site-relative URL of the public feed (`/api/site/<slug>` in the main app, `${SITE_MANAGER_URL}/api/site/<slug>` in a deployed site). */
  feedUrl: string;
  /** Wizard preview: allows blob:/data: media URLs. */
  preview?: boolean;
}

export interface TemplateDef {
  id: TemplateId;
  name_bg: string;
  name_en: string;
  tagline_bg: string;
  tagline_en: string;
  business_types: BusinessType[];
  accentDefault: string;
  /** CSS class string from next/font that sets --font-display and --font-body (and any extra vars). */
  fontVars: string;
  Component: ComponentType<TemplateProps>;
}

// Tasks 3 and 4 replace the two placeholders with `def` from ./nocturne and ./lumen.
export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  classic,
  nocturne: classic,
  lumen: classic,
};

/** The template for an id from the database or a query string; unknown or missing ids fall back to classic. */
export function getTemplate(id: string | null | undefined): TemplateDef {
  return id && (TEMPLATE_IDS as readonly string[]).includes(id) ? TEMPLATES[id as TemplateId] : TEMPLATES.classic;
}
```

- [ ] **Step 7: Pages dispatch through the registry; the banner stays in `app/[slug]`**

`app/[slug]/load.ts` → replace `loadPage`:

```ts
import { cookies } from "next/headers";
```

```ts
/** Shared by the home and menu pages: the live site, the draft preview when `?draft=&key=` is valid for this venue, or a wizard draft when the sm_draft cookie matches. */
export async function loadPage(slug: string, sp: Search) {
  const deps = await getServerDeps((fn) => after(fn));
  const cookie = (await cookies()).get("sm_draft")?.value ?? null;
  const draftToken = cookie && cookie.includes(".") ? cookie.slice(cookie.indexOf(".") + 1) : null;
  return loadSite(deps.store, slug, { draftId: one(sp.draft), key: one(sp.key), draftToken });
}
```

`app/[slug]/page.tsx` becomes:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { getTemplate } from "@/src/templates";
import { DraftBanner } from "./components/DraftBanner";
import { loadPage, pageMetadata } from "./load";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  return pageMetadata((await props.params).slug, await props.searchParams);
}

export default async function Page(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const site = await loadPage(slug, await props.searchParams);
  if (!site) notFound();
  const { Component } = getTemplate(site.state.venue.template);
  return (
    <LangProvider defaultLang={site.state.venue.default_lang}>
      {site.draft && <DraftBanner draft={site.draft} slug={slug} />}
      {/* keyed so leaving a draft preview (Apply/Reject → router.replace) remounts with the live state instead of keeping the draft */}
      <Component key={site.draft?.id ?? "live"} state={site.state} now={Date.now()} slug={slug} page="home" draft={site.draft} live={site.draft === null} feedUrl={`/api/site/${encodeURIComponent(slug)}`} />
    </LangProvider>
  );
}
```

`app/[slug]/menu/page.tsx` becomes the same with `"/[slug]/menu"` in both `PageProps`, `../components/DraftBanner`, `../load`, and `page="menu"`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { getTemplate } from "@/src/templates";
import { DraftBanner } from "../components/DraftBanner";
import { loadPage, pageMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/[slug]/menu">): Promise<Metadata> {
  return pageMetadata((await props.params).slug, await props.searchParams);
}

export default async function Page(props: PageProps<"/[slug]/menu">) {
  const { slug } = await props.params;
  const site = await loadPage(slug, await props.searchParams);
  if (!site) notFound();
  const { Component } = getTemplate(site.state.venue.template);
  return (
    <LangProvider defaultLang={site.state.venue.default_lang}>
      {site.draft && <DraftBanner draft={site.draft} slug={slug} />}
      {/* keyed so leaving a draft preview (Apply/Reject → router.replace) remounts with the live state instead of keeping the draft */}
      <Component key={site.draft?.id ?? "live"} state={site.state} now={Date.now()} slug={slug} page="menu" draft={site.draft} live={site.draft === null} feedUrl={`/api/site/${encodeURIComponent(slug)}`} />
    </LangProvider>
  );
}
```

`app/[slug]/components/DraftBanner.tsx`: change

```ts
import { useRouter, useSearchParams } from "next/navigation";
```
→
```ts
import { useRouter } from "next/navigation";
```
and
```ts
import type { DraftInfo } from "@/src/server/site";
```
→
```ts
import type { DraftInfo } from "@/src/domain/types";
```
and
```ts
  const key = useSearchParams().get("key") ?? "";
```
→
```ts
  const key = draft.key;
```

Everything else in the banner is unchanged.

Append to `.gitignore`:

```
# generated by src/deploy/manifest.ts and scripts/template-build.mts
/src/templates/current.ts
```

Run `npm run typecheck` → clean; `npm run lint` → clean. Run `npm run dev:offline`, open `http://localhost:3000/agala` and `/agala/menu`: same page as before (compare against `git stash` if in doubt); `SITE_MANAGER_STORE=memory npm run build` → green.

- [ ] **Step 8: Import boundary test**

```ts
// test/templates-boundary.test.ts
// Guarantees the shell bundle is complete: files under src/templates/** may only import what the manifest ships.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMPLATES = join(ROOT, "src", "templates");
const DOMAIN_ALLOWED = new Set(["types", "format", "effective", "hours", "allergens"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && name !== "current.ts") out.push(p);
  }
  return out;
}

export function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s+["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of source.matchAll(re)) out.push(m[1]);
  }
  return out;
}

export function allowed(spec: string, file: string): boolean {
  if (spec === "react" || spec === "react-dom" || spec.startsWith("react/") || spec.startsWith("react-dom/")) return true;
  if (spec === "next" || spec.startsWith("next/")) return true;
  if (spec.startsWith("./") || spec.startsWith("../")) return !relative(TEMPLATES, resolve(dirname(file), spec)).startsWith("..");
  if (spec.startsWith("@/src/templates/")) return true;
  if (spec.startsWith("@/src/domain/")) return DOMAIN_ALLOWED.has(spec.slice("@/src/domain/".length));
  if (spec === "@/src/time") return true;
  if (spec === "@/src/i18n" || spec.startsWith("@/src/i18n/")) return true;
  return false;
}

describe("src/templates import boundary", () => {
  it("only imports react, next/*, src/templates/**, the domain closure, src/time and src/i18n", () => {
    const files = walk(TEMPLATES);
    expect(files.length).toBeGreaterThanOrEqual(12);
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of specifiers(readFileSync(f, "utf8"))) if (!allowed(spec, f)) offenders.push(`${relative(ROOT, f)} → ${spec}`);
    }
    expect(offenders).toEqual([]);
  });
  it("classifies specifiers", () => {
    const f = join(TEMPLATES, "classic", "Template.tsx");
    expect(allowed("@/src/domain/types", f)).toBe(true);
    expect(allowed("@/src/domain/changes", f)).toBe(false);
    expect(allowed("@/src/store/memory", f)).toBe(false);
    expect(allowed("@/src/lib/supabase-browser", f)).toBe(false);
    expect(allowed("@supabase/supabase-js", f)).toBe(false);
    expect(allowed("../shared/media", f)).toBe(true);
    expect(allowed("../../server/site", f)).toBe(false);
    expect(allowed("next/image", f)).toBe(true);
    expect(specifiers('import x from "a";\nexport { y } from "./b";\nconst z = await import("c");')).toEqual(["a", "./b", "c"]);
  });
});
```

Run `npm test -- test/templates-boundary.test.ts` → 2 passed (if an offender shows up, fix the import in the template; nothing outside the allowed list is needed by the classic files).

- [ ] **Step 9: Render test for the classic template**

```ts
// test/templates-classic.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import type { TemplateProps } from "@/src/templates";
import { getTemplate, TEMPLATES } from "@/src/templates";
import { Template } from "@/src/templates/classic/Template";
import { makeDemo } from "./helpers";

const NOW = Date.parse("2026-10-09T09:00:00.000Z"); // Friday 12:00 in Sofia, open until 18:00

async function render(lang: Lang, over: Partial<TemplateProps> = {}) {
  const { store, venue } = await makeDemo();
  const state = await store.getSite(venue.id);
  const props: TemplateProps = { state, now: NOW, slug: "agala", page: "home", draft: null, live: false, feedUrl: "/api/site/agala", ...over };
  return renderToStaticMarkup(createElement(LangProvider, { defaultLang: lang }, createElement(Template, props)));
}

describe("classic template", () => {
  it("renders the home page in Bulgarian and English", async () => {
    const bg = await render("bg");
    expect(bg).toContain("Кафене „Ъгъла“");
    expect(bg).toContain("Еспресо");
    expect(bg).toContain("Отворено до 18:00");
    const en = await render("en");
    expect(en).toContain("Кафене „Ъгъла“");
    expect(en).toContain("Espresso");
    expect(en).toContain("Open until 18:00");
  });
  it("renders the menu page with every category", async () => {
    const bg = await render("bg", { page: "menu" });
    expect(bg).toContain("Сандвичи и салати");
    expect(bg).toContain("Шопска салата");
    const en = await render("en", { page: "menu" });
    expect(en).toContain("Shopska salad");
  });
  it("links Home and Menu through pageHref (main-app form outside the shell)", async () => {
    const html = await render("bg");
    expect(html).toContain('href="/agala"');
    expect(html).toContain('href="/agala/menu"');
  });
  it("sets the accent and the font variables on the root", async () => {
    const html = await render("bg");
    expect(html.startsWith('<div style="--accent:#2f6b4f;font-family:var(--font-body)" class="font-var-Literata font-var-Onest flex flex-1 flex-col">')).toBe(true);
  });
  it("registry falls back to classic", () => {
    expect(getTemplate("classic").id).toBe("classic");
    expect(getTemplate("nope").id).toBe("classic");
    expect(getTemplate(null).Component).toBe(Template);
    expect(TEMPLATES.classic.fontVars).toBe("font-var-Literata font-var-Onest");
    expect(TEMPLATES.classic.business_types).toContain("cafe");
  });
});
```

Run `npm test -- test/templates-classic.test.ts` → 5 passed. Run `npm test` → all green.

- [ ] **Step 10: Commit**

```bash
git add -A src/templates "app/[slug]" test/setup.ts test/templates-boundary.test.ts test/templates-classic.test.ts vitest.config.mts .gitignore
git commit -m "Templates: registry, classic moved to src/templates, app/[slug] dispatches on venue.template

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: opus (pure move plus registry; no design work in this task)

---


### Task 3: Template "nocturne" (dark, bold; bars and evening venues)

> **Rulings that apply to this task:** R1, R2, R5, R8, R9, R12, R16 (see "Controller rulings" above; they override conflicting sentences below).

**Design Read:** Reading this as: a bar / evening venue site for guests on their phone, with a dark, cinematic, editorial language leaning toward large photography, one warm accent, grotesk display type with Cyrillic.

**Skills (mandatory, say so in the report):** invoke `design-taste-frontend`, `emil-design-eng`, `high-end-visual-design`, `apple-design`, `frontend-design` before coding; the reviewer runs `review-animations` and `web-design-guidelines`. The plan fixes structure, data, states, i18n keys and tests; palette values, type scale, spacing and motion curves below are a working baseline the implementer refines under those skills. Two hard rules override the skills' font lists: every font has `subsets: ["latin", "cyrillic"]`, and no animation library is added.

**Fonts (verified in `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`):**
- Display: **Unbounded** — subsets `cyrillic, cyrillic-ext, latin, latin-ext, vietnamese`, variable weight 200–900, export name `Unbounded`.
- Body: **Manrope** — subsets `cyrillic, cyrillic-ext, greek, latin, latin-ext, vietnamese`, variable weight 200–800, export name `Manrope`.
- (Also verified with Cyrillic, as fallbacks if the implementer prefers them: Golos Text, Onest, Inter Tight, Oswald, Montserrat Alternates.)

**Files:**
- Create: `src/templates/nocturne/index.ts`, `src/templates/nocturne/fonts.ts`, `src/templates/nocturne/Template.tsx`, `src/templates/nocturne/bits.tsx`, `src/templates/nocturne/Hero.tsx`, `src/templates/nocturne/Tonight.tsx`, `src/templates/nocturne/MenuList.tsx`, `src/templates/nocturne/Gallery.tsx`, `src/templates/nocturne/Visit.tsx`, `src/templates/nocturne/Footer.tsx`, `src/templates/nocturne/styles.css`
- Modify: `src/templates/index.ts` (register), `src/i18n/dicts.ts` (five `site.*` keys)
- Test: `test/template-nocturne.test.ts`

**Interfaces:**
- Consumes (Task 2, spec contract): `TemplateProps = { state: SiteState; now: number; slug: string; page: "home" | "menu"; draft: DraftInfo | null; live: boolean; feedUrl: string; preview?: boolean }` and `TemplateDef` from `src/templates/index.ts`; `mediaUrl(m: Media | null | undefined, opts?: { preview?: boolean }): string | null` from `src/templates/shared/media.ts`; `useLiveSite(initial: SiteState, feedUrl: string, live: boolean): { state: SiteState; changed: Changed }` from `src/templates/shared/useLiveSite.ts`; `Changed = ReadonlyMap<string, number>` from `src/templates/shared/types.ts`; `DraftInfo = { id; summary_bg; summary_en; key }` from `src/domain/types.ts`. Domain: `visibleItems`, `isSoldOut`, `liveAnnouncements` (`src/domain/effective.ts`), `todayStatus` (`src/domain/hours.ts`), `formatPrice`, `itemName`, `categoryName`, `weekdayLabel` (`src/domain/format.ts`), `allergenName` (`src/domain/allergens.ts`), `formatDate`, `formatDateTime`, `hhmm`, `localDate`, `localTime`, `localWeekday` (`src/time.ts`), `LangProvider`, `LangToggle`, `useLang` (`src/i18n`).
- Produces: `def: TemplateDef` with `id: "nocturne"`, `accentDefault: "#d9a05b"`, `fontVars` (sets `--font-display`, `--font-body`), `Component: Template`; registered as `TEMPLATES.nocturne`. New dictionary keys `site.skip`, `site.categories`, `site.tonight`, `site.visit`, `site.toTop` (Task 4 reuses them).
- Import boundary (enforced by Task 2's `test/templates-boundary.test.ts`): files under `src/templates/nocturne/**` import only `react`, `react-dom`, `next/*`, `src/templates/**`, `src/domain/{types,format,effective,hours,allergens}`, `src/time`, `src/i18n/*`. Nothing from `src/server`, `src/store`, `src/lib`, `src/config`.

**Data and states the template must render (same coverage as the classic template in `src/templates/classic/`):** venue name, logo (or none), cover (or none), tagline, welcome text (home only), nav Home/Menu + `LangToggle`; today status open / opens later / closed (with next opening) / closed today, holiday note when today is a holiday; live announcements; specials (expired specials hidden by `visibleItems`); highlights on home (up to 6, link to the full menu); full menu by category with jump links when there are ≥ 2 categories; sold-out items shown struck with the "until" badge (never hidden); allergen codes per item + legend; about, hours table with today marked, upcoming holidays, address / maps / phone / Instagram; gallery (hidden when empty); footer note + "Site by Site Manager"; draft bar when `draft` is set; `live` polling through `useLiveSite`; `preview` passed to `mediaUrl`.

**Acceptance criteria (checked by the reviewer):** body text contrast ≥ 4.5:1 (`--n-ink` #ece7dd on `--n-bg` #0b0a09 ≈ 15:1; `--n-ink-soft` #b3ab9e ≈ 8:1); visible `:focus-visible` rings; `prefers-reduced-motion: reduce` disables every animation and transition in the template; no horizontal page scroll at 360 px (the wrapper uses `overflow-x: clip`; strips scroll inside themselves); all links/buttons ≥ 44 px tall; motion only on `transform`/`opacity`, 150–350 ms, CSS `cubic-bezier(0.22, 1, 0.36, 1)` (spring-like, interruptible because it is CSS), no animation library; Lighthouse accessibility ≥ 95 on `/agala` and `/agala/menu` in both languages; screenshots at 360/768/1280 in BG and EN attached to the report.

- [ ] **Step 1: Add the five dictionary keys**

In `src/i18n/dicts.ts`, inside the `en` object after `"site.galleryPhoto": "{name}, photo {n}",` add:

```ts
  "site.skip": "Skip to content",
  "site.categories": "Categories",
  "site.tonight": "Tonight",
  "site.visit": "Visit us",
  "site.toTop": "Back to top",
```

Inside the `bg` object after `"site.galleryPhoto": "{name}, снимка {n}",` add:

```ts
  "site.skip": "Към съдържанието",
  "site.categories": "Категории",
  "site.tonight": "Тази вечер",
  "site.visit": "Елате при нас",
  "site.toTop": "Нагоре",
```

Run `npm test -- test/i18n.test.ts` → PASS (same keys in both languages).

- [ ] **Step 2: Write the failing render test**

`next/font/google` is a build-time loader: its runtime module (`node_modules/next/font/google/index.js`) is empty, so any test that imports a template `index.ts` (which imports `fonts.ts`) must mock it. The mock below covers every font family the three templates use.

```ts
// test/template-nocturne.test.ts
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DraftInfo, Lang, SiteState } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { makeDemo } from "./helpers";

// next/font/google only works through the Next.js compiler; at test time its module is empty, so stub every family the templates use.
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ className: `f-${name}`, variable: `fv-${name}`, style: { fontFamily: name } });
  return { Literata: font("literata"), Onest: font("onest"), Unbounded: font("unbounded"), Manrope: font("manrope"), Playfair_Display: font("playfair"), Golos_Text: font("golos") };
});

import { def } from "@/src/templates/nocturne";

const NOW = Date.parse("2026-10-09T09:00:00.000Z"); // Fri 12:00 Sofia; demo hours 08:00–18:00

async function render(lang: Lang, opts: { page?: "home" | "menu"; mutate?: (s: SiteState) => void; draft?: DraftInfo | null } = {}) {
  const { store, venue } = await makeDemo();
  const state = await store.getSite(venue.id);
  opts.mutate?.(state);
  return renderToStaticMarkup(
    createElement(LangProvider, { defaultLang: lang },
      createElement(def.Component, { state, now: NOW, slug: "agala", page: opts.page ?? "menu", draft: opts.draft ?? null, live: false, feedUrl: "/api/site/agala" })),
  );
}

describe("nocturne template", () => {
  it("is registered with Cyrillic-capable fonts and a dark accent default", () => {
    expect(def.id).toBe("nocturne");
    expect(def.fontVars).toContain("fv-unbounded");
    expect(def.fontVars).toContain("fv-manrope");
    expect(def.accentDefault).toMatch(/^#[0-9a-f]{6}$/i);
    expect(def.business_types).toContain("bar");
  });
  it("renders the menu page in Bulgarian: name, category, item, bg price, open status", async () => {
    const html = await render("bg");
    expect(html).toContain("Кафене „Ъгъла“");
    expect(html).toContain("Закуски");
    expect(html).toContain("Капучино");
    expect(html).toContain("2,90 €");
    expect(html).toContain("Отворено до 18:00");
    expect(html).toContain('class="tpl-nocturne');
  });
  it("renders the menu page in English with en prices", async () => {
    const html = await render("en");
    expect(html).toContain("Pastries");
    expect(html).toContain("Cappuccino");
    expect(html).toContain("€2.90");
    expect(html).toContain("Open until 18:00");
  });
  it("shows the holiday note when today is a holiday", async () => {
    const mutate = (s: SiteState) => { s.holidays.push({ id: "h1", venue_id: s.venue.id, date: "2026-10-09", note_bg: "Инвентаризация", note_en: "Stock count" }); };
    expect(await render("en", { mutate })).toContain("Stock count");
    expect(await render("bg", { mutate })).toContain("Инвентаризация");
  });
  it("says closed when today's hours are null", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    expect(await render("en", { mutate })).toContain("Closed");
    expect(await render("bg", { mutate })).toContain("Затворено");
  });
  it("keeps sold-out items (struck, with a badge) and hides expired specials", async () => {
    const mutate = (s: SiteState) => {
      s.items[1].sold_out_until = "2026-10-10T06:00:00.000Z";
      s.items.push({ ...s.items[0], id: "sp-old", name_bg: "Стара оферта", name_en: "Old special", is_special: true, special_expires_at: "2026-10-09T08:00:00.000Z" });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Sold out until");
    expect(html).toContain("Cappuccino");
    expect(html).not.toContain("Old special");
  });
  it("renders the home page with highlights, the visit section and no gallery when there are no photos", async () => {
    const html = await render("en", { page: "home" });
    expect(html).toContain("From the menu");
    expect(html).toContain("Visit us");
    expect(html).toContain("Opening hours");
    expect(html).not.toContain('aria-labelledby="gallery"');
  });
  it("adds category jump links for a long menu", async () => {
    const mutate = (s: SiteState) => {
      for (let n = 0; n < 40; n++) s.items.push({ ...s.items[0], id: `big-${n}`, name_bg: `Артикул ${n}`, name_en: `Item ${n}`, position: 100 + n, category_id: s.categories[n % s.categories.length].id });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Item 39");
    expect(html.match(/class="n-chip"/g)?.length).toBe(4);
  });
  it("renders the draft bar with the summary when a draft is given", async () => {
    const draft: DraftInfo = { id: "d1", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", key: "k" };
    expect(await render("en", { draft })).toContain("Cappuccino €3.20");
    expect(await render("bg", { draft })).toContain("Капучино 3,20 €");
  });
});
```

Run `npm test -- test/template-nocturne.test.ts` → FAIL: `Cannot find module '@/src/templates/nocturne'`.

- [ ] **Step 3: Fonts and the template definition**

```ts
// src/templates/nocturne/fonts.ts
// Module scope on purpose: next/font/google must be called at the top level of a module.
import { Manrope, Unbounded } from "next/font/google";

/** Grotesk display with Cyrillic (verified subsets: cyrillic, cyrillic-ext, latin, latin-ext, vietnamese). */
export const display = Unbounded({ subsets: ["latin", "cyrillic"], variable: "--font-display", display: "swap" });
/** Body sans with Cyrillic (verified subsets: cyrillic, cyrillic-ext, greek, latin, latin-ext, vietnamese). */
export const body = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-body", display: "swap" });

export const fontVars = `${display.variable} ${body.variable}`;
```

```ts
// src/templates/nocturne/index.ts
import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "nocturne",
  name_bg: "Ноктюрн",
  name_en: "Nocturne",
  tagline_bg: "Тъмен и едър. За барове и вечерни заведения.",
  tagline_en: "Dark and bold. For bars and evening venues.",
  business_types: ["bar", "restaurant", "cafe"],
  accentDefault: "#d9a05b",
  fontVars,
  Component: Template,
};
```

- [ ] **Step 4: Scoped styles**

```css
/* src/templates/nocturne/styles.css
   Nocturne tokens live on the wrapper only, so the main app's cream theme is untouched.
   Motion: transform/opacity only, 150–350 ms, one spring-like curve; everything off under prefers-reduced-motion. */
.tpl-nocturne {
  --n-bg: #0b0a09;
  --n-bg-2: #15130f;
  --n-ink: #ece7dd;        /* ≈15:1 on --n-bg */
  --n-ink-soft: #b3ab9e;   /* ≈8:1 on --n-bg */
  --n-line: rgb(236 231 221 / 0.12);
  --n-accent: var(--accent, #d9a05b);
  /* Accent as text/fill: lift lightness so a dark owner-picked accent still reads on near-black.
     Browsers without relative colour syntax keep the plain accent (first declaration). */
  --n-accent-text: var(--n-accent);
  --n-accent-text: oklch(from var(--n-accent) max(l, 0.8) min(c, 0.16) h);
  --n-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --n-radius: 1.25rem;
  background: var(--n-bg);
  color: var(--n-ink);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow-x: clip;
  isolation: isolate;
  -webkit-font-smoothing: antialiased;
}
.tpl-nocturne h1, .tpl-nocturne h2, .tpl-nocturne h3, .tpl-nocturne h4, .tpl-nocturne .n-display {
  font-family: var(--font-display), ui-sans-serif, system-ui, sans-serif;
  font-variation-settings: normal;
  letter-spacing: -0.01em;
}
/* Film grain: fixed SVG noise at low opacity, never intercepts input. */
.n-grain {
  position: fixed; inset: 0; z-index: 1; pointer-events: none; opacity: 0.07; mix-blend-mode: soft-light;
  background-size: 180px 180px;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
}
.n-wrap { width: 100%; max-width: 44rem; margin-inline: auto; padding-inline: 1rem; }
@media (min-width: 640px) { .n-wrap { padding-inline: 1.5rem; } }
.n-soft { color: var(--n-ink-soft); }
.n-eyebrow { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--n-accent-text); }
.n-h2 { font-size: 1.5rem; font-weight: 700; line-height: 1.15; }
.n-divide > * + * { border-top: 1px solid var(--n-line); }
.n-card { background: var(--n-bg-2); border: 1px solid var(--n-line); border-radius: var(--n-radius); }
.n-pill { display: inline-block; border-radius: 999px; padding: 0.375rem 0.75rem; font-size: 0.875rem; font-weight: 600; background: color-mix(in oklab, var(--n-accent) 18%, var(--n-bg-2)); color: var(--n-ink); }
.n-badge { display: inline-block; border-radius: 999px; padding: 0.125rem 0.625rem; font-size: 0.75rem; font-weight: 700; border: 1px solid var(--n-line); color: var(--n-ink-soft); }
.n-price { font-family: var(--font-display), ui-sans-serif, system-ui, sans-serif; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--n-accent-text); }
.n-price.is-sold { text-decoration: line-through; color: var(--n-ink-soft); }
.n-dot { display: inline-block; width: 0.625rem; height: 0.625rem; border-radius: 999px; flex: none; }
.n-dot-open { background: #7ed6a2; }
.n-dot-opens_later { background: #f0c66a; }
.n-dot-closed { background: #e27a6a; }
/* Hero */
.n-cover-fallback { background: radial-gradient(120% 80% at 80% 0%, color-mix(in oklab, var(--n-accent) 28%, var(--n-bg)), var(--n-bg) 70%); }
.n-veil { background: linear-gradient(to top, rgb(11 10 9 / 0.92) 0%, rgb(11 10 9 / 0.55) 45%, rgb(11 10 9 / 0.25) 100%); }
.n-navlink { display: inline-flex; align-items: center; min-height: 44px; padding-inline: 0.875rem; border-radius: 999px; font-size: 0.875rem; font-weight: 700; color: var(--n-ink); transition: background-color 200ms var(--n-ease), color 200ms var(--n-ease); }
.n-navlink:hover { background: rgb(236 231 221 / 0.1); }
.n-navlink.is-current { background: var(--n-ink); color: var(--n-bg); }
.n-skip { position: absolute; left: 1rem; top: -100%; z-index: 20; padding: 0.75rem 1rem; border-radius: 999px; background: var(--n-ink); color: var(--n-bg); font-weight: 700; }
.n-skip:focus-visible { top: 1rem; }
/* Buttons: 44 px minimum, press feedback on transform only. */
.n-btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding-inline: 1.25rem; border-radius: 999px; font-weight: 700; transition: transform 180ms var(--n-ease), filter 180ms var(--n-ease), border-color 180ms var(--n-ease); }
.n-btn:active { transform: scale(0.97); }
.n-btn-accent { background: var(--n-accent-text); color: #0b0a09; }
.n-btn-accent:hover { filter: brightness(1.06); }
.n-btn-ghost { border: 1px solid var(--n-line); color: var(--n-ink); }
.n-btn-ghost:hover { border-color: var(--n-ink-soft); }
/* Category jump bar: sticky, scrolls sideways inside itself (no page overflow). */
.n-jump { position: sticky; top: 0; z-index: 2; display: flex; gap: 0.5rem; overflow-x: auto; scrollbar-width: none; padding-block: 0.75rem; margin-inline: -1rem; padding-inline: 1rem; background: linear-gradient(var(--n-bg) 72%, transparent); -webkit-overflow-scrolling: touch; }
.n-jump::-webkit-scrollbar { display: none; }
.n-chip { flex: none; min-height: 44px; display: inline-flex; align-items: center; padding-inline: 1rem; border-radius: 999px; border: 1px solid var(--n-line); color: var(--n-ink-soft); font-size: 0.875rem; font-weight: 600; white-space: nowrap; transition: color 200ms var(--n-ease), border-color 200ms var(--n-ease), transform 200ms var(--n-ease); }
.n-chip:hover, .n-chip:focus-visible { color: var(--n-ink); border-color: var(--n-ink-soft); }
.n-chip:active { transform: scale(0.97); }
.n-section { scroll-margin-top: 4.5rem; }
/* Horizontal snap strips for specials and the gallery. */
.n-strip { display: flex; gap: 0.75rem; overflow-x: auto; scroll-snap-type: x mandatory; margin-inline: -1rem; padding-inline: 1rem; padding-bottom: 0.5rem; scrollbar-width: none; }
.n-strip::-webkit-scrollbar { display: none; }
.n-strip > * { scroll-snap-align: start; flex: 0 0 78%; }
@media (min-width: 640px) { .n-strip > * { flex-basis: 46%; } }
/* Motion */
.n-rise { animation: n-rise 320ms var(--n-ease) both; }
@keyframes n-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.n-flash { animation: n-flash 2.2s ease-out both; }
@keyframes n-flash { 0%, 65% { opacity: 1; } 100% { opacity: 0; } }
.tpl-nocturne :focus-visible { outline: 3px solid var(--n-accent-text); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .tpl-nocturne *, .tpl-nocturne *::before, .tpl-nocturne *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
```

- [ ] **Step 5: Shared bits, root Template and the draft bar**

```tsx
// src/templates/nocturne/bits.tsx
"use client";
import type { Lang } from "@/src/domain/types";

/** Resolves a media id to a loadable URL (null when unknown or not allowed). Built once per render in Template.tsx. */
export type MediaLookup = (id: string | null) => string | null;

/** Bilingual text with the Bulgarian fallback the whole site uses. */
export function pick(lang: Lang, bg: string, en: string): string {
  return (lang === "bg" ? bg : en) || bg || en;
}

/** Brief highlight behind a card that just changed (keyed by the change time so it re-triggers). Needs an `isolate` parent. */
export function Flash({ at }: { at: number | undefined }) {
  if (at === undefined) return null;
  return <span key={at} aria-hidden="true" className="n-flash pointer-events-none absolute inset-0 -z-10 rounded-[inherit]" style={{ background: "color-mix(in oklab, var(--n-accent) 22%, transparent)" }} />;
}
```

```tsx
// src/templates/nocturne/Template.tsx
"use client";
import { useEffect, useState, type CSSProperties } from "react";
import type { DraftInfo } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { mediaUrl } from "../shared/media";
import { useLiveSite } from "../shared/useLiveSite";
import { fontVars } from "./fonts";
import { Footer } from "./Footer";
import { Gallery } from "./Gallery";
import { Hero } from "./Hero";
import { MenuList } from "./MenuList";
import { Tonight } from "./Tonight";
import { Visit } from "./Visit";
import type { MediaLookup } from "./bits";
import "./styles.css";

const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/** The server's `now` first (hydration-safe), then a 15 s clock while live so "open until" flips without a reload. */
function useClock(initial: number, live: boolean): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [live]);
  return now;
}

/** Sticky "not live" bar over a draft preview; Apply/Reject call the admin API with the key the server put in `draft`, then reload the live site. */
function DraftBar({ draft, slug }: { draft: DraftInfo; slug: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function decide(action: "apply" | "reject") {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/${encodeURIComponent(slug)}?key=${encodeURIComponent(draft.key)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, change_set_id: draft.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      window.location.replace(`/${slug}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <div role="region" aria-label={t("site.draft")} className="sticky top-0 z-30 border-b" style={{ background: "var(--n-ink)", color: "var(--n-bg)", borderColor: "var(--n-line)" }}>
      <div className="n-wrap flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm">
          <span className="mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide" style={{ background: "var(--n-accent-text)", color: "#0b0a09" }}>{t("site.draft")}</span>
          <span className="break-words">{lang === "bg" ? draft.summary_bg : draft.summary_en}</span>
          {failed && <span role="alert" className="mt-1 block font-semibold">{t("site.draftFailed")}</span>}
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={busy} onClick={() => void decide("apply")} className="n-btn n-btn-accent disabled:opacity-60">{busy ? t("site.draftBusy") : t("site.draftApply")}</button>
          <button type="button" disabled={busy} onClick={() => void decide("reject")} className="n-btn disabled:opacity-60" style={{ border: "1px solid rgb(11 10 9 / 0.35)" }}>{t("site.draftReject")}</button>
          <a href={`/admin/${slug}?key=${encodeURIComponent(draft.key)}`} className="n-btn underline underline-offset-4">{t("site.draftBack")}</a>
        </div>
      </div>
    </div>
  );
}

export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useClock(initialNow, live);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#d9a05b";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  return (
    <div className={`tpl-nocturne ${fontVars}`} style={{ "--accent": accent } as CSSProperties} data-page={page}>
      <div aria-hidden="true" className="n-grain" />
      {draft && <DraftBar draft={draft} slug={slug} />}
      <Hero state={state} slug={slug} page={page} media={media} />
      <main id="main" className="n-wrap relative z-10 flex-1 pb-16">
        <Tonight state={state} now={now} changed={changed} media={media} />
        {page === "home" ? (
          <>
            <MenuList variant="highlights" state={state} now={now} changed={changed} media={media} slug={slug} />
            <Visit state={state} now={now} />
            <Gallery state={state} media={media} />
          </>
        ) : (
          <MenuList variant="full" state={state} now={now} changed={changed} media={media} slug={slug} />
        )}
      </main>
      <Footer state={state} feedUrl={feedUrl} />
    </div>
  );
}
```

- [ ] **Step 6: Hero and Tonight**

```tsx
// src/templates/nocturne/Hero.tsx
"use client";
import Image from "next/image";
import Link from "next/link";
import type { SiteState } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import { pick, type MediaLookup } from "./bits";

/** Full-bleed cover (or a tinted gradient), nav + language, then the name as large display type pinned to the bottom. */
export function Hero({ state, slug, page, media }: { state: SiteState; slug: string; page: "home" | "menu"; media: MediaLookup }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const cover = media(v.cover_media_id);
  const logo = media(v.logo_media_id);
  const tagline = pick(lang, v.tagline_bg, v.tagline_en);
  const welcome = state.texts.find((x) => x.key === "welcome");
  const welcomeText = welcome ? pick(lang, welcome.text_bg, welcome.text_en) : "";
  const links = [
    { href: `/${slug}`, label: t("site.home"), current: page === "home" },
    { href: `/${slug}/menu`, label: t("site.menu"), current: page === "menu" },
  ];
  return (
    <header className={`relative isolate flex flex-col overflow-hidden ${page === "home" ? "min-h-[82svh]" : "min-h-[46svh]"}`}>
      <a href="#main" className="n-skip">{t("site.skip")}</a>
      {cover ? <Image src={cover} alt="" fill priority sizes="100vw" className="object-cover" /> : <div aria-hidden="true" className="n-cover-fallback absolute inset-0" />}
      <div aria-hidden="true" className="n-veil absolute inset-0" />
      <div className="n-wrap relative z-10 flex flex-1 flex-col pb-12 pt-4">
        <div className="flex items-center justify-between gap-3">
          <nav aria-label={t("site.nav")} className="flex gap-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined} className={`n-navlink ${l.current ? "is-current" : ""}`}>{l.label}</Link>
            ))}
          </nav>
          <LangToggle />
        </div>
        <div className="mt-auto flex flex-col items-start pt-16">
          {logo && (
            <span className="relative mb-5 block size-14 overflow-hidden rounded-full ring-1 ring-white/30">
              <Image src={logo} alt="" fill sizes="56px" className="object-cover" />
            </span>
          )}
          <h1 className="n-display n-rise text-balance text-[clamp(2.4rem,9vw,5.5rem)] font-extrabold uppercase leading-[0.95]">{v.name}</h1>
          {tagline && <p className="n-rise n-soft mt-4 max-w-xl text-lg" style={{ animationDelay: "60ms" }}>{tagline}</p>}
          {page === "home" && welcomeText && <p className="n-rise mt-3 max-w-xl" style={{ animationDelay: "120ms" }}>{welcomeText}</p>}
          {page === "home" && (
            <Link href={`/${slug}/menu`} className="n-btn n-btn-accent n-rise mt-7" style={{ animationDelay: "180ms" }}>{t("site.fullMenu")}</Link>
          )}
        </div>
      </div>
    </header>
  );
}
```

```tsx
// src/templates/nocturne/Tonight.tsx
"use client";
import Image from "next/image";
import { isSoldOut, liveAnnouncements, visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { Changed } from "../shared/types";
import { formatDateTime, hhmm, localTime } from "@/src/time";
import { Flash, pick, type MediaLookup } from "./bits";

/** Today's status + holiday note + announcements in one card, then the specials as a snap strip. */
export function Tonight({ state, now, changed, media }: { state: SiteState; now: number; changed: Changed; media: MediaLookup }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const s = todayStatus(v.hours, state.holidays, new Date(now), v.tz);
  const text =
    s.state === "open" ? t("site.openUntil", { time: hhmm(s.until) })
    : s.state === "opens_later" ? t("site.opensAt", { time: hhmm(s.at) })
    : s.next ? t("site.closedUntil", { when: formatDateTime(s.next, lang, v.tz) })
    : t("site.closedToday");
  const note = s.holiday ? pick(lang, s.holiday.note_bg, s.holiday.note_en) : "";
  const news = liveAnnouncements(state.announcements, now);
  const specials = visibleItems(state.items, now).filter((i) => i.is_special).sort((a, b) => a.position - b.position);
  return (
    <section aria-labelledby="tonight" className="n-section relative z-10 -mt-6">
      <div className="n-card p-4 sm:p-5">
        <h2 id="tonight" className="n-eyebrow">{t("site.tonight")}</h2>
        <p aria-live="polite" className="mt-2 flex items-center gap-2.5 text-lg font-semibold">
          <span aria-hidden="true" className={`n-dot n-dot-${s.state}`} />
          <span suppressHydrationWarning>{text}</span>
        </p>
        {note && <p className="n-soft mt-1 pl-5">{note}</p>}
        {news.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {news.map((a) => <li key={a.id} className="n-pill">{pick(lang, a.text_bg, a.text_en)}</li>)}
          </ul>
        )}
      </div>
      {specials.length > 0 && (
        <div className="mt-8">
          <h3 className="n-h2">{t("site.specials")}</h3>
          <ul className="n-strip mt-4">
            {specials.map((i) => {
              const img = media(i.image_media_id);
              const sold = isSoldOut(i, now);
              const desc = lang === "bg" ? i.desc_bg : i.desc_en;
              return (
                <li key={i.id} className="n-card relative isolate overflow-hidden">
                  <Flash at={changed.get(i.id)} />
                  {img && (
                    <div className="relative aspect-[4/3]">
                      <Image src={img} alt={itemName(i, lang)} fill sizes="(min-width: 640px) 340px, 78vw" className="object-cover" />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h4 className="text-lg font-semibold">{itemName(i, lang)}</h4>
                      <span className={`n-price text-lg ${sold ? "is-sold" : ""}`}>{formatPrice(i.price_eur, lang)}</span>
                    </div>
                    {desc && <p className="n-soft mt-1 text-sm">{desc}</p>}
                    {sold && <p className="n-badge mt-2">{t("site.soldOut")}</p>}
                    {i.special_expires_at && <p className="n-soft mt-2 text-xs">{t("site.specialUntil", { time: localTime(new Date(i.special_expires_at), v.tz) })}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 7: MenuList (highlights on home, full menu with jump links)**

```tsx
// src/templates/nocturne/MenuList.tsx
"use client";
import Image from "next/image";
import Link from "next/link";
import { allergenName } from "@/src/domain/allergens";
import { isSoldOut, visibleItems } from "@/src/domain/effective";
import { categoryName, formatPrice, itemName } from "@/src/domain/format";
import type { Item, Lang, SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { Changed } from "../shared/types";
import { formatDateTime } from "@/src/time";
import { Flash, type MediaLookup } from "./bits";

type Props = { state: SiteState; now: number; changed: Changed; media: MediaLookup; slug: string; variant: "highlights" | "full" };

function Row({ i, lang, now, tz, changed, media, t }: { i: Item; lang: Lang; now: number; tz: string; changed: Changed; media: MediaLookup; t: ReturnType<typeof useLang>["t"] }) {
  const sold = isSoldOut(i, now);
  const desc = lang === "bg" ? i.desc_bg : i.desc_en;
  const img = media(i.image_media_id);
  return (
    <li className="relative isolate py-4">
      <Flash at={changed.get(i.id)} />
      <div className="flex items-start gap-4">
        {img && (
          <div className="relative size-20 shrink-0 overflow-hidden rounded-xl">
            <Image src={img} alt={itemName(i, lang)} fill sizes="80px" className="object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className={`min-w-0 break-words text-lg font-semibold ${sold ? "n-soft" : ""}`}>{itemName(i, lang)}</h3>
            <span className={`n-price text-xl ${sold ? "is-sold" : ""}`}>{formatPrice(i.price_eur, lang)}</span>
          </div>
          {desc && <p className="n-soft mt-1 text-sm">{desc}</p>}
          {(sold || i.allergens.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {sold && i.sold_out_until && <span className="n-badge">{t("site.soldOutUntil", { when: formatDateTime(i.sold_out_until, lang, tz) })}</span>}
              {i.allergens.length > 0 && <span className="sr-only">{t("site.allergens")}:</span>}
              {i.allergens.map((a) => (
                <span key={a} title={allergenName(a, lang)} className="n-soft inline-flex min-w-6 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold" style={{ background: "var(--n-bg-2)" }}>
                  {a}<span className="sr-only"> {allergenName(a, lang)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Home: up to six picks (photos first) and a link to the menu. Menu page: every active category, sticky jump chips, allergen legend. */
export function MenuList({ state, now, changed, media, slug, variant }: Props) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const items = visibleItems(state.items, now);
  const cats = state.categories.filter((c) => c.active).sort((a, b) => a.position - b.position);
  if (variant === "highlights") {
    const catPos = new Map(cats.map((c) => [c.id, c.position]));
    const picks = items
      .filter((i) => !i.is_special)
      .sort((a, b) => Number(!media(a.image_media_id)) - Number(!media(b.image_media_id)) || (catPos.get(a.category_id) ?? 0) - (catPos.get(b.category_id) ?? 0) || a.position - b.position)
      .slice(0, 6);
    if (picks.length === 0) return null;
    return (
      <section aria-labelledby="highlights" className="n-section mt-12">
        <h2 id="highlights" className="n-h2">{t("site.highlights")}</h2>
        <ul className="n-divide mt-2">
          {picks.map((i) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} media={media} t={t} />)}
        </ul>
        <Link href={`/${slug}/menu`} className="n-btn n-btn-ghost mt-6">{t("site.fullMenu")}</Link>
      </section>
    );
  }
  const sections = cats
    .map((c) => ({ c, items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position) }))
    .filter((s) => s.items.length > 0);
  const used = [...new Set(sections.flatMap((s) => s.items.flatMap((i) => i.allergens)))].sort((a, b) => a - b);
  if (sections.length === 0) return <p className="n-soft mt-10 text-center">{t("site.noItems")}</p>;
  return (
    <div className="mt-6">
      {sections.length > 1 && (
        <nav aria-label={t("site.categories")} className="n-jump">
          {sections.map(({ c }) => <a key={c.id} href={`#cat-${c.id}`} className="n-chip">{categoryName(c, lang)}</a>)}
        </nav>
      )}
      {sections.map(({ c, items: list }) => (
        <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-h-${c.id}`} className="n-section mt-10 first:mt-4">
          <h2 id={`cat-h-${c.id}`} className="n-h2 border-b pb-3" style={{ borderColor: "var(--n-line)" }}>{categoryName(c, lang)}</h2>
          <ul className="n-divide">
            {list.map((i) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} media={media} t={t} />)}
          </ul>
        </section>
      ))}
      {used.length > 0 && (
        <section aria-labelledby="allergens" className="n-card mt-12 p-4 sm:p-5">
          <h2 id="allergens" className="n-eyebrow">{t("site.allergenLegend")}</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {used.map((a) => (
              <div key={a} className="flex gap-2">
                <dt className="min-w-6 font-semibold tabular-nums">{a}</dt>
                <dd className="n-soft">{allergenName(a, lang)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <a href="#main" className="n-btn n-btn-ghost mt-10">{t("site.toTop")}</a>
    </div>
  );
}
```

- [ ] **Step 8: Gallery, Visit, Footer**

```tsx
// src/templates/nocturne/Gallery.tsx
"use client";
import Image from "next/image";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MediaLookup } from "./bits";

/** A snap strip of tall photos; nothing at all when the gallery is empty. */
export function Gallery({ state, media }: { state: SiteState; media: MediaLookup }) {
  const { t } = useLang();
  const photos = state.media.filter((m) => m.is_gallery).sort((a, b) => a.position - b.position).map((m) => ({ id: m.id, src: media(m.id) })).filter((p) => p.src);
  if (photos.length === 0) return null;
  return (
    <section aria-labelledby="gallery" className="n-section mt-14">
      <h2 id="gallery" className="n-h2">{t("site.gallery")}</h2>
      <ul className="n-strip mt-4">
        {photos.map((p, n) => (
          <li key={p.id} className="relative aspect-[4/5] overflow-hidden rounded-[var(--n-radius)]">
            <Image src={p.src as string} alt={t("site.galleryPhoto", { name: state.venue.name, n: n + 1 })} fill sizes="(min-width: 640px) 320px, 78vw" className="object-cover" />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// src/templates/nocturne/Visit.tsx
"use client";
import { weekdayLabel } from "@/src/domain/format";
import { WEEKDAYS, type SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDate, hhmm, localDate, localWeekday } from "@/src/time";
import { pick } from "./bits";

/** Accepts "agala.cafe", "@agala.cafe" or a profile URL. */
function instagram(value: string): { url: string; handle: string } {
  const handle = value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  return { url: `https://instagram.com/${encodeURIComponent(handle)}`, handle };
}

/** About, hours (today marked), upcoming holidays, address and contact actions. */
export function Visit({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const about = pick(lang, v.about_bg, v.about_en);
  const today = localWeekday(new Date(now), v.tz);
  const todayDate = localDate(new Date(now), v.tz);
  const upcoming = state.holidays.filter((h) => h.date >= todayDate).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section aria-labelledby="visit" className="n-section mt-14">
      <h2 id="visit" className="n-h2">{t("site.visit")}</h2>
      {about && <p className="n-soft mt-3 max-w-prose text-lg leading-relaxed">{about}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="n-card p-5">
          <h3 className="n-eyebrow">{t("site.hours")}</h3>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {WEEKDAYS.map((d) => {
                const h = v.hours[d];
                const isToday = d === today;
                return (
                  <tr key={d} aria-current={isToday ? "date" : undefined} className={isToday ? "font-semibold" : "n-soft"}>
                    <th scope="row" className="py-1 pr-4 text-left capitalize" style={{ fontWeight: "inherit" }}>{weekdayLabel(d, lang)}</th>
                    <td suppressHydrationWarning className="py-1 text-right tabular-nums">{h ? `${hhmm(h.open)}–${hhmm(h.close)}` : t("site.closedDay")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {upcoming.length > 0 && (
            <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--n-line)" }}>
              <h4 className="text-sm font-semibold">{t("site.holidays")}</h4>
              <ul className="n-soft mt-1 space-y-1 text-sm">
                {upcoming.map((h) => {
                  const note = pick(lang, h.note_bg, h.note_en);
                  return <li key={h.id}><span className="font-semibold tabular-nums" style={{ color: "var(--n-ink)" }}>{formatDate(h.date, lang)}</span>{note && ` · ${note}`}</li>;
                })}
              </ul>
            </div>
          )}
        </div>
        <div className="n-card p-5">
          <h3 className="n-eyebrow">{t("site.findUs")}</h3>
          {v.address && <p className="mt-3">{v.address}</p>}
          <ul className="mt-4 flex flex-wrap gap-2 text-sm">
            {v.maps_url && <li><a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="n-btn n-btn-accent">{t("site.map")}</a></li>}
            {v.phone && <li><a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="n-btn n-btn-ghost">{t("site.call")} {v.phone}</a></li>}
            {v.instagram && <li><a href={instagram(v.instagram).url} target="_blank" rel="noopener noreferrer" className="n-btn n-btn-ghost">Instagram @{instagram(v.instagram).handle}</a></li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
```

```tsx
// src/templates/nocturne/Footer.tsx
"use client";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { pick } from "./bits";

/** "Site by Site Manager" points at the Site Manager origin: the feed URL's origin on a deployed site, "/" inside the main app. */
function poweredHref(feedUrl: string): string {
  try {
    return new URL(feedUrl).origin;
  } catch {
    return "/";
  }
}

export function Footer({ state, feedUrl }: { state: SiteState; feedUrl: string }) {
  const { lang, t } = useLang();
  const note = state.texts.find((x) => x.key === "footer_note");
  const noteText = note ? pick(lang, note.text_bg, note.text_en) : "";
  return (
    <footer className="relative z-10 border-t" style={{ borderColor: "var(--n-line)", background: "var(--n-bg-2)" }}>
      <div className="n-wrap flex flex-col gap-2 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="n-display font-bold">{state.venue.name}</p>
          {noteText && <p className="n-soft mt-1">{noteText}</p>}
        </div>
        <a href={poweredHref(feedUrl)} className="n-soft inline-flex min-h-11 items-center underline underline-offset-4">{t("site.poweredBy")}</a>
      </div>
    </footer>
  );
}
```

- [ ] **Step 9: Register the template**

In `src/templates/index.ts` add the import next to the classic one:

```ts
import { def as nocturne } from "./nocturne";
```

and in the `TEMPLATES` record replace Task 2's placeholder entry for `nocturne` (Task 2 had to fill all three `TemplateId` keys to satisfy `Record<TemplateId, TemplateDef>`; whatever expression it used for the `nocturne` key) with:

```ts
  nocturne,
```

Run `npm test -- test/template-nocturne.test.ts` → PASS (9 tests). Run `npm test -- test/templates-boundary.test.ts` → PASS (no import outside the allowed list). Run `npm run typecheck` → clean.

- [ ] **Step 10: Visual pass under the design skills and the offline check**

`SITE_MANAGER_STORE=memory npm run dev`, then set the demo venue to nocturne (the memory store has no UI for it yet; temporarily run `await store.updateVenue(venue.id, { template: "nocturne" })` in `scripts/demo-reset.mts` or pass `?template=nocturne` if Task 2's `app/[slug]` page supports a preview override; otherwise edit `DEMO_VENUE` locally and revert). Open `/agala` and `/agala/menu` in the browser pane at 360, 768 and 1280 px, in БГ and EN; verify: no horizontal scroll at 360 px, both states of the hero (with the cover from `scripts/demo-reset.mts` photos and without), holiday today, closed day, a sold-out item, no gallery; tab through the page (focus ring visible on every control); toggle "Reduce motion" in the OS and confirm nothing animates. Run Lighthouse (accessibility ≥ 95). Refine spacing, type scale and the accent handling under the skills listed above; keep the class names and structure the tests rely on (`tpl-nocturne`, `n-chip`, `aria-labelledby="gallery"`). Attach screenshots and the `review-animations` + `web-design-guidelines` notes to the report.

- [ ] **Step 11: Commit**

```bash
git add src/templates/nocturne src/templates/index.ts src/i18n/dicts.ts test/template-nocturne.test.ts
git commit -m "Templates: nocturne (dark, bold, bars) with Unbounded + Manrope, grain, jump links, render tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: fable

---


### Task 4: Template "lumen" (light, photo-first, airy; specialty coffee)

> **Rulings that apply to this task:** R1, R2, R5, R8, R9, R12, R16 (see "Controller rulings" above; they override conflicting sentences below).

**Design Read:** Reading this as: a daytime café site for regulars and walk-ins, with a light, photographic, quietly premium language leaning toward a high-contrast serif display with Cyrillic, generous whitespace and soft motion.

**Skills (mandatory, say so in the report):** invoke `design-taste-frontend`, `emil-design-eng`, `high-end-visual-design`, `apple-design`, `frontend-design` before coding; the reviewer runs `review-animations` and `web-design-guidelines`. The plan fixes structure, data, states, i18n keys and tests; palette values, type scale, spacing and motion curves below are a working baseline the implementer refines under those skills. Two hard rules override the skills' font lists: every font has `subsets: ["latin", "cyrillic"]`, and no animation library is added.

**Fonts (verified in `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`):**
- Display: **Playfair Display** — subsets `cyrillic, latin, latin-ext, vietnamese`, variable weight 400–900, normal + italic, export name `Playfair_Display`.
- Body: **Golos Text** — subsets `cyrillic, cyrillic-ext, latin, latin-ext`, variable weight 400–900, export name `Golos_Text`.
- (Also verified with Cyrillic: Cormorant Garamond, Prata (400 only), Literata, Lora, Manrope, Onest.)

**Layout differences from nocturne (deliberate, not only colour):** split hero (text left, 4:5 photo right on ≥ 1024 px; stacked on mobile) instead of full-bleed; a one-line "Today" strip under the hero instead of a card; a photo strip (gallery) right after the strip on the home page; highlights as a two-column photo grid; the full menu in two columns on ≥ 768 px (`columns: 2`, sections kept whole) with a sticky underlined category nav instead of chips; hours as a definition list with a map button.

**Files:**
- Create: `src/templates/lumen/index.ts`, `src/templates/lumen/fonts.ts`, `src/templates/lumen/Template.tsx`, `src/templates/lumen/bits.tsx`, `src/templates/lumen/Hero.tsx`, `src/templates/lumen/Today.tsx`, `src/templates/lumen/MenuList.tsx`, `src/templates/lumen/Gallery.tsx`, `src/templates/lumen/Visit.tsx`, `src/templates/lumen/Footer.tsx`, `src/templates/lumen/styles.css`
- Modify: `src/templates/index.ts` (register), `src/i18n/dicts.ts` (one key `site.today`)
- Test: `test/template-lumen.test.ts`

**Interfaces:**
- Consumes: exactly the Task 3 list (`TemplateProps`, `TemplateDef`, `mediaUrl`, `useLiveSite`, `Changed`, `DraftInfo`, domain helpers, `src/time`, `src/i18n`) plus the Task 3 keys `site.skip`, `site.categories`, `site.visit`, `site.toTop`.
- Produces: `def: TemplateDef` with `id: "lumen"`, `accentDefault: "#2e5e4e"`, `fontVars`, `Component: Template`; registered as `TEMPLATES.lumen`; key `site.today`.
- Import boundary (enforced by Task 2's `test/templates-boundary.test.ts`): files under `src/templates/lumen/**` import only `react`, `react-dom`, `next/*`, `src/templates/**`, `src/domain/{types,format,effective,hours,allergens}`, `src/time`, `src/i18n/*`. Nothing from `src/server`, `src/store`, `src/lib`, `src/config`.

**Data and states the template must render:** venue name, logo (or none), cover (or none), tagline, welcome text (home only), nav Home/Menu + `LangToggle`; today status open / opens later / closed (with next opening) / closed today, holiday note when today is a holiday; live announcements; specials (expired specials hidden by `visibleItems`); photo strip (hidden when empty); highlights on home (up to 6, link to the full menu); full menu by category with jump links when there are ≥ 2 categories; sold-out items shown struck with the "until" badge (never hidden); allergen codes per item + legend; about, hours with today marked, upcoming holidays, address / maps / phone / Instagram; footer note + "Site by Site Manager"; draft bar when `draft` is set; `live` polling through `useLiveSite`; `preview` passed to `mediaUrl`.

**Acceptance criteria (checked by the reviewer):** body text contrast ≥ 4.5:1 (`--l-ink` #1b1b19 on `--l-bg` #fbfaf7 ≈ 16:1; `--l-ink-soft` #5a5952 ≈ 6.5:1; accent text is darkened to L ≤ 0.5 so a light owner-picked accent still passes); visible `:focus-visible` rings; `prefers-reduced-motion: reduce` disables every animation and transition in the template; no horizontal page scroll at 360 px (wrapper `overflow-x: clip`; strips and the category nav scroll inside themselves); all links/buttons ≥ 44 px tall; motion only on `transform`/`opacity`, 150–350 ms, CSS `cubic-bezier(0.22, 1, 0.36, 1)`, no animation library; images never stretch the page (every photo box has an explicit aspect ratio); the two-column menu never splits a category across columns; Lighthouse accessibility ≥ 95 on `/agala` and `/agala/menu` in both languages; screenshots at 360/768/1280 in BG and EN attached to the report.

- [ ] **Step 1: Add the dictionary key**

In `src/i18n/dicts.ts`, `en` object, after `"site.toTop": "Back to top",` add:

```ts
  "site.today": "Today",
```

`bg` object, after `"site.toTop": "Нагоре",` add:

```ts
  "site.today": "Днес",
```

- [ ] **Step 2: Write the failing render test**

```ts
// test/template-lumen.test.ts
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DraftInfo, Lang, SiteState } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { makeDemo } from "./helpers";

vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ className: `f-${name}`, variable: `fv-${name}`, style: { fontFamily: name } });
  return { Literata: font("literata"), Onest: font("onest"), Unbounded: font("unbounded"), Manrope: font("manrope"), Playfair_Display: font("playfair"), Golos_Text: font("golos") };
});

import { def } from "@/src/templates/lumen";

const NOW = Date.parse("2026-10-09T09:00:00.000Z"); // Fri 12:00 Sofia; demo hours 08:00–18:00

async function render(lang: Lang, opts: { page?: "home" | "menu"; mutate?: (s: SiteState) => void; draft?: DraftInfo | null } = {}) {
  const { store, venue } = await makeDemo();
  const state = await store.getSite(venue.id);
  opts.mutate?.(state);
  return renderToStaticMarkup(
    createElement(LangProvider, { defaultLang: lang },
      createElement(def.Component, { state, now: NOW, slug: "agala", page: opts.page ?? "menu", draft: opts.draft ?? null, live: false, feedUrl: "/api/site/agala" })),
  );
}

describe("lumen template", () => {
  it("is registered with Cyrillic-capable fonts and a light accent default", () => {
    expect(def.id).toBe("lumen");
    expect(def.fontVars).toContain("fv-playfair");
    expect(def.fontVars).toContain("fv-golos");
    expect(def.accentDefault).toMatch(/^#[0-9a-f]{6}$/i);
    expect(def.business_types).toContain("cafe");
  });
  it("renders the menu page in Bulgarian: name, category, item, bg price, open status", async () => {
    const html = await render("bg");
    expect(html).toContain("Кафене „Ъгъла“");
    expect(html).toContain("Закуски");
    expect(html).toContain("Капучино");
    expect(html).toContain("2,90 €");
    expect(html).toContain("Отворено до 18:00");
    expect(html).toContain('class="tpl-lumen');
  });
  it("renders the menu page in English with en prices", async () => {
    const html = await render("en");
    expect(html).toContain("Pastries");
    expect(html).toContain("Cappuccino");
    expect(html).toContain("€2.90");
    expect(html).toContain("Open until 18:00");
  });
  it("shows the holiday note when today is a holiday", async () => {
    const mutate = (s: SiteState) => { s.holidays.push({ id: "h1", venue_id: s.venue.id, date: "2026-10-09", note_bg: "Инвентаризация", note_en: "Stock count" }); };
    expect(await render("en", { mutate })).toContain("Stock count");
    expect(await render("bg", { mutate })).toContain("Инвентаризация");
  });
  it("says closed when today's hours are null", async () => {
    const mutate = (s: SiteState) => { s.venue.hours = { ...s.venue.hours, fri: null }; };
    expect(await render("en", { mutate })).toContain("Closed");
    expect(await render("bg", { mutate })).toContain("Затворено");
  });
  it("keeps sold-out items (struck, with a badge) and hides expired specials", async () => {
    const mutate = (s: SiteState) => {
      s.items[1].sold_out_until = "2026-10-10T06:00:00.000Z";
      s.items.push({ ...s.items[0], id: "sp-old", name_bg: "Стара оферта", name_en: "Old special", is_special: true, special_expires_at: "2026-10-09T08:00:00.000Z" });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Sold out until");
    expect(html).toContain("Cappuccino");
    expect(html).not.toContain("Old special");
  });
  it("renders the home page with highlights, the visit section and no gallery when there are no photos", async () => {
    const html = await render("en", { page: "home" });
    expect(html).toContain("From the menu");
    expect(html).toContain("Visit us");
    expect(html).toContain("Opening hours");
    expect(html).not.toContain('aria-labelledby="gallery"');
  });
  it("adds category jump links for a long menu", async () => {
    const mutate = (s: SiteState) => {
      for (let n = 0; n < 40; n++) s.items.push({ ...s.items[0], id: `big-${n}`, name_bg: `Артикул ${n}`, name_en: `Item ${n}`, position: 100 + n, category_id: s.categories[n % s.categories.length].id });
    };
    const html = await render("en", { mutate });
    expect(html).toContain("Item 39");
    expect(html.match(/class="l-jumplink"/g)?.length).toBe(4);
  });
  it("renders the draft bar with the summary when a draft is given", async () => {
    const draft: DraftInfo = { id: "d1", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", key: "k" };
    expect(await render("en", { draft })).toContain("Cappuccino €3.20");
    expect(await render("bg", { draft })).toContain("Капучино 3,20 €");
  });
});
```

Run `npm test -- test/template-lumen.test.ts` → FAIL: `Cannot find module '@/src/templates/lumen'`.

- [ ] **Step 3: Fonts and the template definition**

```ts
// src/templates/lumen/fonts.ts
import { Golos_Text, Playfair_Display } from "next/font/google";

/** High-contrast serif display with Cyrillic (verified subsets: cyrillic, latin, latin-ext, vietnamese). Italic is used for the tagline. */
export const display = Playfair_Display({ subsets: ["latin", "cyrillic"], style: ["normal", "italic"], variable: "--font-display", display: "swap" });
/** Humanist sans with Cyrillic (verified subsets: cyrillic, cyrillic-ext, latin, latin-ext). */
export const body = Golos_Text({ subsets: ["latin", "cyrillic"], variable: "--font-body", display: "swap" });

export const fontVars = `${display.variable} ${body.variable}`;
```

```ts
// src/templates/lumen/index.ts
import type { TemplateDef } from "../index";
import { fontVars } from "./fonts";
import { Template } from "./Template";

export const def: TemplateDef = {
  id: "lumen",
  name_bg: "Лумен",
  name_en: "Lumen",
  tagline_bg: "Светъл и въздушен, със снимките на преден план. За specialty кафенета.",
  tagline_en: "Light and airy, photos first. For specialty coffee.",
  business_types: ["cafe", "restaurant"],
  accentDefault: "#2e5e4e",
  fontVars,
  Component: Template,
};
```

- [ ] **Step 4: Scoped styles**

```css
/* src/templates/lumen/styles.css
   Lumen tokens on the wrapper only. Light paper, one accent darkened for text, serif display, soft motion. */
.tpl-lumen {
  --l-bg: #fbfaf7;
  --l-bg-2: #f3f1ea;
  --l-ink: #1b1b19;        /* ≈16:1 on --l-bg */
  --l-ink-soft: #5a5952;   /* ≈6.5:1 on --l-bg */
  --l-line: rgb(27 27 25 / 0.1);
  --l-accent: var(--accent, #2e5e4e);
  /* Accent as text: cap lightness so a light owner-picked accent still reads on paper (fallback: plain accent). */
  --l-accent-text: var(--l-accent);
  --l-accent-text: oklch(from var(--l-accent) min(l, 0.5) c h);
  --l-accent-soft: color-mix(in oklab, var(--l-accent) 12%, white);
  --l-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --l-radius: 1.5rem;
  background: var(--l-bg);
  color: var(--l-ink);
  font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow-x: clip;
  isolation: isolate;
  -webkit-font-smoothing: antialiased;
}
.tpl-lumen h1, .tpl-lumen h2, .tpl-lumen h3, .tpl-lumen .l-display { font-family: var(--font-display), ui-serif, Georgia, serif; font-variation-settings: normal; font-weight: 500; letter-spacing: -0.005em; }
.l-wrap { width: 100%; max-width: 64rem; margin-inline: auto; padding-inline: 1rem; }
@media (min-width: 640px) { .l-wrap { padding-inline: 1.5rem; } }
.l-soft { color: var(--l-ink-soft); }
.l-accent { color: var(--l-accent-text); }
.l-eyebrow { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--l-accent-text); }
.l-h2 { font-size: 1.75rem; line-height: 1.15; }
.l-italic { font-style: italic; }
.l-card { background: #fff; border: 1px solid var(--l-line); border-radius: var(--l-radius); }
.l-photo { position: relative; overflow: hidden; border-radius: var(--l-radius); background: var(--l-bg-2); }
.l-divide > * + * { border-top: 1px solid var(--l-line); }
.l-price { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
.l-price.is-sold { text-decoration: line-through; color: var(--l-ink-soft); }
.l-badge { display: inline-block; border-radius: 999px; padding: 0.125rem 0.625rem; font-size: 0.75rem; font-weight: 600; background: var(--l-bg-2); color: var(--l-ink-soft); }
.l-pill { display: inline-block; border-radius: 999px; padding: 0.375rem 0.75rem; font-size: 0.875rem; font-weight: 500; background: var(--l-accent-soft); color: var(--l-ink); }
.l-dot { display: inline-block; width: 0.625rem; height: 0.625rem; border-radius: 999px; flex: none; }
.l-dot-open { background: var(--l-accent-text); }
.l-dot-opens_later { background: #b7791f; }
.l-dot-closed { background: #a4442c; }
/* Hero: split on desktop; the photo keeps a 4:5 box so it never jumps during load. */
.l-hero { display: grid; gap: 1.5rem; align-items: center; }
@media (min-width: 1024px) { .l-hero { grid-template-columns: 1.1fr 0.9fr; gap: 3rem; } }
.l-hero-photo { aspect-ratio: 4 / 5; }
@media (max-width: 1023px) { .l-hero-photo { aspect-ratio: 16 / 10; } }
.l-hero-fallback { position: absolute; inset: 0; display: grid; place-items: center; background: linear-gradient(160deg, var(--l-accent-soft), var(--l-bg-2)); color: var(--l-accent-text); font-family: var(--font-display), ui-serif, Georgia, serif; font-size: clamp(5rem, 20vw, 11rem); line-height: 1; }
.l-navlink { display: inline-flex; align-items: center; min-height: 44px; padding-inline: 0.875rem; border-radius: 999px; font-size: 0.875rem; font-weight: 600; color: var(--l-ink-soft); transition: background-color 200ms var(--l-ease), color 200ms var(--l-ease); }
.l-navlink:hover { background: var(--l-bg-2); color: var(--l-ink); }
.l-navlink.is-current { background: var(--l-ink); color: var(--l-bg); }
.l-skip { position: absolute; left: 1rem; top: -100%; z-index: 20; padding: 0.75rem 1rem; border-radius: 999px; background: var(--l-ink); color: var(--l-bg); font-weight: 600; }
.l-skip:focus-visible { top: 1rem; }
/* Today strip */
.l-strip-today { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem; padding-block: 1rem; border-top: 1px solid var(--l-line); border-bottom: 1px solid var(--l-line); }
/* Buttons */
.l-btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding-inline: 1.25rem; border-radius: 999px; font-weight: 600; transition: transform 180ms var(--l-ease), background-color 180ms var(--l-ease), border-color 180ms var(--l-ease); }
.l-btn:active { transform: scale(0.97); }
.l-btn-accent { background: var(--l-accent-text); color: #fff; }
.l-btn-accent:hover { filter: brightness(1.08); }
.l-btn-ghost { border: 1px solid var(--l-line); color: var(--l-ink); }
.l-btn-ghost:hover { border-color: var(--l-ink-soft); }
/* Category nav: sticky row of underlined links, scrolls sideways inside itself. */
.l-jump { position: sticky; top: 0; z-index: 2; display: flex; gap: 1.25rem; overflow-x: auto; scrollbar-width: none; padding-block: 0.75rem; margin-inline: -1rem; padding-inline: 1rem; background: color-mix(in oklab, var(--l-bg) 92%, transparent); backdrop-filter: blur(8px); }
.l-jump::-webkit-scrollbar { display: none; }
.l-jumplink { flex: none; min-height: 44px; display: inline-flex; align-items: center; font-weight: 600; color: var(--l-ink-soft); text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 6px; white-space: nowrap; transition: color 200ms var(--l-ease), text-decoration-color 200ms var(--l-ease); }
.l-jumplink:hover, .l-jumplink:focus-visible { color: var(--l-ink); text-decoration-color: var(--l-accent-text); }
.l-section { scroll-margin-top: 4.5rem; }
/* Two-column menu on tablet and up; a category never splits. */
@media (min-width: 768px) { .l-columns { columns: 2; column-gap: 3rem; } .l-columns > section { break-inside: avoid; } }
/* Photo strip and highlight grid */
.l-strip { display: flex; gap: 0.75rem; overflow-x: auto; scroll-snap-type: x mandatory; margin-inline: -1rem; padding-inline: 1rem; padding-bottom: 0.5rem; scrollbar-width: none; }
.l-strip::-webkit-scrollbar { display: none; }
.l-strip > * { scroll-snap-align: start; flex: 0 0 64%; }
@media (min-width: 640px) { .l-strip > * { flex-basis: 32%; } }
.l-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
@media (min-width: 768px) { .l-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; } }
/* Motion */
.l-rise { animation: l-rise 300ms var(--l-ease) both; }
@keyframes l-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.l-flash { animation: l-flash 2.2s ease-out both; }
@keyframes l-flash { 0%, 65% { opacity: 1; } 100% { opacity: 0; } }
.tpl-lumen :focus-visible { outline: 3px solid var(--l-accent-text); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .tpl-lumen *, .tpl-lumen *::before, .tpl-lumen *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
```

- [ ] **Step 5: Bits, root Template and the draft bar**

```tsx
// src/templates/lumen/bits.tsx
"use client";
import type { Lang } from "@/src/domain/types";

export type MediaLookup = (id: string | null) => string | null;

export function pick(lang: Lang, bg: string, en: string): string {
  return (lang === "bg" ? bg : en) || bg || en;
}

/** Brief tint behind a card that just changed; keyed by the change time so it re-triggers. Needs an `isolate` parent. */
export function Flash({ at }: { at: number | undefined }) {
  if (at === undefined) return null;
  return <span key={at} aria-hidden="true" className="l-flash pointer-events-none absolute inset-0 -z-10 rounded-[inherit]" style={{ background: "var(--l-accent-soft)" }} />;
}
```

```tsx
// src/templates/lumen/Template.tsx
"use client";
import { useEffect, useState, type CSSProperties } from "react";
import type { DraftInfo } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { mediaUrl } from "../shared/media";
import { useLiveSite } from "../shared/useLiveSite";
import { fontVars } from "./fonts";
import { Footer } from "./Footer";
import { Gallery } from "./Gallery";
import { Hero } from "./Hero";
import { MenuList } from "./MenuList";
import { Today } from "./Today";
import { Visit } from "./Visit";
import type { MediaLookup } from "./bits";
import "./styles.css";

const ACCENT_RE = /^#[0-9a-f]{6}$/i;

function useClock(initial: number, live: boolean): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [live]);
  return now;
}

function DraftBar({ draft, slug }: { draft: DraftInfo; slug: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function decide(action: "apply" | "reject") {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/${encodeURIComponent(slug)}?key=${encodeURIComponent(draft.key)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, change_set_id: draft.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      window.location.replace(`/${slug}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <div role="region" aria-label={t("site.draft")} className="sticky top-0 z-30" style={{ background: "var(--l-ink)", color: "var(--l-bg)" }}>
      <div className="l-wrap flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm">
          <span className="mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide" style={{ background: "var(--l-bg)", color: "var(--l-ink)" }}>{t("site.draft")}</span>
          <span className="break-words">{lang === "bg" ? draft.summary_bg : draft.summary_en}</span>
          {failed && <span role="alert" className="mt-1 block font-semibold">{t("site.draftFailed")}</span>}
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={busy} onClick={() => void decide("apply")} className="l-btn disabled:opacity-60" style={{ background: "var(--l-bg)", color: "var(--l-ink)" }}>{busy ? t("site.draftBusy") : t("site.draftApply")}</button>
          <button type="button" disabled={busy} onClick={() => void decide("reject")} className="l-btn disabled:opacity-60" style={{ border: "1px solid rgb(251 250 247 / 0.4)" }}>{t("site.draftReject")}</button>
          <a href={`/admin/${slug}?key=${encodeURIComponent(draft.key)}`} className="l-btn underline underline-offset-4">{t("site.draftBack")}</a>
        </div>
      </div>
    </div>
  );
}

export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useClock(initialNow, live);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2e5e4e";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  return (
    <div className={`tpl-lumen ${fontVars}`} style={{ "--accent": accent } as CSSProperties} data-page={page}>
      {draft && <DraftBar draft={draft} slug={slug} />}
      <Hero state={state} slug={slug} page={page} media={media} />
      <main id="main" className="l-wrap flex-1 pb-16">
        <Today state={state} now={now} changed={changed} media={media} />
        {page === "home" ? (
          <>
            <Gallery state={state} media={media} />
            <MenuList variant="highlights" state={state} now={now} changed={changed} media={media} slug={slug} />
            <Visit state={state} now={now} />
          </>
        ) : (
          <MenuList variant="full" state={state} now={now} changed={changed} media={media} slug={slug} />
        )}
      </main>
      <Footer state={state} feedUrl={feedUrl} />
    </div>
  );
}
```

- [ ] **Step 6: Hero and Today**

```tsx
// src/templates/lumen/Hero.tsx
"use client";
import Image from "next/image";
import Link from "next/link";
import type { SiteState } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import { pick, type MediaLookup } from "./bits";

/** Split hero: name, italic tagline and welcome on the left; the cover (or a big serif initial) on the right. */
export function Hero({ state, slug, page, media }: { state: SiteState; slug: string; page: "home" | "menu"; media: MediaLookup }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const cover = media(v.cover_media_id);
  const logo = media(v.logo_media_id);
  const tagline = pick(lang, v.tagline_bg, v.tagline_en);
  const welcome = state.texts.find((x) => x.key === "welcome");
  const welcomeText = welcome ? pick(lang, welcome.text_bg, welcome.text_en) : "";
  const links = [
    { href: `/${slug}`, label: t("site.home"), current: page === "home" },
    { href: `/${slug}/menu`, label: t("site.menu"), current: page === "menu" },
  ];
  return (
    <header className="relative">
      <a href="#main" className="l-skip">{t("site.skip")}</a>
      <div className="l-wrap flex items-center justify-between gap-3 pt-4">
        <div className="flex items-center gap-3">
          {logo && (
            <span className="relative block size-10 overflow-hidden rounded-full" style={{ background: "var(--l-bg-2)" }}>
              <Image src={logo} alt="" fill sizes="40px" className="object-cover" />
            </span>
          )}
          <nav aria-label={t("site.nav")} className="flex gap-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined} className={`l-navlink ${l.current ? "is-current" : ""}`}>{l.label}</Link>
            ))}
          </nav>
        </div>
        <LangToggle />
      </div>
      <div className={`l-wrap l-hero ${page === "home" ? "pb-12 pt-10 sm:pt-16" : "pb-8 pt-8"}`}>
        <div className="l-rise">
          <h1 className="l-display text-balance text-[clamp(2.5rem,7vw,4.75rem)] leading-[1.02]">{v.name}</h1>
          {tagline && <p className="l-display l-italic l-soft mt-4 max-w-xl text-xl sm:text-2xl" style={{ animationDelay: "60ms" }}>{tagline}</p>}
          {page === "home" && welcomeText && <p className="mt-5 max-w-xl text-lg leading-relaxed">{welcomeText}</p>}
          {page === "home" && <Link href={`/${slug}/menu`} className="l-btn l-btn-accent mt-7">{t("site.fullMenu")}</Link>}
        </div>
        {(page === "home" || cover) && (
          <div className="l-photo l-hero-photo l-rise" style={{ animationDelay: "90ms" }}>
            {cover ? <Image src={cover} alt="" fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /> : <div aria-hidden="true" className="l-hero-fallback">{v.name.charAt(0)}</div>}
          </div>
        )}
      </div>
    </header>
  );
}
```

```tsx
// src/templates/lumen/Today.tsx
"use client";
import Image from "next/image";
import { isSoldOut, liveAnnouncements, visibleItems } from "@/src/domain/effective";
import { formatPrice, itemName } from "@/src/domain/format";
import { todayStatus } from "@/src/domain/hours";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { Changed } from "../shared/types";
import { formatDateTime, hhmm, localTime } from "@/src/time";
import { Flash, pick, type MediaLookup } from "./bits";

/** One-line status strip (dot, text, holiday note, announcement pills), then specials as photo cards in a grid. */
export function Today({ state, now, changed, media }: { state: SiteState; now: number; changed: Changed; media: MediaLookup }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const s = todayStatus(v.hours, state.holidays, new Date(now), v.tz);
  const text =
    s.state === "open" ? t("site.openUntil", { time: hhmm(s.until) })
    : s.state === "opens_later" ? t("site.opensAt", { time: hhmm(s.at) })
    : s.next ? t("site.closedUntil", { when: formatDateTime(s.next, lang, v.tz) })
    : t("site.closedToday");
  const note = s.holiday ? pick(lang, s.holiday.note_bg, s.holiday.note_en) : "";
  const news = liveAnnouncements(state.announcements, now);
  const specials = visibleItems(state.items, now).filter((i) => i.is_special).sort((a, b) => a.position - b.position);
  return (
    <section aria-labelledby="today" className="l-section">
      <div className="l-strip-today">
        <h2 id="today" className="l-eyebrow">{t("site.today")}</h2>
        <p aria-live="polite" className="flex items-center gap-2.5 font-semibold">
          <span aria-hidden="true" className={`l-dot l-dot-${s.state}`} />
          <span suppressHydrationWarning>{text}</span>
        </p>
        {note && <p className="l-soft">{note}</p>}
        {news.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {news.map((a) => <li key={a.id} className="l-pill">{pick(lang, a.text_bg, a.text_en)}</li>)}
          </ul>
        )}
      </div>
      {specials.length > 0 && (
        <div className="mt-10">
          <h3 className="l-h2">{t("site.specials")}</h3>
          <ul className="l-grid mt-4">
            {specials.map((i) => {
              const img = media(i.image_media_id);
              const sold = isSoldOut(i, now);
              const desc = lang === "bg" ? i.desc_bg : i.desc_en;
              return (
                <li key={i.id} className="l-card relative isolate overflow-hidden">
                  <Flash at={changed.get(i.id)} />
                  {img && (
                    <div className="l-photo relative aspect-[4/3] rounded-none">
                      <Image src={img} alt={itemName(i, lang)} fill sizes="(min-width: 768px) 320px, 50vw" className="object-cover" />
                    </div>
                  )}
                  <div className="p-4">
                    <h4 className="l-display text-lg">{itemName(i, lang)}</h4>
                    <p className={`l-price l-accent mt-1 ${sold ? "is-sold" : ""}`}>{formatPrice(i.price_eur, lang)}</p>
                    {desc && <p className="l-soft mt-1 text-sm">{desc}</p>}
                    {sold && <p className="l-badge mt-2">{t("site.soldOut")}</p>}
                    {i.special_expires_at && <p className="l-soft mt-2 text-xs">{t("site.specialUntil", { time: localTime(new Date(i.special_expires_at), v.tz) })}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 7: MenuList (photo grid on home, two-column menu with a sticky category nav)**

```tsx
// src/templates/lumen/MenuList.tsx
"use client";
import Image from "next/image";
import Link from "next/link";
import { allergenName } from "@/src/domain/allergens";
import { isSoldOut, visibleItems } from "@/src/domain/effective";
import { categoryName, formatPrice, itemName } from "@/src/domain/format";
import type { Item, Lang, SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { Changed } from "../shared/types";
import { formatDateTime } from "@/src/time";
import { Flash, type MediaLookup } from "./bits";

type Props = { state: SiteState; now: number; changed: Changed; media: MediaLookup; slug: string; variant: "highlights" | "full" };
type T = ReturnType<typeof useLang>["t"];

function Row({ i, lang, now, tz, changed, t }: { i: Item; lang: Lang; now: number; tz: string; changed: Changed; t: T }) {
  const sold = isSoldOut(i, now);
  const desc = lang === "bg" ? i.desc_bg : i.desc_en;
  return (
    <li className="relative isolate py-3">
      <Flash at={changed.get(i.id)} />
      <div className="flex items-baseline justify-between gap-4">
        <h3 className={`min-w-0 break-words font-semibold ${sold ? "l-soft" : ""}`}>{itemName(i, lang)}</h3>
        <span aria-hidden="true" className="mb-1 min-w-4 flex-1 border-b border-dotted" style={{ borderColor: "var(--l-line)" }} />
        <span className={`l-price ${sold ? "is-sold" : ""}`}>{formatPrice(i.price_eur, lang)}</span>
      </div>
      {desc && <p className="l-soft mt-0.5 text-sm">{desc}</p>}
      {(sold || i.allergens.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {sold && i.sold_out_until && <span className="l-badge">{t("site.soldOutUntil", { when: formatDateTime(i.sold_out_until, lang, tz) })}</span>}
          {i.allergens.length > 0 && <span className="sr-only">{t("site.allergens")}:</span>}
          {i.allergens.map((a) => (
            <span key={a} title={allergenName(a, lang)} className="l-soft inline-flex min-w-6 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold" style={{ background: "var(--l-bg-2)" }}>
              {a}<span className="sr-only"> {allergenName(a, lang)}</span>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export function MenuList({ state, now, changed, media, slug, variant }: Props) {
  const { lang, t } = useLang();
  const tz = state.venue.tz;
  const items = visibleItems(state.items, now);
  const cats = state.categories.filter((c) => c.active).sort((a, b) => a.position - b.position);
  if (variant === "highlights") {
    const catPos = new Map(cats.map((c) => [c.id, c.position]));
    const picks = items
      .filter((i) => !i.is_special)
      .sort((a, b) => Number(!media(a.image_media_id)) - Number(!media(b.image_media_id)) || (catPos.get(a.category_id) ?? 0) - (catPos.get(b.category_id) ?? 0) || a.position - b.position)
      .slice(0, 6);
    if (picks.length === 0) return null;
    const withImages = picks.some((i) => media(i.image_media_id)); // no photos yet: a plain list instead of empty tiles
    return (
      <section aria-labelledby="highlights" className="l-section mt-14">
        <h2 id="highlights" className="l-h2">{t("site.highlights")}</h2>
        {withImages ? (
          <ul className="l-grid mt-5">
            {picks.map((i) => {
              const img = media(i.image_media_id);
              const sold = isSoldOut(i, now);
              return (
                <li key={i.id} className="relative isolate">
                  <Flash at={changed.get(i.id)} />
                  <div className="l-photo aspect-square">{img && <Image src={img} alt={itemName(i, lang)} fill sizes="(min-width: 768px) 320px, 50vw" className="object-cover" />}</div>
                  <h3 className="mt-2 text-sm font-semibold">{itemName(i, lang)}</h3>
                  <p className={`l-price text-sm ${sold ? "is-sold" : "l-accent"}`}>{sold ? t("site.soldOut") : formatPrice(i.price_eur, lang)}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="l-divide mt-3 max-w-2xl">
            {picks.map((i) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} t={t} />)}
          </ul>
        )}
        <Link href={`/${slug}/menu`} className="l-btn l-btn-ghost mt-6">{t("site.fullMenu")}</Link>
      </section>
    );
  }
  const sections = cats
    .map((c) => ({ c, items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position) }))
    .filter((s) => s.items.length > 0);
  const used = [...new Set(sections.flatMap((s) => s.items.flatMap((i) => i.allergens)))].sort((a, b) => a - b);
  if (sections.length === 0) return <p className="l-soft mt-10 text-center">{t("site.noItems")}</p>;
  return (
    <div className="mt-4">
      {sections.length > 1 && (
        <nav aria-label={t("site.categories")} className="l-jump">
          {sections.map(({ c }) => <a key={c.id} href={`#cat-${c.id}`} className="l-jumplink">{categoryName(c, lang)}</a>)}
        </nav>
      )}
      <div className="l-columns mt-4">
        {sections.map(({ c, items: list }) => (
          <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-h-${c.id}`} className="l-section mb-10">
            <h2 id={`cat-h-${c.id}`} className="l-h2">{categoryName(c, lang)}</h2>
            <ul className="l-divide mt-2">
              {list.map((i) => <Row key={i.id} i={i} lang={lang} now={now} tz={tz} changed={changed} t={t} />)}
            </ul>
          </section>
        ))}
      </div>
      {used.length > 0 && (
        <section aria-labelledby="allergens" className="l-card mt-6 p-4 sm:p-5">
          <h2 id="allergens" className="l-eyebrow">{t("site.allergenLegend")}</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {used.map((a) => (
              <div key={a} className="flex gap-2">
                <dt className="min-w-6 font-semibold tabular-nums">{a}</dt>
                <dd className="l-soft">{allergenName(a, lang)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <a href="#main" className="l-btn l-btn-ghost mt-10">{t("site.toTop")}</a>
    </div>
  );
}
```

- [ ] **Step 8: Gallery (photo strip), Visit, Footer**

```tsx
// src/templates/lumen/Gallery.tsx
"use client";
import Image from "next/image";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MediaLookup } from "./bits";

/** Photo strip right under the status line: 3:4 photos that snap; nothing when the gallery is empty. */
export function Gallery({ state, media }: { state: SiteState; media: MediaLookup }) {
  const { t } = useLang();
  const photos = state.media.filter((m) => m.is_gallery).sort((a, b) => a.position - b.position).map((m) => ({ id: m.id, src: media(m.id) })).filter((p) => p.src);
  if (photos.length === 0) return null;
  return (
    <section aria-labelledby="gallery" className="l-section mt-10">
      <h2 id="gallery" className="sr-only">{t("site.gallery")}</h2>
      <ul className="l-strip">
        {photos.map((p, n) => (
          <li key={p.id} className="l-photo aspect-[3/4]">
            <Image src={p.src as string} alt={t("site.galleryPhoto", { name: state.venue.name, n: n + 1 })} fill sizes="(min-width: 640px) 320px, 64vw" className="object-cover" />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// src/templates/lumen/Visit.tsx
"use client";
import { weekdayLabel } from "@/src/domain/format";
import { WEEKDAYS, type SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { formatDate, hhmm, localDate, localWeekday } from "@/src/time";
import { pick } from "./bits";

function instagram(value: string): { url: string; handle: string } {
  const handle = value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  return { url: `https://instagram.com/${encodeURIComponent(handle)}`, handle };
}

/** About on the left, hours as a definition list and the contact actions on the right (stacked on mobile). */
export function Visit({ state, now }: { state: SiteState; now: number }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const about = pick(lang, v.about_bg, v.about_en);
  const today = localWeekday(new Date(now), v.tz);
  const todayDate = localDate(new Date(now), v.tz);
  const upcoming = state.holidays.filter((h) => h.date >= todayDate).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section aria-labelledby="visit" className="l-section mt-16 grid gap-8 lg:grid-cols-2 lg:gap-12">
      <div>
        <h2 id="visit" className="l-h2">{t("site.visit")}</h2>
        {about && <p className="l-soft mt-4 max-w-prose text-lg leading-relaxed">{about}</p>}
        {v.address && <p className="mt-6 font-semibold">{v.address}</p>}
        <ul className="mt-4 flex flex-wrap gap-2 text-sm">
          {v.maps_url && <li><a href={v.maps_url} target="_blank" rel="noopener noreferrer" className="l-btn l-btn-accent">{t("site.map")}</a></li>}
          {v.phone && <li><a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="l-btn l-btn-ghost">{t("site.call")} {v.phone}</a></li>}
          {v.instagram && <li><a href={instagram(v.instagram).url} target="_blank" rel="noopener noreferrer" className="l-btn l-btn-ghost">Instagram @{instagram(v.instagram).handle}</a></li>}
        </ul>
      </div>
      <div className="l-card p-5 sm:p-6">
        <h3 className="l-eyebrow">{t("site.hours")}</h3>
        <dl className="mt-3 text-sm">
          {WEEKDAYS.map((d) => {
            const h = v.hours[d];
            const isToday = d === today;
            return (
              <div key={d} aria-current={isToday ? "date" : undefined} className={`flex justify-between gap-4 py-1 ${isToday ? "font-semibold" : "l-soft"}`}>
                <dt className="capitalize">{weekdayLabel(d, lang)}</dt>
                <dd suppressHydrationWarning className="tabular-nums">{h ? `${hhmm(h.open)}–${hhmm(h.close)}` : t("site.closedDay")}</dd>
              </div>
            );
          })}
        </dl>
        {upcoming.length > 0 && (
          <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--l-line)" }}>
            <h4 className="text-sm font-semibold">{t("site.holidays")}</h4>
            <ul className="l-soft mt-1 space-y-1 text-sm">
              {upcoming.map((h) => {
                const note = pick(lang, h.note_bg, h.note_en);
                return <li key={h.id}><span className="font-semibold tabular-nums" style={{ color: "var(--l-ink)" }}>{formatDate(h.date, lang)}</span>{note && ` · ${note}`}</li>;
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
```

```tsx
// src/templates/lumen/Footer.tsx
"use client";
import type { SiteState } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import { pick } from "./bits";

function poweredHref(feedUrl: string): string {
  try {
    return new URL(feedUrl).origin;
  } catch {
    return "/";
  }
}

export function Footer({ state, feedUrl }: { state: SiteState; feedUrl: string }) {
  const { lang, t } = useLang();
  const note = state.texts.find((x) => x.key === "footer_note");
  const noteText = note ? pick(lang, note.text_bg, note.text_en) : "";
  return (
    <footer className="border-t" style={{ borderColor: "var(--l-line)" }}>
      <div className="l-wrap flex flex-col items-center gap-2 py-10 text-center text-sm">
        <p className="l-display text-lg">{state.venue.name}</p>
        {noteText && <p className="l-soft">{noteText}</p>}
        <a href={poweredHref(feedUrl)} className="l-soft inline-flex min-h-11 items-center underline underline-offset-4">{t("site.poweredBy")}</a>
      </div>
    </footer>
  );
}
```

- [ ] **Step 9: Register the template**

In `src/templates/index.ts` add:

```ts
import { def as lumen } from "./lumen";
```

and in `TEMPLATES` replace the Task 2 placeholder entry for the `lumen` key with:

```ts
  lumen,
```

Run `npm test -- test/template-lumen.test.ts` → PASS (9 tests). Run `npm test -- test/templates-boundary.test.ts test/template-nocturne.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 10: Visual pass under the design skills and the offline check**

`SITE_MANAGER_STORE=memory npm run dev`, then put the demo venue on lumen (temporarily call `store.updateVenue(venue.id, { template: "lumen" })` in `scripts/demo-reset.mts`, or use the preview override if Task 2's `app/[slug]` page has one; revert afterwards). Open `/agala` and `/agala/menu` in the browser pane at 360, 768 and 1280 px, in БГ and EN; verify: no horizontal scroll at 360 px, the hero with and without a cover, holiday today, a closed day, a sold-out item, an empty gallery and a seeded gallery, the 40-item menu in two columns at 768+ with no category split across columns; tab through the page (focus ring on every control); enable "Reduce motion" in the OS and confirm nothing animates. Run Lighthouse (accessibility ≥ 95). Refine spacing, type scale and the accent handling under the skills listed above. Keep the structural hooks the tests use (`tpl-lumen`, `l-jumplink`, `aria-labelledby="gallery"`). Attach screenshots and the `review-animations` + `web-design-guidelines` notes.

- [ ] **Step 11: Commit**

```bash
git add src/templates/lumen src/templates/index.ts src/i18n/dicts.ts test/template-lumen.test.ts
git commit -m "Templates: lumen (light, photo-first, cafés) with Playfair Display + Golos Text, split hero, two-column menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: fable

---


### Task 5: Thin shell app, deploy manifest, `outputFileTracingIncludes`, offline shell build script

> **Rulings that apply to this task:** R1 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Create: `templates/shell/package.json`, `templates/shell/next.config.ts`, `templates/shell/tsconfig.json`, `templates/shell/app/globals.css`, `templates/shell/app/layout.tsx`, `templates/shell/app/feed.ts`, `templates/shell/app/page.tsx`, `templates/shell/app/menu/page.tsx`, `templates/shell/app/not-found.tsx`, `templates/shell/app/robots.ts`, `templates/shell/app/sitemap.ts`, `templates/shell/app/opengraph-image.tsx`, `src/deploy/manifest.ts`, `scripts/template-build.mts`, `test/manifest.test.ts`
- Modify: `next.config.ts` (root), `tsconfig.json` (root: exclude the shell, which has its own tsconfig), `package.json` (script `test:templates`)

**Interfaces:**
- Consumes: `TemplateId`, `TEMPLATE_IDS` (Task 1); `TemplateDef`/`TemplateProps` and the `src/templates/**` layout, `pageHref` and `NEXT_PUBLIC_SITE_STANDALONE` (Task 2); `LangProvider` from `src/i18n`.
- Produces (verbatim from the spec contracts): `InlinedFile { file; data; encoding }`, `SHELL_ROOT = "templates/shell"`, `MANIFEST_DIRS`, `buildFiles(templateId, opts?: { root?: string }): Promise<InlinedFile[]>` in `src/deploy/manifest.ts` (Task 6's `VercelDeployer` takes it as `files`); shell env contract `SITE_MANAGER_URL`, `SITE_MANAGER_SLUG`; `npm run test:templates`.

Decisions this task fixes:
- The root `next.config.ts` key is the glob `"/api/**"`: the files are needed by every route that can call `buildFiles` (`/api/telegram` deploys after the owner's `/start`, `/api/new/[id]/publish` and `/api/new/[id]/status` per the spec, `/api/admin/[slug]` for the template switch in Task 10). Verified in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`: the option is `outputFileTracingIncludes: Record<string, string[]>` (top level, Next 16), keys are route globs matched with picomatch against the route path, values are globs resolved from the project root. The type lives in `node_modules/next/dist/server/config-shared.d.ts` line 1787.
- Shell pages are `force-dynamic` with the feed fetched under `next: { revalidate: 10 }`: a build never calls the feed, and a feed outage renders the last cached copy for up to 10 s, then a 404 page (the main app at `/<slug>` is the fallback).
- The Open Graph card loads a Cyrillic-capable TTF (Onest, subset to the exact glyphs it prints) from Google Fonts at request time with a 3 s timeout and falls back to Satori's default font; the card is always produced.
- `app/feed.ts` is a plain module inside `app/` (not a route file); it keeps the three pages on one fetch implementation.

- [ ] **Step 1: Shell project files**

```json
{
  "name": "venue-site",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "16.4.0",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/turbopack": "^4",
    "@types/node": "24.10.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "typescript": "^5"
  },
  "engines": {
    "node": ">=22"
  }
}
```
→ `templates/shell/package.json` (every version string copied from the root `package.json`).

```ts
// templates/shell/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Inlined at build time: templates link to / and /menu instead of /<slug> (src/templates/shared/links.ts).
  env: { NEXT_PUBLIC_SITE_STANDALONE: "1" },
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  images: { remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }] },
};
export default nextConfig;
```

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
→ `templates/shell/tsconfig.json`. Paths `@/*` → `./*` so `@/src/domain/types` resolves to the same relative location as in the main repo.

- [ ] **Step 2: Shell styles and layout**

`templates/shell/app/globals.css` (the parts of the root `app/globals.css` that templates use; the font tokens come from the template's `fontVars` instead of the main app's layout fonts):

```css
@import "tailwindcss";

@theme {
  --color-paper: #faf7f2;
  --color-paper-deep: #f1ebe1;
  --color-card: #fffdf9;
  --color-ink: #1d2a24;
  --color-ink-soft: #4b5a53;
  --color-amber: #8f5c10;
  --color-amber-soft: #fbf0dc;
  --color-clay: #a4442c;
  --color-clay-soft: #f7e4dc;
  --animate-rise: rise 520ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  --animate-flash: flash 2.2s ease-out both;
  --animate-line-in: line-in 700ms cubic-bezier(0.2, 0.7, 0.2, 1) both;

  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  /* Held for ~1.5 s, then fades: readable as "this just changed" from the back of a room. */
  @keyframes flash { 0%, 65% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes line-in { 0% { opacity: 0; transform: translateX(-8px); background-color: var(--color-amber-soft); } 40% { opacity: 1; transform: none; background-color: var(--color-amber-soft); } 100% { background-color: transparent; } }
}

/* `inline`: utilities read var(--accent) where they are used, so a venue wrapper that sets --accent recolours its descendants.
   `reference`: no :root copy of these tokens, so nothing can resolve --accent at the root by mistake; in custom CSS use var(--accent, #2f6b4f). */
@theme inline reference {
  --color-accent: var(--accent, #2f6b4f);
  --color-accent-soft: color-mix(in oklab, var(--accent, #2f6b4f) 14%, white);
}

/* The template's fontVars class (on <html>) defines --font-display and --font-body. */
@utility font-display { font-family: var(--font-display, ui-serif, Georgia, serif); }

html { -webkit-text-size-adjust: 100%; }
body { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-body, ui-sans-serif, system-ui, sans-serif); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
h1, h2, h3 { font-family: var(--font-display, ui-serif, Georgia, serif); font-variation-settings: "opsz" 48; }
/* Faint tinted grain so the off-white does not read as flat on a projector. */
body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background-image: radial-gradient(1200px 600px at 85% -10%, color-mix(in oklab, var(--accent, #2f6b4f) 9%, transparent), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgb(183 121 31 / 0.06), transparent 60%); }
:focus-visible { outline: 3px solid var(--accent, #2f6b4f); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
}
@media (min-width: 1600px) { html { font-size: 112.5%; } }
```

```tsx
// templates/shell/app/layout.tsx
import type { ReactNode } from "react";
import { def } from "@/src/templates/current";
import "./globals.css";

/** The template's next/font classes go on <html> so --font-display/--font-body exist everywhere (body, not-found, template root). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bg" className={`${def.fontVars} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Shell feed, pages, not-found, robots, sitemap, OG image**

```ts
// templates/shell/app/feed.ts
// Server-only: reads SITE_MANAGER_URL and SITE_MANAGER_SLUG (set on the Vercel project at creation) and fetches the public feed.
import type { SiteState } from "@/src/domain/types";

export const SLUG = (process.env.SITE_MANAGER_SLUG ?? "").trim();
const BASE = (process.env.SITE_MANAGER_URL ?? "").trim().replace(/\/+$/, "");
/** Absolute feed URL; the template polls it in the browser, the pages fetch it on the server. */
export const FEED_URL = `${BASE}/api/site/${encodeURIComponent(SLUG)}`;

/** This site's own origin (Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every deployment). */
export function siteUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host}` : "http://localhost:3000";
}

/** The venue state, revalidated every 10 s; null when the env is missing or Site Manager is unreachable. */
export async function loadFeed(): Promise<SiteState | null> {
  if (!BASE || !SLUG) return null;
  try {
    const res = await fetch(FEED_URL, { next: { revalidate: 10 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { state: SiteState };
    return data.state;
  } catch {
    return null;
  }
}
```

```tsx
// templates/shell/app/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { def } from "@/src/templates/current";
import { FEED_URL, loadFeed, siteUrl, SLUG } from "./feed";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const state = await loadFeed();
  if (!state) return { title: "Site" };
  const v = state.venue;
  return { metadataBase: new URL(siteUrl()), title: v.name, description: v.default_lang === "bg" ? v.tagline_bg : v.tagline_en };
}

export default async function Page() {
  const state = await loadFeed();
  if (!state) notFound();
  return (
    <LangProvider defaultLang={state.venue.default_lang}>
      <def.Component state={state} now={Date.now()} slug={SLUG} page="home" draft={null} live feedUrl={FEED_URL} />
    </LangProvider>
  );
}
```

```tsx
// templates/shell/app/menu/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LangProvider } from "@/src/i18n";
import { def } from "@/src/templates/current";
import { FEED_URL, loadFeed, siteUrl, SLUG } from "../feed";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const state = await loadFeed();
  if (!state) return { title: "Menu" };
  const v = state.venue;
  return { metadataBase: new URL(siteUrl()), title: `${v.default_lang === "bg" ? "Меню" : "Menu"} · ${v.name}`, description: v.default_lang === "bg" ? v.tagline_bg : v.tagline_en };
}

export default async function Page() {
  const state = await loadFeed();
  if (!state) notFound();
  return (
    <LangProvider defaultLang={state.venue.default_lang}>
      <def.Component state={state} now={Date.now()} slug={SLUG} page="menu" draft={null} live feedUrl={FEED_URL} />
    </LangProvider>
  );
}
```

```tsx
// templates/shell/app/not-found.tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold">Страницата не е намерена · Page not found</h1>
      <p className="mt-3 text-ink-soft">Сайтът се обновява в момента. Опитайте след малко. · The site is being updated. Please try again in a moment.</p>
      <Link href="/" className="mt-6 text-accent underline">Начало · Home</Link>
    </main>
  );
}
```

```ts
// templates/shell/app/robots.ts
import type { MetadataRoute } from "next";
import { siteUrl } from "./feed";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${siteUrl()}/sitemap.xml` };
}
```

```ts
// templates/shell/app/sitemap.ts
import type { MetadataRoute } from "next";
import { siteUrl } from "./feed";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();
  return [
    { url: base, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${base}/menu`, lastModified, changeFrequency: "daily", priority: 0.8 },
  ];
}
```

```tsx
// templates/shell/app/opengraph-image.tsx
// Text card: venue name + tagline on the accent colour (cover photo behind it when there is one).
import { ImageResponse } from "next/og";
import { loadFeed } from "./feed";

export const dynamic = "force-dynamic";
export const alt = "Site";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Onest subset to the glyphs we print, as TTF (Satori needs TTF/OTF/WOFF). Best effort: null after 3 s or any error. */
async function cyrillicFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Onest:wght@600&text=${encodeURIComponent(text)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0" },
      signal: AbortSignal.timeout(3000),
    }).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src:\s*url\(([^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image() {
  const state = await loadFeed();
  const name = state?.venue.name ?? "Site";
  const tagline = state ? (state.venue.default_lang === "bg" ? state.venue.tagline_bg : state.venue.tagline_en) : "";
  const accent = state && /^#[0-9a-f]{6}$/i.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2f6b4f";
  const cover = state?.media.find((m) => m.id === state.venue.cover_media_id)?.public_url ?? null;
  const coverUrl = cover && /^https:\/\/[^/]+\.supabase\.co\//.test(cover) ? cover : null;
  const font = await cyrillicFont(`${name} ${tagline}`);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: accent, color: "white", fontFamily: font ? "Onest" : "sans-serif" }}>
        {coverUrl && <img src={coverUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }} />}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 72, width: "100%", height: "100%", background: "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0.15))" }}>
          <div style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.1 }}>{name}</div>
          {tagline && <div style={{ marginTop: 20, fontSize: 34, opacity: 0.92 }}>{tagline}</div>}
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Onest", data: font, weight: 600, style: "normal" }] : [] },
  );
}
```

- [ ] **Step 4: Root config: trace the shell into the API functions, exclude the shell from the root tsconfig**

Root `next.config.ts`: add inside `nextConfig` after the `images` block:

```ts
  // The deployer inlines these files into each venue's Vercel deployment; without this they would not exist in the serverless functions.
  outputFileTracingIncludes: {
    "/api/**": ["./templates/shell/**/*", "./src/templates/**/*", "./src/domain/**/*", "./src/time.ts", "./src/i18n/**/*"],
  },
```

Root `tsconfig.json`: change `"exclude": ["node_modules"]` to `"exclude": ["node_modules", "templates/shell"]` (the shell imports `@/src/templates/current`, which only exists inside a built manifest; the shell is type-checked by its own `next build` in Step 7).

Run `npm run typecheck` → clean (the shell is excluded; `src/deploy/manifest.ts` comes next).

- [ ] **Step 5: Write the failing manifest tests**

```ts
// test/manifest.test.ts
import { readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFiles, MANIFEST_DIRS, SHELL_ROOT, type InlinedFile } from "@/src/deploy/manifest";

const BUILTIN = /^node:/;
const TEXT_EXT = /\.(ts|tsx|css|json|mjs|js|md|txt|svg)$/;

/** Runtime specifiers only: `import type …` statements are erased by the compiler and may point at files the manifest does not ship. */
function specifiers(source: string): string[] {
  const runtime = source.replace(/^\s*import\s+type\b[^;]*;/gm, "");
  const out: string[] = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s+["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of runtime.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** True when `spec` imported from `file` resolves to a file in the manifest or to a dependency the shell package.json provides. */
function resolves(spec: string, file: string, set: Set<string>): boolean {
  if (spec === "react" || spec === "react-dom" || spec.startsWith("react/") || spec.startsWith("react-dom/")) return true;
  if (spec === "next" || spec.startsWith("next/")) return true;
  if (BUILTIN.test(spec)) return true;
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) base = posix.normalize(posix.join(dirname(file), spec));
  else return false;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].some((p) => set.has(p));
}

describe("buildFiles", () => {
  it("ships the shell, the chosen template, shared code, the domain closure and i18n, in a deterministic order", async () => {
    const files = await buildFiles("classic");
    const names = files.map((f) => f.file);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    for (const must of ["package.json", "next.config.ts", "tsconfig.json", "app/layout.tsx", "app/page.tsx", "app/menu/page.tsx", "app/globals.css", "app/not-found.tsx", "app/robots.ts", "app/sitemap.ts", "app/opengraph-image.tsx", "src/templates/current.ts", "src/templates/classic/Template.tsx", "src/templates/classic/index.ts", "src/templates/shared/useLiveSite.ts", "src/templates/shared/media.ts", "src/domain/types.ts", "src/domain/format.ts", "src/time.ts", "src/i18n/index.tsx", "src/i18n/dicts.ts"]) {
      expect(names, `missing ${must}`).toContain(must);
    }
    expect(files.find((f) => f.file === "src/templates/current.ts")).toEqual({ file: "src/templates/current.ts", data: 'export { def } from "./classic";\n', encoding: "utf-8" });
    expect(names).not.toContain("src/templates/index.ts"); // templates import only its types; shipping it would bundle every design
    const again = await buildFiles("classic");
    expect(JSON.stringify(again)).toBe(JSON.stringify(files));
    expect(SHELL_ROOT).toBe("templates/shell");
    expect(MANIFEST_DIRS).toEqual(["src/templates/shared", "src/domain", "src/time.ts", "src/i18n"]);
  });

  it("includes only allowed paths, no env files, no tests, no other templates", async () => {
    const files = await buildFiles("classic");
    for (const f of files) {
      const ok = f.file.startsWith("app/") || f.file.startsWith("src/") || ["package.json", "next.config.ts", "tsconfig.json"].includes(f.file);
      expect(ok, f.file).toBe(true);
      expect(f.file, f.file).not.toMatch(/(^|\/)\.env/);
      expect(f.file, f.file).not.toMatch(/\.test\.tsx?$/);
      expect(f.file, f.file).not.toMatch(/(^|\/)(tests|node_modules|\.next)\//);
      if (f.file.startsWith("src/templates/") && f.file !== "src/templates/current.ts") {
        expect(f.file, f.file).toMatch(/^src\/templates\/(shared|classic)\//);
      }
    }
    const nocturne = await buildFiles("nocturne");
    expect(nocturne.find((f) => f.file === "src/templates/current.ts")?.data).toBe('export { def } from "./nocturne";\n');
    expect(nocturne.some((f) => f.file.startsWith("src/templates/classic/"))).toBe(false);
  });

  it("resolves every import inside the manifest or to react, next or node builtins", async () => {
    const files = await buildFiles("classic");
    const set = new Set(files.map((f) => f.file));
    const unresolved: string[] = [];
    for (const f of files) {
      if (!/\.(ts|tsx)$/.test(f.file) || f.encoding !== "utf-8") continue;
      for (const spec of specifiers(f.data)) if (!resolves(spec, f.file, set)) unresolved.push(`${f.file} → ${spec}`);
    }
    expect(unresolved).toEqual([]);
  });

  it("encodes text as utf-8 straight from disk and everything else as base64", async () => {
    const files = await buildFiles("classic");
    const byName = new Map(files.map((f) => [f.file, f] as const));
    const tpl = byName.get("src/templates/classic/Template.tsx") as InlinedFile;
    expect(tpl.encoding).toBe("utf-8");
    expect(tpl.data).toBe(readFileSync("src/templates/classic/Template.tsx", "utf8"));
    for (const f of files) expect(f.encoding, f.file).toBe(TEXT_EXT.test(f.file) ? "utf-8" : "base64");
    expect(files.length).toBeGreaterThan(30);
    expect(files.length).toBeLessThan(120);
  });
});
```

Run `npm test -- test/manifest.test.ts` → fails: `Cannot find module '@/src/deploy/manifest'`.

- [ ] **Step 6: Implement `src/deploy/manifest.ts`**

```ts
// src/deploy/manifest.ts
// Builds the file list of one venue's thin site: shell + chosen template + shared template code + domain closure + i18n.
// Paths are preserved, so the shell's tsconfig `@/*` → `./*` resolves `@/src/...` exactly as in this repo.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { TemplateId } from "../domain/types";

export interface InlinedFile {
  file: string;
  data: string;
  encoding: "utf-8" | "base64";
}

export const SHELL_ROOT = "templates/shell";
/** Repo-relative paths copied verbatim (plus src/templates/<id>). */
export const MANIFEST_DIRS = ["src/templates/shared", "src/domain", "src/time.ts", "src/i18n"];

const TEXT_EXT = /\.(ts|tsx|css|json|mjs|js|md|txt|svg)$/;
const SKIP_DIR = new Set(["node_modules", ".next", "tests", "__tests__", ".git"]);
const skipFile = (name: string) => name.startsWith(".env") || name === ".DS_Store" || /\.test\.tsx?$/.test(name) || name.endsWith(".tsbuildinfo") || name === "next-env.d.ts";

async function walk(absDir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(absDir, { withFileTypes: true })) {
    const p = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) await walk(p, out);
    } else if (entry.isFile() && !skipFile(entry.name)) out.push(p);
  }
  return out;
}

const toPosix = (p: string) => p.split(sep).join(posix.sep);

async function inline(abs: string, file: string): Promise<InlinedFile> {
  const bytes = await readFile(abs);
  return TEXT_EXT.test(file) ? { file, data: bytes.toString("utf8"), encoding: "utf-8" } : { file, data: bytes.toString("base64"), encoding: "base64" };
}

/** Deterministic (sorted by path) list of files, paths relative to the shell root. `root` defaults to process.cwd() (the repo root). */
export async function buildFiles(templateId: TemplateId, opts: { root?: string } = {}): Promise<InlinedFile[]> {
  const root = opts.root ?? process.cwd();
  const out: InlinedFile[] = [];
  const shell = join(root, SHELL_ROOT);
  for (const abs of await walk(shell)) out.push(await inline(abs, toPosix(relative(shell, abs))));
  // src/templates/index.ts is deliberately absent: templates import only its types (erased), and shipping it would pull in every design.
  for (const dir of [...MANIFEST_DIRS, `src/templates/${templateId}`]) {
    const abs = join(root, dir);
    const s = await stat(abs);
    const files = s.isDirectory() ? await walk(abs) : [abs];
    for (const f of files) {
      const rel = toPosix(relative(root, f));
      if (rel === "src/templates/current.ts") continue; // generated below, never read from disk
      out.push(await inline(f, rel));
    }
  }
  out.push({ file: "src/templates/current.ts", data: `export { def } from "./${templateId}";\n`, encoding: "utf-8" });
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return out;
}
```

Run `npm test -- test/manifest.test.ts` → 4 passed.

Why `src/templates/index.ts` is **not** shipped: it imports every template folder (`./classic`, and after Tasks 3–4 `./nocturne`, `./lumen`), which would drag all three designs and their fonts into every venue site. Template files only need its *types* (`import type { TemplateProps } from "../index"`, `import type { TemplateDef } from "../index"` in Task 2), and `import type` statements are erased at compile time, so the shell's `tsc` never looks for the file. The test's `specifiers` helper strips `import type …;` statements before matching for the same reason. Templates must therefore never import a runtime value from `../index` (the boundary allows the path; this rule is documented in `src/templates/index.ts`'s header comment, which the implementer adds: `// Runtime imports of this module are for app/** only; templates import only its types (the shell manifest does not ship this file).`).

- [ ] **Step 7: `scripts/template-build.mts` and `npm run test:templates`**

```ts
// scripts/template-build.mts
// Offline proof that every deployed venue site builds: writes each template's manifest to a temp dir, installs, runs `next build`.
//   npm run test:templates                 all templates
//   npm run test:templates -- --only lumen one template
//   npm run test:templates -- --keep       keep the temp dirs for inspection
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildFiles } from "../src/deploy/manifest";
import { TEMPLATE_IDS, type TemplateId } from "../src/domain/types";

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const keep = argv.includes("--keep");
const ids = (only ? [only] : [...TEMPLATE_IDS]) as TemplateId[];
if (only && !(TEMPLATE_IDS as readonly string[]).includes(only)) {
  console.error(`unknown template "${only}" (one of ${TEMPLATE_IDS.join(", ")})`);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string): boolean {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, SITE_MANAGER_URL: "http://localhost:3000", SITE_MANAGER_SLUG: "demo", NEXT_TELEMETRY_DISABLED: "1" } });
  return r.status === 0;
}

let failed = 0;
for (const id of ids) {
  const dir = await mkdtemp(join(tmpdir(), `site-manager-shell-${id}-`));
  const files = await buildFiles(id);
  for (const f of files) {
    const abs = join(dir, f.file);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.encoding === "base64" ? Buffer.from(f.data, "base64") : f.data);
  }
  console.log(`\n=== ${id}: ${files.length} files in ${dir}`);
  const ok = run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir) && run("npx", ["next", "build"], dir);
  if (ok) {
    console.log(`=== ${id}: build OK`);
    if (!keep) await rm(dir, { recursive: true, force: true });
  } else {
    failed++;
    console.error(`=== ${id}: BUILD FAILED (files kept in ${dir})`);
  }
}
process.exit(failed ? 1 : 0);
```

`package.json` scripts: add after `"cleanup:test-venues"`:

```json
    "test:templates": "tsx scripts/template-build.mts"
```

Run `npm run test:templates -- --only classic` → prints `=== classic: build OK` (needs network for `npm install` the first time; it is not part of `npm test`). If the shell build fails on a type error inside `src/domain/**` or `src/i18n/**`, fix the import in the shell (never by editing the domain code's behaviour); if it fails on `@/src/templates/current`, the manifest did not write `current.ts` (check Step 6).

Run `npm test` → green; `npm run typecheck` → clean; `npm run lint` → clean; `SITE_MANAGER_STORE=memory npm run build` → green (confirms the root `next.config.ts` option name is accepted by Next 16.4; an unknown key would print a config warning).

- [ ] **Step 8: Commit**

```bash
git add templates/shell src/deploy/manifest.ts scripts/template-build.mts test/manifest.test.ts next.config.ts tsconfig.json package.json
git commit -m "Shell: thin venue site app, deploy manifest, offline template builds

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: opus

---


### Task 6: Deployer interface, `VercelDeployer`, `FakeDeployer`, deploy run, tick polling, draft cleanup, deploy-on-owner-join

> **Rulings that apply to this task:** R6, R7, R10, R14 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Create: `src/deploy/types.ts`, `src/deploy/vercel.ts`, `src/deploy/fake.ts`, `src/deploy/run.ts`, `test/deploy-vercel.test.ts`, `test/deploy-run.test.ts`
- Modify: `src/bot/copy.ts`, `src/bot/bot.ts`, `src/tick.ts`, `src/server/tick.ts`, `src/server/deps.ts`
- Test: `test/tick.test.ts` (extend), `test/bot.test.ts` (extend), `test/server-deps.test.ts` (extend)

**Interfaces:**
- Consumes: `DeployInfo`, `DeployStatus`, `TemplateId`, `Venue.status/deploy/template` and `Store.listVenues({ deploying })`, `setDeploy`, `listMembers`, `deleteVenue` (Task 1); `InlinedFile` and `buildFiles` (Task 5); `Config.vercelToken`, `vercelTeamId`, `publicBaseUrl` (Task 1); `Messenger`, `FakeMessenger`, `makeDemo`, `BotDeps`.
- Produces (verbatim from the spec contracts): `DeployInput`, `DeployStatusResult`, `DomainInstructions`, `Deployer` in `src/deploy/types.ts`; `VercelDeployer` (constructor `{ token, teamId?, fetch?, files, log? }`) in `src/deploy/vercel.ts`; `FakeDeployer` in `src/deploy/fake.ts`; `startDeploy(d, venueId)` and `pollDeployments(d)` in `src/deploy/run.ts` plus `DEPLOY_TIMEOUT_MS`, `POLL_MAX`; `TickDeps.deployer?`, `TickReport.deployed/deployFailed/cleaned`, `cleanupDrafts(d)`, `DRAFT_TTL_MS` in `src/tick.ts`; `ServerDeps.deployer`, `ServerDeps.startDeploy(venueId)`, `DepsOptions.deployer?`; `BotDeps.onOwnerJoined?`; copy keys `publishing`, `siteLive(name, url)`, `siteFailed(name)` in `src/bot/copy.ts`.

Decisions this task fixes:
- `startDeploy` is idempotent and does its own guard: it returns without touching the store when the venue is not `live` or already has a deployment that is not in `error`. The bot therefore calls `onOwnerJoined` after **every** successful owner redeem and prints the "publishing" copy only when `status === "live" && deploy === null`. A venue whose last deploy errored is retried on the same project (`redeploy`) by the next owner join or by Task 10's dashboard button.
- A `pending` deployment with an empty `deployment_id` (the create call is still running in another request) is skipped by the poller; the 20-minute timeout (measured from `deploy.updated_at`, which every status transition resets) eventually marks it `error`.
- Secrets: the deployer logs only `method path → status code`; API error messages are truncated to 200 chars; `run.ts` additionally masks any `Bearer …` fragment before storing an error.
- Realtime/cron note for Task 10 and Task 12: the Vercel cron is daily, so the done page polls `GET /api/new/[id]/status` (which calls the deployer directly) and may also `POST /api/tick?key=<admin token>` (venue-scoped tick, now polls deployments too). `handleRun` (every Telegram webhook) runs the per-venue tick with the deployer, so an owner who writes to the bot also advances their deployment.

- [ ] **Step 1: Types, fake deployer, copy**

```ts
// src/deploy/types.ts
import type { DeployStatus, TemplateId } from "../domain/types";

export interface DeployInput {
  slug: string;
  templateId: TemplateId;
  /** Absolute URL of the public feed, e.g. https://site-manager.example/api/site/agala */
  feedUrl: string;
}
export interface DeployStatusResult {
  state: DeployStatus;
  url: string | null;
  error: string | null;
}
export interface DomainInstructions {
  verified: boolean;
  records: { type: "A" | "CNAME" | "TXT"; name: string; value: string }[];
}
export interface Deployer {
  readonly provider: "vercel" | "fake";
  createSite(i: DeployInput): Promise<{ projectId: string; deploymentId: string }>;
  status(deploymentId: string): Promise<DeployStatusResult>;
  redeploy(projectId: string, i: DeployInput): Promise<{ deploymentId: string }>;
  deleteSite(projectId: string): Promise<void>;
  addDomain?(projectId: string, domain: string): Promise<DomainInstructions>;
}
```

```ts
// src/deploy/fake.ts
// Offline deployer: READY after two status() calls, url https://<slug>.example.test. Used when VERCEL_TOKEN is missing or SITE_MANAGER_STORE=memory.
import type { TemplateId } from "../domain/types";
import type { Deployer, DeployInput, DeployStatusResult, DomainInstructions } from "./types";

export class FakeDeployer implements Deployer {
  readonly provider = "fake" as const;
  projects = new Map<string, { slug: string; templateId: TemplateId; feedUrl: string; deleted: boolean }>();
  deployments = new Map<string, { projectId: string; polls: number }>();
  domains: { projectId: string; domain: string }[] = [];
  private n = 0;

  async createSite(i: DeployInput) {
    const projectId = `fake-prj-${++this.n}`;
    this.projects.set(projectId, { slug: i.slug, templateId: i.templateId, feedUrl: i.feedUrl, deleted: false });
    return { projectId, ...(await this.redeploy(projectId, i)) };
  }
  async status(deploymentId: string): Promise<DeployStatusResult> {
    const d = this.deployments.get(deploymentId);
    if (!d) return { state: "error", url: null, error: "unknown deployment" };
    d.polls++;
    const p = this.projects.get(d.projectId);
    if (!p || p.deleted) return { state: "error", url: null, error: "project deleted" };
    return d.polls >= 2 ? { state: "ready", url: `https://${p.slug}.example.test`, error: null } : { state: "building", url: null, error: null };
  }
  async redeploy(projectId: string, i: DeployInput) {
    const p = this.projects.get(projectId);
    if (!p || p.deleted) throw new Error(`fake deployer: unknown project ${projectId}`);
    p.templateId = i.templateId;
    p.feedUrl = i.feedUrl;
    const deploymentId = `fake-dpl-${++this.n}`;
    this.deployments.set(deploymentId, { projectId, polls: 0 });
    return { deploymentId };
  }
  async deleteSite(projectId: string) {
    const p = this.projects.get(projectId);
    if (p) p.deleted = true;
  }
  async addDomain(projectId: string, domain: string): Promise<DomainInstructions> {
    this.domains.push({ projectId, domain });
    return { verified: false, records: [{ type: "CNAME", name: domain, value: "cname.example.test" }] };
  }
}
```

`src/bot/copy.ts`: add to `BG` after `error: "Възникна грешка. Опитайте отново.",`:

```ts
  publishing: "Сайтът ви се публикува. Ще ви пиша, когато е готов (обикновено до 2–3 минути).",
  siteLive: (name: string, url: string) => `🎉 Сайтът на ${name} е готов: ${url}\n\nОт тук нататък промените от този чат се появяват на него за секунди.`,
  siteFailed: (name: string) => `Публикуването на сайта на ${name} не успя. Ще го погледнем; дотогава сайтът ви остава достъпен на адреса от приветственото съобщение.`,
```

and to `EN` after `error: "Something went wrong. Please try again.",`:

```ts
  publishing: "Your site is being published. I'll message you when it's live (usually within 2–3 minutes).",
  siteLive: (name, url) => `🎉 ${name}'s site is live: ${url}\n\nFrom now on, changes from this chat show up there within seconds.`,
  siteFailed: (name) => `Publishing ${name}'s site failed. We'll look into it; until then your site stays available at the address from the welcome message.`,
```

- [ ] **Step 2: Write the failing Vercel deployer tests**

```ts
// test/deploy-vercel.test.ts
import { describe, expect, it } from "vitest";
import type { InlinedFile } from "@/src/deploy/manifest";
import { VercelDeployer } from "@/src/deploy/vercel";

interface Call { method: string; url: string; body: Record<string, unknown> | null; headers: Record<string, string> }
type Reply = { status?: number; json?: unknown } | undefined;

/** Records every request and answers from `handler`; unknown requests get a 404 with a Vercel-shaped error body. */
function fakeFetch(handler: (c: Call) => Reply) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = { method: init?.method ?? "GET", url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, headers };
    calls.push(call);
    const r = handler(call) ?? { status: 404, json: { error: { code: "not_found", message: "no such route" } } };
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const FILES: InlinedFile[] = [{ file: "package.json", data: "{}", encoding: "utf-8" }, { file: "app/icon.png", data: "AAAA", encoding: "base64" }];
const files = async () => FILES;
const INPUT = { slug: "agala", templateId: "classic" as const, feedUrl: "https://sm.example/api/site/agala" };
const ENV = [
  { key: "SITE_MANAGER_URL", value: "https://sm.example", target: ["production", "preview"], type: "plain" },
  { key: "SITE_MANAGER_SLUG", value: "agala", target: ["production", "preview"], type: "plain" },
];

describe("VercelDeployer", () => {
  it("creates the project and the deployment, then maps building → ready with the real alias", async () => {
    let polls = 0;
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.method === "POST" && c.url === "https://api.vercel.com/v11/projects") return { json: { id: "prj_1", name: c.body?.name } };
      if (c.method === "POST" && c.url === "https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1") return { json: { id: "dpl_1", readyState: "QUEUED", url: "agala-abc123.vercel.app" } };
      if (c.method === "GET" && c.url === "https://api.vercel.com/v13/deployments/dpl_1") {
        polls++;
        return { json: polls === 1 ? { id: "dpl_1", readyState: "BUILDING", url: "agala-abc123.vercel.app" } : { id: "dpl_1", readyState: "READY", url: "agala-abc123.vercel.app", alias: ["agala.vercel.app", "agala-team.vercel.app"], aliasAssigned: true } };
      }
      return undefined;
    });
    const logs: string[] = [];
    const dep = new VercelDeployer({ token: "tok-SECRET", files, fetch: fetchFn, log: (s) => logs.push(s) });
    expect(dep.provider).toBe("vercel");
    expect(await dep.createSite(INPUT)).toEqual({ projectId: "prj_1", deploymentId: "dpl_1" });
    expect(calls[0].headers.authorization).toBe("Bearer tok-SECRET");
    expect(calls[0].body).toEqual({ name: "agala", framework: "nextjs", environmentVariables: ENV, ssoProtection: null });
    expect(calls[1].body).toEqual({ name: "agala", project: "prj_1", target: "production", files: FILES, projectSettings: { framework: "nextjs", nodeVersion: "22.x" } });
    expect(await dep.status("dpl_1")).toEqual({ state: "building", url: null, error: null });
    expect(await dep.status("dpl_1")).toEqual({ state: "ready", url: "https://agala.vercel.app", error: null });
    expect(logs.join("\n")).not.toContain("SECRET");
  });

  it("uses the deployment url when no alias is assigned and maps QUEUED/INITIALIZING to building", async () => {
    const states = ["QUEUED", "INITIALIZING", "READY"];
    const { fetchFn } = fakeFetch((c) => (c.url.startsWith("https://api.vercel.com/v13/deployments/dpl_9") ? { json: { id: "dpl_9", readyState: states.shift(), url: "agala-xyz.vercel.app", alias: [], aliasAssigned: false } } : undefined));
    const dep = new VercelDeployer({ token: "t", files, fetch: fetchFn, log: () => {} });
    expect((await dep.status("dpl_9")).state).toBe("building");
    expect((await dep.status("dpl_9")).state).toBe("building");
    expect(await dep.status("dpl_9")).toEqual({ state: "ready", url: "https://agala-xyz.vercel.app", error: null });
  });

  it("on ERROR reads the last 20 stderr lines from the events endpoint", async () => {
    const events = [
      ...Array.from({ length: 25 }, (_, i) => ({ type: "stderr", created: i, payload: { text: `line ${i + 1}` } })),
      { type: "stdout", created: 99, payload: { text: "not an error" } },
    ];
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.url === "https://api.vercel.com/v13/deployments/dpl_2") return { json: { id: "dpl_2", readyState: "ERROR", errorMessage: "Build failed" } };
      if (c.url === "https://api.vercel.com/v3/deployments/dpl_2/events?limit=-1") return { json: events };
      return undefined;
    });
    const dep = new VercelDeployer({ token: "t", files, fetch: fetchFn, log: () => {} });
    const r = await dep.status("dpl_2");
    expect(r.state).toBe("error");
    expect(r.url).toBeNull();
    expect(r.error).toContain("Build failed");
    expect(r.error).toContain("line 25");
    expect(r.error).toContain("line 6");
    expect(r.error).not.toContain("line 5\n");
    expect(r.error).not.toContain("not an error");
    expect(calls.map((c) => c.url)).toEqual(["https://api.vercel.com/v13/deployments/dpl_2", "https://api.vercel.com/v3/deployments/dpl_2/events?limit=-1"]);
    const { fetchFn: f2 } = fakeFetch((c) => (c.url.includes("/v13/deployments/dpl_3") ? { json: { id: "dpl_3", readyState: "CANCELED" } } : undefined));
    const r2 = await new VercelDeployer({ token: "t", files, fetch: f2, log: () => {} }).status("dpl_3");
    expect(r2).toEqual({ state: "error", url: null, error: "CANCELED" }); // events 404 → no stderr, state name as the message
  });

  it("retries the project name with -site, then -<4 hex> on conflicts and invalid names", async () => {
    const names: string[] = [];
    const { fetchFn } = fakeFetch((c) => {
      if (c.method === "POST" && c.url === "https://api.vercel.com/v11/projects") {
        names.push(String(c.body?.name));
        if (names.length === 1) return { status: 409, json: { error: { code: "conflict", message: "Project already exists" } } };
        if (names.length === 2) return { status: 400, json: { error: { code: "invalid_name", message: "bad" } } };
        return { json: { id: "prj_7" } };
      }
      if (c.method === "POST" && c.url.startsWith("https://api.vercel.com/v13/deployments")) return { json: { id: "dpl_7" } };
      return undefined;
    });
    const dep = new VercelDeployer({ token: "t", files, fetch: fetchFn, log: () => {} });
    expect(await dep.createSite(INPUT)).toEqual({ projectId: "prj_7", deploymentId: "dpl_7" });
    expect(names[0]).toBe("agala");
    expect(names[1]).toBe("agala-site");
    expect(names[2]).toMatch(/^agala-[0-9a-f]{4}$/);
    const { fetchFn: always409 } = fakeFetch(() => ({ status: 409, json: { error: { code: "conflict", message: "taken" } } }));
    await expect(new VercelDeployer({ token: "t", files, fetch: always409, log: () => {} }).createSite(INPUT)).rejects.toThrow(/taken/);
    const { fetchFn: forbidden } = fakeFetch(() => ({ status: 403, json: { error: { code: "forbidden", message: "Not authorized" } } }));
    await expect(new VercelDeployer({ token: "t", files, fetch: forbidden, log: () => {} }).createSite(INPUT)).rejects.toThrow(/Not authorized/); // no retry on other errors
  });

  it("adds teamId to every call, redeploys into an existing project, deletes projects and adds domains", async () => {
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.url.startsWith("https://api.vercel.com/v13/deployments?")) return { json: { id: "dpl_5" } };
      if (c.method === "DELETE") return { status: 204 };
      if (c.method === "POST" && c.url.startsWith("https://api.vercel.com/v10/projects/prj_5/domains")) return { json: { name: "cafe.example.com", apexName: "example.com", verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,abc" }] } };
      if (c.method === "GET" && c.url.startsWith("https://api.vercel.com/v6/domains/cafe.example.com/config")) return { json: { misconfigured: true } };
      return undefined;
    });
    const dep = new VercelDeployer({ token: "t", teamId: "team_1", files, fetch: fetchFn, log: () => {} });
    expect(await dep.redeploy("prj_5", { ...INPUT, templateId: "lumen" })).toEqual({ deploymentId: "dpl_5" });
    expect(calls[0].url).toBe("https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1&teamId=team_1");
    expect(calls[0].body).toMatchObject({ project: "prj_5", target: "production" });
    await dep.deleteSite("prj_5");
    expect(calls[1]).toMatchObject({ method: "DELETE", url: "https://api.vercel.com/v9/projects/prj_5?teamId=team_1" });
    const dns = await dep.addDomain("prj_5", "cafe.example.com");
    expect(calls[2]).toMatchObject({ method: "POST", url: "https://api.vercel.com/v10/projects/prj_5/domains?teamId=team_1", body: { name: "cafe.example.com" } });
    expect(calls[3].url).toBe("https://api.vercel.com/v6/domains/cafe.example.com/config?teamId=team_1");
    expect(dns).toEqual({ verified: false, records: [{ type: "CNAME", name: "cafe", value: "cname.vercel-dns.com" }, { type: "TXT", name: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,abc" }] });
    for (const c of calls) expect(new URL(c.url).searchParams.get("teamId")).toBe("team_1");
  });
});
```

Run `npm test -- test/deploy-vercel.test.ts` → fails: `Cannot find module '@/src/deploy/vercel'`.

- [ ] **Step 3: Implement `src/deploy/vercel.ts`**

```ts
// src/deploy/vercel.ts
// Server-only. Talks to the Vercel REST API with plain fetch (injectable). The token is only ever put in the Authorization header;
// logs carry method, path and status code, never headers or response bodies.
import type { TemplateId } from "../domain/types";
import type { InlinedFile } from "./manifest";
import type { Deployer, DeployInput, DeployStatusResult, DomainInstructions } from "./types";

const API = "https://api.vercel.com";
const ERROR_MAX = 2000;

export interface VercelDeployerOptions {
  token: string;
  teamId?: string | null;
  fetch?: typeof fetch;
  files: (id: TemplateId) => Promise<InlinedFile[]>;
  log?: (s: string) => void;
}

export class VercelError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = "VercelError";
  }
}

interface VercelDeployment {
  id: string;
  readyState?: string;
  url?: string;
  alias?: string[];
  aliasAssigned?: boolean | number | null;
  errorMessage?: string | null;
}
interface VercelEvent {
  type?: string;
  text?: string;
  payload?: { text?: string };
}

const retryableName = (e: unknown) => e instanceof VercelError && (e.status === 409 || e.code === "invalid_name" || /conflict|already_exists/.test(e.code ?? ""));
const hex4 = () => crypto.randomUUID().replaceAll("-", "").slice(0, 4);

export class VercelDeployer implements Deployer {
  readonly provider = "vercel" as const;
  private readonly token: string;
  private readonly teamId: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly files: (id: TemplateId) => Promise<InlinedFile[]>;
  private readonly log: (s: string) => void;

  constructor(opts: VercelDeployerOptions) {
    this.token = opts.token;
    this.teamId = opts.teamId ?? null;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.files = opts.files;
    this.log = opts.log ?? ((s) => console.log(s));
  }

  private url(path: string, query: Record<string, string> = {}): string {
    const u = new URL(API + path);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    if (this.teamId) u.searchParams.set("teamId", this.teamId);
    return u.toString();
  }

  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const res = await this.fetchFn(this.url(path, query), {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      const code = err?.code ?? null;
      this.log(`[vercel] ${method} ${path} → ${res.status}${code ? ` ${code}` : ""}`);
      throw new VercelError((err?.message ?? `HTTP ${res.status}`).slice(0, 200), res.status, code);
    }
    return json as T;
  }

  async createSite(i: DeployInput) {
    const projectId = await this.createProject(i);
    const { deploymentId } = await this.deploy(projectId, i);
    return { projectId, deploymentId };
  }

  /** POST /v11/projects; on a name conflict or an invalid name, `<slug>-site`, then `<slug>-<4 hex>`. */
  private async createProject(i: DeployInput): Promise<string> {
    const siteManagerUrl = i.feedUrl.replace(/\/api\/site\/.*$/, "");
    const environmentVariables = [
      { key: "SITE_MANAGER_URL", value: siteManagerUrl, target: ["production", "preview"], type: "plain" },
      { key: "SITE_MANAGER_SLUG", value: i.slug, target: ["production", "preview"], type: "plain" },
    ];
    let last: unknown = null;
    for (const name of [i.slug, `${i.slug}-site`, `${i.slug}-${hex4()}`]) {
      try {
        const p = await this.call<{ id: string }>("POST", "/v11/projects", { name, framework: "nextjs", environmentVariables, ssoProtection: null });
        this.log(`[vercel] project ${name} created`);
        return p.id;
      } catch (e) {
        if (!retryableName(e)) throw e;
        last = e;
      }
    }
    throw last;
  }

  /** POST /v13/deployments with the template's files inlined. */
  private async deploy(projectId: string, i: DeployInput): Promise<{ deploymentId: string }> {
    const files = await this.files(i.templateId);
    const d = await this.call<{ id: string }>("POST", "/v13/deployments", { name: i.slug, project: projectId, target: "production", files, projectSettings: { framework: "nextjs", nodeVersion: "22.x" } }, { skipAutoDetectionConfirmation: "1" });
    this.log(`[vercel] deployment ${d.id} for ${i.slug} (${files.length} files)`);
    return { deploymentId: d.id };
  }

  async status(deploymentId: string): Promise<DeployStatusResult> {
    const d = await this.call<VercelDeployment>("GET", `/v13/deployments/${encodeURIComponent(deploymentId)}`);
    switch (d.readyState) {
      case "READY": {
        const alias = d.aliasAssigned && d.alias?.length ? d.alias[0] : null;
        const host = alias ?? d.url ?? null;
        return { state: "ready", url: host ? `https://${host}` : null, error: null };
      }
      case "ERROR":
      case "CANCELED":
      case "BLOCKED": {
        const stderr = await this.stderrTail(deploymentId);
        const error = [d.errorMessage?.trim(), stderr].filter(Boolean).join("\n").slice(0, ERROR_MAX) || d.readyState;
        return { state: "error", url: null, error };
      }
      default:
        // QUEUED, INITIALIZING, BUILDING (and anything new): keep polling.
        return { state: "building", url: null, error: null };
    }
  }

  /** GET /v3/deployments/{id}/events?limit=-1 → the last 20 stderr texts; "" when the endpoint fails. */
  private async stderrTail(deploymentId: string): Promise<string> {
    try {
      const events = await this.call<VercelEvent[] | null>("GET", `/v3/deployments/${encodeURIComponent(deploymentId)}/events`, undefined, { limit: "-1" });
      const lines = (Array.isArray(events) ? events : [])
        .filter((e) => e?.type === "stderr")
        .map((e) => String(e.payload?.text ?? e.text ?? "").trimEnd())
        .filter(Boolean);
      return lines.slice(-20).join("\n");
    } catch {
      return "";
    }
  }

  async redeploy(projectId: string, i: DeployInput) {
    return this.deploy(projectId, i);
  }

  async deleteSite(projectId: string) {
    await this.call<unknown>("DELETE", `/v9/projects/${encodeURIComponent(projectId)}`);
    this.log(`[vercel] project ${projectId} deleted`);
  }

  /** POST /v10/projects/{id}/domains then GET /v6/domains/{domain}/config → DNS records the owner must set. */
  async addDomain(projectId: string, domain: string): Promise<DomainInstructions> {
    const added = await this.call<{ name: string; apexName: string; verified: boolean; verification?: { type: string; domain: string; value: string }[] }>("POST", `/v10/projects/${encodeURIComponent(projectId)}/domains`, { name: domain });
    const cfg = await this.call<{ misconfigured?: boolean }>("GET", `/v6/domains/${encodeURIComponent(domain)}/config`);
    const records: DomainInstructions["records"] = [];
    if (added.apexName === added.name) records.push({ type: "A", name: "@", value: "76.76.21.21" });
    else records.push({ type: "CNAME", name: added.name.slice(0, added.name.length - added.apexName.length - 1), value: "cname.vercel-dns.com" });
    for (const v of added.verification ?? []) if (v.type === "TXT") records.push({ type: "TXT", name: v.domain, value: v.value });
    return { verified: Boolean(added.verified) && !cfg.misconfigured, records };
  }
}
```

Run `npm test -- test/deploy-vercel.test.ts` → 5 passed.

- [ ] **Step 4: Write the failing deploy-run tests (memory store only)**

```ts
// test/deploy-run.test.ts
import { describe, expect, it } from "vitest";
import { FakeDeployer } from "@/src/deploy/fake";
import { DEPLOY_TIMEOUT_MS, pollDeployments, startDeploy } from "@/src/deploy/run";
import type { Deployer, DeployStatusResult } from "@/src/deploy/types";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");
const feedUrlFor = (slug: string) => `https://sm.example/api/site/${slug}`;

describe("startDeploy", () => {
  it("creates the site and moves pending → building; no-op for drafts, existing deployments and unknown ids", async () => {
    const { store, venue } = await makeDemo();
    const deployer = new FakeDeployer();
    const logs: string[] = [];
    const d = { store, deployer, feedUrlFor, now: () => T0, log: (s: string) => logs.push(s) };
    await startDeploy(d, venue.id);
    const v = await store.getVenue(venue.id);
    expect(v.deploy).toMatchObject({ provider: "fake", status: "building", template: "classic", url: null, error: null, updated_at: T0.toISOString() });
    expect(v.deploy?.project_id).toMatch(/^fake-prj-/);
    expect(v.deploy?.deployment_id).toMatch(/^fake-dpl-/);
    expect(deployer.projects.get(v.deploy?.project_id ?? "")).toMatchObject({ slug: "agala", templateId: "classic", feedUrl: "https://sm.example/api/site/agala" });
    await startDeploy(d, venue.id);
    expect(deployer.projects.size).toBe(1); // already building: nothing new
    const draft = await store.createVenue({ slug: "mydraft", name: "Draft", status: "draft" });
    await startDeploy(d, draft.id);
    expect((await store.getVenue(draft.id)).deploy).toBeNull();
    await expect(startDeploy(d, "00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined(); // never throws
    expect(logs.some((l) => l.includes("not found"))).toBe(true);
  });

  it("stores a provider failure as a short, secret-free error and retries on the same project next time", async () => {
    const { store, venue } = await makeDemo();
    let fail = true;
    const inner = new FakeDeployer();
    const deployer: Deployer = {
      provider: "fake",
      createSite: (i) => inner.createSite(i),
      status: (id) => inner.status(id),
      redeploy: async (p, i) => {
        if (fail) throw new Error("HTTP 500 from Authorization: Bearer tok-SECRET while deploying");
        return inner.redeploy(p, i);
      },
      deleteSite: (p) => inner.deleteSite(p),
    };
    // first attempt: project created, deployment created (createSite does not go through redeploy)
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    const first = (await store.getVenue(venue.id)).deploy;
    expect(first?.status).toBe("building");
    // simulate a failed build, then a retry: the project id is kept and redeploy is used
    await store.setDeploy(venue.id, { ...first!, status: "error", error: "Build failed" });
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    const errored = (await store.getVenue(venue.id)).deploy;
    expect(errored).toMatchObject({ status: "error", project_id: first?.project_id });
    expect(errored?.error).toBe("HTTP 500 from Authorization: Bearer … while deploying");
    fail = false;
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "building", project_id: first?.project_id });
    expect(inner.projects.size).toBe(1);
  });
});

describe("pollDeployments", () => {
  it("marks the site ready after the fake's second poll and tells every owner in their language", async () => {
    const { store, venue } = await makeDemo(); // owner 1001 (bg), staff 1002 (en)
    await store.upsertMember({ venue_id: venue.id, tg_chat_id: 1003, role: "owner", lang: "en" });
    const deployer = new FakeDeployer();
    const m = new FakeMessenger();
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    const d = { store, deployer, messenger: m, now: () => T0 };
    expect(await pollDeployments(d)).toEqual({ ready: [], failed: [] });
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("building");
    expect(m.sent).toEqual([]);
    expect(await pollDeployments(d)).toEqual({ ready: [venue.id], failed: [] });
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "ready", url: "https://agala.example.test", error: null });
    expect(m.sent.map((s) => [s.chatId, s.text])).toEqual([
      [1001, "🎉 Сайтът на Кафене „Ъгъла“ е готов: https://agala.example.test\n\nОт тук нататък промените от този чат се появяват на него за секунди."],
      [1003, "🎉 Кафене „Ъгъла“'s site is live: https://agala.example.test\n\nFrom now on, changes from this chat show up there within seconds."],
    ]);
    expect(await pollDeployments(d)).toEqual({ ready: [], failed: [] }); // ready venues are not polled again
    expect(m.sent).toHaveLength(2);
  });

  it("stores the provider's error, notifies the owner, and never notifies without a messenger", async () => {
    const { store, venue } = await makeDemo();
    const failing: Deployer = {
      provider: "fake",
      createSite: async () => ({ projectId: "p", deploymentId: "d" }),
      status: async (): Promise<DeployStatusResult> => ({ state: "error", url: null, error: "Build failed\nModule not found: zod" }),
      redeploy: async () => ({ deploymentId: "d2" }),
      deleteSite: async () => {},
    };
    const m = new FakeMessenger();
    await startDeploy({ store, deployer: failing, feedUrlFor, now: () => T0 }, venue.id);
    expect(await pollDeployments({ store, deployer: failing, messenger: m, now: () => T0 })).toEqual({ ready: [], failed: [venue.id] });
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "error", error: "Build failed\nModule not found: zod", url: null });
    expect(m.sent).toEqual([expect.objectContaining({ chatId: 1001, text: "Публикуването на сайта на Кафене „Ъгъла“ не успя. Ще го погледнем; дотогава сайтът ви остава достъпен на адреса от приветственото съобщение." })]);
    const other = await store.createVenue({ slug: "other", name: "Other" });
    await startDeploy({ store, deployer: failing, feedUrlFor, now: () => T0 }, other.id);
    expect(await pollDeployments({ store, deployer: failing, messenger: null, now: () => T0 })).toEqual({ ready: [], failed: [other.id] });
    expect(m.sent).toHaveLength(1);
  });

  it("times out a deployment that is still building after 20 minutes, and keeps polling a transient failure", async () => {
    const { store, venue } = await makeDemo();
    let polls = 0;
    const slow: Deployer = {
      provider: "fake",
      createSite: async () => ({ projectId: "p", deploymentId: "d" }),
      status: async () => {
        polls++;
        if (polls === 1) throw new Error("network");
        return { state: "building", url: null, error: null };
      },
      redeploy: async () => ({ deploymentId: "d2" }),
      deleteSite: async () => {},
    };
    const m = new FakeMessenger();
    await startDeploy({ store, deployer: slow, feedUrlFor, now: () => T0 }, venue.id);
    expect(await pollDeployments({ store, deployer: slow, messenger: m, now: () => T0 })).toEqual({ ready: [], failed: [] }); // threw: skipped, still building
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("building");
    const later = new Date(T0.getTime() + DEPLOY_TIMEOUT_MS + 1);
    expect(await pollDeployments({ store, deployer: slow, messenger: m, now: () => later })).toEqual({ ready: [], failed: [venue.id] });
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "error", error: "timeout: no result after 20 minutes" });
    expect(m.sent.at(-1)?.text).toMatch(/не успя/);
  });

  it("limits itself to one venue when asked", async () => {
    const { store, venue } = await makeDemo();
    const other = await store.createVenue({ slug: "other", name: "Other" });
    const deployer = new FakeDeployer();
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, other.id);
    const d = { store, deployer, messenger: null, now: () => T0, venueId: other.id };
    await pollDeployments(d);
    expect(await pollDeployments(d)).toEqual({ ready: [other.id], failed: [] });
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("building");
  });
});
```

Run `npm test -- test/deploy-run.test.ts` → fails: `Cannot find module '@/src/deploy/run'`.

- [ ] **Step 5: Implement `src/deploy/run.ts`**

```ts
// src/deploy/run.ts
// Deploy lifecycle over the Store: startDeploy (pending → building | error) and pollDeployments (building → ready | error, owner notifications).
import { copy } from "../bot/copy";
import type { Messenger } from "../bot/messenger";
import type { DeployInfo, Lang, Venue } from "../domain/types";
import type { Store } from "../store/types";
import type { Deployer, DeployInput, DeployStatusResult } from "./types";

export const DEPLOY_TIMEOUT_MS = 20 * 60_000;
/** Deployments checked per tick. */
export const POLL_MAX = 10;

/** Short, secret-free message for deploy.error and logs. */
function short(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/Bearer\s+\S+/gi, "Bearer …").slice(0, 300);
}

export interface StartDeployDeps {
  store: Store;
  deployer: Deployer;
  feedUrlFor: (slug: string) => string;
  now: () => Date;
  log?: (s: string) => void;
}

/**
 * Creates the venue's site (or redeploys into its existing project after an error). Sets deploy to pending, then building or error.
 * No-op when the venue is not live or already has a deployment that is not in error. Never throws.
 */
export async function startDeploy(d: StartDeployDeps, venueId: string): Promise<void> {
  const log = d.log ?? ((s: string) => console.log(s));
  try {
    const venue = await d.store.getVenue(venueId);
    if (venue.status !== "live") {
      log(`[deploy] ${venue.slug}: not live, skipped`);
      return;
    }
    if (venue.deploy && venue.deploy.status !== "error") {
      log(`[deploy] ${venue.slug}: already ${venue.deploy.status}, skipped`);
      return;
    }
    const projectId = venue.deploy?.project_id || "";
    const base: DeployInfo = {
      provider: d.deployer.provider,
      project_id: projectId,
      deployment_id: "",
      url: venue.deploy?.url ?? null,
      status: "pending",
      error: null,
      template: venue.template,
      updated_at: d.now().toISOString(),
    };
    await d.store.setDeploy(venueId, base);
    const input: DeployInput = { slug: venue.slug, templateId: venue.template, feedUrl: d.feedUrlFor(venue.slug) };
    try {
      const r = projectId ? { projectId, ...(await d.deployer.redeploy(projectId, input)) } : await d.deployer.createSite(input);
      await d.store.setDeploy(venueId, { ...base, project_id: r.projectId, deployment_id: r.deploymentId, status: "building", updated_at: d.now().toISOString() });
      log(`[deploy] ${venue.slug}: building (${d.deployer.provider} ${r.deploymentId})`);
    } catch (e) {
      await d.store.setDeploy(venueId, { ...base, status: "error", error: short(e), updated_at: d.now().toISOString() });
      log(`[deploy] ${venue.slug}: failed: ${short(e)}`);
    }
  } catch (e) {
    log(`[deploy] ${venueId}: ${short(e)}`);
  }
}

export interface PollDeps {
  store: Store;
  deployer: Deployer;
  messenger: Messenger | null;
  now: () => Date;
  venueId?: string;
}

/** Checks venues with deploy.status pending|building (max POLL_MAX), 20-minute timeout → error; notifies owners on ready/error. */
export async function pollDeployments(d: PollDeps): Promise<{ ready: string[]; failed: string[] }> {
  const report = { ready: [] as string[], failed: [] as string[] };
  const venues = (await d.store.listVenues({ deploying: true })).filter((v) => !d.venueId || v.id === d.venueId).slice(0, POLL_MAX);
  for (const v of venues) {
    const dep = v.deploy;
    if (!dep) continue;
    const now = d.now();
    let result: DeployStatusResult;
    if (now.getTime() - Date.parse(dep.updated_at) > DEPLOY_TIMEOUT_MS) {
      result = { state: "error", url: null, error: "timeout: no result after 20 minutes" };
    } else if (!dep.deployment_id) {
      continue; // createSite still running in another request; the timeout above catches a lost one
    } else {
      try {
        result = await d.deployer.status(dep.deployment_id);
      } catch (e) {
        console.error(`[deploy] status ${v.slug} failed:`, short(e));
        continue; // transient: next tick retries
      }
    }
    if (result.state === "ready") {
      await d.store.setDeploy(v.id, { ...dep, status: "ready", url: result.url ?? dep.url, error: null, updated_at: now.toISOString() });
      report.ready.push(v.id);
      await notify(d, v, (lang) => copy(lang).siteLive(v.name, result.url ?? dep.url ?? ""));
    } else if (result.state === "error") {
      await d.store.setDeploy(v.id, { ...dep, status: "error", error: (result.error ?? "error").slice(0, 2000), updated_at: now.toISOString() });
      report.failed.push(v.id);
      await notify(d, v, (lang) => copy(lang).siteFailed(v.name));
    } else if (result.state !== dep.status) {
      await d.store.setDeploy(v.id, { ...dep, status: result.state, updated_at: now.toISOString() });
    }
  }
  return report;
}

async function notify(d: PollDeps, venue: Venue, text: (lang: Lang) => string): Promise<void> {
  if (!d.messenger) return;
  for (const m of await d.store.listMembers(venue.id)) if (m.role === "owner") await d.messenger.send(m.tg_chat_id, text(m.lang));
}
```

Run `npm test -- test/deploy-run.test.ts` → 6 passed.

- [ ] **Step 6: Tick: poll deployments and clean up abandoned drafts**

Extend `test/tick.test.ts`. Add imports:

```ts
import { FakeDeployer } from "@/src/deploy/fake";
import { startDeploy } from "@/src/deploy/run";
```

and a case inside the `describe`:

```ts
  it("deletes drafts older than 48 h, keeps fresh drafts and old live venues, and polls deployments when a deployer is given", async () => {
    const { store, venue } = await makeDemo();
    store.clock = () => "2026-10-06T09:00:00.000Z";
    const old = await store.createVenue({ slug: "old-draft", name: "Old", status: "draft" });
    store.clock = () => "2026-10-01T09:00:00.000Z";
    await store.createVenue({ slug: "old-live", name: "Live" });
    store.clock = () => "2026-10-09T08:00:00.000Z";
    await store.createVenue({ slug: "fresh-draft", name: "Fresh", status: "draft" });
    const deployer = new FakeDeployer();
    const m = new FakeMessenger();
    await startDeploy({ store, deployer, feedUrlFor: (s) => `https://sm.example/api/site/${s}`, now: () => T0 }, venue.id);
    const r1 = await runTick({ store, messenger: m, now: T0, deployer });
    expect(r1.cleaned).toEqual([old.id]);
    expect(r1.deployed).toEqual([]);
    expect(r1.deployFailed).toEqual([]);
    expect(await store.getVenueBySlug("old-draft")).toBeNull();
    expect(await store.getVenueBySlug("old-live")).not.toBeNull();
    expect(await store.getVenueBySlug("fresh-draft")).not.toBeNull();
    const r2 = await runTick({ store, messenger: m, now: T0, deployer });
    expect(r2.deployed).toEqual([venue.id]);
    expect(r2.cleaned).toEqual([]);
    expect(m.sent.at(-1)).toMatchObject({ chatId: 1001, text: expect.stringContaining("https://agala.example.test") });
    const r3 = await runTick({ store, messenger: null, now: T0 }); // no deployer: nothing polled, report fields still present
    expect(r3).toMatchObject({ deployed: [], deployFailed: [], cleaned: [] });
  });
```

Run `npm test -- test/tick.test.ts` → the new case fails (`r1.cleaned` undefined).

`src/tick.ts` changes. Imports:

```ts
import type { Messenger } from "./bot/messenger";
import { pollDeployments } from "./deploy/run";
import type { Deployer } from "./deploy/types";
import { planChange } from "./domain/changes";
import { itemName, tr } from "./domain/format";
import type { Lang } from "./domain/types";
import type { ExpiredTimer, Store } from "./store/types";
import { formatDateTime } from "./time";
```

Types and constants:

```ts
export interface TickDeps {
  store: Store;
  messenger: Messenger | null;
  now: Date;
  /** Restrict to one venue (the per-webhook tick). */
  venueId?: string;
  /** When set, in-flight deployments are polled (pollDeployments). */
  deployer?: Deployer | null;
}
export interface TickReport {
  applied: string[];
  auto: string[];
  reminded: string[];
  expired: string[];
  /** Venue ids whose site became ready / failed this tick. */
  deployed: string[];
  deployFailed: string[];
  /** Draft venue ids deleted this tick. */
  cleaned: string[];
}

const HOUR = 3_600_000;
const PROPOSAL_TTL_MS = 2 * HOUR;
const REMIND_WINDOW_MS = 24 * HOUR;
/** Wizard drafts nobody published are deleted after this. */
export const DRAFT_TTL_MS = 48 * HOUR;
```

In `runTick`: the report literal becomes `{ applied: [], auto: [], reminded: [], expired: [], deployed: [], deployFailed: [], cleaned: [] }`, and before `return report;` add:

```ts
  // 5. Deployments in flight (only when the caller has a deployer; tests of the content tick pass none).
  if (d.deployer) {
    try {
      const r = await pollDeployments({ store: d.store, deployer: d.deployer, messenger: d.messenger, now: () => d.now, venueId: d.venueId });
      report.deployed = r.ready;
      report.deployFailed = r.failed;
    } catch (e) {
      console.error("[tick] pollDeployments failed:", e instanceof Error ? e.message : e);
    }
  }

  // 6. Abandoned wizard drafts.
  report.cleaned = await cleanupDrafts({ store: d.store, now: d.now, venueId: d.venueId });
```

and append to the file:

```ts
/** Deletes draft venues created more than DRAFT_TTL_MS ago (cookie-only drafts nobody published). Returns the deleted ids. */
export async function cleanupDrafts(d: { store: Store; now: Date; venueId?: string }): Promise<string[]> {
  const cutoff = d.now.getTime() - DRAFT_TTL_MS;
  const out: string[] = [];
  for (const v of await d.store.listVenues({ status: "draft" })) {
    if (d.venueId && v.id !== d.venueId) continue;
    if (Date.parse(v.created_at) >= cutoff) continue;
    try {
      await d.store.deleteVenue(v.id);
      out.push(v.id);
    } catch (e) {
      console.error(`[tick] delete draft ${v.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
```

`src/server/tick.ts`: the `deps` parameter type becomes `{ config: { tickSecret: string }; store: Store; messenger: Messenger; deployer?: Deployer | null }` (add `import type { Deployer } from "../deploy/types";`) and the call becomes `runTick({ store: deps.store, messenger: deps.messenger, now, venueId, deployer: deps.deployer ?? null })`.

Run `npm test -- test/tick.test.ts test/server-tick.test.ts` → all pass (6 + 1).

- [ ] **Step 7: Bot hook after an owner redeem**

Add to `test/bot.test.ts` inside `describe("bot")`:

```ts
  it("calls onOwnerJoined after an owner redeem (not staff) and announces publishing when the venue has no site yet", async () => {
    const { bot, api, store, venue, deps } = await setup();
    const joined: string[] = [];
    deps.onOwnerJoined = (id) => joined.push(id);
    const staffCode = await store.createInvite(venue.id, "staff", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(3001, `/start ${staffCode}`, "en"));
    expect(joined).toEqual([]);
    const ownerCode = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(3002, `/start ${ownerCode}`, "bg"));
    expect(joined).toEqual([venue.id]);
    expect(api.texts().at(-2)).toMatch(/^Свързахте се като собственик/);
    expect(api.texts().at(-1)).toBe("Сайтът ви се публикува. Ще ви пиша, когато е готов (обикновено до 2–3 минути).");
    await store.setDeploy(venue.id, { provider: "fake", project_id: "p", deployment_id: "d", url: "https://agala.example.test", status: "ready", error: null, template: "classic", updated_at: "2026-10-09T09:00:00.000Z" });
    const code2 = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(3003, `/start ${code2}`, "en"));
    expect(joined).toEqual([venue.id, venue.id]);
    expect(api.texts().at(-1)).toMatch(/^You are linked as the owner/); // site exists: no publishing line
  });
```

Run `npm test -- test/bot.test.ts` → the new case fails (`joined` stays empty; TypeScript complains about `onOwnerJoined`).

`src/bot/bot.ts`: add to `BotDeps` after `botInfo?: UserFromGetMe;`:

```ts
  /** Called after a successful owner redeem; deps wire it to startDeploy (which is a no-op when a site already exists). Must not throw. */
  onOwnerJoined?: (venueId: string) => void;
```

and replace in the `/start` handler

```ts
    const venue = await d.store.getVenue(member.venue_id);
    const c = copy(member.lang);
    if (member.role === "owner") await ctx.reply(c.welcome(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)), publicUrl(d.baseUrl, venue.slug)));
    else await ctx.reply(c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
```
with
```ts
    const venue = await d.store.getVenue(member.venue_id);
    const c = copy(member.lang);
    if (member.role === "owner") {
      await ctx.reply(c.welcome(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)), publicUrl(d.baseUrl, venue.slug)));
      if (d.onOwnerJoined) {
        // The first owner join is the human check that publishes the site; startDeploy ignores venues that already have one.
        if (venue.status === "live" && venue.deploy === null) await ctx.reply(c.publishing);
        try {
          d.onOwnerJoined(venue.id);
        } catch (e) {
          console.error("[bot] onOwnerJoined failed:", e instanceof Error ? e.message : e);
        }
      }
    } else await ctx.reply(c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
```

Run `npm test -- test/bot.test.ts` → all pass.

- [ ] **Step 8: Server wiring**

Add to `test/server-deps.test.ts` inside the `describe`:

```ts
  it("uses the fake deployer in memory mode (even with a Vercel token) and deploys a live venue on demand", async () => {
    const jobs: Promise<void>[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void jobs.push(fn()), env: { SITE_MANAGER_STORE: "memory", VERCEL_TOKEN: "never-used" }, log: () => {} });
    expect(deps.deployer.provider).toBe("fake");
    const venue = await deps.store.getVenueBySlug("agala");
    deps.startDeploy(venue!.id);
    await Promise.all(jobs);
    expect((await deps.store.getVenue(venue!.id)).deploy).toMatchObject({ provider: "fake", status: "building", template: "classic" });
    expect((await deps.store.getVenue(venue!.id)).deploy?.project_id).toMatch(/^fake-prj-/);
  });
```

Run `npm test -- test/server-deps.test.ts` → fails (`deps.deployer` undefined).

`src/server/deps.ts`:

1. Imports, add:

```ts
import { FakeDeployer } from "../deploy/fake";
import { buildFiles } from "../deploy/manifest";
import { startDeploy as runStartDeploy } from "../deploy/run";
import type { Deployer } from "../deploy/types";
import { VercelDeployer } from "../deploy/vercel";
```

2. `ServerDeps` gains, after `isMemory: boolean;`:

```ts
  /** VercelDeployer when VERCEL_TOKEN is set and the store is Supabase; FakeDeployer otherwise. */
  deployer: Deployer;
  /** Deferred: creates the venue's site (no-op when it is not live or already has one). */
  startDeploy: (venueId: string) => void;
```

`DepsOptions` gains, after `log?: (line: string) => void;`:

```ts
  deployer?: Deployer;
```

3. After the `transcribe` constant add:

```ts
  const deployer: Deployer = o.deployer ?? (config.vercelToken && !isMemory ? new VercelDeployer({ token: config.vercelToken, teamId: config.vercelTeamId, files: (id) => buildFiles(id), log }) : new FakeDeployer());
  if (deployer.provider === "fake") log(`[deploy] fake deployer (${isMemory ? "memory store" : "VERCEL_TOKEN not set"}): sites get https://<slug>.example.test`);
  const feedUrlFor = (slug: string) => `${config.publicBaseUrl}/api/site/${encodeURIComponent(slug)}`;
  const startDeploy = (venueId: string) => o.defer(() => runStartDeploy({ store: s, deployer, feedUrlFor, now: () => new Date(), log }, venueId));
```

4. In the `botDeps` literal add after `download: …,`:

```ts
    onOwnerJoined: startDeploy,
```

5. In `handleRun` change the tick call to `runTick({ store: s, messenger, now: new Date(), venueId: r.venueId, deployer })`.

6. Return `{ config, store: s, messenger, bot, handleRun, isMemory, deployer, startDeploy }`.

`app/api/tick/route.ts` needs no change: it passes the whole `deps` object, which now carries `deployer`, and `handleTickRequest` forwards it.

Run `npm test` → green; `npm run typecheck` → clean; `npm run lint` → clean. Offline check: `npm run e2e` still passes (it builds its own `runTick` calls without a deployer); `SITE_MANAGER_STORE=memory DEMO_OWNER_CHAT_ID=1 npm run bot:dev` is not needed here, but `npm run dev:offline` must start and `curl -H "x-tick-secret: x" localhost:3000/api/tick` must answer `{"ok":true,…,"deployed":[],"deployFailed":[],"cleaned":[]}` (with the lenient config the secret is empty, so use the admin `?key=` link printed at startup instead).

- [ ] **Step 9: Commit**

```bash
git add src/deploy/types.ts src/deploy/vercel.ts src/deploy/fake.ts src/deploy/run.ts src/bot/copy.ts src/bot/bot.ts src/tick.ts src/server/tick.ts src/server/deps.ts test/deploy-vercel.test.ts test/deploy-run.test.ts test/tick.test.ts test/bot.test.ts test/server-deps.test.ts
git commit -m "Deploy: Vercel and fake deployers, deploy run, tick polling, draft cleanup, deploy on owner join

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: fable

---


### Task 7: Wizard draft API (schema, preview state, server functions, cookie, routes, rate limits)

> **Rulings that apply to this task:** R3, R4, R10, R14, R16, R19, R20 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Create: `src/wizard/schema.ts`, `src/wizard/preview.ts`, `src/server/wizard.ts`, `src/server/draft-cookie.ts`, `app/api/new/route.ts`, `app/api/new/[id]/route.ts`, `app/api/new/[id]/media/route.ts`, `app/api/new/[id]/publish/route.ts`, `app/api/new/[id]/status/route.ts`
- Test: `test/wizard-schema.test.ts`, `test/wizard-preview.test.ts`, `test/wizard-server.test.ts`, `test/wizard-ratelimit.test.ts`, `test/wizard-routes.test.ts`

**Interfaces:**
- Consumes (Task 1): `Venue` with `template: TemplateId; business_type: BusinessType; status: VenueStatus; deploy: DeployInfo | null; wizard_draft: WizardDraft | null`; `NewVenue` with optional `template`, `business_type`, `status`, `wizard_draft`; `Store.updateVenue(id, patch: VenuePatch): Promise<Venue>`, `Store.setDraftToken(id, tokenHash | null)`, `Store.findVenueByDraftToken(tokenHash): Promise<Venue | null>`, `Store.bumpRateLimit(key, windowMs, max, now: string): Promise<boolean>`, `Store.setDeploy(id, deploy)`; `src/server/hash.ts`: `sha256Hex(s: string): string`, `newDraftToken(): string`; `src/config.ts`: `Config.rateSalt: string`, `Config.maxSitesPerDay: number`, `Config.telegramBotUsername: string | null`; `TEMPLATE_IDS`, `BUSINESS_TYPES`, `TemplateId`, `BusinessType`, `VenueStatus`, `DeployInfo` from `src/domain/types`.
- Consumes (Task 6): `ServerDeps.deployer: Deployer`, `pollDeployments(d: { store; deployer; messenger: Messenger | null; now: () => Date; venueId?: string })` from `src/deploy/run.ts`, `Deployer` from `src/deploy/types.ts`.
- Consumes (existing): `seedMenuFrom(store, venueId, cats, items, texts)` and `SeedCategory`, `SeedItem`, `SeedTexts` from `src/seed/demo.ts`; `planChanges`, `PlanContext` from `src/domain/changes.ts`; `renderPreview(site, changes, lang, tz)` from `src/domain/preview.ts`; `INVITE_TTL_MS`, `adminUrl`, `publicUrl` from `src/bot/bot.ts`; `imageMediaType`, `MAX_IMAGE_BYTES` from `src/bot/media.ts`; `isValidHours` from `src/domain/hours.ts`; `PRICE_MIN`, `PRICE_MAX`, `round2` from `src/domain/pricing.ts`; `isAllergenCode` from `src/domain/allergens.ts`; `DEFAULT_HOURS` from `src/store/types.ts`.
- Produces: everything in the spec's "Wizard draft" contract (`SLUG_RE`, `RESERVED_SLUGS`, `WizardDraft`, `WizardCategory`, `WizardItem`, `WizardStep`, `WIZARD_STEPS`, `WizardDraftSchema`, `WizardPatchSchema`, `emptyDraft`, `validateForPublish`) plus `DRAFT_SLUG_PREFIX = "draft-"`, `TEMPLATE_ACCENT_DEFAULTS: Record<TemplateId, string>`, `PublishError`, `stepForPath(path: string): WizardStep`, `bothLangs(bg, en): { bg; en }`; `buildPreviewState(d, media, now)`; `createDraft`, `updateDraft`, `publishDraft`, `rateLimitKeys`, `requireDraft`, `WizardError`, `wizardErrorResponse`, `WizardDeps`, `handleNewDraft`, `handleGetDraft`, `handlePutDraft`, `handleMedia`, `handlePublish`, `handleStatus` (`src/server/wizard.ts`); `COOKIE_NAME`, `DRAFT_COOKIE_MAX_AGE`, `draftCookieValue`, `parseDraftCookie`, `serializeDraftCookie`, `cookieFromHeader`, `readDraftFromCookies`, `readDraftFromRequest` (`src/server/draft-cookie.ts`). Task 8 reuses `requireDraft` and `wizardErrorResponse`; Task 9 reuses the schema, `stepForPath`, `buildPreviewState`, `readDraftFromCookies`; Task 10 reuses `handleStatus`'s response shape.

Decisions this task fixes (the spec leaves them open): the draft's `slug` may be `""` until the owner chooses one (`WizardDraftSchema` accepts `""` or a valid slug; `validateForPublish` requires a real one and rejects anything starting with `draft-`); the venue row keeps its `draft-<8hex>` placeholder slug until publish, so slug uniqueness is checked against other venues on every PUT and again on publish; `WizardDraftSchema` is exported as the inferred `ZodObject` (so `.partial()` works) and checked with `satisfies z.ZodType<WizardDraft>`; `TEMPLATE_ACCENT_DEFAULTS` lives in `src/wizard/schema.ts` because `src/templates/index.ts` loads `next/font/google`, which cannot be imported in vitest (its exports are `undefined` outside the Next loader) — the implementer copies the three values from `def.accentDefault` in `src/templates/{classic,nocturne,lumen}/index.ts` (classic is `#2f6b4f`); `status` returns `site_url` = the deployed URL when `deploy.status === "ready"`, otherwise our own `${publicBaseUrl}/${slug}` once the venue is live, otherwise `null`; the media route answers 400 `too_large` (not 413) so the client handles one error shape; route handlers are thin and the logic lives in `src/server/wizard.ts` `handle*` functions that take a `WizardDeps` object, so the whole HTTP flow is tested on the memory store with plain `Request` objects.

- [ ] **Step 1: Write the failing schema tests**

```ts
// test/wizard-schema.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS } from "@/src/store/types";
import {
  bothLangs, DRAFT_SLUG_PREFIX, emptyDraft, RESERVED_SLUGS, SLUG_RE, stepForPath, TEMPLATE_ACCENT_DEFAULTS, validateForPublish, WIZARD_STEPS, WizardDraftSchema, WizardPatchSchema,
} from "@/src/wizard/schema";

function full() {
  const d = emptyDraft("classic");
  d.name = "Кафене „Ъгъла“";
  d.slug = "agala";
  d.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }];
  return d;
}

describe("slug rules", () => {
  it("accepts 2–39 lowercase letters, digits and dashes starting with a letter or digit", () => {
    expect(SLUG_RE.test("agala")).toBe(true);
    expect(SLUG_RE.test("a1")).toBe(true);
    expect(SLUG_RE.test("my-cafe-2")).toBe(true);
    expect(SLUG_RE.test("a")).toBe(false);
    expect(SLUG_RE.test("-abc")).toBe(false);
    expect(SLUG_RE.test("Abc")).toBe(false);
    expect(SLUG_RE.test("кафе")).toBe(false);
    expect(SLUG_RE.test("a".repeat(40))).toBe(false);
    expect(SLUG_RE.test("a".repeat(39))).toBe(true);
  });
  it("lists the reserved words", () => {
    expect(RESERVED_SLUGS).toEqual(["new", "admin", "api", "embed", "draft", "demo", "www", "static", "_next"]);
    expect(DRAFT_SLUG_PREFIX).toBe("draft-");
  });
});

describe("emptyDraft", () => {
  it("has sensible defaults, the default hours and the template's accent", () => {
    const d = emptyDraft("nocturne");
    expect(d).toMatchObject({ template: "nocturne", business_type: "cafe", name: "", slug: "", default_lang: "bg", step: "basics", logo_media_id: null, cover_media_id: null, gallery_media_ids: [], categories: [] });
    expect(d.hours).toEqual(DEFAULT_HOURS);
    expect(d.hours).not.toBe(DEFAULT_HOURS); // a copy, never the shared constant
    expect(d.theme.accent).toBe(TEMPLATE_ACCENT_DEFAULTS.nocturne);
    expect(d.texts).toEqual({ welcome: { bg: "", en: "" }, footer_note: { bg: "", en: "" } });
    expect(WizardDraftSchema.safeParse(d).success).toBe(true);
  });
  it("lists the steps in wizard order", () => {
    expect(WIZARD_STEPS).toEqual(["template", "basics", "look", "hours", "menu", "texts", "photos", "review", "done"]);
  });
});

describe("WizardDraftSchema / WizardPatchSchema", () => {
  it("bounds prices and allergen codes and validates hours", () => {
    const d = full();
    expect(WizardDraftSchema.safeParse(d).success).toBe(true);
    d.categories[0].items[0].price_eur = 0.05;
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].price_eur = 500.01;
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].price_eur = 2.999;
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].price_eur = 2.5;
    d.categories[0].items[0].allergens = [0];
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].allergens = [15];
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].allergens = [7, 7];
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
    d.categories[0].items[0].allergens = [1, 7];
    expect(WizardDraftSchema.safeParse(d).success).toBe(true);
    d.hours = { ...d.hours, mon: { open: "18:00", close: "08:00" } };
    expect(WizardDraftSchema.safeParse(d).success).toBe(false);
  });
  it("rejects reserved and malformed slugs but allows the empty slug of a fresh draft", () => {
    expect(WizardPatchSchema.safeParse({ slug: "" }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ slug: "admin" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ slug: "_next" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ slug: "My Cafe" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ slug: "my-cafe" }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ theme: { accent: "red" } }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ theme: { accent: "#A1b2C3" } }).success).toBe(true);
    expect(WizardPatchSchema.safeParse({ template: "shopify" }).success).toBe(false);
    expect(WizardPatchSchema.safeParse({ step: "menu" }).success).toBe(true);
  });
  it("strips unknown keys on PUT", () => {
    const r = WizardPatchSchema.safeParse({ name: "X", status: "live", deploy: {} });
    expect(r.success).toBe(true);
    expect(r.success && Object.keys(r.data)).toEqual(["name"]);
  });
});

describe("validateForPublish", () => {
  it("passes a complete draft", () => {
    expect(validateForPublish(full())).toEqual({ ok: true });
  });
  it("names every missing piece in both languages", () => {
    const d = emptyDraft("lumen");
    const r = validateForPublish(d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const byPath = Object.fromEntries(r.errors.map((e) => [e.path, e]));
    expect(byPath.name).toEqual({ path: "name", bg: "Въведете името на заведението.", en: "Enter the venue's name." });
    expect(byPath.slug).toEqual({ path: "slug", bg: "Адресът трябва да е 2–39 малки латински букви, цифри и тирета.", en: "The address must be 2–39 lowercase letters, digits and dashes." });
    expect(byPath.categories).toEqual({ path: "categories", bg: "Добавете поне един продукт в менюто.", en: "Add at least one menu item." });
    for (const e of r.errors) {
      expect(e.bg.length).toBeGreaterThan(0);
      expect(e.en.length).toBeGreaterThan(0);
      expect(e.bg).not.toBe(e.en);
    }
  });
  it("rejects reserved words and the draft placeholder as the final slug", () => {
    const a = full();
    a.slug = "demo";
    expect(validateForPublish(a)).toMatchObject({ ok: false, errors: [{ path: "slug", bg: "Този адрес е запазен. Изберете друг.", en: "This address is reserved. Choose another." }] });
    const b = full();
    b.slug = "draft-0a1b2c3d";
    expect(validateForPublish(b)).toMatchObject({ ok: false, errors: [{ path: "slug" }] });
  });
  it("needs a name in at least one language per category and item, and unique keys", () => {
    const d = full();
    d.categories[0].items[0].name_bg = "";
    d.categories[0].items[0].name_en = "";
    const r = validateForPublish(d);
    expect(r).toMatchObject({ ok: false, errors: [{ path: "categories.0.items.0.name", en: "Give the dish a name." }] });
    const dup = full();
    dup.categories[0].items.push({ ...dup.categories[0].items[0] });
    expect(validateForPublish(dup)).toMatchObject({ ok: false, errors: [{ path: "categories.0.items.1.key" }] });
  });
  it("maps error paths to wizard steps", () => {
    expect(stepForPath("name")).toBe("basics");
    expect(stepForPath("slug")).toBe("basics");
    expect(stepForPath("theme.accent")).toBe("look");
    expect(stepForPath("hours.mon")).toBe("hours");
    expect(stepForPath("categories.0.items.1.price_eur")).toBe("menu");
    expect(stepForPath("tagline_bg")).toBe("texts");
    expect(stepForPath("texts.welcome.en")).toBe("texts");
    expect(stepForPath("gallery_media_ids")).toBe("photos");
    expect(stepForPath("anything.else")).toBe("review");
  });
  it("fills the missing language from the other one", () => {
    expect(bothLangs("Еспресо", "")).toEqual({ bg: "Еспресо", en: "Еспресо" });
    expect(bothLangs("", "Espresso")).toEqual({ bg: "Espresso", en: "Espresso" });
    expect(bothLangs(" a ", " b ")).toEqual({ bg: "a", en: "b" });
  });
});
```

- [ ] **Step 2: Run the schema test and see it fail**

`npm test -- test/wizard-schema.test.ts` → fails with `Cannot find module '@/src/wizard/schema'`.

- [ ] **Step 3: Write `src/wizard/schema.ts`**

```ts
// src/wizard/schema.ts
// Shared by the wizard UI (client), the API routes and publish. No secrets, no store access, no template imports
// (src/templates loads next/font, which vitest cannot import).
import { z } from "zod";
import { isAllergenCode } from "../domain/allergens";
import { isValidHours } from "../domain/hours";
import { PRICE_MAX, PRICE_MIN, round2 } from "../domain/pricing";
import { BUSINESS_TYPES, LANGS, TEMPLATE_IDS, WEEKDAYS, type BusinessType, type Lang, type TemplateId, type WeekHours, type Weekday } from "../domain/types";
import { DEFAULT_HOURS } from "../store/types";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
export const RESERVED_SLUGS = ["new", "admin", "api", "embed", "draft", "demo", "www", "static", "_next"];
/** Placeholder slug of an unpublished draft: `draft-<8 hex>`. Never accepted as the final address. */
export const DRAFT_SLUG_PREFIX = "draft-";
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Copy of `def.accentDefault` from src/templates/<id>/index.ts (kept here so the wizard code and its tests never import next/font). */
export const TEMPLATE_ACCENT_DEFAULTS: Record<TemplateId, string> = {
  classic: "#2f6b4f",
  nocturne: "#d9893b",
  lumen: "#2f6b8a",
};

export type WizardStep = "template" | "basics" | "look" | "hours" | "menu" | "texts" | "photos" | "review" | "done";
export const WIZARD_STEPS: readonly WizardStep[] = ["template", "basics", "look", "hours", "menu", "texts", "photos", "review", "done"];

export interface WizardItem {
  key: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  image_media_id: string | null;
}
export interface WizardCategory {
  key: string;
  name_bg: string;
  name_en: string;
  items: WizardItem[];
}
export interface WizardDraft {
  template: TemplateId;
  business_type: BusinessType;
  name: string;
  slug: string;
  default_lang: Lang;
  address: string;
  phone: string;
  instagram: string;
  maps_url: string;
  hours: WeekHours;
  theme: { accent: string };
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  texts: { welcome: { bg: string; en: string }; footer_note: { bg: string; en: string } };
  logo_media_id: string | null;
  cover_media_id: string | null;
  gallery_media_ids: string[];
  categories: WizardCategory[];
  /** Last step the owner reached. */
  step: WizardStep;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DayHoursSchema = z.object({ open: z.string().regex(HHMM), close: z.string().regex(HHMM) }).nullable();
export const WeekHoursSchema = z
  .object(Object.fromEntries(WEEKDAYS.map((d) => [d, DayHoursSchema])) as Record<Weekday, typeof DayHoursSchema>)
  .refine((h) => isValidHours(h), { message: "open must be before close" });

const Key = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const Price = z
  .number()
  .finite()
  .min(PRICE_MIN)
  .max(PRICE_MAX)
  .refine((p) => round2(p) === p, { message: "at most two decimals" });
const Allergens = z
  .array(z.number().int().refine(isAllergenCode, { message: "allergen codes are 1–14" }))
  .max(14)
  .refine((a) => new Set(a).size === a.length, { message: "no repeats" });
const Short = (max: number) => z.string().max(max);
const SlugSchema = z.string().regex(SLUG_RE).refine((s) => !RESERVED_SLUGS.includes(s), { message: "reserved" });
const Pair = z.object({ bg: Short(400), en: Short(400) });

export const WizardItemSchema = z.object({
  key: Key,
  name_bg: Short(120),
  name_en: Short(120),
  desc_bg: Short(400),
  desc_en: Short(400),
  price_eur: Price,
  allergens: Allergens,
  image_media_id: z.string().max(64).nullable(),
});
export const WizardCategorySchema = z.object({ key: Key, name_bg: Short(80), name_en: Short(80), items: z.array(WizardItemSchema).max(200) });

export const WizardDraftSchema = z.object({
  template: z.enum(TEMPLATE_IDS),
  business_type: z.enum(BUSINESS_TYPES),
  name: Short(80),
  slug: z.union([z.literal(""), SlugSchema]),
  default_lang: z.enum(LANGS),
  address: Short(200),
  phone: Short(40),
  instagram: Short(60),
  maps_url: z.union([z.literal(""), z.string().url().max(500)]),
  hours: WeekHoursSchema,
  theme: z.object({ accent: z.string().regex(HEX) }),
  tagline_bg: Short(160),
  tagline_en: Short(160),
  about_bg: Short(2000),
  about_en: Short(2000),
  texts: z.object({ welcome: Pair, footer_note: Pair }),
  logo_media_id: z.string().max(64).nullable(),
  cover_media_id: z.string().max(64).nullable(),
  gallery_media_ids: z.array(z.string().max(64)).max(40),
  categories: z.array(WizardCategorySchema).max(40),
  step: z.enum(WIZARD_STEPS),
}) satisfies z.ZodType<WizardDraft>;
/** PUT body: any subset of the draft; unknown keys are dropped. */
export const WizardPatchSchema = WizardDraftSchema.partial();

export function emptyDraft(template: TemplateId): WizardDraft {
  return {
    template,
    business_type: "cafe",
    name: "",
    slug: "",
    default_lang: "bg",
    address: "",
    phone: "",
    instagram: "",
    maps_url: "",
    hours: structuredClone(DEFAULT_HOURS),
    theme: { accent: TEMPLATE_ACCENT_DEFAULTS[template] },
    tagline_bg: "",
    tagline_en: "",
    about_bg: "",
    about_en: "",
    texts: { welcome: { bg: "", en: "" }, footer_note: { bg: "", en: "" } },
    logo_media_id: null,
    cover_media_id: null,
    gallery_media_ids: [],
    categories: [],
    step: "basics",
  };
}

export interface PublishError {
  path: string;
  bg: string;
  en: string;
}

/** The wizard step that owns a validation path (for "Fix" links and per-step blocking). */
export function stepForPath(path: string): WizardStep {
  const head = path.split(".")[0];
  if (["name", "slug", "default_lang", "address", "phone", "instagram", "maps_url", "business_type"].includes(head)) return "basics";
  if (["theme", "logo_media_id", "cover_media_id", "template"].includes(head)) return "look";
  if (head === "hours") return "hours";
  if (head === "categories") return "menu";
  if (["tagline_bg", "tagline_en", "about_bg", "about_en", "texts"].includes(head)) return "texts";
  if (head === "gallery_media_ids") return "photos";
  return "review";
}

/** When one language is empty the other is used for both, so nothing on the site is ever blank. */
export function bothLangs(bg: string, en: string): { bg: string; en: string } {
  const b = bg.trim();
  const e = en.trim();
  return { bg: b || e, en: e || b };
}

export function validateForPublish(d: WizardDraft): { ok: true } | { ok: false; errors: PublishError[] } {
  const errors: PublishError[] = [];
  const push = (path: string, bg: string, en: string) => {
    if (!errors.some((e) => e.path === path)) errors.push({ path, bg, en });
  };
  if (!d.name.trim()) push("name", "Въведете името на заведението.", "Enter the venue's name.");
  if (!SLUG_RE.test(d.slug)) push("slug", "Адресът трябва да е 2–39 малки латински букви, цифри и тирета.", "The address must be 2–39 lowercase letters, digits and dashes.");
  else if (RESERVED_SLUGS.includes(d.slug) || d.slug.startsWith(DRAFT_SLUG_PREFIX)) push("slug", "Този адрес е запазен. Изберете друг.", "This address is reserved. Choose another.");
  if (!isValidHours(d.hours)) push("hours", "Проверете работното време: отварянето трябва да е преди затварянето.", "Check the opening hours: opening must be before closing.");
  if (!HEX.test(d.theme.accent)) push("theme.accent", "Цветът трябва да е във вид #rrggbb.", "The colour must look like #rrggbb.");
  if (!d.categories.some((c) => c.items.length > 0)) push("categories", "Добавете поне един продукт в менюто.", "Add at least one menu item.");
  const catKeys = new Set<string>();
  d.categories.forEach((c, i) => {
    if (catKeys.has(c.key)) push(`categories.${i}.key`, "Повтарящ се ключ на категория.", "Duplicate category key.");
    catKeys.add(c.key);
    if (!c.name_bg.trim() && !c.name_en.trim()) push(`categories.${i}.name`, "Дайте име на категорията.", "Give the category a name.");
    const itemKeys = new Set<string>();
    c.items.forEach((it, j) => {
      if (itemKeys.has(it.key)) push(`categories.${i}.items.${j}.key`, "Повтарящ се ключ на продукт.", "Duplicate item key.");
      itemKeys.add(it.key);
      if (!it.name_bg.trim() && !it.name_en.trim()) push(`categories.${i}.items.${j}.name`, "Дайте име на ястието.", "Give the dish a name.");
      if (!Number.isFinite(it.price_eur) || it.price_eur < PRICE_MIN || it.price_eur > PRICE_MAX || round2(it.price_eur) !== it.price_eur)
        push(`categories.${i}.items.${j}.price_eur`, `Цената трябва да е между ${PRICE_MIN.toFixed(2)} и ${PRICE_MAX.toFixed(2)} € с до два знака.`, `The price must be between ${PRICE_MIN.toFixed(2)} and ${PRICE_MAX.toFixed(2)} € with at most two decimals.`);
      if (!it.allergens.every(isAllergenCode) || new Set(it.allergens).size !== it.allergens.length) push(`categories.${i}.items.${j}.allergens`, "Алергените са кодове от 1 до 14, без повторения.", "Allergens are codes 1–14 without repeats.");
    });
  });
  // Anything the field checks above did not cover (lengths, URL shape, enums).
  const parsed = WizardDraftSchema.safeParse(d);
  if (!parsed.success) for (const i of parsed.error.issues) push(i.path.map(String).join("."), "Невалидна стойност.", "Invalid value.");
  return errors.length ? { ok: false, errors } : { ok: true };
}
```

- [ ] **Step 4: Run the schema test**

`npm test -- test/wizard-schema.test.ts` → PASS (12 tests). If `z.enum(TEMPLATE_IDS)` complains about `readonly TemplateId[]`, write `z.enum([...TEMPLATE_IDS] as [TemplateId, ...TemplateId[]])` (same for `BUSINESS_TYPES`, `LANGS`, `WIZARD_STEPS`).

- [ ] **Step 5: Write the failing preview test**

```ts
// test/wizard-preview.test.ts
import { describe, expect, it } from "vitest";
import { media } from "./fixtures";
import { buildPreviewState } from "@/src/wizard/preview";
import { emptyDraft } from "@/src/wizard/schema";

describe("buildPreviewState", () => {
  it("turns a draft into a live-looking SiteState with prefixed ids and grouped items", () => {
    const d = emptyDraft("classic");
    d.name = "Кафене „Ъгъла“";
    d.slug = "agala";
    d.tagline_bg = "Кафе на ъгъла";
    d.tagline_en = "";
    d.logo_media_id = "m1";
    d.gallery_media_ids = ["m3", "m2"];
    d.texts.welcome = { bg: "Добре дошли!", en: "Welcome!" };
    d.categories = [
      { key: "coffee", name_bg: "Кафе", name_en: "Coffee", items: [
        { key: "esp", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null },
        { key: "cap", name_bg: "Капучино", name_en: "", desc_bg: "", desc_en: "", price_eur: 2.9, allergens: [7], image_media_id: "m1" },
      ] },
      { key: "food", name_bg: "", name_en: "Food", items: [] },
    ];
    const now = new Date("2026-10-09T09:00:00.000Z");
    const s = buildPreviewState(d, [media("m1"), media("m2"), media("m3")], now);
    expect(s.venue).toMatchObject({ id: "preview", slug: "agala", name: "Кафене „Ъгъла“", status: "live", template: "classic", deploy: null, wizard_draft: null, logo_media_id: "m1", cover_media_id: null, tz: "Europe/Sofia", created_at: now.toISOString() });
    expect(s.venue.tagline_en).toBe("Кафе на ъгъла"); // missing language falls back
    expect(s.categories.map((c) => [c.id, c.position, c.name_bg])).toEqual([["prev-cat-coffee", 0, "Кафе"], ["prev-cat-food", 1, "Food"]]);
    expect(s.items.map((i) => [i.id, i.category_id, i.position, i.name_en])).toEqual([["prev-item-esp", "prev-cat-coffee", 0, "Espresso"], ["prev-item-cap", "prev-cat-coffee", 1, "Капучино"]]);
    expect(s.items[1]).toMatchObject({ allergens: [7], image_media_id: "m1", active: true, is_special: false, sold_out_until: null });
    expect(s.media.map((m) => [m.id, m.is_gallery, m.position, m.venue_id])).toEqual([["m1", false, 0, "preview"], ["m2", true, 1, "preview"], ["m3", true, 0, "preview"]]);
    expect(s.texts).toEqual([{ venue_id: "preview", key: "welcome", text_bg: "Добре дошли!", text_en: "Welcome!" }]);
    expect(s.holidays).toEqual([]);
    expect(s.announcements).toEqual([]);
  });
  it("gives an unnamed draft a placeholder name in its default language", () => {
    const bg = buildPreviewState(emptyDraft("lumen"), [], new Date());
    expect(bg.venue.name).toBe("Вашето заведение");
    const d = emptyDraft("lumen");
    d.default_lang = "en";
    expect(buildPreviewState(d, [], new Date()).venue.name).toBe("Your venue");
    expect(bg.venue.slug).toBe("preview");
  });
});
```

- [ ] **Step 6: Write `src/wizard/preview.ts`**

```ts
// src/wizard/preview.ts
import type { Category, Item, Media, SiteState, SiteText, Venue } from "../domain/types";
import { bothLangs, type WizardDraft } from "./schema";

/** The draft rendered as if it were live: ids are prefixed so nothing can be mistaken for a stored row. */
export function buildPreviewState(d: WizardDraft, media: Media[], now: Date): SiteState {
  const iso = now.toISOString();
  const tagline = bothLangs(d.tagline_bg, d.tagline_en);
  const about = bothLangs(d.about_bg, d.about_en);
  const venue: Venue = {
    id: "preview",
    slug: d.slug || "preview",
    name: d.name.trim() || (d.default_lang === "bg" ? "Вашето заведение" : "Your venue"),
    tagline_bg: tagline.bg,
    tagline_en: tagline.en,
    about_bg: about.bg,
    about_en: about.en,
    address: d.address,
    phone: d.phone,
    maps_url: d.maps_url,
    instagram: d.instagram,
    cover_media_id: d.cover_media_id,
    logo_media_id: d.logo_media_id,
    hours: d.hours,
    tz: "Europe/Sofia",
    default_lang: d.default_lang,
    theme: { accent: d.theme.accent },
    created_at: iso,
    template: d.template,
    business_type: d.business_type,
    status: "live",
    deploy: null,
    wizard_draft: null,
  };
  const categories: Category[] = d.categories.map((c, i) => {
    const n = bothLangs(c.name_bg, c.name_en);
    return { id: `prev-cat-${c.key}`, venue_id: "preview", name_bg: n.bg, name_en: n.en, position: i, active: true };
  });
  const items: Item[] = d.categories.flatMap((c) =>
    c.items.map((it, j): Item => {
      const n = bothLangs(it.name_bg, it.name_en);
      return {
        id: `prev-item-${it.key}`,
        venue_id: "preview",
        category_id: `prev-cat-${c.key}`,
        name_bg: n.bg,
        name_en: n.en,
        desc_bg: it.desc_bg,
        desc_en: it.desc_en,
        price_eur: it.price_eur,
        allergens: [...it.allergens].sort((a, b) => a - b),
        image_media_id: it.image_media_id,
        sold_out_until: null,
        is_special: false,
        special_expires_at: null,
        position: j,
        active: true,
        created_at: iso,
        updated_at: iso,
      };
    }),
  );
  const gallery = new Map(d.gallery_media_ids.map((id, i) => [id, i]));
  const mediaRows: Media[] = media.map((m) => ({ ...m, venue_id: "preview", is_gallery: gallery.has(m.id), position: gallery.get(m.id) ?? m.position }));
  const texts: SiteText[] = [];
  for (const key of ["welcome", "footer_note"] as const) {
    const t = d.texts[key];
    if (!t.bg.trim() && !t.en.trim()) continue;
    const b = bothLangs(t.bg, t.en);
    texts.push({ venue_id: "preview", key, text_bg: b.bg, text_en: b.en });
  }
  return { venue, categories, items, holidays: [], announcements: [], media: mediaRows, texts };
}
```

- [ ] **Step 7: Run the preview test**

`npm test -- test/wizard-preview.test.ts` → PASS (2 tests). `npm run typecheck` must be clean: if `Venue` lacks `template`/`status`/`deploy`/`wizard_draft`, Task 1 is not merged; stop and report.

- [ ] **Step 8: Write the cookie helper and its test**

```ts
// src/server/draft-cookie.ts
// The draft cookie is the only place the draft token lives. httpOnly, so the wizard's JS never sees it.
export const COOKIE_NAME = "sm_draft";
export const DRAFT_COOKIE_MAX_AGE = 7 * 24 * 3600; // seconds

export function draftCookieValue(id: string, token: string): string {
  return `${id}.${token}`;
}

/** `<venueId>.<token>`; ids are UUIDs and tokens hex, so the first dot splits them. */
export function parseDraftCookie(value: string | null | undefined): { id: string; token: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const id = value.slice(0, dot);
  const token = value.slice(dot + 1);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id) || !/^[0-9a-f]{32,128}$/.test(token)) return null;
  return { id, token };
}

export function serializeDraftCookie(id: string, token: string, opts: { secure: boolean }): string {
  return `${COOKIE_NAME}=${draftCookieValue(id, token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DRAFT_COOKIE_MAX_AGE}${opts.secure ? "; Secure" : ""}`;
}

/** One cookie's value from a raw `Cookie` request header. */
export function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** For server components: `readDraftFromCookies(await cookies())`. */
export function readDraftFromCookies(cookieStore: { get(name: string): { value: string } | undefined }): { id: string; token: string } | null {
  return parseDraftCookie(cookieStore.get(COOKIE_NAME)?.value);
}

/** For route handlers. */
export function readDraftFromRequest(req: Request): { id: string; token: string } | null {
  return parseDraftCookie(cookieFromHeader(req.headers.get("cookie"), COOKIE_NAME));
}
```

Add to `test/wizard-server.test.ts` (created in Step 9 below) — the cookie block is included there.

- [ ] **Step 9: Write the failing server tests**

```ts
// test/wizard-server.test.ts
import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS } from "@/src/bot/bot";
import { sha256Hex } from "@/src/server/hash";
import { createDraft, publishDraft, rateLimitKeys, updateDraft, WizardError } from "@/src/server/wizard";
import { COOKIE_NAME, cookieFromHeader, draftCookieValue, parseDraftCookie, readDraftFromCookies, readDraftFromRequest, serializeDraftCookie } from "@/src/server/draft-cookie";
import { emptyDraft } from "@/src/wizard/schema";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("draft cookie", () => {
  it("round-trips id and token and rejects junk", () => {
    const v = draftCookieValue("8d1b8f1e-1c5e-4a1b-9c6a-5f0f2b7a9e11", "ab".repeat(32));
    expect(parseDraftCookie(v)).toEqual({ id: "8d1b8f1e-1c5e-4a1b-9c6a-5f0f2b7a9e11", token: "ab".repeat(32) });
    expect(parseDraftCookie("")).toBeNull();
    expect(parseDraftCookie("nodot")).toBeNull();
    expect(parseDraftCookie(".abc")).toBeNull();
    expect(parseDraftCookie("id.")).toBeNull();
    expect(parseDraftCookie("id.NOT-HEX")).toBeNull();
    const header = serializeDraftCookie("id1", "ab".repeat(32), { secure: true });
    expect(header).toBe(`${COOKIE_NAME}=id1.${"ab".repeat(32)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`);
    expect(serializeDraftCookie("id1", "ab".repeat(32), { secure: false })).not.toContain("Secure");
    expect(cookieFromHeader(`a=1; ${COOKIE_NAME}=id1.${"ab".repeat(32)}; b=2`, COOKIE_NAME)).toBe(`id1.${"ab".repeat(32)}`);
    expect(cookieFromHeader(null, COOKIE_NAME)).toBeNull();
    expect(readDraftFromRequest(new Request("http://x/", { headers: { cookie: `${COOKIE_NAME}=id1.${"ab".repeat(32)}` } }))).toEqual({ id: "id1", token: "ab".repeat(32) });
    expect(readDraftFromCookies({ get: (n) => (n === COOKIE_NAME ? { value: `id1.${"ab".repeat(32)}` } : undefined) })).toEqual({ id: "id1", token: "ab".repeat(32) });
  });
});

describe("rateLimitKeys", () => {
  it("builds the ip and global keys", () => {
    expect(rateLimitKeys("deadbeef")).toEqual({ ip: "new:ip:deadbeef", global: "new:global" });
  });
});

describe("createDraft → updateDraft → publishDraft", () => {
  it("creates a draft venue with a placeholder slug and a hashed token", async () => {
    const { store } = await makeDemo();
    const { venue, token } = await createDraft(store, "nocturne", T0);
    expect(venue.status).toBe("draft");
    expect(venue.slug).toMatch(/^draft-[0-9a-f]{8}$/);
    expect(venue.template).toBe("nocturne");
    expect(venue.wizard_draft).toEqual(emptyDraft("nocturne"));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.findVenueByDraftToken(sha256Hex(token)))?.id).toBe(venue.id);
    expect(await store.findVenueByDraftToken(sha256Hex("wrong"))).toBeNull();
  });

  it("validates and merges patches, refusing taken and reserved slugs", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    const merged = await updateDraft(store, venue, { name: "Моето кафене", slug: "moeto-kafene" });
    expect(merged).toMatchObject({ name: "Моето кафене", slug: "moeto-kafene", template: "classic" });
    expect((await store.getVenue(venue.id)).wizard_draft).toEqual(merged);
    expect((await store.getVenue(venue.id)).slug).toMatch(/^draft-/); // the row keeps its placeholder until publish
    await expect(updateDraft(store, await store.getVenue(venue.id), { slug: "agala" })).rejects.toMatchObject({ code: "slug_taken", status: 409 });
    await expect(updateDraft(store, await store.getVenue(venue.id), { slug: "admin" })).rejects.toMatchObject({ code: "invalid", status: 400 });
    await expect(updateDraft(store, await store.getVenue(venue.id), { categories: [{ key: "c", name_bg: "x", name_en: "x", items: [{ key: "i", name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 0.01, allergens: [], image_media_id: null }] }] })).rejects.toBeInstanceOf(WizardError);
    // a second draft may still choose the same slug as an unpublished first draft (only published venues are taken)
    const other = await createDraft(store, "classic", T0);
    await expect(updateDraft(store, other.venue, { slug: "moeto-kafene" })).resolves.toMatchObject({ slug: "moeto-kafene" });
  });

  it("refuses to publish an incomplete draft with the validation errors", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    await expect(publishDraft(store, venue, T0)).rejects.toMatchObject({ code: "invalid", status: 400, errors: expect.arrayContaining([expect.objectContaining({ path: "name" }), expect.objectContaining({ path: "slug" }), expect.objectContaining({ path: "categories" })]) });
  });

  it("publishes: venue live with all fields, menu and texts inserted, images via one applied change set, invite redeemable, token still valid", async () => {
    const { store } = await makeDemo();
    const { venue, token } = await createDraft(store, "lumen", T0);
    const logo = await store.saveMedia(venue.id, new Uint8Array([1]), "image/png");
    const cover = await store.saveMedia(venue.id, new Uint8Array([2]), "image/jpeg");
    const g1 = await store.saveMedia(venue.id, new Uint8Array([3]), "image/jpeg");
    const g2 = await store.saveMedia(venue.id, new Uint8Array([4]), "image/jpeg");
    const dish = await store.saveMedia(venue.id, new Uint8Array([5]), "image/jpeg");
    const draft = await updateDraft(store, venue, {
      name: "Кафе „Светлина“", slug: "svetlina", default_lang: "en", address: "ул. Пример 1", phone: "+359 2 111 1111", instagram: "svetlina", maps_url: "https://maps.google.com/?q=1,2",
      hours: { ...emptyDraft("lumen").hours, sun: { open: "10:00", close: "14:00" } }, theme: { accent: "#AABBCC" },
      tagline_bg: "Светло кафе", tagline_en: "", about_bg: "", about_en: "A bright café.",
      texts: { welcome: { bg: "Добре дошли!", en: "Welcome!" }, footer_note: { bg: "", en: "" } },
      logo_media_id: logo.id, cover_media_id: cover.id, gallery_media_ids: [g2.id, g1.id, "not-ours"],
      categories: [
        { key: "coffee", name_bg: "Кафе", name_en: "Coffee", items: [
          { key: "esp", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: dish.id },
          { key: "cap", name_bg: "", name_en: "Cappuccino", desc_bg: "", desc_en: "Milky.", price_eur: 2.9, allergens: [7], image_media_id: "not-ours" },
        ] },
        { key: "empty", name_bg: "Празна", name_en: "Empty", items: [] },
      ],
      step: "review",
    });
    expect(draft.slug).toBe("svetlina");
    const r = await publishDraft(store, await store.getVenue(venue.id), T0);
    expect(r.venue).toMatchObject({ id: venue.id, slug: "svetlina", name: "Кафе „Светлина“", status: "live", template: "lumen", business_type: "cafe", default_lang: "en", wizard_draft: null, tagline_bg: "Светло кафе", tagline_en: "Светло кафе", about_bg: "A bright café.", about_en: "A bright café.", address: "ул. Пример 1", phone: "+359 2 111 1111", instagram: "svetlina", theme: { accent: "#aabbcc" }, logo_media_id: logo.id, cover_media_id: cover.id });
    expect(r.venue.hours.sun).toEqual({ open: "10:00", close: "14:00" });
    const site = await store.getSite(venue.id);
    expect(site.categories.map((c) => [c.name_en, c.position])).toEqual([["Coffee", 0], ["Empty", 1]]);
    expect(site.items.map((i) => [i.name_bg, i.name_en, i.price_eur, i.allergens, i.position, i.image_media_id])).toEqual([["Еспресо", "Espresso", 1.8, [], 0, dish.id], ["Cappuccino", "Cappuccino", 2.9, [7], 1, null]]);
    expect(site.texts).toEqual([{ venue_id: venue.id, key: "welcome", text_bg: "Добре дошли!", text_en: "Welcome!" }]);
    expect(site.media.filter((m) => m.is_gallery).sort((a, b) => a.position - b.position).map((m) => m.id)).toEqual([g2.id, g1.id]);
    const sets = await store.listChangeSets(venue.id);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ status: "applied", source: "dashboard", summary_bg: "Първоначални снимки", summary_en: "Initial photos", chat_id: null });
    expect(sets[0].changes.map((c) => c.op)).toEqual(["set_logo_image", "set_cover_image", "add_gallery_image", "add_gallery_image"]);
    expect(sets[0].preview_bg.length).toBeGreaterThan(0);
    // owner invite, 7 days
    const member = await store.redeemInvite(r.inviteCode, 5001, "bg", new Date(T0.getTime() + INVITE_TTL_MS - 1000).toISOString());
    expect(member).toMatchObject({ venue_id: venue.id, role: "owner", tg_chat_id: 5001 });
    expect((await store.findVenueByAdminToken(r.adminToken))?.id).toBe(venue.id);
    // the done page still authenticates with the cookie after publish
    expect((await store.findVenueByDraftToken(sha256Hex(token)))?.id).toBe(venue.id);
    expect((await store.getVenueBySlug("svetlina"))?.id).toBe(venue.id);
    await expect(publishDraft(store, await store.getVenue(venue.id), T0)).rejects.toMatchObject({ code: "already_published", status: 409 });
  });

  it("publishes without any image and writes no change set", async () => {
    const { store } = await makeDemo();
    const { venue } = await createDraft(store, "classic", T0);
    await updateDraft(store, venue, { name: "A", slug: "a-cafe", categories: [{ key: "c", name_bg: "Кафе", name_en: "", items: [{ key: "i", name_bg: "Чай", name_en: "", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] });
    await publishDraft(store, await store.getVenue(venue.id), T0);
    expect(await store.listChangeSets(venue.id)).toEqual([]);
    expect((await store.getSite(venue.id)).items[0]).toMatchObject({ name_bg: "Чай", name_en: "Чай" });
  });

  it("refuses to publish when the slug was taken by a venue published in between", async () => {
    const { store } = await makeDemo();
    const a = await createDraft(store, "classic", T0);
    const b = await createDraft(store, "classic", T0);
    const menu = { categories: [{ key: "c", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i", name_bg: "Чай", name_en: "Tea", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] };
    await updateDraft(store, a.venue, { name: "A", slug: "same", ...menu });
    await updateDraft(store, b.venue, { name: "B", slug: "same", ...menu });
    await publishDraft(store, await store.getVenue(a.venue.id), T0);
    await expect(publishDraft(store, await store.getVenue(b.venue.id), T0)).rejects.toMatchObject({ code: "slug_taken", status: 409 });
  });
});
```

- [ ] **Step 10: Write `src/server/wizard.ts`**

```ts
// src/server/wizard.ts
// Pure functions over Store (tested on the memory store) plus the HTTP handlers the thin app/api/new routes call.
import { adminUrl, INVITE_TTL_MS, publicUrl } from "../bot/bot";
import { imageMediaType, MAX_IMAGE_BYTES } from "../bot/media";
import type { Messenger } from "../bot/messenger";
import type { Config } from "../config";
import { pollDeployments } from "../deploy/run";
import type { Deployer } from "../deploy/types";
import { planChanges } from "../domain/changes";
import { renderPreview } from "../domain/preview";
import { TEMPLATE_IDS, type ChangeOp, type TemplateId, type Venue } from "../domain/types";
import { seedMenuFrom, type SeedCategory, type SeedItem, type SeedTexts } from "../seed/demo";
import type { Store, VenuePatch } from "../store/types";
import { bothLangs, DRAFT_SLUG_PREFIX, emptyDraft, RESERVED_SLUGS, SLUG_RE, validateForPublish, WizardPatchSchema, type PublishError, type WizardDraft } from "../wizard/schema";
import { newDraftToken, sha256Hex } from "./hash";
import { readDraftFromRequest, serializeDraftCookie } from "./draft-cookie";

export type WizardErrorCode = "bad_request" | "invalid" | "unauthorized" | "not_found" | "slug_taken" | "already_published" | "rate_limited" | "too_large" | "unsupported_type";

/** Every wizard failure the client can show: a code, both languages, an HTTP status and optional field errors. */
export class WizardError extends Error {
  constructor(
    public readonly code: WizardErrorCode,
    public readonly status: number,
    public readonly bg: string,
    public readonly en: string,
    public readonly errors: PublishError[] = [],
  ) {
    super(en);
    this.name = "WizardError";
  }
}

export function wizardErrorResponse(e: unknown): Response {
  if (e instanceof WizardError) {
    return Response.json({ error: { code: e.code, bg: e.bg, en: e.en, ...(e.errors.length ? { details: e.errors } : {}) } }, { status: e.status, headers: { "cache-control": "no-store" } });
  }
  console.error("[wizard] unexpected:", e instanceof Error ? e.message : e);
  return Response.json({ error: { code: "error", bg: "Възникна грешка. Опитайте отново.", en: "Something went wrong. Please try again." } }, { status: 500, headers: { "cache-control": "no-store" } });
}

const INVALID = (errors: PublishError[] = []) => new WizardError("invalid", 400, "Някои полета не са попълнени правилно.", "Some fields are not filled in correctly.", errors);
const SLUG_TAKEN = () => new WizardError("slug_taken", 409, "Този адрес вече е зает. Изберете друг.", "This address is already taken. Choose another.");

export function rateLimitKeys(ipHash: string): { ip: string; global: string } {
  return { ip: `new:ip:${ipHash}`, global: "new:global" };
}

function placeholderSlug(): string {
  return `${DRAFT_SLUG_PREFIX}${newDraftToken().slice(0, 8)}`;
}

export async function createDraft(store: Store, template: TemplateId, now: Date): Promise<{ venue: Venue; token: string }> {
  void now; // created_at comes from the store's clock; `now` is kept in the signature for the contract
  let venue: Venue | null = null;
  for (let attempt = 0; attempt < 3 && !venue; attempt++) {
    try {
      venue = await store.createVenue({ slug: placeholderSlug(), name: "", template, business_type: "cafe", status: "draft", wizard_draft: emptyDraft(template) });
    } catch (e) {
      if (attempt === 2) throw e; // a placeholder collision three times in a row is not a collision
    }
  }
  const token = newDraftToken();
  await store.setDraftToken((venue as Venue).id, sha256Hex(token));
  return { venue: venue as Venue, token };
}

/** The slug is free when no OTHER published venue has it. Drafts keep their placeholder row slug, so only live rows count. */
async function assertSlugFree(store: Store, slug: string, selfId: string): Promise<void> {
  const other = await store.getVenueBySlug(slug);
  if (other && other.id !== selfId && other.status === "live") throw SLUG_TAKEN();
}

export async function updateDraft(store: Store, venue: Venue, patch: Partial<WizardDraft>): Promise<WizardDraft> {
  if (venue.status !== "draft") throw new WizardError("already_published", 409, "Сайтът вече е създаден.", "This site has already been created.");
  const parsed = WizardPatchSchema.safeParse(patch);
  if (!parsed.success) throw INVALID(parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), bg: "Невалидна стойност.", en: "Invalid value." })));
  const clean = parsed.data;
  if (clean.slug) {
    if (RESERVED_SLUGS.includes(clean.slug) || clean.slug.startsWith(DRAFT_SLUG_PREFIX)) throw INVALID([{ path: "slug", bg: "Този адрес е запазен. Изберете друг.", en: "This address is reserved. Choose another." }]);
    await assertSlugFree(store, clean.slug, venue.id);
  }
  const merged: WizardDraft = { ...(venue.wizard_draft ?? emptyDraft(venue.template)), ...clean };
  await store.updateVenue(venue.id, { wizard_draft: merged, ...(clean.template ? { template: clean.template } : {}), ...(clean.business_type ? { business_type: clean.business_type } : {}) });
  return merged;
}

export async function publishDraft(store: Store, venue: Venue, now: Date): Promise<{ venue: Venue; inviteCode: string; adminToken: string }> {
  if (venue.status !== "draft") throw new WizardError("already_published", 409, "Сайтът вече е създаден.", "This site has already been created.");
  const d = venue.wizard_draft ?? emptyDraft(venue.template);
  const v = validateForPublish(d);
  if (!v.ok) throw INVALID(v.errors);
  if (!SLUG_RE.test(d.slug)) throw INVALID([{ path: "slug", bg: "Изберете адрес на сайта.", en: "Choose a web address." }]);
  await assertSlugFree(store, d.slug, venue.id);
  const nowIso = now.toISOString();

  // Only media uploaded to this draft may be referenced.
  const own = new Set((await store.getSite(venue.id)).media.map((m) => m.id));
  const mediaOrNull = (id: string | null) => (id && own.has(id) ? id : null);

  const tagline = bothLangs(d.tagline_bg, d.tagline_en);
  const about = bothLangs(d.about_bg, d.about_en);
  const patch: VenuePatch = {
    slug: d.slug,
    name: d.name.trim(),
    tagline_bg: tagline.bg,
    tagline_en: tagline.en,
    about_bg: about.bg,
    about_en: about.en,
    address: d.address.trim(),
    phone: d.phone.trim(),
    maps_url: d.maps_url.trim(),
    instagram: d.instagram.trim().replace(/^@/, ""),
    hours: d.hours,
    tz: "Europe/Sofia",
    default_lang: d.default_lang,
    theme: { accent: d.theme.accent.toLowerCase() },
    template: d.template,
    business_type: d.business_type,
    status: "live",
    wizard_draft: null,
  };
  let updated: Venue;
  try {
    updated = await store.updateVenue(venue.id, patch);
  } catch (e) {
    if (e instanceof Error && /slug/i.test(e.message)) throw SLUG_TAKEN();
    throw e;
  }

  // Menu and texts through the shared seeder, so positions and ids come from the store exactly as for seeded venues.
  const cats: SeedCategory[] = d.categories.map((c) => {
    const n = bothLangs(c.name_bg, c.name_en);
    return { name_bg: n.bg, name_en: n.en };
  });
  const items: (SeedItem & { image_media_id: string | null })[] = d.categories.flatMap((c, ci) =>
    c.items.map((it) => {
      const n = bothLangs(it.name_bg, it.name_en);
      return { cat: ci, name_bg: n.bg, name_en: n.en, desc_bg: it.desc_bg.trim(), desc_en: it.desc_en.trim(), price_eur: it.price_eur, allergens: [...it.allergens].sort((a, b) => a - b), image_media_id: mediaOrNull(it.image_media_id) };
    }),
  );
  const texts: SeedTexts = { welcome: bothLangs(d.texts.welcome.bg, d.texts.welcome.en), footer_note: bothLangs(d.texts.footer_note.bg, d.texts.footer_note.en) };
  const filtered = Object.fromEntries(Object.entries(texts).filter(([, t]) => t.bg || t.en)) as SeedTexts;
  await seedMenuFrom(store, venue.id, cats, items, filtered);

  // Logo, cover and gallery go through one auto-applied change set, so the log explains where the images came from.
  const ops: ChangeOp[] = [];
  const logo = mediaOrNull(d.logo_media_id);
  const cover = mediaOrNull(d.cover_media_id);
  if (logo) ops.push({ op: "set_logo_image", media_id: logo });
  if (cover) ops.push({ op: "set_cover_image", media_id: cover });
  for (const id of d.gallery_media_ids) if (own.has(id) && !ops.some((o) => o.op === "add_gallery_image" && o.media_id === id)) ops.push({ op: "add_gallery_image", media_id: id });
  if (ops.length) {
    const site = await store.getSite(venue.id);
    const changes = planChanges(site, ops, { newId: () => crypto.randomUUID(), now: nowIso });
    const cs = await store.createChangeSet({
      venue_id: venue.id,
      chat_id: null,
      summary_bg: "Първоначални снимки",
      summary_en: "Initial photos",
      preview_bg: renderPreview(site, changes, "bg", updated.tz),
      preview_en: renderPreview(site, changes, "en", updated.tz),
      source: "dashboard",
      status: "proposed",
      changes,
    });
    await store.applyChangeSet(cs.id, nowIso);
  }

  const inviteCode = await store.createInvite(venue.id, "owner", new Date(now.getTime() + INVITE_TTL_MS).toISOString());
  const adminToken = await store.getAdminToken(venue.id);
  return { venue: await store.getVenue(venue.id), inviteCode, adminToken };
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP layer (the app/api/new routes only parse params and call these).

export interface WizardDeps {
  store: Store;
  config: Pick<Config, "publicBaseUrl" | "rateSalt" | "maxSitesPerDay" | "telegramBotUsername">;
  now: () => Date;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const NEW_PER_IP_PER_HOUR = 5;

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || "unknown";
}

/** Cookie id must equal the path id and its token hash must resolve to that venue. Draft or live (the done page polls after publish). */
export async function requireDraft(req: Request, d: Pick<WizardDeps, "store">, id: string): Promise<{ venue: Venue } | Response> {
  const c = readDraftFromRequest(req);
  if (!c || c.id !== id) return wizardErrorResponse(new WizardError("unauthorized", 401, "Тази чернова не е ваша или сесията е изтекла.", "This draft is not yours or the session has expired."));
  const venue = await d.store.findVenueByDraftToken(sha256Hex(c.token));
  if (!venue || venue.id !== id) return wizardErrorResponse(new WizardError("not_found", 404, "Черновата не беше намерена.", "The draft was not found."));
  return { venue };
}

export async function handleNewDraft(req: Request, d: WizardDeps): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as { template?: unknown };
    const template = typeof body.template === "string" && (TEMPLATE_IDS as readonly string[]).includes(body.template) ? (body.template as TemplateId) : null;
    if (!template) throw new WizardError("bad_request", 400, "Изберете шаблон.", "Choose a template.");
    const now = d.now();
    const nowIso = now.toISOString();
    const keys = rateLimitKeys(sha256Hex(clientIp(req) + d.config.rateSalt));
    if (!(await d.store.bumpRateLimit(keys.ip, HOUR_MS, NEW_PER_IP_PER_HOUR, nowIso))) throw new WizardError("rate_limited", 429, "Твърде много опити от този адрес. Опитайте след час.", "Too many attempts from this address. Try again in an hour.");
    if (!(await d.store.bumpRateLimit(keys.global, DAY_MS, d.config.maxSitesPerDay, nowIso))) throw new WizardError("rate_limited", 429, "Днес достигнахме лимита за нови сайтове. Опитайте утре.", "We reached today's limit for new sites. Try again tomorrow.");
    const { venue, token } = await createDraft(d.store, template, now);
    const secure = d.config.publicBaseUrl.startsWith("https://");
    return Response.json({ id: venue.id }, { status: 201, headers: { "set-cookie": serializeDraftCookie(venue.id, token, { secure }), "cache-control": "no-store" } });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export async function handleGetDraft(d: WizardDeps, venue: Venue): Promise<Response> {
  const site = await d.store.getSite(venue.id);
  return Response.json({ draft: venue.wizard_draft ?? emptyDraft(venue.template), media: site.media, status: venue.status }, { headers: { "cache-control": "no-store" } });
}

export async function handlePutDraft(req: Request, d: WizardDeps, venue: Venue): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WizardError("bad_request", 400, "Невалидна заявка.", "Invalid request.");
    const draft = await updateDraft(d.store, venue, body as Partial<WizardDraft>);
    return Response.json({ draft }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export async function handleMedia(req: Request, d: WizardDeps, venue: Venue): Promise<Response> {
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new WizardError("bad_request", 400, "Липсва файл.", "No file was sent.");
    if (file.size > MAX_IMAGE_BYTES) throw new WizardError("too_large", 400, "Снимката е над 5 MB.", "The image is over 5 MB.");
    const type = imageMediaType(file.type, file.name);
    if (!type) throw new WizardError("unsupported_type", 400, "Само снимки: JPEG, PNG, WebP или GIF.", "Images only: JPEG, PNG, WebP or GIF.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) throw new WizardError("bad_request", 400, "Файлът е празен.", "The file is empty.");
    const media = await d.store.saveMedia(venue.id, bytes, type);
    return Response.json({ media }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export async function handlePublish(d: WizardDeps, venue: Venue): Promise<Response> {
  try {
    const r = await publishDraft(d.store, venue, d.now());
    const bot = d.config.telegramBotUsername;
    return Response.json(
      {
        slug: r.venue.slug,
        invite_code: r.inviteCode,
        start_url: bot ? `https://t.me/${bot}?start=${r.inviteCode}` : null,
        admin_url: adminUrl(d.config.publicBaseUrl, r.venue.slug, r.adminToken),
        site_url: publicUrl(d.config.publicBaseUrl, r.venue.slug),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export async function handleStatus(d: WizardDeps & { deployer: Deployer; messenger: Messenger | null }, venue: Venue): Promise<Response> {
  let v = venue;
  if (v.deploy && (v.deploy.status === "pending" || v.deploy.status === "building")) {
    try {
      await pollDeployments({ store: d.store, deployer: d.deployer, messenger: d.messenger, now: d.now, venueId: v.id });
    } catch (e) {
      console.error("[wizard] status poll failed:", e instanceof Error ? e.message : e);
    }
    v = await d.store.getVenue(v.id);
  }
  const site_url = v.deploy?.status === "ready" && v.deploy.url ? v.deploy.url : v.status === "live" ? publicUrl(d.config.publicBaseUrl, v.slug) : null;
  return Response.json({ status: v.status, deploy: v.deploy, site_url }, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 11: Run the server tests**

`npm test -- test/wizard-server.test.ts` → PASS (8 tests). Notes while making it pass: `store.updateVenue` must reject a slug that another row already has (Task 1 contract: "throws on unknown id or slug conflict"); the memory store's error message contains the word "slug", which `publishDraft` maps to `slug_taken`. `seedMenuFrom` spreads each item into `insertItem`, so the extra `image_media_id` reaches `NewItem.image_media_id`; the `(SeedItem & {...})[]` array is assignable to `readonly SeedItem[]` because it is a variable, not an object literal.

- [ ] **Step 12: Write the rate-limit test**

```ts
// test/wizard-ratelimit.test.ts
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@/src/store/memory";
import { rateLimitKeys } from "@/src/server/wizard";

const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.parse("2026-10-09T09:00:00.000Z") + ms).toISOString();

describe("bumpRateLimit through the wizard keys", () => {
  it("allows five per ip per hour, then refuses, then allows again in the next window", async () => {
    const store = new InMemoryStore();
    const keys = rateLimitKeys("abc");
    for (let i = 0; i < 5; i++) expect(await store.bumpRateLimit(keys.ip, HOUR, 5, at(i * 1000))).toBe(true);
    expect(await store.bumpRateLimit(keys.ip, HOUR, 5, at(6000))).toBe(false);
    expect(await store.bumpRateLimit(keys.ip, HOUR, 5, at(HOUR - 1))).toBe(false);
    expect(await store.bumpRateLimit(keys.ip, HOUR, 5, at(HOUR + 1))).toBe(true);
  });
  it("keeps ip windows and the global window independent", async () => {
    const store = new InMemoryStore();
    const a = rateLimitKeys("a");
    const b = rateLimitKeys("b");
    expect(a.global).toBe(b.global);
    expect(a.ip).not.toBe(b.ip);
    for (let i = 0; i < 2; i++) {
      expect(await store.bumpRateLimit(a.ip, HOUR, 2, at(0))).toBe(true);
      expect(await store.bumpRateLimit(a.global, 24 * HOUR, 3, at(0))).toBe(true);
    }
    expect(await store.bumpRateLimit(a.ip, HOUR, 2, at(0))).toBe(false);
    expect(await store.bumpRateLimit(b.ip, HOUR, 2, at(0))).toBe(true);
    expect(await store.bumpRateLimit(b.global, 24 * HOUR, 3, at(0))).toBe(true); // third of three
    expect(await store.bumpRateLimit(b.global, 24 * HOUR, 3, at(0))).toBe(false); // fourth
  });
});
```

`npm test -- test/wizard-ratelimit.test.ts` → PASS (2 tests). If `InMemoryStore.bumpRateLimit` resets the window only when `now - window_start >= windowMs`, the `at(HOUR - 1)` assertion holds; if Task 1 implemented a strictly sliding log instead of a fixed window, adjust the `at(HOUR + 1)` expectation to the documented semantics (`count after increment <= max` within the window).

- [ ] **Step 13: Write the route tests (whole HTTP flow on the memory store)**

```ts
// test/wizard-routes.test.ts
import { describe, expect, it } from "vitest";
import type { Deployer } from "@/src/deploy/types";
import { COOKIE_NAME, cookieFromHeader } from "@/src/server/draft-cookie";
import { handleGetDraft, handleMedia, handleNewDraft, handlePublish, handlePutDraft, handleStatus, requireDraft, type WizardDeps } from "@/src/server/wizard";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function setup(over: Partial<WizardDeps["config"]> = {}) {
  const demo = await makeDemo();
  const deps: WizardDeps = { store: demo.store, config: { publicBaseUrl: "https://site.example", rateSalt: "salt", maxSitesPerDay: 50, telegramBotUsername: "site_bot", ...over }, now: () => T0 };
  return { ...demo, deps };
}
const json = (url: string, body: unknown, init: RequestInit & { headers?: Record<string, string> } = {}) => {
  const { headers, ...rest } = init;
  return new Request(url, { method: "POST", body: JSON.stringify(body), ...rest, headers: { "content-type": "application/json", ...(headers ?? {}) } });
};

async function newDraft(deps: WizardDeps, ip = "1.2.3.4") {
  const res = await handleNewDraft(json("https://site.example/api/new", { template: "nocturne" }, { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } }), deps);
  const cookie = res.headers.get("set-cookie") ?? "";
  const value = cookieFromHeader(cookie.split(";")[0], COOKIE_NAME) ?? "";
  const { id } = (await res.json()) as { id: string };
  return { res, id, cookie: `${COOKIE_NAME}=${value}` };
}

describe("POST /api/new", () => {
  it("creates a draft, sets the httpOnly cookie and rate-limits per ip and globally", async () => {
    const { deps } = await setup();
    const first = await newDraft(deps);
    expect(first.res.status).toBe(201);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    const sc = first.res.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(new RegExp(`^${COOKIE_NAME}=${first.id}\\.[0-9a-f]{64}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$`));
    for (let i = 0; i < 4; i++) expect((await newDraft(deps)).res.status).toBe(201);
    const sixth = await newDraft(deps);
    expect(sixth.res.status).toBe(429);
    expect(await sixth.res.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect((await newDraft(deps, "5.6.7.8")).res.status).toBe(201); // another ip
    const tight = await setup({ maxSitesPerDay: 1, publicBaseUrl: "http://localhost:3000" });
    const a = await newDraft(tight.deps, "9.9.9.9");
    expect(a.res.status).toBe(201);
    expect(a.res.headers.get("set-cookie")).not.toContain("Secure"); // http base url
    expect((await newDraft(tight.deps, "9.9.9.8")).res.status).toBe(429);
  });
  it("rejects an unknown template", async () => {
    const { deps } = await setup();
    const res = await handleNewDraft(json("https://site.example/api/new", { template: "wix" }), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "bad_request", bg: "Изберете шаблон.", en: "Choose a template." } });
  });
});

describe("requireDraft", () => {
  it("needs the cookie for the same id with a token that resolves", async () => {
    const { deps, store } = await setup();
    const { id, cookie } = await newDraft(deps);
    const noCookie = await requireDraft(new Request(`https://site.example/api/new/${id}`), deps, id);
    expect(noCookie).toBeInstanceOf(Response);
    expect((noCookie as Response).status).toBe(401);
    const wrongId = await requireDraft(new Request(`https://site.example/api/new/other`, { headers: { cookie } }), deps, "other");
    expect((wrongId as Response).status).toBe(401);
    const badToken = await requireDraft(new Request(`https://site.example/api/new/${id}`, { headers: { cookie: `${COOKIE_NAME}=${id}.${"0".repeat(64)}` } }), deps, id);
    expect((badToken as Response).status).toBe(404);
    const ok = await requireDraft(new Request(`https://site.example/api/new/${id}`, { headers: { cookie } }), deps, id);
    expect("venue" in ok && ok.venue.id).toBe(id);
    expect((await store.getVenue(id)).status).toBe("draft");
  });
});

describe("GET/PUT /api/new/[id], media, publish, status", () => {
  it("runs the whole flow", async () => {
    const { deps, store } = await setup();
    const { id, cookie } = await newDraft(deps);
    const venue = await store.getVenue(id);
    const got = await handleGetDraft(deps, venue);
    expect(await got.json()).toMatchObject({ draft: { template: "nocturne", step: "basics" }, media: [], status: "draft" });

    const bad = await handlePutDraft(json(`https://site.example/api/new/${id}`, { slug: "admin" }, { method: "PUT" }), deps, venue);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid", details: [{ path: "slug" }] } });

    const form = new FormData();
    form.append("file", new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" }));
    const up = await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: form }), deps, venue);
    expect(up.status).toBe(201);
    const { media } = (await up.json()) as { media: { id: string } };
    const pdfForm = new FormData();
    pdfForm.append("file", new File([new Uint8Array([1])], "menu.pdf", { type: "application/pdf" }));
    expect((await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: pdfForm }), deps, venue)).status).toBe(400);
    const bigForm = new FormData();
    bigForm.append("file", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" }));
    expect(await (await handleMedia(new Request(`https://site.example/api/new/${id}/media`, { method: "POST", body: bigForm }), deps, venue)).json()).toMatchObject({ error: { code: "too_large" } });

    const put = await handlePutDraft(json(`https://site.example/api/new/${id}`, { name: "Нощ", slug: "nosht", logo_media_id: media.id, categories: [{ key: "c", name_bg: "Коктейли", name_en: "Cocktails", items: [{ key: "i", name_bg: "Негрони", name_en: "Negroni", desc_bg: "", desc_en: "", price_eur: 9, allergens: [], image_media_id: null }] }] }, { method: "PUT" }), deps, venue);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ draft: { name: "Нощ", slug: "nosht", logo_media_id: media.id } });

    const early = await handleStatus({ ...deps, deployer: fakeDeployer(), messenger: null }, await store.getVenue(id));
    expect(await early.json()).toEqual({ status: "draft", deploy: null, site_url: null });

    const pub = await handlePublish(deps, await store.getVenue(id));
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as Record<string, string | null>;
    expect(body.slug).toBe("nosht");
    expect(body.invite_code).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.start_url).toBe(`https://t.me/site_bot?start=${body.invite_code}`);
    expect(body.admin_url).toMatch(/^https:\/\/site\.example\/admin\/nosht\?key=[0-9a-f]{32}$/);
    expect(body.site_url).toBe("https://site.example/nosht");
    expect((await handlePublish(deps, await store.getVenue(id))).status).toBe(409);
    expect((await handlePutDraft(json(`https://site.example/api/new/${id}`, { name: "x" }, { method: "PUT" }), deps, await store.getVenue(id))).status).toBe(409);

    // no bot username → start_url null
    const noBot = await setup({ telegramBotUsername: null });
    const d2 = await newDraft(noBot.deps);
    await handlePutDraft(json(`https://site.example/api/new/${d2.id}`, { name: "B", slug: "b-cafe", categories: [{ key: "c", name_bg: "К", name_en: "", items: [{ key: "i", name_bg: "Ч", name_en: "", desc_bg: "", desc_en: "", price_eur: 2, allergens: [], image_media_id: null }] }] }, { method: "PUT" }), noBot.deps, await noBot.store.getVenue(d2.id));
    expect(await (await handlePublish(noBot.deps, await noBot.store.getVenue(d2.id))).json()).toMatchObject({ start_url: null, slug: "b-cafe" });

    // status after publish: live and our own url; with a pending deploy it polls the deployer
    const live = await handleStatus({ ...deps, deployer: fakeDeployer(), messenger: null }, await store.getVenue(id));
    expect(await live.json()).toEqual({ status: "live", deploy: null, site_url: "https://site.example/nosht" });
    await store.setDeploy(id, { provider: "fake", project_id: "p1", deployment_id: "d1", url: null, status: "pending", error: null, template: "nocturne", updated_at: T0.toISOString() });
    const polled = await handleStatus({ ...deps, deployer: fakeDeployer(), messenger: null }, await store.getVenue(id));
    const pj = (await polled.json()) as { status: string; deploy: { status: string; url: string | null }; site_url: string | null };
    expect(pj.status).toBe("live");
    expect(pj.deploy.status).toBe("ready");
    expect(pj.site_url).toBe("https://nosht.example.test");
  });
});

/** A deployer that is READY on the first status() call (pollDeployments from Task 6 drives it). */
function fakeDeployer(): Deployer {
  return {
    provider: "fake",
    async createSite(i) { return { projectId: `prj_${i.slug}`, deploymentId: `dpl_${i.slug}` }; },
    async status() { return { state: "ready", url: "https://nosht.example.test", error: null }; },
    async redeploy(_p, i) { return { deploymentId: `dpl2_${i.slug}` }; },
    async deleteSite() {},
  };
}
```

- [ ] **Step 14: Run the route tests**

`npm test -- test/wizard-routes.test.ts` → PASS (4 tests). Expected adjustments: the memory `bumpRateLimit` is the Task 1 one; `pollDeployments` (Task 6) writes `deploy.status = "ready"` and `deploy.url` from `status().url`; if Task 6's `pollDeployments` expects `messenger` to be non-null, pass a `FakeMessenger` from `test/helpers.ts` instead of `null`.

- [ ] **Step 15: Write the route files**

```ts
// app/api/new/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleNewDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleNewDraft(req, { store: deps.store, config: deps.config, now: () => new Date() });
}
```

```ts
// app/api/new/[id]/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleGetDraft, handlePutDraft, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/new/[id]">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleGetDraft({ store: deps.store, config: deps.config, now: () => new Date() }, guard.venue);
}

export async function PUT(req: Request, ctx: RouteContext<"/api/new/[id]">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handlePutDraft(req, { store: deps.store, config: deps.config, now: () => new Date() }, guard.venue);
}
```

```ts
// app/api/new/[id]/media/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleMedia, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/media">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleMedia(req, { store: deps.store, config: deps.config, now: () => new Date() }, guard.venue);
}
```

```ts
// app/api/new/[id]/publish/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handlePublish, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/publish">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handlePublish({ store: deps.store, config: deps.config, now: () => new Date() }, guard.venue);
}
```

```ts
// app/api/new/[id]/status/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleStatus, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/new/[id]/status">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleStatus({ store: deps.store, config: deps.config, now: () => new Date(), deployer: deps.deployer, messenger: deps.messenger }, guard.venue);
}
```

No `next.config.ts` change: the draft token travels only in the httpOnly cookie, never in a URL, so the dev request log needs no new ignore pattern (venue ids are not secrets).

- [ ] **Step 16: Typecheck, full test run, manual smoke, commit**

`npm run typecheck` → clean (`RouteContext<"/api/new/[id]/media">` exists after `next build`/`next dev` typegen; if `tsc` runs before any build, run `npx next typegen` first). `npm test` → all green. Smoke: `SITE_MANAGER_STORE=memory npm run dev`, then

```bash
curl -s -i -X POST localhost:3000/api/new -H 'content-type: application/json' -d '{"template":"classic"}'   # 201, set-cookie: sm_draft=…
```

copy the cookie and `curl -s -b 'sm_draft=…' localhost:3000/api/new/<id>` → `{ draft, media, status }`.

```bash
git add src/wizard/schema.ts src/wizard/preview.ts src/server/wizard.ts src/server/draft-cookie.ts app/api/new test/wizard-schema.test.ts test/wizard-preview.test.ts test/wizard-server.test.ts test/wizard-ratelimit.test.ts test/wizard-routes.test.ts
git commit -m "Wizard API: draft schema, preview state, create/update/media/publish/status routes with rate limits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: opus

---


### Task 8: Menu extraction (image + PDF) and "Write for me" texts

> **Rulings that apply to this task:** R17, R18 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Create: `src/wizard/extract.ts`, `src/wizard/texts.ts`, `src/server/wizard-ai.ts`, `app/api/new/[id]/extract/route.ts`, `app/api/new/[id]/texts/route.ts`
- Modify: `src/server/deps.ts` (`ServerDeps.anthropic`)
- Test: `test/wizard-extract.test.ts`, `test/wizard-texts.test.ts`

**Interfaces:**
- Consumes (Task 7): `requireDraft(req, deps, id)`, `WizardError`, `wizardErrorResponse` from `src/server/wizard.ts`; `Venue` (Task 1); `Config.anthropicApiKey`, `Config.agentModel` (existing); `ALLERGENS`, `isAllergenCode`, `suggestAllergens` from `src/domain/allergens.ts`; `clampPrice`, `round2` from `src/domain/pricing.ts`; `Lang` from `src/domain/types.ts`; `betaZodTool` from `@anthropic-ai/sdk/helpers/beta/zod`.
- Produces: `ExtractFile`, `ExtractMediaType`, `ExtractResult`, `ExtractResultSchema`, `ExtractFilesSchema`, `BGN_PER_EUR`, `EXTRACT_MAX_FILES`, `EXTRACT_MAX_IMAGE_BYTES`, `EXTRACT_MAX_PDF_BYTES`, `base64Bytes`, `checkExtractFiles`, `postProcessExtract`, `extractMenu(client, cfg, files)` (`src/wizard/extract.ts`); `DraftTexts`, `DraftTextsSchema`, `draftTexts(client, cfg, facts, lang)`, `TEXTS_MAX_FACTS` (`src/wizard/texts.ts`); `WizardAiDeps`, `handleExtract(req, d, venue)`, `handleTexts(req, d, venue)` (`src/server/wizard-ai.ts`); `ServerDeps.anthropic: Anthropic | null` (contract gap, see below). Task 9's Menu and Texts steps call `POST /api/new/[id]/extract` and `POST /api/new/[id]/texts` and read `ExtractResult` / `DraftTexts`.

Decisions this task fixes:
- **Contract deviation (binding, from the `claude-api` skill, which is authoritative over the spec's recalled API shape):** on `claude-opus-5-5` a forced `tool_choice: { type: "tool", name }` (and `{ type: "any" }`) returns HTTP 400. Both helpers therefore send `tool_choice: { type: "auto", disable_parallel_tool_use: true }`, mark the single tool `strict: true` (the zod-generated schema already has `additionalProperties: false`), and the system prompt tells the model to call that tool exactly once. A response without the tool call is treated as `"error"` (the route tells the owner to try again). Everything else in the contract is kept: `client.beta.messages.create`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, `output_config: { effort: "high" }`, `max_tokens: 16000`, one tool, zod validation of the tool input.
- The model never does arithmetic: the tool's `price_eur` field carries the number printed on the menu and `currency_seen` says which currency it was; `postProcessExtract` converts BGN at 1.95583, rounds to cents and clamps to `PRICE_MIN..PRICE_MAX`. The field keeps the contract's name.
- The Anthropic client is built once in `makeServerDeps` (`ServerDeps.anthropic = o.client ?? (config.anthropicApiKey ? new Anthropic({ apiKey }) : null)`) and injected into the handlers; tests pass a fake object. This adds `anthropic: Anthropic | null` to `ServerDeps` (contract gap for the controller: `ServerDeps` in the spec lists only `deployer` and `startDeploy` as additions). `runTurn` keeps receiving `o.client` as today.
- Refusal → HTTP 422 `{ error: { code: "refused", bg, en } }`; model/parse failure → HTTP 502 `{ error: { code: "ai_error", … } }`; missing key → HTTP 503 `{ error: { code: "ai_unavailable", … } }`; bad body or over the limits → 400. The spec's status list (400/401/404/409/429) is extended by these three.
- PDFs are read in memory and sent to Claude only; they are never passed to `saveMedia`. Page-count checking (≤ 20 pages) is left to the API's own limits; the route enforces the byte limits.

- [ ] **Step 1: Write the failing extraction tests**

```ts
// test/wizard-extract.test.ts
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { handleExtract } from "@/src/server/wizard-ai";
import { base64Bytes, checkExtractFiles, EXTRACT_MAX_IMAGE_BYTES, EXTRACT_MAX_PDF_BYTES, extractMenu, postProcessExtract, type ExtractResult } from "@/src/wizard/extract";
import { makeDemo } from "./helpers";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PDF_STUB = Buffer.from("%PDF-1.4\n%stub\n").toString("base64");

type Reply = { stop_reason: string; content: unknown[] } | Error;
/** Records the request params and answers with the scripted message (or throws). */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); if (reply instanceof Error) throw reply; return reply; } } } };
  return { client: client as unknown as Anthropic, calls };
}
const toolUse = (input: unknown): Reply => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "extract_menu", input }] });

const RAW: ExtractResult = {
  categories: [
    { name_bg: " Кафе ", name_en: "Coffee", items: [
      { name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "С прясно мляко", desc_en: "With fresh milk", price_eur: 5, currency_seen: "BGN", allergens: [] },
      { name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, currency_seen: "EUR", allergens: [99, 7, 7] },
      { name_bg: "Торта", name_en: "Cake", desc_bg: "с орехи", desc_en: "with walnuts", price_eur: 9999, currency_seen: "unknown", allergens: [] },
      { name_bg: "Вода", name_en: "Water", desc_bg: "", desc_en: "", price_eur: 0, currency_seen: "unknown", allergens: [] },
    ] },
  ],
  notes_bg: "Една цена не се чете.",
  notes_en: "One price is unreadable.",
};

describe("extractMenu request shape", () => {
  it("sends image and document blocks, one strict tool, auto tool choice and the agent's beta flags", async () => {
    const { client, calls } = fakeClient(toolUse(RAW));
    const r = await extractMenu(client, { model: "claude-opus-5-5" }, [
      { media_type: "image/png", data: PNG_1x1 },
      { media_type: "application/pdf", data: PDF_STUB },
    ]);
    expect(r).not.toBe("error");
    const p = calls[0];
    expect(p).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "high" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", tool_choice: { type: "auto", disable_parallel_tool_use: true } });
    const tools = p.tools as { name: string; strict?: boolean; input_schema: { additionalProperties?: boolean; required?: string[] } }[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("extract_menu");
    expect(tools[0].strict).toBe(true);
    expect(tools[0].input_schema.additionalProperties).toBe(false);
    expect(tools[0].input_schema.required).toEqual(["categories", "notes_bg", "notes_en"]);
    expect(typeof p.system).toBe("string");
    expect(p.system as string).toContain("1.95583");
    expect(p.system as string).toContain("extract_menu");
    const msg = (p.messages as { role: string; content: { type: string; source?: Record<string, string>; text?: string }[] }[])[0];
    expect(msg.role).toBe("user");
    expect(msg.content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1x1 } });
    expect(msg.content[1]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF_STUB } });
    expect(msg.content[2].type).toBe("text");
  });
});

describe("postProcessExtract", () => {
  it("converts BGN, merges suggested allergens, clamps and rounds prices, trims names", () => {
    const out = postProcessExtract(RAW);
    expect(out.categories[0].name_bg).toBe("Кафе");
    const [cap, esp, cake, water] = out.categories[0].items;
    expect(cap.price_eur).toBe(2.56); // 5.00 BGN / 1.95583 = 2.5565 → 2.56
    expect(cap.currency_seen).toBe("BGN");
    expect(cap.allergens).toEqual([7]); // "мляко" / "milk" / "капучино" suggest 7
    expect(esp.price_eur).toBe(1.8);
    expect(esp.allergens).toEqual([7]); // 99 dropped, 7 deduplicated
    expect(cake.price_eur).toBe(500); // clamped to PRICE_MAX
    expect(cake.allergens).toEqual([8]); // walnuts
    expect(water.price_eur).toBe(0.1); // unreadable price → PRICE_MIN, the owner fixes it in review
    expect(out.notes_en).toBe("One price is unreadable.");
  });
});

describe("extractMenu outcomes", () => {
  const files = [{ media_type: "image/jpeg" as const, data: PNG_1x1 }];
  it("returns the post-processed result on tool_use", async () => {
    const { client } = fakeClient(toolUse(RAW));
    const r = await extractMenu(client, { model: "m" }, files);
    expect(r).not.toBe("refused");
    expect(r).not.toBe("error");
    expect((r as ExtractResult).categories[0].items[0].price_eur).toBe(2.56);
  });
  it("maps refusal, max_tokens, a missing tool call, invalid input and a thrown error", async () => {
    expect(await extractMenu(fakeClient({ stop_reason: "refusal", content: [] }).client, { model: "m" }, files)).toBe("refused");
    expect(await extractMenu(fakeClient({ stop_reason: "max_tokens", content: [] }).client, { model: "m" }, files)).toBe("error");
    expect(await extractMenu(fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "I cannot see a menu." }] }).client, { model: "m" }, files)).toBe("error");
    expect(await extractMenu(fakeClient(toolUse({ categories: "nope" })).client, { model: "m" }, files)).toBe("error");
    expect(await extractMenu(fakeClient(new Error("boom")).client, { model: "m" }, files)).toBe("error");
  });
  it("enforces the file limits before calling the model", async () => {
    const { client, calls } = fakeClient(toolUse(RAW));
    expect(base64Bytes(PNG_1x1)).toBe(70);
    expect(base64Bytes("QUJD")).toBe(3);
    expect(base64Bytes("QUI=")).toBe(2);
    expect(checkExtractFiles([])).toMatchObject({ code: "bad_request" });
    expect(checkExtractFiles(Array(7).fill(files[0]))).toMatchObject({ code: "bad_request", en: "Up to 6 files at a time." });
    const bigImage = { media_type: "image/jpeg" as const, data: "A".repeat(Math.ceil((EXTRACT_MAX_IMAGE_BYTES + 3) / 3) * 4) };
    expect(checkExtractFiles([bigImage])).toMatchObject({ code: "too_large" });
    const bigPdf = { media_type: "application/pdf" as const, data: "A".repeat(Math.ceil((EXTRACT_MAX_PDF_BYTES + 3) / 3) * 4) };
    expect(checkExtractFiles([bigPdf])).toMatchObject({ code: "too_large" });
    expect(checkExtractFiles([{ media_type: "image/png", data: PNG_1x1 }])).toBeNull();
    await expect(extractMenu(client, { model: "m" }, [bigPdf])).rejects.toThrow(/too large/);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/new/[id]/extract", () => {
  const url = "https://site.example/api/new/v/extract";
  const post = (body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  it("answers 503 without a key, 400 on a bad body, 200 with the result, 422 on refusal, 502 on error", async () => {
    const { store, venue } = await makeDemo();
    const noKey = await handleExtract(post({ files: [{ media_type: "image/png", data: PNG_1x1 }] }), { store, anthropic: null, model: "m" }, venue);
    expect(noKey.status).toBe(503);
    expect(await noKey.json()).toMatchObject({ error: { code: "ai_unavailable" } });
    const ok = { store, anthropic: fakeClient(toolUse(RAW)).client, model: "m" };
    expect((await handleExtract(post({ files: [] }), ok, venue)).status).toBe(400);
    expect((await handleExtract(post({ files: [{ media_type: "text/plain", data: "QUJD" }] }), ok, venue)).status).toBe(400);
    expect((await handleExtract(new Request(url, { method: "POST", body: "{" }), ok, venue)).status).toBe(400);
    const good = await handleExtract(post({ files: [{ media_type: "image/png", data: PNG_1x1 }] }), ok, venue);
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ categories: [{ name_bg: "Кафе", items: [{ price_eur: 2.56 }] }] });
    const refused = await handleExtract(post({ files: [{ media_type: "image/png", data: PNG_1x1 }] }), { ...ok, anthropic: fakeClient({ stop_reason: "refusal", content: [] }).client }, venue);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "refused" } });
    const failed = await handleExtract(post({ files: [{ media_type: "image/png", data: PNG_1x1 }] }), { ...ok, anthropic: fakeClient(new Error("down")).client }, venue);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: { code: "ai_error" } });
  });
});

const live = process.env.ANTHROPIC_API_KEY ? it : it.skip;
live("LIVE: a real call with a 1×1 PNG returns a structured (probably empty) menu", async () => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await extractMenu(client, { model: process.env.AGENT_MODEL ?? "claude-opus-5-5" }, [{ media_type: "image/png", data: PNG_1x1 }]);
  if (r === "refused" || r === "error") throw new Error(`live extract returned ${r}`);
  expect(Array.isArray(r.categories)).toBe(true);
  expect(typeof r.notes_en).toBe("string");
}, 120_000);
```

- [ ] **Step 2: Run it and see it fail**

`npm test -- test/wizard-extract.test.ts` → `Cannot find module '@/src/wizard/extract'`.

- [ ] **Step 3: Write `src/wizard/extract.ts`**

```ts
// src/wizard/extract.ts
// Reads menu photos / a PDF with Claude and returns structured items for the owner to review. Nothing is inserted here.
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ALLERGENS, isAllergenCode, suggestAllergens } from "../domain/allergens";
import { clampPrice, round2 } from "../domain/pricing";

export const BGN_PER_EUR = 1.95583;
export const EXTRACT_MAX_FILES = 6;
export const EXTRACT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const EXTRACT_MAX_PDF_BYTES = 10 * 1024 * 1024;
export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ExtractMediaType = (typeof IMAGE_MEDIA_TYPES)[number] | "application/pdf";

export interface ExtractFile {
  media_type: ExtractMediaType;
  /** base64, no data: prefix */
  data: string;
}
export const ExtractFilesSchema = z.object({
  files: z.array(z.object({ media_type: z.enum([...IMAGE_MEDIA_TYPES, "application/pdf"]), data: z.string().min(1) })).min(1).max(EXTRACT_MAX_FILES),
});

export interface ExtractResult {
  categories: {
    name_bg: string;
    name_en: string;
    items: { name_bg: string; name_en: string; desc_bg: string; desc_en: string; price_eur: number; currency_seen: "EUR" | "BGN" | "unknown"; allergens: number[] }[];
  }[];
  notes_bg: string;
  notes_en: string;
}

const ExtractedItem = z.object({
  name_bg: z.string().describe("Dish name in natural Bulgarian"),
  name_en: z.string().describe("Dish name in natural English"),
  desc_bg: z.string().describe("One short sentence in Bulgarian, or empty"),
  desc_en: z.string().describe("One short sentence in English, or empty"),
  price_eur: z.number().describe("The number printed on the menu, unchanged. The server converts BGN to EUR. 0 when unreadable"),
  currency_seen: z.enum(["EUR", "BGN", "unknown"]).describe("The currency shown next to the price"),
  allergens: z.array(z.number().int().min(1).max(14)).describe("EU allergen codes 1–14 you can tell from the name or description; empty when unsure"),
});
export const ExtractResultSchema = z.object({
  categories: z.array(z.object({ name_bg: z.string(), name_en: z.string(), items: z.array(ExtractedItem) })),
  notes_bg: z.string().describe("Anything the owner should check, in Bulgarian; empty when nothing"),
  notes_en: z.string().describe("The same in English"),
}) satisfies z.ZodType<ExtractResult>;

const tool = betaZodTool({
  name: "extract_menu",
  description: "Returns the menu read from the attached photos or PDF pages, grouped by the menu's own sections, in Bulgarian and English.",
  inputSchema: ExtractResultSchema,
  run: async () => "ok", // never executed: we read the tool_use block ourselves
});

const SYSTEM = `You read photos or PDF pages of a café, bar or restaurant menu and transcribe them as structured data by calling the extract_menu tool exactly once. Do not answer in prose.
Rules:
- Return every dish you can read, grouped by the menu's own sections, in the menu's order. Do not invent dishes, prices or ingredients.
- Write name_bg and desc_bg in natural Bulgarian and name_en and desc_en in natural English. When the menu has one language, write the other one yourself as a native speaker would; never transliterate and never leave a field in the wrong language.
- price_eur holds the number printed next to the dish, unchanged, even when the currency is лв or BGN; the server converts BGN at 1 EUR = 1.95583 BGN. Set currency_seen to "BGN" for лв/BGN/лева, "EUR" for €/EUR/евро, "unknown" when no currency is visible. When both are printed, use the EUR number and "EUR". A dish without a readable price gets 0.
- allergens: EU allergen codes ${ALLERGENS.map((a) => `${a.code}=${a.en}`).join(", ")}. Add a code only when the name or description makes it clear; leave the list empty when unsure.
- Descriptions are one short sentence or empty. Illegible or doubtful parts are described in notes_bg and notes_en (one or two sentences each), which are empty when there is nothing to say.`;

/** Decoded size of a base64 string without decoding it. */
export function base64Bytes(data: string): number {
  const s = data.replace(/\s+/g, "");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

/** Null when the files may be sent; otherwise the error the route returns (400). */
export function checkExtractFiles(files: ExtractFile[]): { code: "bad_request" | "too_large"; bg: string; en: string } | null {
  if (files.length === 0) return { code: "bad_request", bg: "Качете поне един файл.", en: "Upload at least one file." };
  if (files.length > EXTRACT_MAX_FILES) return { code: "bad_request", bg: `До ${EXTRACT_MAX_FILES} файла наведнъж.`, en: `Up to ${EXTRACT_MAX_FILES} files at a time.` };
  for (const f of files) {
    const bytes = base64Bytes(f.data);
    if (f.media_type === "application/pdf" && bytes > EXTRACT_MAX_PDF_BYTES) return { code: "too_large", bg: "PDF файлът е над 10 MB.", en: "The PDF is over 10 MB." };
    if (f.media_type !== "application/pdf" && bytes > EXTRACT_MAX_IMAGE_BYTES) return { code: "too_large", bg: "Снимката е над 5 MB.", en: "The image is over 5 MB." };
  }
  return null;
}

/** BGN → EUR, cents, clamp, allergen suggestions merged in, names trimmed. Pure. */
export function postProcessExtract(r: ExtractResult): ExtractResult {
  return {
    categories: r.categories.map((c) => ({
      name_bg: c.name_bg.trim(),
      name_en: c.name_en.trim(),
      items: c.items.map((it) => {
        const raw = Number.isFinite(it.price_eur) ? it.price_eur : 0;
        const eur = it.currency_seen === "BGN" ? raw / BGN_PER_EUR : raw;
        const text = `${it.name_en} ${it.desc_en} ${it.name_bg} ${it.desc_bg}`;
        const allergens = [...new Set([...it.allergens.filter(isAllergenCode), ...suggestAllergens(text)])].sort((a, b) => a - b);
        return { name_bg: it.name_bg.trim(), name_en: it.name_en.trim(), desc_bg: it.desc_bg.trim(), desc_en: it.desc_en.trim(), price_eur: clampPrice(round2(eur)), currency_seen: it.currency_seen, allergens };
      }),
    })),
    notes_bg: r.notes_bg.trim(),
    notes_en: r.notes_en.trim(),
  };
}

function contentBlocks(files: ExtractFile[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = files.map((f) =>
    f.media_type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
      : { type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } },
  );
  blocks.push({ type: "text", text: `Transcribe the menu in the ${files.length === 1 ? "attached file" : `${files.length} attached files`} by calling extract_menu once.` });
  return blocks;
}

/** Never throws for model-side problems: "refused" on a safety refusal, "error" on anything else. Throws only for a limit violation (the route checks first). */
export async function extractMenu(client: Anthropic, cfg: { model: string }, files: ExtractFile[]): Promise<ExtractResult | "refused" | "error"> {
  const limit = checkExtractFiles(files);
  if (limit) throw new Error(`extract: ${limit.en} (${limit.code === "too_large" ? "too large" : "bad request"})`);
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Forced tool_choice is rejected by claude-opus-5-5; the prompt asks for exactly one call and strict keeps the schema.
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.input_schema, strict: true }],
      system: SYSTEM,
      messages: [{ role: "user", content: contentBlocks(files) }],
    });
  } catch (e) {
    console.error("[wizard] extract call failed:", e instanceof Error ? e.message : e);
    return "error";
  }
  if (res.stop_reason === "refusal") return "refused";
  if (res.stop_reason === "max_tokens") return "error";
  const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "extract_menu");
  if (!call) return "error";
  const parsed = ExtractResultSchema.safeParse(call.input);
  if (!parsed.success) {
    console.error("[wizard] extract: tool input failed validation:", parsed.error.issues.length, "issues");
    return "error";
  }
  return postProcessExtract(parsed.data);
}
```

If `tool.input_schema`'s type is not assignable to the tool param, cast with `input_schema: tool.input_schema as Anthropic.Beta.BetaTool["input_schema"]`. If `strict` is not in `BetaTool` of SDK 0.133, spread it as `{ ...def, strict: true } as Anthropic.Beta.BetaToolUnion` and leave a comment; the test asserts the wire shape.

- [ ] **Step 4: Write `src/server/wizard-ai.ts` (handlers)**

```ts
// src/server/wizard-ai.ts
// Claude-backed wizard helpers: menu extraction and text drafting. The client is injected (ServerDeps.anthropic) so tests use a fake.
import type Anthropic from "@anthropic-ai/sdk";
import type { Venue } from "../domain/types";
import type { Store } from "../store/types";
import { checkExtractFiles, ExtractFilesSchema, extractMenu } from "../wizard/extract";
import { draftTexts, TEXTS_MAX_FACTS } from "../wizard/texts";
import { WizardError, wizardErrorResponse } from "./wizard";

export interface WizardAiDeps {
  store: Store;
  /** null when ANTHROPIC_API_KEY is not set (offline mode): the routes answer 503 and the UI hides the buttons. */
  anthropic: Anthropic | null;
  model: string;
}

const UNAVAILABLE = () => new WizardError("ai_unavailable" as never, 503, "Четенето с изкуствен интелект не е включено на този сървър.", "AI reading is not enabled on this server.");
const REFUSED = () => new WizardError("refused" as never, 422, "Не мога да обработя тези файлове. Опитайте с други снимки.", "I can't work with these files. Try different photos.");
const FAILED = () => new WizardError("ai_error" as never, 502, "Не успях да прочета менюто. Опитайте отново след малко.", "I couldn't read the menu. Please try again in a moment.");

export async function handleExtract(req: Request, d: WizardAiDeps, venue: Venue): Promise<Response> {
  void venue; // the guard already proved the caller owns this draft; nothing is stored here
  try {
    if (!d.anthropic) throw UNAVAILABLE();
    const body = await req.json().catch(() => null);
    const parsed = ExtractFilesSchema.safeParse(body);
    if (!parsed.success) throw new WizardError("bad_request", 400, "Качете снимки (JPEG, PNG, WebP, GIF) или PDF.", "Upload images (JPEG, PNG, WebP, GIF) or a PDF.");
    const limit = checkExtractFiles(parsed.data.files);
    if (limit) throw new WizardError(limit.code, 400, limit.bg, limit.en);
    const r = await extractMenu(d.anthropic, { model: d.model }, parsed.data.files);
    if (r === "refused") throw REFUSED();
    if (r === "error") throw FAILED();
    return Response.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export async function handleTexts(req: Request, d: WizardAiDeps, venue: Venue): Promise<Response> {
  try {
    if (!d.anthropic) throw UNAVAILABLE();
    const body = (await req.json().catch(() => null)) as { facts?: unknown } | null;
    const facts = typeof body?.facts === "string" ? body.facts.trim() : "";
    if (!facts) throw new WizardError("bad_request", 400, "Напишете няколко факта за заведението.", "Write a few facts about the venue.");
    if (facts.length > TEXTS_MAX_FACTS) throw new WizardError("bad_request", 400, `Фактите са до ${TEXTS_MAX_FACTS} знака.`, `Facts are limited to ${TEXTS_MAX_FACTS} characters.`);
    const lang = venue.wizard_draft?.default_lang ?? venue.default_lang;
    const r = await draftTexts(d.anthropic, { model: d.model }, facts, lang);
    if (r === "refused") throw new WizardError("refused" as never, 422, "Не мога да напиша текст по тези факти. Опитайте с други.", "I can't write from these facts. Try different ones.");
    if (r === "error") throw new WizardError("ai_error" as never, 502, "Не успях да напиша текстовете. Опитайте отново след малко.", "I couldn't write the texts. Please try again in a moment.");
    return Response.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}
```

Instead of the `as never` casts, extend the union in `src/server/wizard.ts`: `export type WizardErrorCode = ... | "ai_unavailable" | "refused" | "ai_error";` (edit Task 7's file: add the three members to the type) and drop the casts.

- [ ] **Step 5: Run the extraction tests**

`npm test -- test/wizard-extract.test.ts` → PASS (7 tests, 1 skipped). The `handleExtract` tests pass a demo venue; no cookie guard is involved at this layer.

- [ ] **Step 6: Write the failing texts tests**

```ts
// test/wizard-texts.test.ts
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { handleTexts } from "@/src/server/wizard-ai";
import { draftTexts, type DraftTexts } from "@/src/wizard/texts";
import { makeDemo } from "./helpers";

type Reply = { stop_reason: string; content: unknown[] } | Error;
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); if (reply instanceof Error) throw reply; return reply; } } } };
  return { client: client as unknown as Anthropic, calls };
}
const TEXTS: DraftTexts = {
  tagline_bg: " Кафе и тишина на ъгъла ", tagline_en: "Coffee and quiet on the corner",
  about_bg: "Малко квартално кафене.", about_en: "A small neighbourhood café.",
  welcome_bg: "Добре дошли!", welcome_en: "Welcome!",
  footer_note_bg: "Приемаме карти.", footer_note_en: "Cards accepted.",
};
const toolUse = (input: unknown): Reply => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "draft_texts", input }] });

describe("draftTexts", () => {
  it("sends the facts and the owner's language, one strict tool, auto tool choice", async () => {
    const { client, calls } = fakeClient(toolUse(TEXTS));
    const r = await draftTexts(client, { model: "claude-opus-5-5" }, "Кафене в Лозенец, печем баница сутрин, кучета добре дошли", "bg");
    expect(r).toEqual({ ...TEXTS, tagline_bg: "Кафе и тишина на ъгъла" });
    const p = calls[0];
    expect(p).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "high" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", tool_choice: { type: "auto", disable_parallel_tool_use: true } });
    const tools = p.tools as { name: string; strict?: boolean; input_schema: { required?: string[] } }[];
    expect(tools[0]).toMatchObject({ name: "draft_texts", strict: true });
    expect(tools[0].input_schema.required).toEqual(["tagline_bg", "tagline_en", "about_bg", "about_en", "welcome_bg", "welcome_en", "footer_note_bg", "footer_note_en"]);
    expect(p.system as string).toMatch(/40.{1,3}120 words/);
    const msg = (p.messages as { content: { type: string; text: string }[] }[])[0];
    expect(msg.content[0].text).toContain("Лозенец");
    expect(msg.content[0].text).toContain("Bulgarian");
  });
  it("maps refusal, errors, missing calls and empty texts", async () => {
    expect(await draftTexts(fakeClient({ stop_reason: "refusal", content: [] }).client, { model: "m" }, "f", "en")).toBe("refused");
    expect(await draftTexts(fakeClient({ stop_reason: "max_tokens", content: [] }).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "no" }] }).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient(toolUse({ ...TEXTS, tagline_bg: "" })).client, { model: "m" }, "f", "en")).toBe("error");
    expect(await draftTexts(fakeClient(new Error("boom")).client, { model: "m" }, "f", "en")).toBe("error");
  });
});

describe("POST /api/new/[id]/texts", () => {
  const url = "https://site.example/api/new/v/texts";
  const post = (body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  it("answers 503 without a key, 400 without facts, 200 with the texts", async () => {
    const { store, venue } = await makeDemo();
    expect((await handleTexts(post({ facts: "x" }), { store, anthropic: null, model: "m" }, venue)).status).toBe(503);
    const ok = { store, anthropic: fakeClient(toolUse(TEXTS)).client, model: "m" };
    expect((await handleTexts(post({ facts: "   " }), ok, venue)).status).toBe(400);
    expect((await handleTexts(post({ facts: "x".repeat(2001) }), ok, venue)).status).toBe(400);
    const good = await handleTexts(post({ facts: "Кафене в Лозенец" }), ok, venue);
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ tagline_bg: "Кафе и тишина на ъгъла", footer_note_en: "Cards accepted." });
  });
});
```

- [ ] **Step 7: Write `src/wizard/texts.ts`**

```ts
// src/wizard/texts.ts
// "Write for me": tagline, about, welcome and footer note in both languages from a few facts the owner typed.
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Lang } from "../domain/types";

export const TEXTS_MAX_FACTS = 2000;

export interface DraftTexts {
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  welcome_bg: string;
  welcome_en: string;
  footer_note_bg: string;
  footer_note_en: string;
}

export const DraftTextsSchema = z.object({
  tagline_bg: z.string().describe("Up to 12 words, Bulgarian"),
  tagline_en: z.string().describe("Up to 12 words, English"),
  about_bg: z.string().describe("40–120 words about the place, Bulgarian"),
  about_en: z.string().describe("40–120 words about the place, English"),
  welcome_bg: z.string().describe("One or two sentences greeting a guest, Bulgarian"),
  welcome_en: z.string().describe("One or two sentences greeting a guest, English"),
  footer_note_bg: z.string().describe("One short practical line (cards, pets, wifi, terrace), Bulgarian; may be empty"),
  footer_note_en: z.string().describe("The same line in English; may be empty"),
}) satisfies z.ZodType<DraftTexts>;

const tool = betaZodTool({
  name: "draft_texts",
  description: "Returns the venue's website texts in Bulgarian and English.",
  inputSchema: DraftTextsSchema,
  run: async () => "ok",
});

const SYSTEM = `You write the short texts for a small café, bar or restaurant website in Bulgaria, from facts the owner typed. Reply by calling the draft_texts tool exactly once; no prose.
Rules:
- Write each language natively: Bulgarian that sounds like a Bulgarian wrote it, English that sounds like an English speaker wrote it. Never translate word for word; the two versions may differ in wording as long as the facts match.
- Use only the facts given. Do not invent awards, years, ratings, prices or opening hours. If a fact is missing, leave it out rather than guessing.
- tagline: up to 12 words, no exclamation marks. about: 40–120 words, warm and plain, no marketing clichés. welcome: one or two sentences. footer_note: one short practical line taken from the facts (cards, pets, wifi, terrace); empty when the facts say nothing practical.
- Plain text only: no emoji, no markdown, no quotes around the texts.`;

export async function draftTexts(client: Anthropic, cfg: { model: string }, facts: string, lang: Lang): Promise<DraftTexts | "refused" | "error"> {
  const language = lang === "bg" ? "Bulgarian" : "English";
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.input_schema, strict: true }],
      system: SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: `The owner wrote these facts in ${language}:\n\n${facts.trim().slice(0, TEXTS_MAX_FACTS)}\n\nCall draft_texts once with all eight texts.` }] }],
    });
  } catch (e) {
    console.error("[wizard] texts call failed:", e instanceof Error ? e.message : e);
    return "error";
  }
  if (res.stop_reason === "refusal") return "refused";
  if (res.stop_reason === "max_tokens") return "error";
  const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "draft_texts");
  if (!call) return "error";
  const parsed = DraftTextsSchema.safeParse(call.input);
  if (!parsed.success) return "error";
  const out = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v.trim()])) as unknown as DraftTexts;
  // A footer note may be empty; everything else must be there, or the owner would get blank fields.
  if (!out.tagline_bg || !out.tagline_en || !out.about_bg || !out.about_en || !out.welcome_bg || !out.welcome_en) return "error";
  return out;
}
```

- [ ] **Step 8: Run the texts tests**

`npm test -- test/wizard-texts.test.ts` → PASS (3 tests).

- [ ] **Step 9: Wire `ServerDeps.anthropic` and the two routes**

In `src/server/deps.ts` change the import and the interface:

```ts
// old
import type Anthropic from "@anthropic-ai/sdk";
// new
import Anthropic from "@anthropic-ai/sdk";
```

```ts
// old
export interface ServerDeps {
  config: Config;
  store: Store;
  messenger: Messenger;
  bot: Bot;
// new
export interface ServerDeps {
  config: Config;
  store: Store;
  messenger: Messenger;
  bot: Bot;
  /** Shared Anthropic client for the wizard helpers; null without ANTHROPIC_API_KEY (offline mode). Tests inject `client`. */
  anthropic: Anthropic | null;
```

and in `makeServerDeps`, right after `const log = ...`:

```ts
  const anthropic = o.client ?? (config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null);
```

and in the returned object add `anthropic`:

```ts
// old
  return { config, store: s, messenger, bot, handleRun, isMemory };
// new
  return { config, store: s, messenger, bot, handleRun, isMemory, anthropic };
```

(If Task 6 already extended this return with `deployer` and `startDeploy`, add `anthropic` next to them.) Then the routes:

```ts
// app/api/new/[id]/extract/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { requireDraft } from "@/src/server/wizard";
import { handleExtract } from "@/src/server/wizard-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/extract">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleExtract(req, { store: deps.store, anthropic: deps.anthropic, model: deps.config.agentModel }, guard.venue);
}
```

```ts
// app/api/new/[id]/texts/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { requireDraft } from "@/src/server/wizard";
import { handleTexts } from "@/src/server/wizard-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/texts">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleTexts(req, { store: deps.store, anthropic: deps.anthropic, model: deps.config.agentModel }, guard.venue);
}
```

`test/server-deps.test.ts` builds deps in memory mode: add one assertion there — `expect(deps.anthropic).toBeNull()` for the keyless memory run (and, where that test passes `client`, `expect(deps.anthropic).toBe(client)`).

- [ ] **Step 10: Typecheck, all tests, optional live check, commit**

`npm run typecheck` → clean. `npm test` → green (the live test stays skipped). With a key: `ANTHROPIC_API_KEY=… npx vitest run test/wizard-extract.test.ts -t LIVE` → the live test passes (a 1×1 PNG yields an empty `categories` array and a note). Manual: in `npm run dev` with the key, POST `/api/new/<id>/extract` with a real menu photo base64 and the draft cookie; verify BGN menus come back as EUR with `currency_seen: "BGN"`.

```bash
git add src/wizard/extract.ts src/wizard/texts.ts src/server/wizard-ai.ts src/server/wizard.ts src/server/deps.ts app/api/new/[id]/extract/route.ts app/api/new/[id]/texts/route.ts test/wizard-extract.test.ts test/wizard-texts.test.ts test/server-deps.test.ts
git commit -m "Wizard: menu extraction from photos/PDF and text drafting with Claude (fake client in tests)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: fable

---


### Task 9: Wizard UI (template chooser, stepper, live preview, menu table, extraction review)

> **Rulings that apply to this task:** R1, R12, R13 (see "Controller rulings" above; they override conflicting sentences below).

**Design task.** Before writing any component the implementer invokes, in this order, `impeccable` (it reads `.impeccable.md` in the repo root: light brand theme, one OKLCH brand hue with tinted neutrals, distinctive display face + quiet body face, both with Cyrillic), `design-taste-frontend`, `emil-design-eng`, `high-end-visual-design`, `apple-design`, `frontend-design`, and says so in the report. The reviewer runs `review-animations` and `web-design-guidelines` on `app/new/**`. This task fixes the structure below (components, props, data, states, i18n keys, accessibility and performance acceptance criteria, render tests); palette, type scale, spacing and motion curves are the implementer's under the skills, with these hard limits: every font via `next/font/google` with `subsets: ["latin", "cyrillic"]`; 360 px wide works without horizontal scroll; 44 px touch targets; `prefers-reduced-motion` respected; WCAG 2.2 AA contrast; Lighthouse a11y ≥ 95 on `/new` and `/new/[id]`.

**Design Read (one line each):** *Chooser* — three live storefronts side by side, the page itself calm and neutral so each template's own voice carries; one decision, one button per card, hover lifts the card a few pixels on a spring, never zooms the content. *Wizard* — a quiet form column on the left that reads like a well-set questionnaire (one group per step, generous rhythm, inputs with real labels), the chosen template living on the right; progress is named, saving is announced, nothing moves except to explain state.

**Files:**
- Create: `src/i18n/wizard.ts`, `src/wizard/edit.ts`, `src/wizard/demo-state.ts`, `app/new/page.tsx`, `app/new/[id]/page.tsx`, `app/new/components/api.ts`, `app/new/components/types.ts`, `app/new/components/useWizardText.ts`, `app/new/components/Field.tsx`, `app/new/components/MediaThumb.tsx`, `app/new/components/ScaledFrame.tsx`, `app/new/components/TemplateChooser.tsx`, `app/new/components/NoDraft.tsx`, `app/new/components/Stepper.tsx`, `app/new/components/Preview.tsx`, `app/new/components/Wizard.tsx`, `app/new/components/Steps/Basics.tsx`, `app/new/components/Steps/Look.tsx`, `app/new/components/Steps/Hours.tsx`, `app/new/components/Steps/Menu.tsx`, `app/new/components/Steps/ExtractReview.tsx`, `app/new/components/Steps/Texts.tsx`, `app/new/components/Steps/Photos.tsx`, `app/new/components/Steps/Review.tsx`
- Test: `test/wizard-ui.test.ts`, `test/wizard-edit.test.ts`

**Interfaces:**
- Consumes (Task 2): `TEMPLATES`, `getTemplate(id)`, `TemplateDef` (`name_bg`, `name_en`, `tagline_bg`, `tagline_en`, `accentDefault`, `Component`), `TemplateProps` with `preview?: boolean` from `src/templates/index.ts`; `mediaUrl(m, { preview: true })` accepting `blob:` URLs (used inside the templates, not here).
- Consumes (Task 7): `WizardDraft`, `WizardCategory`, `WizardItem`, `WizardStep`, `emptyDraft`, `validateForPublish`, `stepForPath`, `PublishError`, `TEMPLATE_ACCENT_DEFAULTS`, `SLUG_RE` from `src/wizard/schema.ts`; `buildPreviewState` from `src/wizard/preview.ts`; `readDraftFromCookies` from `src/server/draft-cookie.ts`; `sha256Hex` from `src/server/hash.ts`; routes `POST /api/new`, `GET/PUT /api/new/[id]`, `POST /api/new/[id]/media`, `POST /api/new/[id]/publish` and their JSON shapes.
- Consumes (Task 8): `ExtractFile`, `ExtractResult`, `EXTRACT_MAX_FILES`, `IMAGE_MEDIA_TYPES` from `src/wizard/extract.ts`; `DraftTexts` from `src/wizard/texts.ts`; `ServerDeps.anthropic` (to tell the UI whether the AI buttons work).
- Consumes (existing): `LangProvider`, `LangToggle`, `useLang` from `src/i18n`; `ALLERGENS`, `allergenName` from `src/domain/allergens`; `WEEKDAYS`, `BUSINESS_TYPES`, `TEMPLATE_IDS`, `Media`, `SiteState` from `src/domain/types`; `formatPrice`, `weekdayLabel` from `src/domain/format`; `seedDemo` + `InMemoryStore` for the chooser's demo state; `MAX_IMAGE_BYTES` from `src/bot/media`.
- Produces: the `/new` and `/new/[id]` pages; `WIZARD_BG`, `WIZARD_EN`, `WizardKey`, `wizardText(lang, key, vars?)` (`src/i18n/wizard.ts`); `newKey`, `slugify`, `moveIndex`, `blankCategory`, `blankItem`, `mergeExtracted` (`src/wizard/edit.ts`); `demoSiteState()` (`src/wizard/demo-state.ts`); `api`, `fileToBase64`, `ApiError`, `ApiResult` (`app/new/components/api.ts`); `StepProps` (`app/new/components/types.ts`); `useT()`. Task 10's done page reuses `useT`, `api`, `Field.tsx` and the `NoDraft` component; the dashboard's "Your site" card (Task 10) reuses the `chooser.template.*` names.

Decisions this task fixes:
- **i18n:** a separate dictionary `src/i18n/wizard.ts` (not `src/i18n/dicts.ts`), because `dicts.ts` is copied into every deployed shell (manifest `src/i18n`) and the wizard's ~110 strings do not belong on venue sites. `useT()` composes `useLang().lang` (so the existing `LangToggle` switches the wizard too) with `wizardText`. The wizard-ui test asserts BG and EN have the same keys and no empty strings. Bulgarian is written first in the file.
- **Chooser demo state:** built at request time with `seedDemo(new InMemoryStore())` in `src/wizard/demo-state.ts` (module-level promise cache, so one seed per server process) and passed to the client chooser as a prop. No JSON fixture: the demo café has one source of truth (`src/seed/demo.ts`). The chooser swaps `venue.template` and `theme.accent` per card so each template shows its own default accent.
- **Templates and tests:** `src/templates/index.ts` loads `next/font/google`, whose exports are `undefined` under vitest, so `Preview.tsx` and `TemplateChooser.tsx` are the only wizard files that import `@/src/templates`, and `test/wizard-ui.test.ts` renders the step components only (never `Wizard`, `Preview` or the chooser). Everything else under `app/new/**` must stay importable in node.
- **Scaling the cards:** a `ScaledFrame` measures its own width with `ResizeObserver` and applies `transform: scale(width / 1280)` to a 1280 × 1600 px inner box that is `inert` and `aria-hidden` (the card's button is the only control). No CSS `zoom` (inconsistent in Safari for `position: fixed` children).
- **Local image previews:** the wizard keeps `localUrls: Record<mediaId, blobUrl>` for files uploaded in this session and hands the steps and the preview a `media` array whose `public_url` is the blob URL for those rows; the templates' `mediaUrl(m, { preview: true })` accepts `blob:`. This is what makes previews work in memory mode (`memory://` URLs are not served) and shows the photo before Supabase's CDN has it.
- **Autosave:** every `update(patch)` merges into local state, accumulates into a pending patch and PUTs it 800 ms after the last change; changing step flushes at once; the PUT uses `keepalive: true` so a tab close still sends it. Status is announced in an `aria-live="polite"` region (`Saving…` / `Saved` / `Could not save`). Server field errors (`details[]` from a 400/409 PUT) are shown next to the field (`slug` taken) via `serverErrors`.
- **Step validation:** `validateForPublish(draft)` filtered by `stepForPath` gives the current step's errors; *Next* shows them (`role="alert"`) and refuses to advance while they exist; *Back* and the stepper never block. The menu step therefore needs at least one dish before *Next*.
- **Publish:** the response's `admin_url` carries the key; `Wizard` pushes `/new/${id}/done?key=<key>` (Task 10's page). `app/new/[id]/page.tsx` redirects an already-live venue to `/new/${id}/done` (that page authenticates with the cookie; with `?key=` it can also show the dashboard link).
- **AI buttons:** `app/new/[id]/page.tsx` passes `aiAvailable={deps.anthropic !== null}`; when false, the "Upload your current menu" dropzone and "Write for me" render a one-line explanation instead of a control, so offline mode is honest.
- **Removing things:** no `window.confirm`; a Remove button turns into an inline "Remove N dishes?" Yes/No pair (keyboard reachable, announced).

- [ ] **Step 1: Write the wizard dictionary**

```ts
// src/i18n/wizard.ts
// Wizard-only copy (BG first). Kept out of dicts.ts, which is bundled into every deployed venue site.
import type { Lang } from "../domain/types";

const bg = {
  "brand": "Site Manager",
  "chooser.title": "Създайте сайта на заведението си",
  "chooser.h1": "Изберете как да изглежда сайтът ви",
  "chooser.lead": "Три дизайна, показани с примерно кафене. Избирате един, попълвате данните си и за минути сайтът е онлайн. После го управлявате от Telegram.",
  "chooser.start": "Започнете с този дизайн",
  "chooser.starting": "Създаваме черновата…",
  "chooser.demoNote": "Примерът е Кафене „Ъгъла“, измислено заведение.",
  "chooser.template.classic": "Класик",
  "chooser.template.nocturne": "Ноктюрн",
  "chooser.template.lumen": "Лумен",
  "chooser.failed": "Не успяхме да започнем. Опитайте отново.",
  "chooser.limited": "Днес не можем да създадем нов сайт от този адрес. Опитайте по-късно.",
  "step.basics": "Основни данни",
  "step.look": "Външен вид",
  "step.hours": "Работно време",
  "step.menu": "Меню",
  "step.texts": "Текстове",
  "step.photos": "Снимки",
  "step.review": "Преглед и създаване",
  "nav.steps": "Стъпки",
  "nav.stepOf": "Стъпка {n} от {total}",
  "nav.back": "Назад",
  "nav.next": "Напред",
  "nav.fixFirst": "Преди да продължите, поправете:",
  "save.saving": "Записваме…",
  "save.saved": "Записано",
  "save.error": "Не успяхме да запишем. Проверете връзката.",
  "preview.title": "Преглед на сайта",
  "preview.open": "Преглед",
  "preview.close": "Затвори прегледа",
  "preview.home": "Начало",
  "preview.menu": "Меню",
  "preview.note": "Това е вашият сайт с данните, които попълвате. Обновява се докато пишете.",
  "basics.name": "Име на заведението",
  "basics.slug": "Адрес на сайта",
  "basics.slugHint": "Малки латински букви, цифри и тирета. Сайтът ще е на {url}",
  "basics.lang": "Основен език на сайта",
  "basics.lang.bg": "Български (с английски превод)",
  "basics.lang.en": "Английски (с български превод)",
  "basics.type": "Вид заведение",
  "basics.type.cafe": "Кафене",
  "basics.type.bar": "Бар",
  "basics.type.restaurant": "Ресторант",
  "basics.address": "Адрес",
  "basics.phone": "Телефон",
  "basics.instagram": "Instagram (без @)",
  "basics.mapsUrl": "Линк към картата",
  "basics.mapsHint": "Отворете мястото в Google Maps и копирайте адреса от браузъра.",
  "look.accent": "Основен цвят",
  "look.accentDefault": "Цветът на дизайна",
  "look.accentCustom": "Друг цвят",
  "look.accentHex": "Цвят като #rrggbb",
  "look.logo": "Лого",
  "look.cover": "Корица",
  "look.coverHint": "Широка снимка за най-отгоре на сайта. Най-добре 1600 × 900 или по-голяма.",
  "look.upload": "Качи",
  "look.replace": "Смени",
  "look.remove": "Премахни",
  "look.uploading": "Качваме…",
  "look.uploadFailed": "Качването не се получи. Опитайте с друга снимка.",
  "look.none": "Няма снимка",
  "hours.day": "Ден",
  "hours.open": "Отваря",
  "hours.close": "Затваря",
  "hours.closed": "Почивен ден",
  "hours.copyMon": "Копирай понеделник във вторник–петък",
  "hours.day.mon": "Понеделник",
  "hours.day.tue": "Вторник",
  "hours.day.wed": "Сряда",
  "hours.day.thu": "Четвъртък",
  "hours.day.fri": "Петък",
  "hours.day.sat": "Събота",
  "hours.day.sun": "Неделя",
  "menu.categories": "Категории",
  "menu.addCategory": "Нова категория",
  "menu.category.nameBg": "Име на категорията (БГ)",
  "menu.category.nameEn": "Име на категорията (EN)",
  "menu.removeCategory": "Премахни категорията",
  "menu.removeCategoryAsk": "Премахване на категорията и {n} продукта?",
  "menu.yes": "Да, премахни",
  "menu.no": "Не",
  "menu.moveUp": "Премести нагоре",
  "menu.moveDown": "Премести надолу",
  "menu.items": "Продукти",
  "menu.addItem": "Нов продукт",
  "menu.item.nameBg": "Име (БГ)",
  "menu.item.nameEn": "Име (EN)",
  "menu.item.descBg": "Описание (БГ)",
  "menu.item.descEn": "Описание (EN)",
  "menu.item.price": "Цена, €",
  "menu.item.allergens": "Алергени",
  "menu.item.details": "Описание и алергени",
  "menu.item.remove": "Премахни продукта",
  "menu.empty": "Още няма продукти. Добавете ги ръчно или качете сегашното си меню.",
  "menu.noCategory": "Първо добавете категория.",
  "menu.upload.title": "Качете сегашното си меню",
  "menu.upload.hint": "Снимки или PDF, до {n} файла. Claude ги прочита, вие проверявате резултата преди да влезе в менюто.",
  "menu.upload.choose": "Изберете файлове",
  "menu.upload.working": "Четем менюто…",
  "menu.upload.failed": "Не успяхме да прочетем менюто. Опитайте с по-ясни снимки.",
  "menu.upload.unavailable": "Четенето на меню от снимка не е включено на този сървър. Добавете продуктите ръчно.",
  "menu.upload.badFile": "Само снимки (JPEG, PNG, WebP, GIF) или PDF.",
  "extract.title": "Проверете какво прочетохме",
  "extract.lead": "Поправете каквото трябва, махнете отметката на ненужното и добавете останалото в менюто.",
  "extract.include": "Включи",
  "extract.acceptAll": "Добави всичко",
  "extract.acceptSelected": "Добави избраните ({n})",
  "extract.discard": "Откажи",
  "extract.notes": "Бележки от четенето",
  "extract.bgn": "Преизчислено от лева по 1,95583",
  "extract.empty": "Не разпознахме продукти. Опитайте с по-ясна снимка.",
  "texts.facts": "Няколко факта за заведението",
  "texts.factsHint": "Например: квартално кафене в Лозенец, печем баница сутрин, кафе от местна пържилня, кучета добре дошли. На български или английски.",
  "texts.write": "Напиши вместо мен",
  "texts.writing": "Пишем…",
  "texts.writeFailed": "Не се получи. Опитайте с още факти.",
  "texts.unavailable": "Писането с изкуствен интелект не е включено на този сървър.",
  "texts.tagline.bg": "Кратко мото (БГ)",
  "texts.tagline.en": "Кратко мото (EN)",
  "texts.about.bg": "За нас (БГ)",
  "texts.about.en": "За нас (EN)",
  "texts.welcome.bg": "Поздрав на началната страница (БГ)",
  "texts.welcome.en": "Поздрав на началната страница (EN)",
  "texts.footer.bg": "Бележка най-долу (БГ)",
  "texts.footer.en": "Бележка най-долу (EN)",
  "texts.bothHint": "Попълнете и двата езика; ако оставите единия празен, ще покажем другия.",
  "photos.title": "Галерия",
  "photos.hint": "Снимки на мястото, храната, терасата. Показват се в този ред.",
  "photos.add": "Добави снимки",
  "photos.empty": "Още няма снимки в галерията.",
  "photos.remove": "Махни от галерията",
  "photos.noPreview": "Няма преглед",
  "photos.photo": "Снимка {n}",
  "review.title": "Всичко готово?",
  "review.lead": "Прегледайте и натиснете „Създай сайта ми“. След това ще получите код за Telegram, с който ботът публикува сайта и поема управлението му.",
  "review.name": "Заведение",
  "review.address": "Адрес на сайта",
  "review.template": "Дизайн",
  "review.hours": "Работно време",
  "review.hoursSummary": "{open} работни дни, {closed} почивни",
  "review.menu": "Меню",
  "review.menuSummary": "{items} продукта в {cats} категории",
  "review.photos": "Снимки",
  "review.photosSummary": "{n} в галерията",
  "review.fix": "Поправи",
  "review.problems": "Преди да създадем сайта:",
  "review.create": "Създай сайта ми",
  "review.creating": "Създаваме…",
  "review.failed": "Не се получи. Опитайте отново.",
  "nodraft.title": "Тази чернова не е налична",
  "nodraft.body": "Линкът е от друго устройство или черновата е по-стара от 7 дни. Започнете отначало, отнема минути.",
  "nodraft.cta": "Изберете дизайн",
  "a11y.required": "задължително",
  "a11y.preview": "Преглед на дизайна {name} с примерното кафене",
};
export type WizardKey = keyof typeof bg;

const en: Record<WizardKey, string> = {
  "brand": "Site Manager",
  "chooser.title": "Create your venue's website",
  "chooser.h1": "Choose how your site should look",
  "chooser.lead": "Three designs, shown with a sample café. Pick one, fill in your details, and your site is online in minutes. After that you run it from Telegram.",
  "chooser.start": "Start with this template",
  "chooser.starting": "Creating your draft…",
  "chooser.demoNote": "The sample is Кафене „Ъгъла“, a fictional café.",
  "chooser.template.classic": "Classic",
  "chooser.template.nocturne": "Nocturne",
  "chooser.template.lumen": "Lumen",
  "chooser.failed": "We couldn't start. Please try again.",
  "chooser.limited": "We can't create another site from this address today. Please try later.",
  "step.basics": "Basics",
  "step.look": "Look",
  "step.hours": "Opening hours",
  "step.menu": "Menu",
  "step.texts": "Texts",
  "step.photos": "Photos",
  "step.review": "Review and create",
  "nav.steps": "Steps",
  "nav.stepOf": "Step {n} of {total}",
  "nav.back": "Back",
  "nav.next": "Next",
  "nav.fixFirst": "Before you continue, fix:",
  "save.saving": "Saving…",
  "save.saved": "Saved",
  "save.error": "Could not save. Check your connection.",
  "preview.title": "Site preview",
  "preview.open": "Preview",
  "preview.close": "Close preview",
  "preview.home": "Home",
  "preview.menu": "Menu",
  "preview.note": "This is your site with what you fill in. It updates as you type.",
  "basics.name": "Venue name",
  "basics.slug": "Web address",
  "basics.slugHint": "Lowercase letters, digits and dashes. Your site will be at {url}",
  "basics.lang": "Main language of the site",
  "basics.lang.bg": "Bulgarian (with an English version)",
  "basics.lang.en": "English (with a Bulgarian version)",
  "basics.type": "Type of venue",
  "basics.type.cafe": "Café",
  "basics.type.bar": "Bar",
  "basics.type.restaurant": "Restaurant",
  "basics.address": "Address",
  "basics.phone": "Phone",
  "basics.instagram": "Instagram (without @)",
  "basics.mapsUrl": "Map link",
  "basics.mapsHint": "Open the place in Google Maps and copy the address from the browser.",
  "look.accent": "Accent colour",
  "look.accentDefault": "The template's colour",
  "look.accentCustom": "Custom colour",
  "look.accentHex": "Colour as #rrggbb",
  "look.logo": "Logo",
  "look.cover": "Cover photo",
  "look.coverHint": "A wide photo for the top of the site. 1600 × 900 or larger works best.",
  "look.upload": "Upload",
  "look.replace": "Replace",
  "look.remove": "Remove",
  "look.uploading": "Uploading…",
  "look.uploadFailed": "The upload didn't work. Try another photo.",
  "look.none": "No photo",
  "hours.day": "Day",
  "hours.open": "Opens",
  "hours.close": "Closes",
  "hours.closed": "Closed",
  "hours.copyMon": "Copy Monday to Tuesday–Friday",
  "hours.day.mon": "Monday",
  "hours.day.tue": "Tuesday",
  "hours.day.wed": "Wednesday",
  "hours.day.thu": "Thursday",
  "hours.day.fri": "Friday",
  "hours.day.sat": "Saturday",
  "hours.day.sun": "Sunday",
  "menu.categories": "Categories",
  "menu.addCategory": "New category",
  "menu.category.nameBg": "Category name (BG)",
  "menu.category.nameEn": "Category name (EN)",
  "menu.removeCategory": "Remove category",
  "menu.removeCategoryAsk": "Remove the category and its {n} dishes?",
  "menu.yes": "Yes, remove",
  "menu.no": "No",
  "menu.moveUp": "Move up",
  "menu.moveDown": "Move down",
  "menu.items": "Dishes",
  "menu.addItem": "New dish",
  "menu.item.nameBg": "Name (BG)",
  "menu.item.nameEn": "Name (EN)",
  "menu.item.descBg": "Description (BG)",
  "menu.item.descEn": "Description (EN)",
  "menu.item.price": "Price, €",
  "menu.item.allergens": "Allergens",
  "menu.item.details": "Description and allergens",
  "menu.item.remove": "Remove dish",
  "menu.empty": "No dishes yet. Add them by hand or upload your current menu.",
  "menu.noCategory": "Add a category first.",
  "menu.upload.title": "Upload your current menu",
  "menu.upload.hint": "Photos or a PDF, up to {n} files. Claude reads them; you check the result before it goes into the menu.",
  "menu.upload.choose": "Choose files",
  "menu.upload.working": "Reading your menu…",
  "menu.upload.failed": "We couldn't read the menu. Try clearer photos.",
  "menu.upload.unavailable": "Reading a menu from a photo is not enabled on this server. Add the dishes by hand.",
  "menu.upload.badFile": "Images (JPEG, PNG, WebP, GIF) or a PDF only.",
  "extract.title": "Check what we read",
  "extract.lead": "Fix anything that's off, untick what you don't want, then add the rest to your menu.",
  "extract.include": "Include",
  "extract.acceptAll": "Add everything",
  "extract.acceptSelected": "Add selected ({n})",
  "extract.discard": "Discard",
  "extract.notes": "Notes from the reading",
  "extract.bgn": "Converted from BGN at 1.95583",
  "extract.empty": "We didn't find any dishes. Try a clearer photo.",
  "texts.facts": "A few facts about the venue",
  "texts.factsHint": "For example: neighbourhood café in Lozenets, we bake banitsa every morning, coffee from a local roaster, dogs welcome. In Bulgarian or English.",
  "texts.write": "Write for me",
  "texts.writing": "Writing…",
  "texts.writeFailed": "That didn't work. Try adding more facts.",
  "texts.unavailable": "AI writing is not enabled on this server.",
  "texts.tagline.bg": "Tagline (BG)",
  "texts.tagline.en": "Tagline (EN)",
  "texts.about.bg": "About us (BG)",
  "texts.about.en": "About us (EN)",
  "texts.welcome.bg": "Home page greeting (BG)",
  "texts.welcome.en": "Home page greeting (EN)",
  "texts.footer.bg": "Footer note (BG)",
  "texts.footer.en": "Footer note (EN)",
  "texts.bothHint": "Fill in both languages; if you leave one empty, we show the other.",
  "photos.title": "Gallery",
  "photos.hint": "Photos of the place, the food, the terrace. Shown in this order.",
  "photos.add": "Add photos",
  "photos.empty": "No gallery photos yet.",
  "photos.remove": "Remove from gallery",
  "photos.noPreview": "No preview",
  "photos.photo": "Photo {n}",
  "review.title": "All set?",
  "review.lead": "Check everything and press “Create my site”. You'll then get a Telegram code; the bot publishes the site and takes over running it.",
  "review.name": "Venue",
  "review.address": "Web address",
  "review.template": "Design",
  "review.hours": "Opening hours",
  "review.hoursSummary": "{open} open days, {closed} closed",
  "review.menu": "Menu",
  "review.menuSummary": "{items} dishes in {cats} categories",
  "review.photos": "Photos",
  "review.photosSummary": "{n} in the gallery",
  "review.fix": "Fix",
  "review.problems": "Before we create the site:",
  "review.create": "Create my site",
  "review.creating": "Creating…",
  "review.failed": "That didn't work. Please try again.",
  "nodraft.title": "This draft is not available",
  "nodraft.body": "The link is from another device, or the draft is older than 7 days. Start again, it takes minutes.",
  "nodraft.cta": "Choose a design",
  "a11y.required": "required",
  "a11y.preview": "Preview of the {name} design with the sample café",
};

export const WIZARD_BG = bg;
export const WIZARD_EN = en;
export const WIZARD = { bg, en } as const;

export function wizardText(lang: Lang, key: WizardKey, vars?: Record<string, string | number>): string {
  const s = WIZARD[lang][key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
```

- [ ] **Step 2: Write the pure edit helpers and their test**

```ts
// test/wizard-edit.test.ts
import { describe, expect, it } from "vitest";
import { blankCategory, blankItem, mergeExtracted, moveIndex, newKey, slugify } from "@/src/wizard/edit";
import { emptyDraft } from "@/src/wizard/schema";

describe("edit helpers", () => {
  it("slugifies Bulgarian and Latin names into valid slugs", () => {
    expect(slugify("Кафене „Ъгъла“")).toBe("kafene-agala");
    expect(slugify("The High End Bar")).toBe("the-high-end-bar");
    expect(slugify("  Café Lumière!  ")).toBe("cafe-lumiere");
    expect(slugify("Щастие & Чаша")).toBe("shtastie-chasha");
    expect(slugify("---")).toBe("");
    expect(slugify("x".repeat(60))).toHaveLength(39);
  });
  it("moves list entries and clamps", () => {
    expect(moveIndex([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveIndex([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveIndex([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveIndex([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveIndex([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
  });
  it("makes unique keys and blank rows", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newKey()));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^k[a-z0-9]{8,}$/);
    expect(blankItem()).toMatchObject({ name_bg: "", name_en: "", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], image_media_id: null });
    expect(blankCategory()).toMatchObject({ name_bg: "", name_en: "", items: [] });
  });
  it("merges an extraction into existing categories by name and appends new ones", () => {
    const d = emptyDraft("classic");
    d.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }];
    const merged = mergeExtracted(d.categories, {
      categories: [
        { name_bg: "кафе", name_en: "", items: [{ name_bg: "Лате", name_en: "Latte", desc_bg: "", desc_en: "", price_eur: 3.2, currency_seen: "EUR", allergens: [7] }] },
        { name_bg: "Десерти", name_en: "Desserts", items: [{ name_bg: "Торта", name_en: "Cake", desc_bg: "с орехи", desc_en: "with walnuts", price_eur: 4, currency_seen: "BGN", allergens: [1, 3, 8] }] },
      ],
      notes_bg: "", notes_en: "",
    });
    expect(merged).toHaveLength(2);
    expect(merged[0].key).toBe("c1");
    expect(merged[0].items.map((i) => i.name_en)).toEqual(["Espresso", "Latte"]);
    expect(merged[0].items[1]).toMatchObject({ price_eur: 3.2, allergens: [7], image_media_id: null });
    expect(merged[0].items[1].key).not.toBe("i1");
    expect(merged[1]).toMatchObject({ name_bg: "Десерти", name_en: "Desserts" });
    expect(merged[1].items[0]).toMatchObject({ name_bg: "Торта", desc_en: "with walnuts", allergens: [1, 3, 8] });
    expect(d.categories[0].items).toHaveLength(1); // input untouched
  });
});
```

```ts
// src/wizard/edit.ts
// Pure helpers behind the wizard's buttons (unit-tested; the components stay thin).
import type { ExtractResult } from "./extract";
import { SLUG_RE, type WizardCategory, type WizardItem } from "./schema";

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};

/** Bulgarian or Latin name → a slug that passes SLUG_RE (or "" when nothing usable is left). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split("")
    .map((ch) => CYR[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 39)
    .replace(/-+$/g, "");
  return SLUG_RE.test(s) ? s : "";
}

export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `k${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

export function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export function blankItem(): WizardItem {
  return { key: newKey(), name_bg: "", name_en: "", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], image_media_id: null };
}
export function blankCategory(): WizardCategory {
  return { key: newKey(), name_bg: "", name_en: "", items: [] };
}

const norm = (s: string) => s.trim().toLowerCase();

/** Appends extracted dishes to the category with the same name (either language), or adds the category. Returns a new array. */
export function mergeExtracted(categories: readonly WizardCategory[], r: ExtractResult): WizardCategory[] {
  const out = categories.map((c) => ({ ...c, items: [...c.items] }));
  for (const ec of r.categories) {
    const items: WizardItem[] = ec.items.map((it) => ({ key: newKey(), name_bg: it.name_bg, name_en: it.name_en, desc_bg: it.desc_bg, desc_en: it.desc_en, price_eur: it.price_eur, allergens: [...it.allergens], image_media_id: null }));
    const bg = norm(ec.name_bg);
    const en = norm(ec.name_en);
    const existing = out.find((c) => (bg && norm(c.name_bg) === bg) || (en && norm(c.name_en) === en) || (bg && norm(c.name_en) === bg) || (en && norm(c.name_bg) === en));
    if (existing) existing.items.push(...items);
    else out.push({ key: newKey(), name_bg: ec.name_bg, name_en: ec.name_en, items });
  }
  return out;
}
```

`npm test -- test/wizard-edit.test.ts` → PASS (4 tests).

- [ ] **Step 3: Demo state, client API, shared types, `useT`**

```ts
// src/wizard/demo-state.ts
// The chooser shows the demo café in every template. Seeded once per server process into a throwaway memory store.
import type { SiteState } from "../domain/types";
import { seedDemo } from "../seed/demo";
import { InMemoryStore } from "../store/memory";

let cached: Promise<SiteState> | null = null;
export function demoSiteState(): Promise<SiteState> {
  cached ??= (async () => {
    const store = new InMemoryStore();
    const { venue } = await seedDemo(store);
    return store.getSite(venue.id);
  })();
  return cached;
}
```

```ts
// app/new/components/api.ts
"use client";
import type { Media } from "@/src/domain/types";
import type { ExtractFile, ExtractResult } from "@/src/wizard/extract";
import type { PublishError, WizardDraft } from "@/src/wizard/schema";
import type { DraftTexts } from "@/src/wizard/texts";

export interface ApiError {
  code: string;
  bg: string;
  en: string;
  details?: PublishError[];
}
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const NETWORK: ApiError = { code: "network", bg: "Няма връзка. Проверете интернета и опитайте пак.", en: "No connection. Check your internet and try again." };
const GENERIC: ApiError = { code: "error", bg: "Възникна грешка. Опитайте отново.", en: "Something went wrong. Please try again." };

async function call<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, error: NETWORK };
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: ApiError }) | null;
  if (!res.ok) return { ok: false, status: res.status, error: body?.error ?? GENERIC };
  return { ok: true, data: body as T };
}
const json = (method: string, body: unknown, extra: RequestInit = {}): RequestInit => ({ method, body: JSON.stringify(body), headers: { "content-type": "application/json" }, ...extra });

export interface PublishResponse { slug: string; invite_code: string; start_url: string | null; admin_url: string; site_url: string }

export const api = {
  create: (template: string) => call<{ id: string }>("/api/new", json("POST", { template })),
  get: (id: string) => call<{ draft: WizardDraft; media: Media[]; status: string }>(`/api/new/${id}`),
  put: (id: string, patch: Partial<WizardDraft>, keepalive = false) => call<{ draft: WizardDraft }>(`/api/new/${id}`, json("PUT", patch, { keepalive })),
  upload: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ media: Media }>(`/api/new/${id}/media`, { method: "POST", body: form });
  },
  extract: (id: string, files: ExtractFile[]) => call<ExtractResult>(`/api/new/${id}/extract`, json("POST", { files })),
  texts: (id: string, facts: string) => call<DraftTexts>(`/api/new/${id}/texts`, json("POST", { facts })),
  publish: (id: string) => call<PublishResponse>(`/api/new/${id}/publish`, { method: "POST" }),
};

/** base64 payload only (no data: prefix), as the extract route expects. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });
}
```

```ts
// app/new/components/types.ts
import type { Media } from "@/src/domain/types";
import type { PublishError, WizardDraft } from "@/src/wizard/schema";

export interface StepProps {
  id: string;
  draft: WizardDraft;
  /** Media rows; freshly uploaded ones carry a blob: public_url so they render before the CDN has them. */
  media: Media[];
  update: (patch: Partial<WizardDraft>) => void;
  addMedia: (m: Media, file: File) => void;
  /** PUBLIC_BASE_URL, for the "your site will be at" hint. */
  baseUrl: string;
  /** false without ANTHROPIC_API_KEY: AI controls render an explanation instead. */
  aiAvailable: boolean;
  /** Field errors from the last failed autosave (e.g. slug taken). */
  serverErrors: PublishError[];
}
```

```ts
// app/new/components/useWizardText.ts
"use client";
import { useLang } from "@/src/i18n";
import { wizardText, type WizardKey } from "@/src/i18n/wizard";

export function useT() {
  const { lang } = useLang();
  return { lang, t: (key: WizardKey, vars?: Record<string, string | number>) => wizardText(lang, key, vars) };
}
```

- [ ] **Step 4: Field primitives, media thumbnail, scaled frame**

```tsx
// app/new/components/Field.tsx
"use client";
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

interface Common {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
}

export function TextField({ label, hint, error, value, onChange, prefix, className = "", ...rest }: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "prefix">) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold">{label}{rest.required && <span className="sr-only"> (required)</span>}</label>
      <div className="flex min-h-11 items-stretch rounded-xl bg-card ring-1 ring-ink/15 focus-within:ring-2 focus-within:ring-accent">
        {prefix && <span className="flex items-center pl-3 text-sm text-ink-soft" aria-hidden="true">{prefix}</span>}
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={[hintId, errId].filter(Boolean).join(" ") || undefined} aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 bg-transparent px-3 text-base outline-none" {...rest} />
      </div>
      {hint && <p id={hintId} className="text-sm text-ink-soft">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-sm font-semibold text-clay">{error}</p>}
    </div>
  );
}

export function TextArea({ label, hint, error, value, onChange, className = "", ...rest }: Omit<Common, "prefix"> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rest.rows ?? 3} aria-describedby={[hintId, errId].filter(Boolean).join(" ") || undefined} aria-invalid={error ? true : undefined}
        className="min-h-11 rounded-xl bg-card px-3 py-2 text-base ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-accent" {...rest} />
      {hint && <p id={hintId} className="text-sm text-ink-soft">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-sm font-semibold text-clay">{error}</p>}
    </div>
  );
}

export function Button({ variant = "secondary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  const styles = {
    primary: "bg-accent text-white hover:brightness-110",
    secondary: "text-ink ring-1 ring-ink/25 hover:bg-ink/5",
    quiet: "text-ink-soft hover:bg-ink/5",
  }[variant];
  return <button type="button" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-50 ${styles} ${className}`} {...rest} />;
}

export function Fieldset({ legend, hint, children, className = "" }: { legend: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`grid gap-3 ${className}`}>
      <legend className="text-sm font-semibold">{legend}</legend>
      {hint && <p className="-mt-1 text-sm text-ink-soft">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** Hidden file input behind a visible button. */
export function FileButton({ label, accept, multiple = false, disabled = false, onFiles }: { label: string; accept: string; multiple?: boolean; disabled?: boolean; onFiles: (files: File[]) => void }) {
  const id = useId();
  return (
    <>
      <input id={id} type="file" accept={accept} multiple={multiple} disabled={disabled} className="sr-only" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) onFiles(files); }} />
      <label htmlFor={id} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-sm font-semibold text-ink ring-1 ring-ink/25 hover:bg-ink/5 focus-within:ring-2 focus-within:ring-accent ${disabled ? "pointer-events-none opacity-50" : ""}`}>{label}</label>
    </>
  );
}
```

```tsx
// app/new/components/MediaThumb.tsx
"use client";
import type { Media } from "@/src/domain/types";
import { useT } from "./useWizardText";

export function thumbUrl(m: Media | undefined): string | null {
  if (!m) return null;
  return /^(https?:|blob:|data:)/.test(m.public_url) ? m.public_url : null;
}

/** A square thumbnail or a neutral tile when the URL cannot be shown (memory:// in offline mode). Plain <img>: blob and memory URLs are not next/image material. */
export function MediaThumb({ media, alt, className = "" }: { media: Media | undefined; alt: string; className?: string }) {
  const { t } = useT();
  const src = thumbUrl(media);
  return (
    <div className={`relative overflow-hidden rounded-xl bg-paper-deep ${className}`}>
      {src ? <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-ink-soft">{media ? t("photos.noPreview") : t("look.none")}</span>}
    </div>
  );
}
```

```tsx
// app/new/components/ScaledFrame.tsx
"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A 1280×1600 page scaled to the box width. The inside is inert: the card's button is the only control. */
export function ScaledFrame({ width = 1280, height = 1600, children, className = "" }: { width?: number; height?: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <div inert aria-hidden="true" className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: The chooser page**

```tsx
// app/new/page.tsx
import type { Metadata } from "next";
import { LangProvider } from "@/src/i18n";
import { WIZARD } from "@/src/i18n/wizard";
import { demoSiteState } from "@/src/wizard/demo-state";
import { TemplateChooser } from "./components/TemplateChooser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${WIZARD.bg["chooser.title"]} · ${WIZARD.en["chooser.title"]}`, robots: { index: false, follow: false } };

export default async function Page() {
  const demo = await demoSiteState();
  return (
    <LangProvider defaultLang="bg">
      <TemplateChooser demo={demo} now={Date.now()} />
    </LangProvider>
  );
}
```

```tsx
// app/new/components/TemplateChooser.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TEMPLATE_IDS, type SiteState, type TemplateId } from "@/src/domain/types";
import { LangToggle } from "@/src/i18n";
import { getTemplate } from "@/src/templates";
import { api, type ApiError } from "./api";
import { Button } from "./Field";
import { ScaledFrame } from "./ScaledFrame";
import { useT } from "./useWizardText";

export function TemplateChooser({ demo, now }: { demo: SiteState; now: number }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<TemplateId | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function start(id: TemplateId) {
    setBusy(id);
    setError(null);
    const r = await api.create(id);
    if (!r.ok) {
      setError(r.status === 429 ? { code: "limited", bg: t("chooser.limited"), en: t("chooser.limited") } : r.error);
      setBusy(null);
      return;
    }
    router.push(`/new/${r.data.id}`);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="font-display text-lg font-semibold">{t("brand")}</span>
        <LangToggle />
      </header>
      <h1 className="mt-6 text-3xl font-semibold sm:text-5xl">{t("chooser.h1")}</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">{t("chooser.lead")}</p>
      <ul className="mt-10 grid gap-6 md:grid-cols-3" aria-label={t("chooser.h1")}>
        {TEMPLATE_IDS.map((id) => {
          const def = getTemplate(id);
          const name = lang === "bg" ? def.name_bg : def.name_en;
          const state: SiteState = { ...demo, venue: { ...demo.venue, template: id, theme: { accent: def.accentDefault } } };
          return (
            <li key={id} className="flex flex-col overflow-hidden rounded-3xl bg-card ring-1 ring-ink/10 transition-transform motion-safe:hover:-translate-y-1">
              <ScaledFrame className="border-b border-ink/10 bg-paper-deep">
                <def.Component state={state} now={now} slug="agala" page="home" draft={null} live={false} feedUrl="" preview />
              </ScaledFrame>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <h2 className="text-xl font-semibold">{name}</h2>
                <p className="flex-1 text-ink-soft">{lang === "bg" ? def.tagline_bg : def.tagline_en}</p>
                <Button variant="primary" disabled={busy !== null} aria-busy={busy === id} onClick={() => void start(id)} aria-describedby={`tpl-${id}-desc`}>
                  {busy === id ? t("chooser.starting") : t("chooser.start")}
                </Button>
                <span id={`tpl-${id}-desc`} className="sr-only">{t("a11y.preview", { name })}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm text-ink-soft">{t("chooser.demoNote")}</p>
      {error && <p role="alert" className="mt-4 font-semibold text-clay">{lang === "bg" ? error.bg : error.en}</p>}
    </main>
  );
}
```

- [ ] **Step 6: The wizard page shell and NoDraft**

```tsx
// app/new/[id]/page.tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { WIZARD } from "@/src/i18n/wizard";
import { getServerDeps } from "@/src/server/deps";
import { sha256Hex } from "@/src/server/hash";
import { readDraftFromCookies } from "@/src/server/draft-cookie";
import { emptyDraft } from "@/src/wizard/schema";
import { NoDraft } from "../components/NoDraft";
import { Wizard } from "../components/Wizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${WIZARD.bg["chooser.title"]} · ${WIZARD.en["chooser.title"]}`, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page(props: PageProps<"/new/[id]">) {
  const { id } = await props.params;
  const deps = await getServerDeps((fn) => after(fn));
  const c = readDraftFromCookies(await cookies());
  const venue = c && c.id === id ? await deps.store.findVenueByDraftToken(sha256Hex(c.token)) : null;
  if (!venue || venue.id !== id) {
    return (
      <LangProvider defaultLang="bg"><NoDraft /></LangProvider>
    );
  }
  if (venue.status === "live") redirect(`/new/${id}/done`);
  const draft = venue.wizard_draft ?? emptyDraft(venue.template);
  const site = await deps.store.getSite(venue.id);
  return (
    <LangProvider defaultLang={draft.default_lang}>
      <Wizard id={id} initialDraft={draft} initialMedia={site.media} baseUrl={deps.config.publicBaseUrl} aiAvailable={deps.anthropic !== null} />
    </LangProvider>
  );
}
```

```tsx
// app/new/components/NoDraft.tsx
"use client";
import Link from "next/link";
import { LangToggle } from "@/src/i18n";
import { useT } from "./useWizardText";

export function NoDraft() {
  const { t } = useT();
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="font-display text-lg font-semibold">{t("brand")}</span>
        <LangToggle />
      </header>
      <h1 className="mt-10 text-3xl font-semibold">{t("nodraft.title")}</h1>
      <p className="mt-4 text-ink-soft">{t("nodraft.body")}</p>
      <Link href="/new" className="mt-8 inline-flex min-h-11 items-center rounded-full bg-accent px-6 font-semibold text-white">{t("nodraft.cta")}</Link>
    </main>
  );
}
```

- [ ] **Step 7: Stepper, Preview and the Wizard shell**

```tsx
// app/new/components/Stepper.tsx
"use client";
import type { WizardStep } from "@/src/wizard/schema";
import { useT } from "./useWizardText";

export const FORM_STEPS: readonly WizardStep[] = ["basics", "look", "hours", "menu", "texts", "photos", "review"];
type StepKey = `step.${(typeof FORM_STEPS)[number]}`;

/** Numbered steps; earlier ones are buttons, the current is aria-current, later ones are plain text (Next validates first). */
export function Stepper({ current, onSelect }: { current: WizardStep; onSelect: (s: WizardStep) => void }) {
  const { t } = useT();
  const idx = FORM_STEPS.indexOf(current);
  return (
    <nav aria-label={t("nav.steps")}>
      <p className="text-sm text-ink-soft">{t("nav.stepOf", { n: idx + 1, total: FORM_STEPS.length })}</p>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {FORM_STEPS.map((s, i) => {
          const label = t(`step.${s}` as StepKey);
          const done = i < idx;
          const active = i === idx;
          const cls = `inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm ${active ? "bg-ink text-paper font-semibold" : done ? "bg-paper-deep text-ink hover:bg-ink/10" : "text-ink-soft"}`;
          return (
            <li key={s}>
              {done ? (
                <button type="button" className={cls} onClick={() => onSelect(s)}><span aria-hidden="true">{i + 1}</span> {label}</button>
              ) : (
                <span className={cls} aria-current={active ? "step" : undefined}><span aria-hidden="true">{i + 1}</span> {label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

```tsx
// app/new/components/Preview.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import type { Media } from "@/src/domain/types";
import { getTemplate } from "@/src/templates";
import { buildPreviewState } from "@/src/wizard/preview";
import type { WizardDraft } from "@/src/wizard/schema";
import { Button } from "./Field";
import { useT } from "./useWizardText";

/** The chosen template rendering the draft. Sticky right pane from 1024 px; a full-screen sheet on smaller screens when `open`. */
export function Preview({ draft, media, open, onClose }: { draft: WizardDraft; media: Media[]; open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [page, setPage] = useState<"home" | "menu">("home");
  const now = Date.now();
  const state = useMemo(() => buildPreviewState(draft, media, new Date(now)), [draft, media, now]);
  const def = getTemplate(draft.template);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const body = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink/10 bg-card px-3 py-2">
        <span className="mr-auto text-sm font-semibold">{t("preview.title")}</span>
        <div role="group" aria-label={t("preview.title")} className="inline-flex rounded-full bg-paper-deep p-0.5">
          {(["home", "menu"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={page === p} onClick={() => setPage(p)} className={`min-h-9 rounded-full px-3 text-sm font-semibold ${page === p ? "bg-ink text-paper" : "text-ink-soft"}`}>{t(p === "home" ? "preview.home" : "preview.menu")}</button>
          ))}
        </div>
        <Button variant="quiet" className="lg:hidden" onClick={onClose}>{t("preview.close")}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
        <def.Component key={draft.template} state={state} now={now} slug={state.venue.slug} page={page} draft={null} live={false} feedUrl="" preview />
      </div>
      <p className="border-t border-ink/10 bg-card px-3 py-1.5 text-xs text-ink-soft">{t("preview.note")}</p>
    </div>
  );
  return (
    <>
      <aside aria-label={t("preview.title")} className="hidden lg:sticky lg:top-0 lg:block lg:h-screen lg:border-l lg:border-ink/10">{body}</aside>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={t("preview.title")} className="fixed inset-0 z-50 bg-paper lg:hidden">{body}</div>
      )}
    </>
  );
}
```

```tsx
// app/new/components/Wizard.tsx
"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Media } from "@/src/domain/types";
import { LangToggle } from "@/src/i18n";
import { stepForPath, validateForPublish, type PublishError, type WizardDraft, type WizardStep } from "@/src/wizard/schema";
import { api } from "./api";
import { Button } from "./Field";
import { Preview } from "./Preview";
import { FORM_STEPS, Stepper } from "./Stepper";
import { Basics } from "./Steps/Basics";
import { Hours } from "./Steps/Hours";
import { Look } from "./Steps/Look";
import { Menu } from "./Steps/Menu";
import { Photos } from "./Steps/Photos";
import { Review } from "./Steps/Review";
import { Texts } from "./Steps/Texts";
import type { StepProps } from "./types";
import { useT } from "./useWizardText";

const AUTOSAVE_MS = 800;
type SaveState = "idle" | "saving" | "saved" | "error";

export function Wizard({ id, initialDraft, initialMedia, baseUrl, aiAvailable }: { id: string; initialDraft: WizardDraft; initialMedia: Media[]; baseUrl: string; aiAvailable: boolean }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [media, setMedia] = useState(initialMedia);
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [step, setStep] = useState<WizardStep>(FORM_STEPS.includes(initialDraft.step) ? initialDraft.step : "basics");
  const [save, setSave] = useState<SaveState>("idle");
  const [serverErrors, setServerErrors] = useState<PublishError[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const pending = useRef<Partial<WizardDraft>>({});
  const timer = useRef<number | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);

  const flush = useCallback(async (keepalive = false) => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    setSave("saving");
    const r = await api.put(id, patch, keepalive);
    if (r.ok) {
      setSave("saved");
      setServerErrors([]);
    } else {
      setSave("error");
      setServerErrors(r.error.details ?? (r.error.code === "slug_taken" ? [{ path: "slug", bg: r.error.bg, en: r.error.en }] : []));
      pending.current = { ...patch, ...pending.current }; // retry with the next change
    }
  }, [id]);

  const update = useCallback((patch: Partial<WizardDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flush(true); };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); window.clearTimeout(timer.current); };
  }, [flush]);

  const addMedia = useCallback((m: Media, file: File) => {
    setMedia((list) => [...list, m]);
    setLocalUrls((u) => ({ ...u, [m.id]: URL.createObjectURL(file) }));
  }, []);
  const shownMedia = useMemo(() => media.map((m) => (localUrls[m.id] ? { ...m, public_url: localUrls[m.id] } : m)), [media, localUrls]);

  const errors = useMemo(() => { const r = validateForPublish(draft); return r.ok ? [] : r.errors; }, [draft]);
  const stepErrors = errors.filter((e) => stepForPath(e.path) === step);
  const idx = FORM_STEPS.indexOf(step);

  function go(next: WizardStep) {
    if (FORM_STEPS.indexOf(next) > idx && stepErrors.length) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    update({ step: next });
    void flush();
    setStep(next);
    setPreviewOpen(false);
    window.requestAnimationFrame(() => heading.current?.focus());
  }

  const stepProps: StepProps = { id, draft, media: shownMedia, update, addMedia, baseUrl, aiAvailable, serverErrors };
  const saveText = save === "saving" ? t("save.saving") : save === "saved" ? t("save.saved") : save === "error" ? t("save.error") : "";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="mx-auto w-full max-w-xl px-4 pb-28 sm:px-6 lg:pb-12">
        <header className="flex items-center justify-between py-5">
          <span className="font-display text-lg font-semibold">{t("brand")}</span>
          <LangToggle />
        </header>
        <Stepper current={step} onSelect={go} />
        <p aria-live="polite" className={`mt-2 min-h-5 text-sm ${save === "error" ? "font-semibold text-clay" : "text-ink-soft"}`}>{saveText}</p>
        <h1 ref={heading} tabIndex={-1} className="mt-4 text-3xl font-semibold outline-none">{t(`step.${step}` as "step.basics")}</h1>
        {showErrors && stepErrors.length > 0 && (
          <div role="alert" className="mt-4 rounded-2xl bg-clay-soft p-4 text-sm">
            <p className="font-semibold">{t("nav.fixFirst")}</p>
            <ul className="mt-1 list-disc pl-5">{stepErrors.map((e) => <li key={e.path}>{lang === "bg" ? e.bg : e.en}</li>)}</ul>
          </div>
        )}
        <div className="mt-6">
          {step === "basics" && <Basics {...stepProps} />}
          {step === "look" && <Look {...stepProps} />}
          {step === "hours" && <Hours {...stepProps} />}
          {step === "menu" && <Menu {...stepProps} />}
          {step === "texts" && <Texts {...stepProps} />}
          {step === "photos" && <Photos {...stepProps} />}
          {step === "review" && (
            <Review {...stepProps} errors={errors} goTo={(s) => { setShowErrors(false); setStep(s); update({ step: s }); }}
              onPublished={(adminUrl) => { const key = new URL(adminUrl).searchParams.get("key") ?? ""; router.push(`/new/${id}/done?key=${encodeURIComponent(key)}`); }} />
          )}
        </div>
        <nav className="mt-10 flex items-center justify-between gap-3" aria-label={t("nav.steps")}>
          <Button onClick={() => go(FORM_STEPS[idx - 1])} disabled={idx === 0}>{t("nav.back")}</Button>
          {step !== "review" && <Button variant="primary" onClick={() => go(FORM_STEPS[idx + 1])}>{t("nav.next")}</Button>}
        </nav>
      </div>
      <Preview draft={draft} media={shownMedia} open={previewOpen} onClose={() => setPreviewOpen(false)} />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-card/95 p-3 backdrop-blur lg:hidden">
        <Button variant="secondary" className="w-full" aria-haspopup="dialog" aria-expanded={previewOpen} onClick={() => setPreviewOpen(true)}>{t("preview.open")}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: The steps**

```tsx
// app/new/components/Steps/Basics.tsx
"use client";
import { useState } from "react";
import { BUSINESS_TYPES } from "@/src/domain/types";
import { slugify } from "@/src/wizard/edit";
import { Fieldset, TextField } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

export function Basics({ draft, update, baseUrl, serverErrors }: StepProps) {
  const { t, lang } = useT();
  const [slugTouched, setSlugTouched] = useState(draft.slug !== "");
  const host = baseUrl.replace(/^https?:\/\//, "");
  const slugErr = serverErrors.find((e) => e.path === "slug");
  return (
    <div className="grid gap-5">
      <TextField label={t("basics.name")} value={draft.name} required maxLength={80} autoComplete="organization" onChange={(name) => update(slugTouched ? { name } : { name, slug: slugify(name) })} />
      <TextField label={t("basics.slug")} value={draft.slug} required prefix={`${host}/`} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={39}
        hint={t("basics.slugHint", { url: `${baseUrl}/${draft.slug || "…"}` })} error={slugErr ? (lang === "bg" ? slugErr.bg : slugErr.en) : undefined}
        onChange={(v) => { setSlugTouched(true); update({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "") }); }} />
      <Fieldset legend={t("basics.lang")}>
        {(["bg", "en"] as const).map((l) => (
          <label key={l} className="flex min-h-11 items-center gap-3">
            <input type="radio" name="default_lang" value={l} checked={draft.default_lang === l} onChange={() => update({ default_lang: l })} className="size-5 accent-accent" />
            <span>{t(l === "bg" ? "basics.lang.bg" : "basics.lang.en")}</span>
          </label>
        ))}
      </Fieldset>
      <Fieldset legend={t("basics.type")}>
        <div className="flex flex-wrap gap-2">
          {BUSINESS_TYPES.map((b) => (
            <label key={b} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 ring-1 ${draft.business_type === b ? "bg-ink text-paper ring-ink" : "ring-ink/25"}`}>
              <input type="radio" name="business_type" value={b} checked={draft.business_type === b} onChange={() => update({ business_type: b })} className="sr-only" />
              {t(`basics.type.${b}` as "basics.type.cafe")}
            </label>
          ))}
        </div>
      </Fieldset>
      <TextField label={t("basics.address")} value={draft.address} maxLength={200} autoComplete="street-address" onChange={(address) => update({ address })} />
      <TextField label={t("basics.phone")} value={draft.phone} maxLength={40} type="tel" autoComplete="tel" onChange={(phone) => update({ phone })} />
      <TextField label={t("basics.instagram")} value={draft.instagram} maxLength={60} prefix="@" autoCapitalize="none" onChange={(v) => update({ instagram: v.replace(/^@/, "") })} />
      <TextField label={t("basics.mapsUrl")} value={draft.maps_url} maxLength={500} type="url" inputMode="url" hint={t("basics.mapsHint")} onChange={(maps_url) => update({ maps_url })} />
    </div>
  );
}
```

```tsx
// app/new/components/Steps/Look.tsx
"use client";
import { useState } from "react";
import type { Media } from "@/src/domain/types";
import { TEMPLATE_ACCENT_DEFAULTS } from "@/src/wizard/schema";
import { api } from "../api";
import { Button, Fieldset, FileButton, TextField } from "../Field";
import { MediaThumb } from "../MediaThumb";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

const PRESETS = ["#2f6b4f", "#8f5c10", "#a4442c", "#1d4ed8", "#6b21a8", "#1d2a24"];
const HEX = /^#[0-9a-fA-F]{6}$/;

function ImageSlot({ id, label, hint, mediaId, media, onChange, addMedia, wide }: { id: string; label: string; hint?: string; mediaId: string | null; media: Media[]; onChange: (id: string | null) => void; addMedia: StepProps["addMedia"]; wide?: boolean }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = media.find((m) => m.id === mediaId);
  async function upload(files: File[]) {
    setBusy(true);
    setFailed(false);
    const r = await api.upload(id, files[0]);
    if (r.ok) { addMedia(r.data.media, files[0]); onChange(r.data.media.id); } else setFailed(true);
    setBusy(false);
  }
  return (
    <Fieldset legend={label} hint={hint}>
      <div className="flex items-center gap-4">
        <MediaThumb media={current} alt={label} className={wide ? "h-24 w-40" : "size-24"} />
        <div className="flex flex-wrap gap-2">
          <FileButton label={busy ? t("look.uploading") : current ? t("look.replace") : t("look.upload")} accept="image/*" disabled={busy} onFiles={(f) => void upload(f)} />
          {current && <Button variant="quiet" onClick={() => onChange(null)}>{t("look.remove")}</Button>}
        </div>
      </div>
      <p aria-live="polite" className="min-h-5 text-sm font-semibold text-clay">{failed ? t("look.uploadFailed") : ""}</p>
    </Fieldset>
  );
}

export function Look({ id, draft, media, update, addMedia }: StepProps) {
  const { t } = useT();
  const templateDefault = TEMPLATE_ACCENT_DEFAULTS[draft.template];
  const options = [templateDefault, ...PRESETS.filter((p) => p !== templateDefault)];
  const custom = !options.includes(draft.theme.accent.toLowerCase());
  const [hex, setHex] = useState(draft.theme.accent);
  return (
    <div className="grid gap-8">
      <Fieldset legend={t("look.accent")}>
        <div className="flex flex-wrap gap-2">
          {options.map((c, i) => (
            <label key={c} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 ring-1 ring-ink/15 has-[:checked]:ring-2 has-[:checked]:ring-ink">
              <input type="radio" name="accent" value={c} checked={draft.theme.accent.toLowerCase() === c} onChange={() => { setHex(c); update({ theme: { accent: c } }); }} className="sr-only" />
              <span aria-hidden="true" className="size-6 rounded-full ring-1 ring-ink/10" style={{ background: c }} />
              <span className="text-sm">{i === 0 ? t("look.accentDefault") : c}</span>
            </label>
          ))}
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 ring-1 ring-ink/15 has-[:checked]:ring-2 has-[:checked]:ring-ink">
            <input type="radio" name="accent" value="custom" checked={custom} readOnly className="sr-only" />
            <input type="color" aria-label={t("look.accentCustom")} value={HEX.test(hex) ? hex : "#000000"} onChange={(e) => { setHex(e.target.value); update({ theme: { accent: e.target.value } }); }} className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0" />
            <span className="text-sm">{t("look.accentCustom")}</span>
          </label>
        </div>
        <TextField label={t("look.accentHex")} value={hex} maxLength={7} spellCheck={false} className="max-w-xs" onChange={(v) => { setHex(v); if (HEX.test(v)) update({ theme: { accent: v } }); }} />
      </Fieldset>
      <ImageSlot id={id} label={t("look.logo")} mediaId={draft.logo_media_id} media={media} addMedia={addMedia} onChange={(logo_media_id) => update({ logo_media_id })} />
      <ImageSlot id={id} label={t("look.cover")} hint={t("look.coverHint")} mediaId={draft.cover_media_id} media={media} addMedia={addMedia} onChange={(cover_media_id) => update({ cover_media_id })} wide />
    </div>
  );
}
```

```tsx
// app/new/components/Steps/Hours.tsx
"use client";
import { WEEKDAYS, type WeekHours } from "@/src/domain/types";
import { Button } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

const DEFAULT_DAY = { open: "08:00", close: "18:00" };

export function Hours({ draft, update }: StepProps) {
  const { t } = useT();
  const set = (patch: Partial<WeekHours>) => update({ hours: { ...draft.hours, ...patch } });
  return (
    <div className="grid gap-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-soft"><th scope="col" className="py-2 font-semibold">{t("hours.day")}</th><th scope="col" className="py-2 font-semibold">{t("hours.open")}</th><th scope="col" className="py-2 font-semibold">{t("hours.close")}</th><th scope="col" className="py-2 font-semibold">{t("hours.closed")}</th></tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((d) => {
            const v = draft.hours[d];
            const name = t(`hours.day.${d}` as "hours.day.mon");
            return (
              <tr key={d} className="border-t border-ink/10">
                <th scope="row" className="py-2 pr-2 font-semibold">{name}</th>
                <td className="py-2 pr-2"><input type="time" aria-label={`${name}: ${t("hours.open")}`} value={v?.open ?? ""} disabled={!v} onChange={(e) => set({ [d]: { open: e.target.value, close: v?.close ?? DEFAULT_DAY.close } })} className="min-h-11 w-full rounded-xl bg-card px-2 ring-1 ring-ink/15 disabled:opacity-40" /></td>
                <td className="py-2 pr-2"><input type="time" aria-label={`${name}: ${t("hours.close")}`} value={v?.close ?? ""} disabled={!v} onChange={(e) => set({ [d]: { open: v?.open ?? DEFAULT_DAY.open, close: e.target.value } })} className="min-h-11 w-full rounded-xl bg-card px-2 ring-1 ring-ink/15 disabled:opacity-40" /></td>
                <td className="py-2"><label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={!v} onChange={(e) => set({ [d]: e.target.checked ? null : { ...DEFAULT_DAY } })} className="size-5 accent-accent" /><span className="sr-only">{name}: {t("hours.closed")}</span></label></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div><Button onClick={() => { const mon = draft.hours.mon ? { ...draft.hours.mon } : null; set({ tue: mon && { ...mon }, wed: mon && { ...mon }, thu: mon && { ...mon }, fri: mon && { ...mon } }); }}>{t("hours.copyMon")}</Button></div>
    </div>
  );
}
```

```tsx
// app/new/components/Steps/Menu.tsx
"use client";
import { useState } from "react";
import { ALLERGENS, allergenName } from "@/src/domain/allergens";
import { blankCategory, blankItem, mergeExtracted, moveIndex } from "@/src/wizard/edit";
import { EXTRACT_MAX_FILES, IMAGE_MEDIA_TYPES, type ExtractFile, type ExtractResult } from "@/src/wizard/extract";
import type { WizardCategory, WizardItem } from "@/src/wizard/schema";
import { api, fileToBase64, type ApiError } from "../api";
import { Button, FileButton, TextField } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";
import { ExtractReview } from "./ExtractReview";

export function Menu({ id, draft, update, aiAvailable }: StepProps) {
  const { t, lang } = useT();
  const cats = draft.categories;
  const [activeKey, setActiveKey] = useState<string | null>(cats[0]?.key ?? null);
  const [askRemove, setAskRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [review, setReview] = useState<ExtractResult | null>(null);
  const active = cats.find((c) => c.key === activeKey) ?? cats[0] ?? null;
  const setCats = (categories: WizardCategory[]) => update({ categories });
  const patchCat = (key: string, patch: Partial<WizardCategory>) => setCats(cats.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const patchItem = (ckey: string, ikey: string, patch: Partial<WizardItem>) => setCats(cats.map((c) => (c.key === ckey ? { ...c, items: c.items.map((i) => (i.key === ikey ? { ...i, ...patch } : i)) } : c)));

  async function onFiles(files: File[]) {
    setUploadError(null);
    const okTypes: string[] = [...IMAGE_MEDIA_TYPES, "application/pdf"];
    if (files.some((f) => !okTypes.includes(f.type))) { setUploadError(t("menu.upload.badFile")); return; }
    if (files.length > EXTRACT_MAX_FILES) { setUploadError(t("menu.upload.hint", { n: EXTRACT_MAX_FILES })); return; }
    setBusy(true);
    const payload: ExtractFile[] = [];
    for (const f of files) payload.push({ media_type: f.type as ExtractFile["media_type"], data: await fileToBase64(f) });
    const r = await api.extract(id, payload);
    setBusy(false);
    if (!r.ok) { const e: ApiError = r.error; setUploadError(r.status === 503 ? t("menu.upload.unavailable") : lang === "bg" ? e.bg : e.en); return; }
    if (r.data.categories.every((c) => c.items.length === 0)) { setUploadError(t("extract.empty")); return; }
    setReview(r.data);
  }

  if (review) {
    return <ExtractReview result={review} onDiscard={() => setReview(null)} onAccept={(r) => { const merged = mergeExtracted(cats, r); setCats(merged); setActiveKey(merged[0]?.key ?? null); setReview(null); }} />;
  }

  const ci = active ? cats.indexOf(active) : -1;
  return (
    <div className="grid gap-8">
      <section aria-labelledby="menu-cats">
        <h2 id="menu-cats" className="text-sm font-semibold">{t("menu.categories")}</h2>
        <div role="tablist" aria-label={t("menu.categories")} className="mt-2 flex flex-wrap gap-2">
          {cats.map((c) => (
            <button key={c.key} role="tab" type="button" aria-selected={active?.key === c.key} onClick={() => { setActiveKey(c.key); setAskRemove(false); }}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ${active?.key === c.key ? "bg-ink text-paper" : "ring-1 ring-ink/25"}`}>
              {(lang === "bg" ? c.name_bg : c.name_en) || c.name_bg || c.name_en || "…"}
            </button>
          ))}
          <Button onClick={() => { const c = blankCategory(); setCats([...cats, c]); setActiveKey(c.key); }}>{t("menu.addCategory")}</Button>
        </div>
        {active && (
          <div role="tabpanel" className="mt-4 grid gap-3 rounded-2xl bg-card p-4 ring-1 ring-ink/10">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t("menu.category.nameBg")} value={active.name_bg} maxLength={80} onChange={(name_bg) => patchCat(active.key, { name_bg })} />
              <TextField label={t("menu.category.nameEn")} value={active.name_en} maxLength={80} onChange={(name_en) => patchCat(active.key, { name_en })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="quiet" disabled={ci <= 0} onClick={() => setCats(moveIndex(cats, ci, ci - 1))}>{t("menu.moveUp")}</Button>
              <Button variant="quiet" disabled={ci >= cats.length - 1} onClick={() => setCats(moveIndex(cats, ci, ci + 1))}>{t("menu.moveDown")}</Button>
              {!askRemove ? (
                <Button variant="quiet" onClick={() => (active.items.length ? setAskRemove(true) : setCats(cats.filter((c) => c.key !== active.key)))}>{t("menu.removeCategory")}</Button>
              ) : (
                <span role="group" aria-label={t("menu.removeCategoryAsk", { n: active.items.length })} className="inline-flex items-center gap-2 text-sm">
                  {t("menu.removeCategoryAsk", { n: active.items.length })}
                  <Button variant="primary" onClick={() => { setCats(cats.filter((c) => c.key !== active.key)); setAskRemove(false); setActiveKey(null); }}>{t("menu.yes")}</Button>
                  <Button onClick={() => setAskRemove(false)}>{t("menu.no")}</Button>
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="menu-items">
        <h2 id="menu-items" className="text-sm font-semibold">{t("menu.items")}</h2>
        {!active && <p className="mt-2 text-ink-soft">{t("menu.noCategory")}</p>}
        {active && active.items.length === 0 && <p className="mt-2 text-ink-soft">{t("menu.empty")}</p>}
        {active && (
          <ol className="mt-2 grid gap-3">
            {active.items.map((it, ii) => (
              <li key={it.key} className="grid gap-3 rounded-2xl bg-card p-4 ring-1 ring-ink/10">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem]">
                  <TextField label={t("menu.item.nameBg")} value={it.name_bg} maxLength={120} onChange={(name_bg) => patchItem(active.key, it.key, { name_bg })} />
                  <TextField label={t("menu.item.nameEn")} value={it.name_en} maxLength={120} onChange={(name_en) => patchItem(active.key, it.key, { name_en })} />
                  <TextField label={t("menu.item.price")} value={String(it.price_eur)} type="number" inputMode="decimal" step="0.01" min="0.10" max="500" onChange={(v) => patchItem(active.key, it.key, { price_eur: Math.round(Number(v) * 100) / 100 || 0 })} />
                </div>
                <details>
                  <summary className="min-h-11 cursor-pointer text-sm font-semibold">{t("menu.item.details")}{it.allergens.length > 0 && <span className="ml-2 text-ink-soft">({it.allergens.join(", ")})</span>}</summary>
                  <div className="mt-3 grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField label={t("menu.item.descBg")} value={it.desc_bg} maxLength={400} onChange={(desc_bg) => patchItem(active.key, it.key, { desc_bg })} />
                      <TextField label={t("menu.item.descEn")} value={it.desc_en} maxLength={400} onChange={(desc_en) => patchItem(active.key, it.key, { desc_en })} />
                    </div>
                    <fieldset>
                      <legend className="text-sm font-semibold">{t("menu.item.allergens")}</legend>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ALLERGENS.map((a) => {
                          const on = it.allergens.includes(a.code);
                          return (
                            <button key={a.code} type="button" aria-pressed={on} onClick={() => patchItem(active.key, it.key, { allergens: on ? it.allergens.filter((c) => c !== a.code) : [...it.allergens, a.code].sort((x, y) => x - y) })}
                              className={`min-h-9 rounded-full px-3 text-xs font-semibold ${on ? "bg-ink text-paper" : "bg-paper-deep text-ink"}`}>
                              {a.code} {allergenName(a.code, lang)}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  </div>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button variant="quiet" disabled={ii === 0} aria-label={`${t("menu.moveUp")}: ${it.name_bg || it.name_en}`} onClick={() => patchCat(active.key, { items: moveIndex(active.items, ii, ii - 1) })}>{t("menu.moveUp")}</Button>
                  <Button variant="quiet" disabled={ii === active.items.length - 1} aria-label={`${t("menu.moveDown")}: ${it.name_bg || it.name_en}`} onClick={() => patchCat(active.key, { items: moveIndex(active.items, ii, ii + 1) })}>{t("menu.moveDown")}</Button>
                  <Button variant="quiet" aria-label={`${t("menu.item.remove")}: ${it.name_bg || it.name_en}`} onClick={() => patchCat(active.key, { items: active.items.filter((x) => x.key !== it.key) })}>{t("menu.item.remove")}</Button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {active && <div className="mt-3"><Button onClick={() => patchCat(active.key, { items: [...active.items, blankItem()] })}>{t("menu.addItem")}</Button></div>}
      </section>

      <section aria-labelledby="menu-upload" className="rounded-2xl bg-paper-deep p-4">
        <h2 id="menu-upload" className="font-semibold">{t("menu.upload.title")}</h2>
        {aiAvailable ? (
          <>
            <p className="mt-1 text-sm text-ink-soft">{t("menu.upload.hint", { n: EXTRACT_MAX_FILES })}</p>
            <div className="mt-3"><FileButton label={busy ? t("menu.upload.working") : t("menu.upload.choose")} accept="image/*,application/pdf" multiple disabled={busy} onFiles={(f) => void onFiles(f)} /></div>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">{t("menu.upload.unavailable")}</p>
        )}
        <p aria-live="polite" className="mt-2 min-h-5 text-sm font-semibold text-clay">{busy ? t("menu.upload.working") : uploadError ?? ""}</p>
      </section>
    </div>
  );
}
```

```tsx
// app/new/components/Steps/ExtractReview.tsx
"use client";
import { useState } from "react";
import { allergenName } from "@/src/domain/allergens";
import { formatPrice } from "@/src/domain/format";
import type { ExtractResult } from "@/src/wizard/extract";
import { Button, TextField } from "../Field";
import { useT } from "../useWizardText";

type Row = ExtractResult["categories"][number]["items"][number] & { on: boolean };
type Cat = { name_bg: string; name_en: string; items: Row[] };

/** The extraction as an editable checklist. Accept returns only the ticked rows, with edits applied. */
export function ExtractReview({ result, onAccept, onDiscard }: { result: ExtractResult; onAccept: (r: ExtractResult) => void; onDiscard: () => void }) {
  const { t, lang } = useT();
  const [cats, setCats] = useState<Cat[]>(() => result.categories.map((c) => ({ name_bg: c.name_bg, name_en: c.name_en, items: c.items.map((i) => ({ ...i, on: true })) })));
  const selected = cats.reduce((n, c) => n + c.items.filter((i) => i.on).length, 0);
  const patch = (ci: number, ii: number, p: Partial<Row>) => setCats(cats.map((c, x) => (x === ci ? { ...c, items: c.items.map((i, y) => (y === ii ? { ...i, ...p } : i)) } : c)));
  const accept = (all: boolean) =>
    onAccept({ notes_bg: result.notes_bg, notes_en: result.notes_en, categories: cats.map((c) => ({ name_bg: c.name_bg, name_en: c.name_en, items: c.items.filter((i) => all || i.on).map(({ on: _on, ...i }) => i) })).filter((c) => c.items.length > 0) });
  const notes = lang === "bg" ? result.notes_bg : result.notes_en;
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-xl font-semibold">{t("extract.title")}</h2>
        <p className="mt-1 text-ink-soft">{t("extract.lead")}</p>
      </div>
      {notes && <p className="rounded-2xl bg-amber-soft p-3 text-sm"><span className="font-semibold">{t("extract.notes")}: </span>{notes}</p>}
      {cats.map((c, ci) => (
        <section key={ci} aria-label={(lang === "bg" ? c.name_bg : c.name_en) || c.name_bg || c.name_en}>
          <h3 className="font-semibold">{(lang === "bg" ? c.name_bg : c.name_en) || c.name_bg || c.name_en}</h3>
          <ul className="mt-2 grid gap-2">
            {c.items.map((it, ii) => (
              <li key={ii} className={`grid gap-2 rounded-2xl bg-card p-3 ring-1 ring-ink/10 ${it.on ? "" : "opacity-60"}`}>
                <label className="flex min-h-11 items-center gap-3 font-semibold">
                  <input type="checkbox" checked={it.on} onChange={(e) => patch(ci, ii, { on: e.target.checked })} className="size-5 accent-accent" />
                  <span>{t("extract.include")}: {(lang === "bg" ? it.name_bg : it.name_en) || it.name_bg || it.name_en} · {formatPrice(it.price_eur, lang)}</span>
                </label>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem]">
                  <TextField label={t("menu.item.nameBg")} value={it.name_bg} onChange={(name_bg) => patch(ci, ii, { name_bg })} />
                  <TextField label={t("menu.item.nameEn")} value={it.name_en} onChange={(name_en) => patch(ci, ii, { name_en })} />
                  <TextField label={t("menu.item.price")} value={String(it.price_eur)} type="number" inputMode="decimal" step="0.01" onChange={(v) => patch(ci, ii, { price_eur: Math.round(Number(v) * 100) / 100 || 0 })} />
                </div>
                <p className="text-xs text-ink-soft">
                  {it.currency_seen === "BGN" && <span className="mr-2 rounded-full bg-amber-soft px-2 py-0.5 font-semibold text-amber">{t("extract.bgn")}</span>}
                  {it.allergens.length > 0 && <span>{t("menu.item.allergens")}: {it.allergens.map((a) => `${a} ${allergenName(a, lang)}`).join(", ")}</span>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => accept(true)}>{t("extract.acceptAll")}</Button>
        <Button disabled={selected === 0} onClick={() => accept(false)}>{t("extract.acceptSelected", { n: selected })}</Button>
        <Button variant="quiet" onClick={onDiscard}>{t("extract.discard")}</Button>
      </div>
    </div>
  );
}
```

```tsx
// app/new/components/Steps/Texts.tsx
"use client";
import { useState } from "react";
import { api } from "../api";
import { Button, TextArea, TextField } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

export function Texts({ id, draft, update, aiAvailable }: StepProps) {
  const { t, lang } = useT();
  const [facts, setFacts] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function write() {
    setBusy(true);
    setError(null);
    const r = await api.texts(id, facts);
    setBusy(false);
    if (!r.ok) { setError(r.status === 503 ? t("texts.unavailable") : r.status === 400 ? (lang === "bg" ? r.error.bg : r.error.en) : t("texts.writeFailed")); return; }
    const d = r.data;
    update({ tagline_bg: d.tagline_bg, tagline_en: d.tagline_en, about_bg: d.about_bg, about_en: d.about_en, texts: { welcome: { bg: d.welcome_bg, en: d.welcome_en }, footer_note: { bg: d.footer_note_bg, en: d.footer_note_en } } });
  }
  const setText = (key: "welcome" | "footer_note", l: "bg" | "en", v: string) => update({ texts: { ...draft.texts, [key]: { ...draft.texts[key], [l]: v } } });
  return (
    <div className="grid gap-6">
      <section className="rounded-2xl bg-paper-deep p-4">
        {aiAvailable ? (
          <>
            <TextArea label={t("texts.facts")} hint={t("texts.factsHint")} value={facts} rows={4} maxLength={2000} onChange={setFacts} />
            <div className="mt-3"><Button variant="primary" disabled={busy || facts.trim().length === 0} aria-busy={busy} onClick={() => void write()}>{busy ? t("texts.writing") : t("texts.write")}</Button></div>
          </>
        ) : (
          <p className="text-sm text-ink-soft">{t("texts.unavailable")}</p>
        )}
        <p aria-live="polite" className="mt-2 min-h-5 text-sm font-semibold text-clay">{error ?? ""}</p>
      </section>
      <p className="text-sm text-ink-soft">{t("texts.bothHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("texts.tagline.bg")} value={draft.tagline_bg} maxLength={160} lang="bg" onChange={(tagline_bg) => update({ tagline_bg })} />
        <TextField label={t("texts.tagline.en")} value={draft.tagline_en} maxLength={160} lang="en" onChange={(tagline_en) => update({ tagline_en })} />
        <TextArea label={t("texts.about.bg")} value={draft.about_bg} rows={5} maxLength={2000} lang="bg" onChange={(about_bg) => update({ about_bg })} />
        <TextArea label={t("texts.about.en")} value={draft.about_en} rows={5} maxLength={2000} lang="en" onChange={(about_en) => update({ about_en })} />
        <TextField label={t("texts.welcome.bg")} value={draft.texts.welcome.bg} maxLength={400} lang="bg" onChange={(v) => setText("welcome", "bg", v)} />
        <TextField label={t("texts.welcome.en")} value={draft.texts.welcome.en} maxLength={400} lang="en" onChange={(v) => setText("welcome", "en", v)} />
        <TextField label={t("texts.footer.bg")} value={draft.texts.footer_note.bg} maxLength={400} lang="bg" onChange={(v) => setText("footer_note", "bg", v)} />
        <TextField label={t("texts.footer.en")} value={draft.texts.footer_note.en} maxLength={400} lang="en" onChange={(v) => setText("footer_note", "en", v)} />
      </div>
    </div>
  );
}
```

```tsx
// app/new/components/Steps/Photos.tsx
"use client";
import { useState } from "react";
import { moveIndex } from "@/src/wizard/edit";
import { api } from "../api";
import { Button, FileButton } from "../Field";
import { MediaThumb } from "../MediaThumb";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

export function Photos({ id, draft, media, update, addMedia }: StepProps) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0);
  const ids = draft.gallery_media_ids;
  async function upload(files: File[]) {
    setBusy(true);
    setFailed(0);
    const added: string[] = [];
    for (const f of files) {
      const r = await api.upload(id, f);
      if (r.ok) { addMedia(r.data.media, f); added.push(r.data.media.id); } else setFailed((n) => n + 1);
    }
    if (added.length) update({ gallery_media_ids: [...ids, ...added] });
    setBusy(false);
  }
  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-soft">{t("photos.hint")}</p>
      <div><FileButton label={busy ? t("look.uploading") : t("photos.add")} accept="image/*" multiple disabled={busy} onFiles={(f) => void upload(f)} /></div>
      <p aria-live="polite" className="min-h-5 text-sm font-semibold text-clay">{failed ? t("look.uploadFailed") : ""}</p>
      {ids.length === 0 && <p className="text-ink-soft">{t("photos.empty")}</p>}
      <ol className="grid gap-3 sm:grid-cols-2" aria-label={t("photos.title")}>
        {ids.map((mid, i) => (
          <li key={mid} className="grid gap-2 rounded-2xl bg-card p-3 ring-1 ring-ink/10">
            <MediaThumb media={media.find((m) => m.id === mid)} alt={t("photos.photo", { n: i + 1 })} className="aspect-[4/3] w-full" />
            <div className="flex flex-wrap gap-1">
              <Button variant="quiet" disabled={i === 0} aria-label={`${t("menu.moveUp")}: ${t("photos.photo", { n: i + 1 })}`} onClick={() => update({ gallery_media_ids: moveIndex(ids, i, i - 1) })}>{t("menu.moveUp")}</Button>
              <Button variant="quiet" disabled={i === ids.length - 1} aria-label={`${t("menu.moveDown")}: ${t("photos.photo", { n: i + 1 })}`} onClick={() => update({ gallery_media_ids: moveIndex(ids, i, i + 1) })}>{t("menu.moveDown")}</Button>
              <Button variant="quiet" aria-label={`${t("photos.remove")}: ${t("photos.photo", { n: i + 1 })}`} onClick={() => update({ gallery_media_ids: ids.filter((x) => x !== mid) })}>{t("photos.remove")}</Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

```tsx
// app/new/components/Steps/Review.tsx
"use client";
import { useState } from "react";
import { WEEKDAYS } from "@/src/domain/types";
import { stepForPath, type PublishError, type WizardStep } from "@/src/wizard/schema";
import { api } from "../api";
import { Button } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

export function Review({ id, draft, errors, goTo, onPublished, baseUrl }: StepProps & { errors: PublishError[]; goTo: (s: WizardStep) => void; onPublished: (adminUrl: string) => void }) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const openDays = WEEKDAYS.filter((d) => draft.hours[d]).length;
  const items = draft.categories.reduce((n, c) => n + c.items.length, 0);
  async function create() {
    setBusy(true);
    setFailed(null);
    const r = await api.publish(id);
    if (!r.ok) { setFailed(lang === "bg" ? r.error.bg : r.error.en); setBusy(false); return; }
    onPublished(r.data.admin_url);
  }
  const rows: [string, string][] = [
    [t("review.name"), draft.name || "—"],
    [t("review.address"), draft.slug ? `${baseUrl}/${draft.slug}` : "—"],
    [t("review.template"), t(`chooser.template.${draft.template}` as "chooser.template.classic")],
    [t("review.hours"), t("review.hoursSummary", { open: openDays, closed: 7 - openDays })],
    [t("review.menu"), t("review.menuSummary", { items, cats: draft.categories.length })],
    [t("review.photos"), t("review.photosSummary", { n: draft.gallery_media_ids.length })],
  ];
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-xl font-semibold">{t("review.title")}</h2>
        <p className="mt-1 text-ink-soft">{t("review.lead")}</p>
      </div>
      <dl className="grid gap-2 rounded-2xl bg-card p-4 ring-1 ring-ink/10 sm:grid-cols-[10rem_1fr]">
        {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-sm font-semibold text-ink-soft">{k}</dt><dd className="[overflow-wrap:anywhere]">{v}</dd></div>))}
      </dl>
      {errors.length > 0 && (
        <div role="alert" className="rounded-2xl bg-clay-soft p-4">
          <p className="font-semibold">{t("review.problems")}</p>
          <ul className="mt-2 grid gap-2">
            {errors.map((e) => (
              <li key={e.path} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{lang === "bg" ? e.bg : e.en}</span>
                <Button variant="quiet" onClick={() => goTo(stepForPath(e.path))}>{t("review.fix")}: {t(`step.${stepForPath(e.path)}` as "step.basics")}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <Button variant="primary" className="w-full sm:w-auto" disabled={busy || errors.length > 0} aria-busy={busy} onClick={() => void create()}>{busy ? t("review.creating") : t("review.create")}</Button>
        <p aria-live="polite" className="mt-2 min-h-5 text-sm font-semibold text-clay">{failed ?? ""}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Write the render tests**

```ts
// test/wizard-ui.test.ts
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { WIZARD_BG, WIZARD_EN } from "@/src/i18n/wizard";
import { emptyDraft, validateForPublish } from "@/src/wizard/schema";
import { Basics } from "@/app/new/components/Steps/Basics";
import { ExtractReview } from "@/app/new/components/Steps/ExtractReview";
import { Hours } from "@/app/new/components/Steps/Hours";
import { Look } from "@/app/new/components/Steps/Look";
import { Menu } from "@/app/new/components/Steps/Menu";
import { Photos } from "@/app/new/components/Steps/Photos";
import { Review } from "@/app/new/components/Steps/Review";
import { Texts } from "@/app/new/components/Steps/Texts";
import { NoDraft } from "@/app/new/components/NoDraft";
import { Stepper } from "@/app/new/components/Stepper";
import type { StepProps } from "@/app/new/components/types";
import { media } from "./fixtures";

const render = (lang: Lang, el: ReactElement) => renderToStaticMarkup(createElement(LangProvider, { defaultLang: lang }, el));
const noop = () => undefined;
function props(over: Partial<StepProps> = {}): StepProps {
  const draft = emptyDraft("classic");
  draft.categories = [{ key: "c1", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "i1", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [7], image_media_id: null }] }];
  draft.gallery_media_ids = ["m2"];
  return { id: "v1", draft, media: [media("m1"), media("m2")], update: noop, addMedia: noop, baseUrl: "https://site.example", aiAvailable: true, serverErrors: [], ...over };
}

describe("wizard dictionary", () => {
  it("has the same keys in both languages, no empty strings, Bulgarian is not English", () => {
    const bg = Object.keys(WIZARD_BG).sort();
    const en = Object.keys(WIZARD_EN).sort();
    expect(bg).toEqual(en);
    for (const k of bg) {
      expect(WIZARD_BG[k as keyof typeof WIZARD_BG].length, `bg ${k}`).toBeGreaterThan(0);
      expect(WIZARD_EN[k as keyof typeof WIZARD_EN].length, `en ${k}`).toBeGreaterThan(0);
    }
    expect(WIZARD_BG["review.create"]).toBe("Създай сайта ми");
    expect(WIZARD_EN["review.create"]).toBe("Create my site");
  });
});

describe("step components render labelled fields in both languages", () => {
  const cases: [string, (p: StepProps) => ReactElement, string, string][] = [
    ["Basics", (p) => createElement(Basics, p), "Име на заведението", "Venue name"],
    ["Look", (p) => createElement(Look, p), "Основен цвят", "Accent colour"],
    ["Hours", (p) => createElement(Hours, p), "Понеделник", "Monday"],
    ["Menu", (p) => createElement(Menu, p), "Качете сегашното си меню", "Upload your current menu"],
    ["Texts", (p) => createElement(Texts, p), "Напиши вместо мен", "Write for me"],
    ["Photos", (p) => createElement(Photos, p), "Добави снимки", "Add photos"],
    ["Review", (p) => createElement(Review, { ...p, errors: [], goTo: noop, onPublished: noop }), "Създай сайта ми", "Create my site"],
  ];
  for (const [name, make, bgLabel, enLabel] of cases) {
    it(`${name}: bg and en`, () => {
      const bg = render("bg", make(props()));
      const en = render("en", make(props()));
      expect(bg).toContain(bgLabel);
      expect(en).toContain(enLabel);
      expect(bg).not.toContain(enLabel);
    });
  }
  it("Basics shows the slug prefix, the required name and a server slug error", () => {
    const html = render("en", createElement(Basics, props({ serverErrors: [{ path: "slug", bg: "Зает", en: "Taken" }] })));
    expect(html).toContain("site.example/");
    expect(html).toContain('required=""');
    expect(html).toContain("Taken");
    expect(html).toContain('aria-invalid="true"');
  });
  it("Menu lists the dish, its allergen chip pressed, and the move/remove buttons", () => {
    const html = render("bg", createElement(Menu, props()));
    expect(html).toContain("Еспресо");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Премести нагоре");
    expect(html).toContain("Премахни продукта");
    expect(html).toContain('role="tablist"');
  });
  it("Menu and Texts explain when AI is unavailable", () => {
    expect(render("en", createElement(Menu, props({ aiAvailable: false })))).toContain("not enabled on this server");
    expect(render("bg", createElement(Texts, props({ aiAvailable: false })))).toContain("не е включено на този сървър");
    expect(render("en", createElement(Texts, props({ aiAvailable: false })))).not.toContain("Write for me");
  });
  it("Photos renders the gallery order with a placeholder for unrenderable media", () => {
    const html = render("en", createElement(Photos, props()));
    expect(html).toContain("Photo 1");
    expect(html).toContain('src="https://cdn.example/v1/m2.jpg"');
    expect(html).toContain("Remove from gallery");
  });
  it("Review lists validation errors with Fix buttons and disables Create", () => {
    const draft = emptyDraft("lumen");
    const r = validateForPublish(draft);
    const errors = r.ok ? [] : r.errors;
    const html = render("en", createElement(Review, { ...props({ draft }), errors, goTo: noop, onPublished: noop }));
    expect(html).toContain("Before we create the site:");
    expect(html).toContain("Enter the venue's name.");
    expect(html).toContain("Fix: Basics");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Lumen");
  });
  it("ExtractReview shows rows with the BGN flag and the accept buttons", () => {
    const html = render("bg", createElement(ExtractReview, {
      result: { categories: [{ name_bg: "Кафе", name_en: "Coffee", items: [{ name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "", desc_en: "", price_eur: 2.56, currency_seen: "BGN", allergens: [7] }] }], notes_bg: "Една цена не се чете.", notes_en: "" },
      onAccept: noop, onDiscard: noop,
    }));
    expect(html).toContain("Проверете какво прочетохме");
    expect(html).toContain("Преизчислено от лева");
    expect(html).toContain("Добави избраните (1)");
    expect(html).toContain("Една цена не се чете.");
    expect(html).toContain("2,56 €");
  });
  it("Stepper marks the current step and numbers all seven", () => {
    const html = render("en", createElement(Stepper, { current: "hours", onSelect: noop }));
    expect(html).toContain("Step 3 of 7");
    expect(html).toContain('aria-current="step"');
    expect((html.match(/<li>/g) ?? []).length).toBe(7);
  });
  it("NoDraft links back to the chooser", () => {
    const html = render("bg", createElement(NoDraft));
    expect(html).toContain('href="/new"');
    expect(html).toContain("Изберете дизайн");
  });
});
```

- [ ] **Step 10: Run the UI tests, typecheck, build, visual pass**

`npm test -- test/wizard-ui.test.ts test/wizard-edit.test.ts` → PASS (13 tests). None of the imported files reach `@/src/templates`; if one does, vitest fails with `TypeError: ... is not a function` from `next/font/google` — move that import into `Preview.tsx`/`TemplateChooser.tsx`.

`npm run typecheck` → clean. `npm run build` → green (the pages are dynamic). Then the design pass under the skills on `SITE_MANAGER_STORE=memory npm run dev` → `/new`: three cards; pick Nocturne → `/new/<id>`: fill Basics (slug auto-fills from the name: "Кафене „Ъгъла“" → `kafene-agala`), Look (upload a PNG: it appears in the preview at once via the blob URL), Hours (copy Monday), Menu (add a category and a dish; with no key the dropzone explains itself), Texts, Photos, Review → Create → the browser goes to `/new/<id>/done?key=…` (404 until Task 10 lands; the venue is live, `/<slug>` renders the chosen template). Check 360 px (no horizontal scroll, the bottom "Preview" button opens the sheet, Escape closes it), keyboard-only through every step (focus lands on the step heading after Next/Back), VoiceOver reads the autosave status, `prefers-reduced-motion` disables the card lift. Record screenshots at 360/768/1280 in both languages in the task report. Reviewer: `review-animations` + `web-design-guidelines` on `app/new/**`; Lighthouse accessibility ≥ 95 on both pages.

- [ ] **Step 11: Commit**

```bash
git add src/i18n/wizard.ts src/wizard/edit.ts src/wizard/demo-state.ts app/new test/wizard-ui.test.ts test/wizard-edit.test.ts
git commit -m "Wizard UI: template chooser, seven-step form with autosave, live template preview, menu table and extraction review

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: fable

---


### Task 10: Done page (QR, `/start` link, status polling) and the dashboard "Your site" card with template switch

> **Rulings that apply to this task:** R3, R7, R8, R13, R14, R19 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Create: `src/server/draft-cookie.ts`, `app/new/[id]/done/page.tsx`, `app/new/[id]/done/DoneStatus.tsx`, `app/admin/[slug]/components/SiteCard.tsx`
- Modify: `src/i18n/dicts.ts`, `src/server/admin.ts`, `app/api/admin/[slug]/route.ts`, `app/admin/[slug]/components/useAdminOverview.ts`, `app/admin/[slug]/components/AdminPanel.tsx`
- Test: `test/wizard-done.test.ts`, `test/admin-site.test.ts`

**Interfaces:**
- Consumes: `Venue` with `template`, `status`, `deploy: DeployInfo | null` and `DeployInfo`, `TemplateId`, `TEMPLATE_IDS`, `VenueStatus` (Task 1, spec contract); `Store.updateVenue(id, patch)`, `Store.setDeploy(id, deploy)`, `Store.findVenueByDraftToken(tokenHash)`, `Store.listMembers(venueId)`, `Store.createInvite(venueId, role, expiresAt)`, `Store.getAdminToken(venueId)` (Task 1 / existing); `sha256Hex` from `src/server/hash.ts` (Task 1 or 7, spec contract); `Deployer.redeploy(projectId, { slug, templateId, feedUrl })` and `FakeDeployer` (Task 6, `src/deploy/types.ts`, `src/deploy/fake.ts`); `ServerDeps.deployer` and `Config.telegramBotUsername`, `Config.publicBaseUrl` (Task 6); `GET /api/new/[id]/status` → `{ status: VenueStatus; deploy: DeployInfo | null; site_url: string | null }` (Task 7, cookie-authenticated, same-origin fetch sends the cookie); `POST /api/tick?key=<admin token>` (existing, `src/server/tick.ts`); `INVITE_TTL_MS` from `src/bot/bot.ts` (7 days); `QRCodeSVG` from `qrcode.react` (already a dependency); `adminOverview`, `adminAction` (existing `src/server/admin.ts`).
- Assumed from Task 9 (wizard UI): after a successful publish the UI navigates to `/new/<id>/done?code=<invite_code>&key=<admin token>` (the key is the last path segment of `admin_url`). The done page also works without either param (see Step 4).
- Produces: `DRAFT_COOKIE = "sm_draft"`, `parseDraftCookie(value): { id; token } | null`, `venueFromDraftCookie(store, value, pathId): Promise<Venue | null>` (`src/server/draft-cookie.ts`); `DoneStatus` props `{ id; slug; code: string | null; startUrl: string | null; adminKey; baseUrl; initial: DoneStatusResponse; fetcher?: typeof fetch }`, `phaseOf(s): "waiting" | "publishing" | "live" | "error"`; `AdminOverview` gains `template: TemplateId; status: VenueStatus; deploy: DeployInfo | null; site_url: string`; `AdminSiteDeps = { store; deployer; feedUrlFor; now }`; `setTemplate(d: AdminSiteDeps, venue, template: unknown): Promise<{ ok: true; template: TemplateId; deploy: DeployInfo | null } | { ok: false; error: string }>`; `POST /api/admin/[slug]?key=` accepts `{ action: "set_template", template }`; `useAdminOverview` returns `post(body)` (`Post` type) used by Task 11.

> **Note (channels branch, `build/channels`):** render `startLinks(config, code)` next to the Telegram QR, see `src/channels/links.ts` (Messenger, Instagram and WhatsApp deep links for the enabled channels).

- [ ] **Step 1: Dictionary keys**

In `src/i18n/dicts.ts`, `en` object, after `"admin.details": "Before → after",` add:

```ts
  "admin.yourSite": "Your site",
  "admin.deploy.none": "Not published yet: press Start in Telegram.",
  "admin.deploy.pending": "Queued",
  "admin.deploy.building": "Publishing…",
  "admin.deploy.ready": "Live",
  "admin.deploy.error": "Publishing failed",
  "admin.lastUpdate": "last update {when}",
  "admin.template": "Template",
  "admin.template.classic": "Classic",
  "admin.template.nocturne": "Nocturne",
  "admin.template.lumen": "Lumen",
  "admin.changeTemplate": "Change template",
  "admin.templateChanged": "Template changed. The site is republishing; this takes a minute or two.",
  "admin.templateChangedLocal": "Template changed.",
  "admin.busyPublishing": "The site is publishing right now. Try again in a minute.",
  // Wizard done page
  "done.title": "Your site is created",
  "done.lead": "One last step: press Start in Telegram so the bot knows you are the owner. Then we publish the site and message you when it is live.",
  "done.openTelegram": "Open Telegram",
  "done.codeLabel": "Or send this to the bot:",
  "done.copy": "Copy",
  "done.copied": "Copied",
  "done.expires": "The code works once and is valid for 7 days.",
  "done.joined": "Telegram is connected.",
  "done.qr": "Scan with your phone to open the bot",
  "done.statusTitle": "Publishing status",
  "done.waiting": "Waiting for Telegram…",
  "done.publishing": "Publishing your site… this takes a minute or two.",
  "done.live": "Live at",
  "done.error": "Publishing hit a snag. We'll retry; if it stays like this, message the bot.",
  "done.hosted": "Your site on Site Manager",
  "done.dashboard": "Dashboard",
```

`bg` object, after `"admin.details": "Преди → след",` add:

```ts
  "admin.yourSite": "Вашият сайт",
  "admin.deploy.none": "Още не е публикуван: натиснете Start в Telegram.",
  "admin.deploy.pending": "На опашка",
  "admin.deploy.building": "Публикува се…",
  "admin.deploy.ready": "На живо",
  "admin.deploy.error": "Публикуването не успя",
  "admin.lastUpdate": "последна промяна {when}",
  "admin.template": "Шаблон",
  "admin.template.classic": "Класик",
  "admin.template.nocturne": "Ноктюрн",
  "admin.template.lumen": "Лумен",
  "admin.changeTemplate": "Смени шаблона",
  "admin.templateChanged": "Шаблонът е сменен. Сайтът се публикува отново; отнема минута-две.",
  "admin.templateChangedLocal": "Шаблонът е сменен.",
  "admin.busyPublishing": "Сайтът се публикува в момента. Опитайте след минута.",
  "done.title": "Сайтът ви е създаден",
  "done.lead": "Последна стъпка: натиснете Start в Telegram, за да знае ботът, че вие сте собственикът. После публикуваме сайта и ви пишем, когато е готов.",
  "done.openTelegram": "Отворете Telegram",
  "done.codeLabel": "Или изпратете това на бота:",
  "done.copy": "Копирай",
  "done.copied": "Копирано",
  "done.expires": "Кодът работи еднократно и важи 7 дни.",
  "done.joined": "Telegram е свързан.",
  "done.qr": "Сканирайте с телефона, за да отворите бота",
  "done.statusTitle": "Статус на публикуването",
  "done.waiting": "Чакаме Telegram…",
  "done.publishing": "Публикуваме сайта ви… отнема минута-две.",
  "done.live": "На живо на",
  "done.error": "Публикуването се запъна. Ще опитаме пак; ако остане така, пишете на бота.",
  "done.hosted": "Сайтът ви в Site Manager",
  "done.dashboard": "Табло",
```

Run `npm test -- test/i18n.test.ts` → PASS.

- [ ] **Step 2: Failing tests for the done page component and the template switch**

```ts
// test/wizard-done.test.ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeployInfo, Lang } from "@/src/domain/types";
import { LangProvider } from "@/src/i18n";
import { DoneStatus, phaseOf, type DoneStatusResponse } from "@/app/new/[id]/done/DoneStatus";

const deploy = (status: DeployInfo["status"], url: string | null = null): DeployInfo =>
  ({ provider: "fake", project_id: "prj_1", deployment_id: "dpl_1", url, status, error: null, template: "nocturne", updated_at: "2026-10-10T10:00:00.000Z" });

function render(lang: Lang, initial: DoneStatusResponse, over: Partial<Parameters<typeof DoneStatus>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(LangProvider, { defaultLang: lang },
      createElement(DoneStatus, { id: "v1", slug: "bar", code: "ABCD2345", startUrl: "https://t.me/site_manager_bot?start=ABCD2345", adminKey: "k1", baseUrl: "https://site.example", initial, ...over })),
  );
}

describe("phaseOf", () => {
  it("maps status + deploy to a phase", () => {
    expect(phaseOf({ status: "live", deploy: null, site_url: null })).toBe("waiting");
    expect(phaseOf({ status: "live", deploy: deploy("pending"), site_url: null })).toBe("publishing");
    expect(phaseOf({ status: "live", deploy: deploy("building"), site_url: null })).toBe("publishing");
    expect(phaseOf({ status: "live", deploy: deploy("ready", "https://bar.example.test"), site_url: "https://bar.example.test" })).toBe("live");
    expect(phaseOf({ status: "live", deploy: deploy("error"), site_url: null })).toBe("error");
  });
});

describe("DoneStatus", () => {
  const waiting: DoneStatusResponse = { status: "live", deploy: null, site_url: null };
  it("shows the code, the deep link, a QR and the waiting line in both languages", () => {
    const bg = render("bg", waiting);
    expect(bg).toContain("/start ABCD2345");
    expect(bg).toContain("https://t.me/site_manager_bot?start=ABCD2345");
    expect(bg).toContain("<svg");
    expect(bg).toContain("Чакаме Telegram");
    expect(bg).toContain("7 дни");
    expect(bg).toContain("https://site.example/bar");
    expect(bg).toContain("/admin/bar?key=k1");
    const en = render("en", waiting);
    expect(en).toContain("Waiting for Telegram");
    expect(en).toContain("7 days");
    expect(en).toContain('data-phase="waiting"');
  });
  it("encodes the raw code when the bot username is unknown", () => {
    const html = render("en", waiting, { startUrl: null });
    expect(html).not.toContain("t.me/");
    expect(html).toContain("/start ABCD2345");
    expect(html).toContain("<svg");
  });
  it("hides the code once the owner has joined", () => {
    const html = render("en", waiting, { code: null, startUrl: null });
    expect(html).toContain("Telegram is connected.");
    expect(html).not.toContain("/start");
  });
  it("shows publishing, live (as a link) and error lines", () => {
    expect(render("bg", { status: "live", deploy: deploy("building"), site_url: null })).toContain("Публикуваме сайта ви");
    expect(render("en", { status: "live", deploy: deploy("building"), site_url: null })).toContain('data-phase="publishing"');
    const live = render("en", { status: "live", deploy: deploy("ready", "https://bar.example.test"), site_url: "https://bar.example.test" });
    expect(live).toContain('href="https://bar.example.test"');
    expect(live).toContain("Live at");
    expect(render("bg", { status: "live", deploy: deploy("ready", "https://bar.example.test"), site_url: "https://bar.example.test" })).toContain("На живо на");
    expect(render("en", { status: "live", deploy: deploy("error"), site_url: null })).toContain("hit a snag");
    expect(render("bg", { status: "live", deploy: deploy("error"), site_url: null })).toContain("запъна");
  });
});
```

```ts
// test/admin-site.test.ts
import { describe, expect, it } from "vitest";
import { FakeDeployer } from "@/src/deploy/fake";
import type { DeployInfo } from "@/src/domain/types";
import { adminOverview, setTemplate } from "@/src/server/admin";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-10T10:00:00.000Z");
const ready: DeployInfo = { provider: "fake", project_id: "prj_1", deployment_id: "dpl_1", url: "https://agala.example.test", status: "ready", error: null, template: "classic", updated_at: "2026-10-10T09:00:00.000Z" };

function deps(store: Awaited<ReturnType<typeof makeDemo>>["store"]) {
  return { store, deployer: new FakeDeployer(), feedUrlFor: (slug: string) => `https://site.example/api/site/${slug}`, now: () => T0 };
}

describe("set_template", () => {
  it("changes the template and redeploys when the site is deployed", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const r = await setTemplate(deps(store), await store.getVenue(venue.id), "nocturne");
    expect(r).toMatchObject({ ok: true, template: "nocturne" });
    const after = await store.getVenue(venue.id);
    expect(after.template).toBe("nocturne");
    expect(after.deploy).toMatchObject({ status: "building", template: "nocturne", project_id: "prj_1", error: null, updated_at: T0.toISOString() });
    expect(after.deploy?.deployment_id).not.toBe("dpl_1");
    const o = await adminOverview(store, after, T0, "https://site.example");
    expect(o).toMatchObject({ template: "nocturne", status: "live", site_url: "https://site.example/agala" });
    expect(o.deploy?.status).toBe("building");
  });
  it("only updates the venue when there is no deploy; the overview shows the provider URL once ready", async () => {
    const { store, venue } = await makeDemo();
    expect(await setTemplate(deps(store), venue, "lumen")).toEqual({ ok: true, template: "lumen", deploy: null });
    expect((await store.getVenue(venue.id)).template).toBe("lumen");
    await store.setDeploy(venue.id, ready);
    const o = await adminOverview(store, await store.getVenue(venue.id), T0, "https://site.example");
    expect(o.site_url).toBe("https://agala.example.test");
    expect(o.deploy).toEqual(ready);
  });
  it("rejects unknown templates and refuses while a deploy is in flight", async () => {
    const { store, venue } = await makeDemo();
    expect(await setTemplate(deps(store), venue, "neon")).toEqual({ ok: false, error: "Unknown template." });
    expect(await setTemplate(deps(store), venue, 42)).toEqual({ ok: false, error: "Unknown template." });
    await store.setDeploy(venue.id, { ...ready, status: "building" });
    expect(await setTemplate(deps(store), await store.getVenue(venue.id), "nocturne")).toEqual({ ok: false, error: "The site is publishing right now." });
    expect((await store.getVenue(venue.id)).template).toBe("classic");
  });
});
```

Run `npm test -- test/wizard-done.test.ts test/admin-site.test.ts` → FAIL: `Cannot find module '@/app/new/[id]/done/DoneStatus'` and `setTemplate` is not exported.

- [ ] **Step 3: Cookie helper**

```ts
// src/server/draft-cookie.ts
// Server-only. The wizard cookie is the owner's proof for the done page: "<venueId>.<token>", httpOnly, 7 days (set by POST /api/new).
import type { Venue } from "../domain/types";
import type { Store } from "../store/types";
import { sha256Hex } from "./hash";

export const DRAFT_COOKIE = "sm_draft";

/** "<venueId>.<token>" → its parts; null when malformed. */
export function parseDraftCookie(value: string | undefined | null): { id: string; token: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const id = value.slice(0, dot);
  const token = value.slice(dot + 1);
  return /^[A-Za-z0-9_-]+$/.test(id) && /^[0-9a-f]+$/.test(token) ? { id, token } : null;
}

/** The venue this cookie proves ownership of, only when it is the one in the path. */
export async function venueFromDraftCookie(store: Store, value: string | undefined | null, pathId: string): Promise<Venue | null> {
  const c = parseDraftCookie(value);
  if (!c || c.id !== pathId) return null;
  const venue = await store.findVenueByDraftToken(sha256Hex(c.token));
  return venue && venue.id === pathId ? venue : null;
}
```

- [ ] **Step 4: Done page (server) and `DoneStatus` (client)**

```tsx
// app/new/[id]/done/page.tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { INVITE_TTL_MS } from "@/src/bot/bot";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { getServerDeps } from "@/src/server/deps";
import { DRAFT_COOKIE, venueFromDraftCookie } from "@/src/server/draft-cookie";
import { DoneStatus } from "./DoneStatus";

export const dynamic = "force-dynamic";

// The admin key and the invite code sit in this page's URL: no indexing, no Referer. next.config.ts already keeps ?key= out of the request log.
export const metadata: Metadata = {
  title: `${DICTS.bg["done.title"]} · ${DICTS.en["done.title"]}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function Page(props: PageProps<"/new/[id]/done">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const deps = await getServerDeps((fn) => after(fn));
  const jar = await cookies();
  const venue = await venueFromDraftCookie(deps.store, jar.get(DRAFT_COOKIE)?.value, id);
  if (!venue) notFound();
  if (venue.status !== "live") redirect(`/new/${id}`);
  const joined = (await deps.store.listMembers(venue.id)).some((m) => m.role === "owner");
  // The publish redirect carries the fresh invite code. A reload without it gets a new single-use code (7 days), unless the owner already pressed Start.
  const code = joined ? null : (one(sp.code) ?? (await deps.store.createInvite(venue.id, "owner", new Date(Date.now() + INVITE_TTL_MS).toISOString())));
  const adminKey = one(sp.key) ?? (await deps.store.getAdminToken(venue.id));
  const bot = deps.config.telegramBotUsername;
  const initial = { status: venue.status, deploy: venue.deploy, site_url: venue.deploy?.status === "ready" ? venue.deploy.url : null };
  return (
    <LangProvider defaultLang={venue.default_lang}>
      <DoneStatus id={id} slug={venue.slug} code={code} startUrl={bot && code ? `https://t.me/${bot}?start=${code}` : null} adminKey={adminKey} baseUrl={deps.config.publicBaseUrl} initial={initial} />
    </LangProvider>
  );
}
```

```tsx
// app/new/[id]/done/DoneStatus.tsx
"use client";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import type { DeployInfo, VenueStatus } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";

export interface DoneStatusResponse { status: VenueStatus; deploy: DeployInfo | null; site_url: string | null }
export type Phase = "waiting" | "publishing" | "live" | "error";

export function phaseOf(s: DoneStatusResponse): Phase {
  if (!s.deploy) return "waiting";
  if (s.deploy.status === "ready") return "live";
  if (s.deploy.status === "error") return "error";
  return "publishing";
}

const POLL_MS = 5_000;
const TICK_MS = 30_000;
const TICK_WINDOW_MS = 10 * 60_000;
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

interface Props {
  id: string;
  slug: string;
  /** null once the owner has joined (or when the page cannot show one). */
  code: string | null;
  /** https://t.me/<bot>?start=<code>, null when TELEGRAM_BOT_USERNAME is not set. */
  startUrl: string | null;
  adminKey: string;
  baseUrl: string;
  initial: DoneStatusResponse;
  fetcher?: typeof fetch;
}

/** Telegram hand-off (QR + deep link + raw code), then a status line polled every 5 s until the site is live. */
export function DoneStatus({ id, slug, code, startUrl, adminKey, baseUrl, initial, fetcher = defaultFetch }: Props) {
  const { t } = useLang();
  const [status, setStatus] = useState(initial);
  const [copied, setCopied] = useState(false);
  const started = useRef<number | null>(null);
  const phase = phaseOf(status);

  useEffect(() => {
    if (phase === "live") return;
    let stop = false;
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      try {
        const res = await fetcher(`/api/new/${encodeURIComponent(id)}/status`, { cache: "no-store" });
        if (!res.ok || stop || mine !== seq) return;
        const data = (await res.json()) as DoneStatusResponse;
        if (!stop && mine === seq) setStatus(data);
      } catch {
        // keep the last status; the next poll retries
      }
    };
    const poll = window.setInterval(() => void load(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(poll);
    };
  }, [id, phase, fetcher]);

  // Vercel cron is daily: while publishing, nudge the tick with the owner's key (allowed by ?key= auth) for the first 10 minutes,
  // so the deploy is polled and the "your site is live" Telegram message goes out promptly.
  useEffect(() => {
    if (phase !== "publishing") return;
    started.current ??= Date.now();
    const nudge = () => {
      if (Date.now() - (started.current ?? Date.now()) > TICK_WINDOW_MS) return;
      void fetcher(`/api/tick?key=${encodeURIComponent(adminKey)}`, { method: "POST" }).catch(() => undefined);
    };
    nudge();
    const timer = window.setInterval(nudge, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, adminKey, fetcher]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`/start ${code}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the code is still visible to copy by hand
    }
  }

  const hostedUrl = `${baseUrl}/${slug}`;
  const adminUrl = `/admin/${slug}?key=${encodeURIComponent(adminKey)}`;
  const liveUrl = status.site_url ?? status.deploy?.url ?? null;
  const dot = phase === "live" ? "bg-accent" : phase === "error" ? "bg-clay" : "bg-amber";
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex justify-end"><LangToggle /></div>
      <h1 className="mt-4 text-3xl font-semibold text-balance sm:text-4xl">{t("done.title")}</h1>
      <p className="mt-3 text-lg text-ink-soft">{t("done.lead")}</p>

      {code ? (
        <section aria-labelledby="tg" className="mt-8 rounded-3xl bg-card p-5 ring-1 ring-ink/10">
          <h2 id="tg" className="sr-only">Telegram</h2>
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
            <div className="rounded-2xl bg-white p-2 ring-1 ring-ink/10">
              <QRCodeSVG value={startUrl ?? code} size={180} marginSize={2} level="M" role="img" aria-label={t("done.qr")} />
            </div>
            <div className="min-w-0 flex-1">
              {startUrl && (
                <a href={startUrl} className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110">{t("done.openTelegram")}</a>
              )}
              <p className="mt-4 text-sm text-ink-soft">{t("done.codeLabel")}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <code className="rounded-xl bg-paper-deep px-3 py-2 font-mono text-lg tracking-wider">/start {code}</code>
                <button type="button" onClick={() => void copy()} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-ink/25 hover:bg-ink/5">{copied ? t("done.copied") : t("done.copy")}</button>
              </p>
              <p className="mt-3 text-xs text-ink-soft">{t("done.expires")}</p>
            </div>
          </div>
        </section>
      ) : (
        <p className="mt-8 rounded-2xl bg-accent-soft px-4 py-3 font-semibold">{t("done.joined")}</p>
      )}

      <section aria-labelledby="status" aria-live="polite" className="mt-6 rounded-3xl bg-card p-5 ring-1 ring-ink/10">
        <h2 id="status" className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("done.statusTitle")}</h2>
        <p data-phase={phase} className="mt-2 flex items-center gap-2.5 text-lg font-semibold">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${dot} ${phase === "publishing" ? "animate-pulse" : ""}`} />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {phase === "waiting" && t("done.waiting")}
            {phase === "publishing" && t("done.publishing")}
            {phase === "live" && (liveUrl ? <>{t("done.live")} <a href={liveUrl} className="underline underline-offset-4">{liveUrl}</a></> : t("done.live"))}
            {phase === "error" && t("done.error")}
          </span>
        </p>
      </section>

      <ul className="mt-6 grid gap-2">
        <li>
          <a href={hostedUrl} className="flex min-h-11 flex-col justify-center rounded-2xl bg-card px-4 py-2 ring-1 ring-ink/10 hover:ring-accent/50">
            <span className="font-semibold">{t("done.hosted")}</span>
            <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">{hostedUrl}</span>
          </a>
        </li>
        <li>
          <a href={adminUrl} className="flex min-h-11 items-center rounded-2xl bg-card px-4 py-2 font-semibold ring-1 ring-ink/10 hover:ring-accent/50">{t("done.dashboard")}</a>
        </li>
      </ul>
    </main>
  );
}
```

Run `npm test -- test/wizard-done.test.ts` → PASS (5 tests).

- [ ] **Step 5: `src/server/admin.ts`: overview fields and `setTemplate`**

Imports, old:

```ts
import { renderPreview } from "../domain/preview";
import type { ChangeSet, Venue } from "../domain/types";
import type { Store } from "../store/types";
```

new:

```ts
import { renderPreview } from "../domain/preview";
import { TEMPLATE_IDS, type ChangeSet, type DeployInfo, type TemplateId, type Venue, type VenueStatus } from "../domain/types";
import type { Deployer } from "../deploy/types";
import type { Store } from "../store/types";
```

`AdminOverview`, old:

```ts
  venue: Pick<Venue, "id" | "slug" | "name" | "tz" | "default_lang">;
  now: string;
  public_url: string;
```

new:

```ts
  venue: Pick<Venue, "id" | "slug" | "name" | "tz" | "default_lang">;
  now: string;
  public_url: string;
  template: TemplateId;
  status: VenueStatus;
  deploy: DeployInfo | null;
  /** The provider URL when the deploy is ready, otherwise our hosted copy. */
  site_url: string;
```

Return object in `adminOverview`, old:

```ts
    public_url: `${baseUrl}/${venue.slug}`,
    pending,
```

new:

```ts
    public_url: `${baseUrl}/${venue.slug}`,
    template: venue.template,
    status: venue.status,
    deploy: venue.deploy,
    site_url: venue.deploy?.status === "ready" && venue.deploy.url ? venue.deploy.url : `${baseUrl}/${venue.slug}`,
    pending,
```

Append at the end of the file:

```ts
export type AdminSiteActionName = "set_template";
export interface AdminSiteDeps {
  store: Store;
  deployer: Deployer;
  feedUrlFor: (slug: string) => string;
  now: () => Date;
}

/** Dashboard "Change template": updates the venue (our /[slug] switches at once) and, when the site is deployed, redeploys it with the new template. */
export async function setTemplate(d: AdminSiteDeps, venue: Venue, template: unknown): Promise<{ ok: true; template: TemplateId; deploy: DeployInfo | null } | { ok: false; error: string }> {
  if (typeof template !== "string" || !(TEMPLATE_IDS as readonly string[]).includes(template)) return { ok: false, error: "Unknown template." };
  const id = template as TemplateId;
  const deploy = venue.deploy;
  if (deploy && (deploy.status === "pending" || deploy.status === "building")) return { ok: false, error: "The site is publishing right now." };
  await d.store.updateVenue(venue.id, { template: id });
  if (!deploy) return { ok: true, template: id, deploy: null };
  const updated_at = d.now().toISOString();
  let next: DeployInfo;
  try {
    const { deploymentId } = await d.deployer.redeploy(deploy.project_id, { slug: venue.slug, templateId: id, feedUrl: d.feedUrlFor(venue.slug) });
    next = { ...deploy, deployment_id: deploymentId, status: "building", error: null, template: id, updated_at };
  } catch {
    next = { ...deploy, status: "error", error: "Redeploy could not start.", template: id, updated_at }; // the provider message stays out of the stored record
  }
  await d.store.setDeploy(venue.id, next);
  return { ok: true, template: id, deploy: next };
}
```

Run `npm test -- test/admin-site.test.ts test/admin-server.test.ts` → PASS.

- [ ] **Step 6: Route: accept `set_template`**

Replace `app/api/admin/[slug]/route.ts` with:

```ts
import { after } from "next/server";
import { adminAction, adminOverview, setTemplate, type AdminActionName } from "@/src/server/admin";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

async function auth(req: Request, slug: string) {
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) return { deps, venue: null };
  return { deps, venue };
}

export async function GET(req: Request, ctx: RouteContext<"/api/admin/[slug]">) {
  const { slug } = await ctx.params;
  const { deps, venue } = await auth(req, slug);
  if (!venue) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await adminOverview(deps.store, venue, new Date(), deps.config.publicBaseUrl), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]">) {
  const { slug } = await ctx.params;
  const { deps, venue } = await auth(req, slug);
  if (!venue) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; change_set_id?: string; template?: unknown };
  const siteDeps = { store: deps.store, deployer: deps.deployer, feedUrlFor: (s: string) => `${deps.config.publicBaseUrl}/api/site/${s}`, now: () => new Date() };
  if (body.action === "set_template") {
    const r = await setTemplate(siteDeps, venue, body.template);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
  const actions: AdminActionName[] = ["apply", "reject", "cancel", "undo"];
  if (!actions.includes(body.action as AdminActionName) || typeof body.change_set_id !== "string") return Response.json({ error: "bad request" }, { status: 400 });
  const r = await adminAction({ store: deps.store, messenger: deps.messenger, now: () => new Date(), baseUrl: deps.config.publicBaseUrl }, venue, body.action as AdminActionName, body.change_set_id);
  return Response.json(r, { status: r.ok ? 200 : 409 });
}
```

- [ ] **Step 7: Dashboard: generic `post`, the `SiteCard`, panel wiring**

`app/admin/[slug]/components/useAdminOverview.ts`, old:

```ts
  const decide = useCallback(
    async (action: AdminActionName, changeSetId: string): Promise<boolean> => {
      let ok = false;
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, change_set_id: changeSetId }) });
        ok = res.ok;
      } catch {
        ok = false;
      }
      await load();
      return ok;
    },
    [url, load],
  );

  return { overview, unauthorized, decide };
}

export type Decide = ReturnType<typeof useAdminOverview>["decide"];
```

new:

```ts
  /** POSTs any dashboard action, then refetches at once. `data` is the parsed JSON (null on a network error). */
  const post = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> => {
      let out: { ok: boolean; data: unknown } = { ok: false, data: null };
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        out = { ok: res.ok, data: await res.json().catch(() => null) };
      } catch {
        out = { ok: false, data: null };
      }
      await load();
      return out;
    },
    [url, load],
  );

  const decide = useCallback(async (action: AdminActionName, changeSetId: string): Promise<boolean> => (await post({ action, change_set_id: changeSetId })).ok, [post]);

  return { overview, unauthorized, decide, post };
}

export type Decide = ReturnType<typeof useAdminOverview>["decide"];
export type Post = ReturnType<typeof useAdminOverview>["post"];
```

```tsx
// app/admin/[slug]/components/SiteCard.tsx
"use client";
import { useState, type FormEvent } from "react";
import { TEMPLATE_IDS, type TemplateId } from "@/src/domain/types";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import type { AdminOverview } from "@/src/server/admin";
import { formatDateTime } from "@/src/time";
import { Chip, Section } from "./bits";
import type { Post } from "./useAdminOverview";

/** "Your site": live URL, deploy status, template, last update, and the template switch (redeploys when the site is deployed). */
export function SiteCard({ overview: o, post }: { overview: AdminOverview; post: Post }) {
  const { lang, t } = useLang();
  const [template, setTemplate] = useState<TemplateId>(o.template);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "warn"; text: string } | null>(null);
  const d = o.deploy;
  const publishing = d?.status === "pending" || d?.status === "building";

  async function change(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await post({ action: "set_template", template });
    setMsg(r.ok ? { tone: "good", text: t(d ? "admin.templateChanged" : "admin.templateChangedLocal") } : { tone: "warn", text: publishing ? t("admin.busyPublishing") : t("admin.failed") });
    setBusy(false);
  }

  return (
    <Section id="your-site" title={t("admin.yourSite")}>
      <div className="rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <Chip tone={d?.status === "ready" ? "good" : d?.status === "error" ? "warn" : "plain"}>{d ? t(`admin.deploy.${d.status}` as MessageKey) : t("admin.deploy.none")}</Chip>
          <Chip>{t(`admin.template.${o.template}` as MessageKey)}</Chip>
          {d && <time dateTime={d.updated_at}>{t("admin.lastUpdate", { when: formatDateTime(d.updated_at, lang, o.venue.tz) })}</time>}
        </div>
        <a href={o.site_url} target="_blank" rel="noopener" className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-4 [overflow-wrap:anywhere] hover:text-accent">
          {o.site_url}<span className="sr-only"> {t("admin.newTab")}</span>
        </a>
        {d?.status === "error" && d.error && <p className="mt-1 text-sm text-clay">{d.error}</p>}
        <form onSubmit={(e) => void change(e)} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t("admin.template")}
            <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)} className="min-h-11 rounded-xl bg-paper px-3 ring-1 ring-ink/20">
              {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{t(`admin.template.${id}` as MessageKey)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || publishing || template === o.template} className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60">
            {busy ? t("admin.busy") : t("admin.changeTemplate")}
          </button>
        </form>
        {msg && <p role="status" className={`mt-2 text-sm font-semibold ${msg.tone === "good" ? "text-ink" : "text-clay"}`}>{msg.text}</p>}
      </div>
    </Section>
  );
}
```

`app/admin/[slug]/components/AdminPanel.tsx`, old:

```ts
import { QrCard } from "./QrCard";
import { useAdminOverview } from "./useAdminOverview";
```

new:

```ts
import { QrCard } from "./QrCard";
import { SiteCard } from "./SiteCard";
import { useAdminOverview } from "./useAdminOverview";
```

old:

```ts
  const { overview: o, unauthorized, decide } = useAdminOverview(initial, slug, adminKey);
```

new:

```ts
  const { overview: o, unauthorized, decide, post } = useAdminOverview(initial, slug, adminKey);
```

old:

```tsx
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <PendingList sets={o.pending} slug={slug} adminKey={adminKey} tz={tz} decide={decide} />
```

new:

```tsx
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <SiteCard overview={o} post={post} />
        <PendingList sets={o.pending} slug={slug} adminKey={adminKey} tz={tz} decide={decide} />
```

- [ ] **Step 8: Verify**

`npm test -- test/wizard-done.test.ts test/admin-site.test.ts test/admin-server.test.ts test/i18n.test.ts` → PASS. `npm run typecheck` → clean. `npm run build` → green (the done page compiles under `PageProps<"/new/[id]/done">`). Offline: `SITE_MANAGER_STORE=memory npm run dev`; open the admin link from the dev log; the "Your site" card shows "Not published yet", template "Classic"; change to "Nocturne" → message "Template changed."; `/agala` renders nocturne. Set a deploy with the dev console or by running the wizard end to end (Task 9) and pressing `/start` with `npm run bot:dev`; the done page then shows publishing → live (`FakeDeployer` is READY after two status calls, so within ~10 s of polling) and the card shows "Live" with the `https://<slug>.example.test` URL. Check the done page in both languages at 360 px (QR and code fit, no horizontal scroll), that `curl -I` of the page URL with the key returns `referrer-policy: no-referrer` and `x-robots-tag`/meta noindex, and that nothing in the dev log prints the key.

- [ ] **Step 9: Commit**

```bash
git add src/server/draft-cookie.ts app/new/[id]/done src/i18n/dicts.ts src/server/admin.ts app/api/admin/[slug]/route.ts app/admin/[slug]/components test/wizard-done.test.ts test/admin-site.test.ts
git commit -m "Wizard: done page with Telegram QR + status polling; dashboard Your site card with template switch and redeploy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: fable

---


### Task 11: Optional custom domain (Pro): connect, DNS records, check again

> **Rulings that apply to this task:** R6 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Create: `src/deploy/vercel-domains.ts`, `app/admin/[slug]/components/DomainCard.tsx`
- Modify: `src/domain/types.ts` (`DeployInfo.custom_domain?: string | null`, contract addition), `src/deploy/vercel.ts` (`addDomain` method), `src/deploy/fake.ts` (`addDomain` method), `src/server/admin.ts` (`connectDomain`, `checkDomain`, `custom_domain` in the overview), `app/api/admin/[slug]/route.ts`, `src/i18n/dicts.ts`, `app/admin/[slug]/components/AdminPanel.tsx`
- Test: `test/deploy-vercel-domains.test.ts` (new; `test/deploy-vercel.test.ts` belongs to Task 6 and is not touched), `test/admin-site.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `DomainInstructions = { verified: boolean; records: { type: "A" | "CNAME" | "TXT"; name: string; value: string }[] }` and `Deployer.addDomain?(projectId, domain): Promise<DomainInstructions>` (spec contract, `src/deploy/types.ts`); `VercelDeployer` constructor options `{ token; teamId?; fetch?; files; log? }` (Task 6); `FakeDeployer` (Task 6); `AdminSiteDeps`, `setTemplate`, `Post`, `useAdminOverview`, `SiteCard` (Task 10); `Store.setDeploy`.
- Produces: `normalizeDomain(raw: unknown): string | null`, `addVercelDomain(c: { token: string; teamId?: string | null; fetch?: typeof fetch }, projectId: string, domain: string): Promise<DomainInstructions>`, `instructionsFrom(domain, projectDomain, config): DomainInstructions` (`src/deploy/vercel-domains.ts`); `VercelDeployer.addDomain` and `FakeDeployer.addDomain` (fake: fixed records, `verified` from the second call on); `connectDomain(d: AdminSiteDeps, venue, domain: unknown)` and `checkDomain(d, venue)` → `{ ok: true; domain: string; instructions: DomainInstructions } | { ok: false; error: string }`; `AdminOverview.custom_domain: string | null`; `POST /api/admin/[slug]?key=` actions `add_domain { domain }` and `check_domain {}`; `DeployInfo.custom_domain?: string | null` (stored inside `venues.deploy` jsonb, no schema change).
- "Check again" reuses `addDomain` (attaching an already attached domain is idempotent on Vercel and in the fake), so the `Deployer` contract is not extended.

- [ ] **Step 1: Contract addition and dictionary keys**

`src/domain/types.ts`, inside `DeployInfo` after `updated_at: string;          // ISO` add:

```ts
  /** Optional custom domain attached to the provider project (Task 11); absent or null when none. */
  custom_domain?: string | null;
```

`src/i18n/dicts.ts`, `en` object after `"admin.busyPublishing": …,` add:

```ts
  "admin.domain": "Connect your domain",
  "admin.domainLead": "Use your own address, for example bar.example.com. Add the records below at your DNS provider; we check them for you.",
  "admin.domainLabel": "Domain",
  "admin.domainAdd": "Connect",
  "admin.domainCheck": "Check again",
  "admin.domainInvalid": "That does not look like a domain name.",
  "admin.domainNeedsSite": "Publish the site first (press Start in Telegram).",
  "admin.domainVerified": "Connected. Your site answers at {domain}.",
  "admin.domainPending": "Not verified yet. DNS changes can take up to an hour; press Check again later.",
  "admin.domainCurrent": "Connected domain: {domain}",
  "admin.dns.type": "Type",
  "admin.dns.name": "Name",
  "admin.dns.value": "Value",
  "admin.copy": "Copy",
  "admin.copied": "Copied",
```

`bg` object after `"admin.busyPublishing": …,` add:

```ts
  "admin.domain": "Свържете своя домейн",
  "admin.domainLead": "Използвайте собствен адрес, например bar.example.com. Добавете записите по-долу при вашия DNS доставчик; ние ги проверяваме.",
  "admin.domainLabel": "Домейн",
  "admin.domainAdd": "Свържи",
  "admin.domainCheck": "Провери отново",
  "admin.domainInvalid": "Това не прилича на домейн.",
  "admin.domainNeedsSite": "Първо публикувайте сайта (натиснете Start в Telegram).",
  "admin.domainVerified": "Свързан. Сайтът ви отговаря на {domain}.",
  "admin.domainPending": "Още не е потвърден. DNS промените може да отнемат до час; натиснете „Провери отново“ по-късно.",
  "admin.domainCurrent": "Свързан домейн: {domain}",
  "admin.dns.type": "Тип",
  "admin.dns.name": "Име",
  "admin.dns.value": "Стойност",
  "admin.copy": "Копирай",
  "admin.copied": "Копирано",
```

Run `npm test -- test/i18n.test.ts` → PASS.

- [ ] **Step 2: Failing tests**

```ts
// test/deploy-vercel-domains.test.ts
import { describe, expect, it } from "vitest";
import { addVercelDomain, instructionsFrom, normalizeDomain } from "@/src/deploy/vercel-domains";

type Call = { url: string; method: string; auth: string | null; body: unknown };

/** A fetch that answers from a route table and records every call; bodies are JSON. */
function fakeFetch(routes: Record<string, { status: number; json: unknown }>, calls: Call[]): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ url, method, auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
    const key = `${method} ${new URL(url).pathname}`;
    const r = routes[key] ?? { status: 404, json: { error: { code: "not_found" } } };
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  };
}

describe("normalizeDomain", () => {
  it("lowercases and strips scheme, path, port and trailing dot; rejects non-hostnames", () => {
    expect(normalizeDomain(" https://Bar.Example.COM/menu ")).toBe("bar.example.com");
    expect(normalizeDomain("bar.example.com:443")).toBe("bar.example.com");
    expect(normalizeDomain("example.bg.")).toBe("example.bg");
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("-bad.example.com")).toBeNull();
    expect(normalizeDomain(42)).toBeNull();
  });
});

describe("instructionsFrom", () => {
  it("builds a CNAME for a subdomain and an A record for an apex, plus TXT verification", () => {
    const sub = instructionsFrom("bar.example.com", { apexName: "example.com", verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=bar.example.com,abc" }] }, { misconfigured: true });
    expect(sub).toEqual({ verified: false, records: [{ type: "CNAME", name: "bar", value: "cname.vercel-dns.com" }, { type: "TXT", name: "_vercel.example.com", value: "vc-domain-verify=bar.example.com,abc" }] });
    const apex = instructionsFrom("example.com", { apexName: "example.com", verified: true }, { misconfigured: false, recommendedIPv4: [{ rank: 1, value: ["216.198.79.1"] }] });
    expect(apex).toEqual({ verified: true, records: [{ type: "A", name: "@", value: "216.198.79.1" }] });
  });
});

describe("addVercelDomain", () => {
  it("attaches the domain, reads the DNS config and sends the token and team id", async () => {
    const calls: Call[] = [];
    const f = fakeFetch({
      "POST /v10/projects/prj_1/domains": { status: 200, json: { name: "bar.example.com", apexName: "example.com", verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=bar.example.com,abc" }] } },
      "GET /v6/domains/bar.example.com/config": { status: 200, json: { misconfigured: true, recommendedCNAME: [{ rank: 1, value: "abc.vercel-dns-017.com" }] } },
    }, calls);
    const r = await addVercelDomain({ token: "tok_secret", teamId: "team_1", fetch: f }, "prj_1", "bar.example.com");
    expect(r.verified).toBe(false);
    expect(r.records).toEqual([{ type: "CNAME", name: "bar", value: "abc.vercel-dns-017.com" }, { type: "TXT", name: "_vercel.example.com", value: "vc-domain-verify=bar.example.com,abc" }]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1",
      "GET https://api.vercel.com/v6/domains/bar.example.com/config?teamId=team_1",
    ]);
    expect(calls[0]).toMatchObject({ auth: "Bearer tok_secret", body: { name: "bar.example.com" } });
  });
  it("treats an already attached domain as success by reading it back; verified when Vercel says so and DNS is configured", async () => {
    const calls: Call[] = [];
    const f = fakeFetch({
      "POST /v10/projects/prj_1/domains": { status: 409, json: { error: { code: "domain_already_in_use" } } },
      "GET /v9/projects/prj_1/domains/example.com": { status: 200, json: { name: "example.com", apexName: "example.com", verified: true } },
      "GET /v6/domains/example.com/config": { status: 200, json: { misconfigured: false, recommendedIPv4: [{ rank: 1, value: ["216.198.79.1"] }] } },
    }, calls);
    const r = await addVercelDomain({ token: "tok", fetch: f }, "prj_1", "example.com");
    expect(r).toEqual({ verified: true, records: [{ type: "A", name: "@", value: "216.198.79.1" }] });
    expect(calls[1].url).toBe("https://api.vercel.com/v9/projects/prj_1/domains/example.com");
  });
  it("throws a short error without the provider body when the domain cannot be attached", async () => {
    const f = fakeFetch({ "POST /v10/projects/prj_1/domains": { status: 400, json: { error: { code: "forbidden", message: "SECRET DETAILS" } } } }, []);
    await expect(addVercelDomain({ token: "tok", fetch: f }, "prj_1", "example.com")).rejects.toThrow(/add failed \(400\)/);
    await expect(addVercelDomain({ token: "tok", fetch: f }, "prj_1", "example.com")).rejects.not.toThrow(/SECRET/);
  });
});
```

Append to `test/admin-site.test.ts` (after the existing imports add `import { checkDomain, connectDomain } from "@/src/server/admin";` merged into the existing import line: `import { adminOverview, checkDomain, connectDomain, setTemplate } from "@/src/server/admin";`), then at the end of the file:

```ts
describe("custom domain", () => {
  it("normalises, attaches through the deployer, stores it and reports records; check again verifies", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const d = deps(store);
    const r = await connectDomain(d, await store.getVenue(venue.id), " https://Bar.Example.COM/ ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.domain).toBe("bar.example.com");
    expect(r.instructions.verified).toBe(false);
    expect(r.instructions.records).toContainEqual({ type: "CNAME", name: "bar", value: "cname.vercel-dns.com" });
    expect(r.instructions.records.some((x) => x.type === "TXT")).toBe(true);
    const v = await store.getVenue(venue.id);
    expect(v.deploy?.custom_domain).toBe("bar.example.com");
    expect(v.deploy?.updated_at).toBe(T0.toISOString());
    const again = await checkDomain(d, v);
    expect(again).toMatchObject({ ok: true, domain: "bar.example.com", instructions: { verified: true } });
    expect((await adminOverview(store, v, T0, "https://site.example")).custom_domain).toBe("bar.example.com");
  });
  it("rejects invalid input, needs a deployed site, and check needs a stored domain", async () => {
    const { store, venue } = await makeDemo();
    const d = deps(store);
    expect(await connectDomain(d, venue, "bar.example.com")).toEqual({ ok: false, error: "Publish the site first." });
    await store.setDeploy(venue.id, ready);
    const v = await store.getVenue(venue.id);
    expect(await connectDomain(d, v, "nope")).toEqual({ ok: false, error: "Invalid domain." });
    expect(await checkDomain(d, v)).toEqual({ ok: false, error: "No domain connected." });
    expect((await store.getVenue(venue.id)).deploy?.custom_domain ?? null).toBeNull();
  });
});
```

Run `npm test -- test/deploy-vercel-domains.test.ts test/admin-site.test.ts` → FAIL: module `@/src/deploy/vercel-domains` not found; `connectDomain` not exported.

- [ ] **Step 3: `src/deploy/vercel-domains.ts`**

```ts
// src/deploy/vercel-domains.ts
// Pure, fetch-injected helpers for the optional custom domain. Never logs or rethrows provider bodies.
import type { DomainInstructions } from "./types";

const API = "https://api.vercel.com";
const DEFAULT_A = "76.76.21.21";
const DEFAULT_CNAME = "cname.vercel-dns.com";
/** Hostname with at least one dot and a letter-only TLD (no localhost, no IPs, no underscores). */
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lowercases and strips scheme, path, query, port and trailing dot; null unless the result is a plain hostname. */
export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  return DOMAIN_RE.test(s) ? s : null;
}

export interface VercelProjectDomain { name?: string; apexName?: string; verified?: boolean; verification?: { type: string; domain: string; value: string }[] }
export interface VercelDomainConfig { misconfigured?: boolean; recommendedCNAME?: { rank?: number; value: string }[]; recommendedIPv4?: { rank?: number; value: string[] }[] }

/** DNS records the owner must set: CNAME for a subdomain, A for an apex, plus Vercel's TXT ownership records while unverified. */
export function instructionsFrom(domain: string, info: VercelProjectDomain, config: VercelDomainConfig): DomainInstructions {
  const apex = info.apexName ?? domain;
  const records: DomainInstructions["records"] = [];
  if (domain === apex) records.push({ type: "A", name: "@", value: config.recommendedIPv4?.[0]?.value?.[0] ?? DEFAULT_A });
  else records.push({ type: "CNAME", name: domain.slice(0, domain.length - apex.length - 1), value: config.recommendedCNAME?.[0]?.value ?? DEFAULT_CNAME });
  for (const v of info.verification ?? []) if (v.type === "TXT") records.push({ type: "TXT", name: v.domain, value: v.value });
  return { verified: info.verified === true && config.misconfigured === false, records };
}

export interface VercelDomainClient { token: string; teamId?: string | null; fetch?: typeof fetch }

/**
 * Attaches `domain` to the project (POST /v10/projects/{id}/domains; an existing attachment is read back with GET /v9/projects/{id}/domains/{domain}),
 * then reads GET /v6/domains/{domain}/config. Idempotent, so "Check again" calls it too.
 */
export async function addVercelDomain(c: VercelDomainClient, projectId: string, domain: string): Promise<DomainInstructions> {
  const f = c.fetch ?? fetch;
  const q = c.teamId ? `?teamId=${encodeURIComponent(c.teamId)}` : "";
  const headers = { authorization: `Bearer ${c.token}`, "content-type": "application/json" };
  const pid = encodeURIComponent(projectId);
  const dom = encodeURIComponent(domain);
  const added = await f(`${API}/v10/projects/${pid}/domains${q}`, { method: "POST", headers, body: JSON.stringify({ name: domain }) });
  let info: VercelProjectDomain;
  if (added.ok) {
    info = (await added.json()) as VercelProjectDomain;
  } else {
    const existing = await f(`${API}/v9/projects/${pid}/domains/${dom}${q}`, { headers });
    if (!existing.ok) throw new Error(`vercel domains: add failed (${added.status})`);
    info = (await existing.json()) as VercelProjectDomain;
  }
  const cfg = await f(`${API}/v6/domains/${dom}/config${q}`, { headers });
  const config: VercelDomainConfig = cfg.ok ? ((await cfg.json()) as VercelDomainConfig) : { misconfigured: true };
  return instructionsFrom(domain, info, config);
}
```

- [ ] **Step 4: Deployer methods**

`src/deploy/vercel.ts` (Task 6's class): add the import `import { addVercelDomain } from "./vercel-domains";` and `import type { DomainInstructions } from "./types";` (if not already imported), and inside `class VercelDeployer` add the method, using the private fields Task 6 stored its constructor options in (its `token`, `teamId` and injected `fetch`; rename the three accessors below to Task 6's names, nothing else changes):

```ts
  async addDomain(projectId: string, domain: string): Promise<DomainInstructions> {
    return addVercelDomain({ token: this.token, teamId: this.teamId, fetch: this.fetchImpl }, projectId, domain);
  }
```

`src/deploy/fake.ts`: inside `class FakeDeployer` add a field and the method. Fixed records; `verified` becomes true from the second call for the same project + domain, so the offline dashboard flow "Connect → Check again" reaches the verified state:

```ts
  private domainCalls = new Map<string, number>();

  async addDomain(projectId: string, domain: string): Promise<DomainInstructions> {
    const key = `${projectId}:${domain}`;
    const n = (this.domainCalls.get(key) ?? 0) + 1;
    this.domainCalls.set(key, n);
    const apex = domain.split(".").slice(-2).join(".");
    const main = domain === apex
      ? { type: "A" as const, name: "@", value: "76.76.21.21" }
      : { type: "CNAME" as const, name: domain.slice(0, domain.length - apex.length - 1), value: "cname.vercel-dns.com" };
    return { verified: n >= 2, records: [main, { type: "TXT", name: `_vercel.${apex}`, value: `vc-domain-verify=${domain},fake` }] };
  }
```

(`DomainInstructions` is imported from `./types` in both files.)

- [ ] **Step 5: `src/server/admin.ts`: `connectDomain`, `checkDomain`, overview field**

Imports: extend the Task 10 line

```ts
import type { Deployer } from "../deploy/types";
```

to

```ts
import type { Deployer, DomainInstructions } from "../deploy/types";
import { normalizeDomain } from "../deploy/vercel-domains";
```

`AdminOverview`: after `site_url: string;` add:

```ts
  custom_domain: string | null;
```

`adminOverview` return: after the `site_url: …,` line add:

```ts
    custom_domain: venue.deploy?.custom_domain ?? null,
```

Change `export type AdminSiteActionName = "set_template";` to:

```ts
export type AdminSiteActionName = "set_template" | "add_domain" | "check_domain";
```

Append at the end of the file:

```ts
export type DomainResult = { ok: true; domain: string; instructions: DomainInstructions } | { ok: false; error: string };

async function attachDomain(d: AdminSiteDeps, venue: Venue, domain: string): Promise<DomainResult> {
  const deploy = venue.deploy;
  if (!deploy || !d.deployer.addDomain) return { ok: false, error: "Publish the site first." };
  let instructions: DomainInstructions;
  try {
    instructions = await d.deployer.addDomain(deploy.project_id, domain);
  } catch {
    return { ok: false, error: "The domain could not be added." };
  }
  await d.store.setDeploy(venue.id, { ...deploy, custom_domain: domain, updated_at: d.now().toISOString() });
  return { ok: true, domain, instructions };
}

/** Dashboard "Connect your domain": validate, attach to the provider project, remember it on the deploy record, return the DNS records. */
export async function connectDomain(d: AdminSiteDeps, venue: Venue, domainRaw: unknown): Promise<DomainResult> {
  const domain = normalizeDomain(domainRaw);
  if (!domain) return { ok: false, error: "Invalid domain." };
  return attachDomain(d, venue, domain);
}

/** "Check again": re-reads the records and verification for the stored domain (attach is idempotent). */
export async function checkDomain(d: AdminSiteDeps, venue: Venue): Promise<DomainResult> {
  const domain = venue.deploy?.custom_domain;
  if (!domain) return { ok: false, error: "No domain connected." };
  return attachDomain(d, venue, domain);
}
```

Run `npm test -- test/deploy-vercel-domains.test.ts test/admin-site.test.ts` → PASS.

- [ ] **Step 6: Route branches**

`app/api/admin/[slug]/route.ts`, old:

```ts
import { adminAction, adminOverview, setTemplate, type AdminActionName } from "@/src/server/admin";
```

new:

```ts
import { adminAction, adminOverview, checkDomain, connectDomain, setTemplate, type AdminActionName } from "@/src/server/admin";
```

old:

```ts
  const body = (await req.json().catch(() => ({}))) as { action?: string; change_set_id?: string; template?: unknown };
  const siteDeps = { store: deps.store, deployer: deps.deployer, feedUrlFor: (s: string) => `${deps.config.publicBaseUrl}/api/site/${s}`, now: () => new Date() };
  if (body.action === "set_template") {
    const r = await setTemplate(siteDeps, venue, body.template);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
```

new:

```ts
  const body = (await req.json().catch(() => ({}))) as { action?: string; change_set_id?: string; template?: unknown; domain?: unknown };
  const siteDeps = { store: deps.store, deployer: deps.deployer, feedUrlFor: (s: string) => `${deps.config.publicBaseUrl}/api/site/${s}`, now: () => new Date() };
  if (body.action === "set_template") {
    const r = await setTemplate(siteDeps, venue, body.template);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
  if (body.action === "add_domain") {
    const r = await connectDomain(siteDeps, venue, body.domain);
    return Response.json(r, { status: r.ok ? 200 : r.error === "Invalid domain." ? 400 : 409 });
  }
  if (body.action === "check_domain") {
    const r = await checkDomain(siteDeps, venue);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
```

- [ ] **Step 7: `DomainCard` and panel wiring**

```tsx
// app/admin/[slug]/components/DomainCard.tsx
"use client";
import { useState, type FormEvent } from "react";
import type { DomainInstructions } from "@/src/deploy/types";
import { useLang } from "@/src/i18n";
import type { AdminOverview } from "@/src/server/admin";
import { Section } from "./bits";
import type { Post } from "./useAdminOverview";

type DomainResult = { ok: true; domain: string; instructions: DomainInstructions } | { ok: false; error: string };

function CopyButton({ value }: { value: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the value is visible to copy by hand
    }
  }
  return <button type="button" onClick={() => void copy()} className="min-h-11 rounded-full px-3 text-xs font-semibold ring-1 ring-ink/25 hover:bg-ink/5">{copied ? t("admin.copied") : t("admin.copy")}</button>;
}

/** "Connect your domain" (Pro): domain form → DNS records table with copy buttons → Check again. Only usable once the site is deployed. */
export function DomainCard({ overview: o, post }: { overview: AdminOverview; post: Post }) {
  const { t } = useLang();
  const [domain, setDomain] = useState(o.custom_domain ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DomainResult | null>(null);
  const deployed = o.deploy !== null;

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    const r = await post(body);
    const data = r.data as DomainResult | null;
    setResult(data && typeof data === "object" && "ok" in data ? data : { ok: false, error: "failed" });
    setBusy(false);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void run({ action: "add_domain", domain });
  }
  const errorText = (err: string) => (err === "Invalid domain." ? t("admin.domainInvalid") : err === "Publish the site first." ? t("admin.domainNeedsSite") : t("admin.failed"));

  return (
    <Section id="domain" title={t("admin.domain")}>
      <div className="rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
        <p className="text-sm text-ink-soft">{t("admin.domainLead")}</p>
        {o.custom_domain && <p className="mt-2 text-sm font-semibold">{t("admin.domainCurrent", { domain: o.custom_domain })}</p>}
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
            {t("admin.domainLabel")}
            <input type="text" inputMode="url" autoComplete="off" spellCheck={false} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="bar.example.com" required
              className="min-h-11 w-full rounded-xl bg-paper px-3 font-normal ring-1 ring-ink/20" />
          </label>
          <button type="submit" disabled={busy || !deployed} className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60">{busy ? t("admin.busy") : t("admin.domainAdd")}</button>
          {o.custom_domain && (
            <button type="button" disabled={busy} onClick={() => void run({ action: "check_domain" })} className="min-h-11 rounded-full px-5 text-sm font-semibold ring-1 ring-ink/25 hover:bg-ink/5 disabled:opacity-60">{t("admin.domainCheck")}</button>
          )}
        </form>
        {!deployed && <p className="mt-2 text-sm text-ink-soft">{t("admin.domainNeedsSite")}</p>}
        {result && !result.ok && <p role="alert" className="mt-3 text-sm font-semibold text-clay">{errorText(result.error)}</p>}
        {result && result.ok && (
          <div className="mt-4" aria-live="polite">
            <p className={`text-sm font-semibold ${result.instructions.verified ? "text-ink" : "text-amber"}`}>
              {result.instructions.verified ? t("admin.domainVerified", { domain: result.domain }) : t("admin.domainPending")}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                    <th scope="col" className="py-1 pr-3">{t("admin.dns.type")}</th>
                    <th scope="col" className="py-1 pr-3">{t("admin.dns.name")}</th>
                    <th scope="col" className="py-1 pr-3">{t("admin.dns.value")}</th>
                    <th scope="col" className="py-1"><span className="sr-only">{t("admin.copy")}</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {result.instructions.records.map((r) => (
                    <tr key={`${r.type}-${r.name}-${r.value}`}>
                      <td className="py-2 pr-3 font-semibold">{r.type}</td>
                      <td className="py-2 pr-3 font-mono [overflow-wrap:anywhere]">{r.name}</td>
                      <td className="py-2 pr-3 font-mono [overflow-wrap:anywhere]">{r.value}</td>
                      <td className="py-2 text-right"><CopyButton value={r.value} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
```

`app/admin/[slug]/components/AdminPanel.tsx`, old:

```ts
import { SiteCard } from "./SiteCard";
```

new:

```ts
import { DomainCard } from "./DomainCard";
import { SiteCard } from "./SiteCard";
```

old:

```tsx
        <LogList sets={o.log} tz={tz} decide={decide} />
        <QrCard publicUrl={o.public_url} slug={slug} />
```

new:

```tsx
        <LogList sets={o.log} tz={tz} decide={decide} />
        <DomainCard overview={o} post={post} />
        <QrCard publicUrl={o.public_url} slug={slug} />
```

- [ ] **Step 8: Verify**

`npm test -- test/deploy-vercel-domains.test.ts test/admin-site.test.ts test/admin-server.test.ts test/i18n.test.ts` → PASS. `npm run typecheck` → clean. `npm run build` → green. Offline: `SITE_MANAGER_STORE=memory npm run dev`, dashboard with a deployed demo venue (after the Task 10 flow): type `Bar.Example.com`, Connect → table shows CNAME `bar` → `cname.vercel-dns.com` and the TXT record with copy buttons, "Not verified yet"; Check again → "Connected. Your site answers at bar.example.com." (the fake verifies on the second call). With no deploy the Connect button is disabled and the hint is shown. Both languages, 360 px (table scrolls inside its box, no page overflow). Live (only with `VERCEL_TOKEN`): connect a test subdomain you control to a test project, confirm the records match the Vercel dashboard, then remove the domain in Vercel.

- [ ] **Step 9: Commit**

```bash
git add src/domain/types.ts src/deploy/vercel-domains.ts src/deploy/vercel.ts src/deploy/fake.ts src/server/admin.ts app/api/admin/[slug]/route.ts src/i18n/dicts.ts app/admin/[slug]/components/DomainCard.tsx app/admin/[slug]/components/AdminPanel.tsx test/deploy-vercel-domains.test.ts test/admin-site.test.ts
git commit -m "Dashboard: optional custom domain (Pro) with DNS records, copy buttons and re-check; Vercel domain helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: fable


### Task 12: Docs, parked ideas, landing CTA, env example and the site-delete script

> **Rulings that apply to this task:** R15 (see "Controller rulings" above; they override conflicting sentences below).

**Files:**
- Modify: `README.md`, `docs/IDEAS.md`, `docs/lovable/LANDING-PROMPT.md`, `.env.example`, `package.json` (one script), `src/i18n/dicts.ts` (`landing.cta`, `landing.ctaNote` in both languages), `app/components/Landing.tsx` (CTA href + demo text link)
- Create: `scripts/site-delete.mts`
- Test: none beyond `npm run typecheck`, `npm test` (the i18n parity test still passes) and `npm run lint`

**Interfaces:**
- Consumes (Task 1): `Venue.status`, `Venue.deploy` (`DeployInfo` with `provider`, `project_id`, `status`, `url`), `Store.deleteVenue(id)`.
- Consumes (Task 6): `ServerDeps.deployer` (`Deployer.provider`, `Deployer.deleteSite(projectId)`), the `FakeDeployer`'s no-op `deleteSite`.
- Consumes (Task 5): the `npm run test:templates` script (documented here, created there).
- Consumes (Task 7/9): routes under `/api/new` and the `/new` pages (documented here).
- Produces: `npm run site:delete`; the README sections "Creating a site with the wizard", "Demo (3 minutes): wizard to live site", env rows for `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `RATE_SALT`, `MAX_SITES_PER_DAY`, `TELEGRAM_BOT_USERNAME`; the parked integrations section in `docs/IDEAS.md`; the Lovable prompt pointing its CTA at `/new`.

Decisions this task fixes: the landing's single call to action becomes "Create your site →" to `/new`, with the demo café demoted to a plain text link under it (the Lovable prompt's "one CTA" rule is kept: one button, one text link). Because the Lovable prompt copies `landing.*` verbatim from `src/i18n/dicts.ts`, both change together, and the fallback landing in `app/components/Landing.tsx` follows. `site:delete` asks for the slug, prints the Vercel project id, asks for the slug a second time, and only then deletes: first the provider project (only when `deploy.provider` equals the configured deployer's `provider`, so a `fake` deploy record never reaches Vercel), then the venue row (cascade), and reminds that storage objects stay (same pattern as `cleanup-test-venues.mts`).

- [ ] **Step 1: README — wizard section and the new demo script**

In `README.md`, directly after the line

```
The same sequence runs offline, without a phone or keys: `npm run e2e`.
```

insert:

```markdown

## Creating a site with the wizard

Anyone can create a venue site at `/new` (linked from the landing). The owner picks one of three templates (`classic` warm editorial, `nocturne` dark for bars and evenings, `lumen` light and photo-first for daytime coffee), each shown live with the demo café, then fills seven steps with the chosen template rendering their data on the right: Basics (name, web address, main language, contact), Look (accent colour, logo, cover), Hours, Menu (type it, or upload photos or a PDF of the current menu and let Claude read it into a review list you accept row by row), Texts (both languages; "Write for me" drafts all of them from a few facts), Photos (gallery), Review. "Create my site" makes the venue live in our database and shows a one-use Telegram code with a QR. Pressing Start in Telegram links the owner's chat as the owner and starts the deploy: a new Vercel project named after the slug, built from the thin template shell, polled until READY; the bot then messages the live URL and the done page shows it. From that moment the Telegram agent manages the content; the deployed site reads `/api/site/<slug>` every 10 s (server) and 5 s (client), so a price change from Telegram is visible on it in seconds. Only a template switch needs a new deployment.

Guards: drafts live in `venues.wizard_draft` with a hashed token in an httpOnly cookie (`sm_draft`, 7 days); `POST /api/new` allows 5 drafts per IP per hour (IP hashed with `RATE_SALT`) and `MAX_SITES_PER_DAY` per day in total; uploaded PDFs are sent to Claude and never stored; images go through the same 5 MB `saveMedia` path as Telegram photos; abandoned drafts are deleted by the tick after 48 h. Without `ANTHROPIC_API_KEY` the wizard still works, with the two AI buttons replaced by a one-line explanation. Without `VERCEL_TOKEN` (or with `SITE_MANAGER_STORE=memory`) the `FakeDeployer` reports READY after two polls at `https://<slug>.example.test`, so the whole flow runs offline.

## Demo (3 minutes): wizard to live site

| # | You do | What happens |
|---|---|---|
| 1 | Open `/new` on the projector | Three live cards: the demo café in Classic, Nocturne and Lumen. |
| 2 | Pick Nocturne, type the name and address | The right pane is the bar's site, updating as you type; the web address fills itself from the name. |
| 3 | Menu step: upload a photo of the printed menu | "Reading your menu…", then a review list in Bulgarian and English with EUR prices (BGN converted and flagged) and allergen codes. Accept all. |
| 4 | Texts: type two facts, press "Write for me" | Tagline, about, greeting and footer in both languages appear in the fields and on the preview. |
| 5 | Review → "Create my site" | The done page: a QR code and `/start <code>`. "Press Start in Telegram to publish." |
| 6 | Phone: scan, press Start | The bot: "Публикуваме сайта ви…". The done page polls; in about a minute: "Вашият сайт е готов: https://…". |
| 7 | Open the live URL on the projector | The deployed site on its own Vercel project. |
| 8 | Phone: "Негронито става 11" → ✅ | Within 15 s the price changes on the deployed site. |

Offline the same runs with `SITE_MANAGER_STORE=memory` (fake deployer, no phone: simulate Start with `npm run bot:dev` or the dev-bot script's `/start <code>`).
```

- [ ] **Step 2: README — env table rows, scripts table, security notes, known gaps**

In the env table, after the row that starts with `| \`NEXT_PUBLIC_LANDING_URL\` |`, add:

```markdown
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens → Create: scope it to the **team** that owns the site projects (not "Full account"), expiry per your policy; the wizard creates one Vercel project per venue with it | For automatic deploys; without it the fake deployer is used |
| `VERCEL_TEAM_ID` | Vercel → Team Settings → General → Team ID (`team_…`). Needed when the token is team-scoped | With `VERCEL_TOKEN` |
| `RATE_SALT` | Any random string: `openssl rand -hex 16`. Hashed with the visitor's IP for the wizard's rate limit, so raw IPs are never stored | Yes in production (defaults to `dev-salt` offline) |
| `MAX_SITES_PER_DAY` | Default `50`: the global cap on new sites per 24 h | No |
| `TELEGRAM_BOT_USERNAME` | The bot's username without `@` (from @BotFather). Builds the `https://t.me/<bot>?start=<code>` link and QR on the wizard's done page | For the done page's Start link; otherwise only the code is shown |
```

In the "Other scripts" table, after the `npm run telegram:set-webhook -- --delete` row, add:

```markdown
| `npm run test:templates` | Writes each template's thin shell to a temp dir, runs `npm install` and `next build` there: the offline proof that a deployed site builds. Slow; not part of `npm test`. Run before a release. |
| `npm run site:delete -- --slug my-cafe` | Deletes a venue created by the wizard and its Vercel project. Prints the project id and asks you to type the slug again before deleting. Storage objects are not removed. |
```

In "Security notes", after the "**Invite codes**" bullet, add:

```markdown
- **Draft token.** A wizard draft is reachable only with the `sm_draft` httpOnly cookie (`<venue id>.<token>`); the database holds the token's SHA-256 only. Drafts are invisible to the anon key (`venues.status = 'draft'` is excluded by the policies; `npm run check:rls` proves it) and are never served at `/<slug>`.
- **Vercel token.** `VERCEL_TOKEN` is read only in `src/config.ts`; the deployer never logs a Vercel response in full and stores at most the last 20 build-log lines in `deploy.error`. The build is checked: `grep -rl VERCEL_TOKEN .next/static` finds nothing (`npm run smoke` does this).
- **Rate limits.** 5 new drafts per IP per hour, `MAX_SITES_PER_DAY` per day; the IP is hashed with `RATE_SALT` before it is stored.
- **Uploaded menus.** PDFs and photos sent for extraction go to Claude and are not stored; only images the owner places on the site are saved.
- **Deleting a venue** never deletes its Vercel project automatically; `npm run site:delete` does both, with a typed confirmation.
```

In "Known gaps" replace

```markdown
- Only the venue's own site is managed: no delivery apps, no Google Business profile.
```

with

```markdown
- Only the venue's own site is managed: no delivery apps, no Google Business profile. Integrations with existing sites (WordPress, embed, Shopify/Wix, GitHub) are parked in `docs/IDEAS.md`.
- Custom domains for wizard-created sites are optional (Task 11) and may not be in this build; each site lives on its Vercel URL.
```

In "Landing page (Lovable)" replace

```markdown
The public marketing landing is built in [Lovable](https://lovable.dev) from the prompt pack in [docs/lovable/LANDING-PROMPT.md](docs/lovable/LANDING-PROMPT.md) (bilingual copy, the pitch facts, design tokens and the demo link).
```

with

```markdown
The public marketing landing is built in [Lovable](https://lovable.dev) from the prompt pack in [docs/lovable/LANDING-PROMPT.md](docs/lovable/LANDING-PROMPT.md) (bilingual copy, the pitch facts, design tokens, the "Create your site" button to `/new` and the demo link).
```

- [ ] **Step 3: `docs/IDEAS.md` — parked integrations research**

Append to the end of `docs/IDEAS.md`:

```markdown

## Parked 2026-10-10: integrations research

Decision: the first product is template-first onboarding with our own hosting (see `docs/superpowers/specs/2026-10-10-site-manager-templates-design.md`). The research below on managing a venue's *existing* site from Telegram is kept for after the templates ship.

- **WordPress plugin.** Two halves: read blocks (a `site-manager` block or shortcode per section — today's status, specials, menu, hours, gallery — rendered from our JSON feed with a short cache) and a write channel (an application password or a plugin REST endpoint that accepts our change sets and writes posts/options). The agent stays ours; the site stays theirs. Cost: a plugin to maintain, WP.org review, and a support surface we do not control. Reach: the biggest single platform among venues that have a site at all.
- **Generic embed + JSON feed.** `<script src=".../embed.js" data-venue="slug">` that renders live sections (open now, specials, menu) into any page, plus the raw feed for developers. Works on any builder (Wix, Squarespace, Webflow, static HTML) without an app store. Limits: only the sections we render; the rest of the page stays stale; CSP and sandboxed builders may block it.
- **Google Business Profile push.** Hours, holiday hours, a menu and posts through the Business Profile API when a change set is applied. Every venue has a profile; this is where "is it open" is actually read. Needs API access approval (quota request with a business justification) and OAuth per venue.
- **GitHub connector for custom or AI-built sites.** For venues with a repo (Lovable, v0, an agency): a change set becomes a pull request that edits a `site-manager.json` (or the content files) and the site rebuilds. Full access, no runtime dependency on us, reviewable diffs. Only for the minority with a repo and a build.
- **Shopify / Wix apps.** Proper apps with their own review processes; Shopify for the few venues selling online, Wix because it is common among small businesses in Bulgaria. Deferred: two app stores to maintain for a thin slice of venues.

Market coverage estimate (what share of venues each path could manage, not what they would pay):

| Path | Depth | Bulgaria | Global | Why |
|---|---|---|---|---|
| WordPress plugin + GitHub connector | Full site control | ~35–45 % | ~50–55 % | Venues with a CMS or a repo; WordPress dominates the sites that exist, GitHub covers agency and AI-built sites. |
| Generic embed + feed | Live sections only | ~50 % | ~40 % | Any builder that allows a script; the rest of the page stays as it is. |
| Our hosted template | Whole site, ours | ~5 % | ~5 % | Venues without a site or willing to replace it: the current product. |
| Google Business Profile push | Hours, menu, posts | 100 % | 100 % | Every venue has a profile; the API covers the fields guests actually read. |

Order if we come back to this: Google push first (universal, no plugin), then the embed (cheap, universal), then WordPress, then GitHub, then the app stores.
```

- [ ] **Step 4: Landing CTA → `/new` (prompt, dictionary, fallback landing)**

`src/i18n/dicts.ts`, English:

```ts
// old
  "landing.cta": "Open the demo café →",
  "landing.ctaNote": "A fictional café, Кафене „Ъгъла“, that we change live during the demo.",
// new
  "landing.cta": "Create your site →",
  "landing.ctaNote": "Three designs, your menu from a photo, online in minutes. Then you run it from Telegram.",
```

Bulgarian:

```ts
// old
  "landing.cta": "Отворете демо кафенето →",
  "landing.ctaNote": "Измислено кафене, Кафене „Ъгъла“, което променяме на живо по време на демото.",
// new
  "landing.cta": "Създайте сайта си →",
  "landing.ctaNote": "Три дизайна, менюто от снимка, онлайн за минути. После го управлявате от Telegram.",
```

`app/components/Landing.tsx`:

```tsx
// old
        <div className="mt-8 flex flex-col items-start gap-2">
          <Link href={`/${demoSlug}`} className="rounded-full bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-110">{t("landing.cta")}</Link>
          <span className="text-sm text-ink-soft">{t("landing.ctaNote")}</span>
        </div>
// new
        <div className="mt-8 flex flex-col items-start gap-2">
          <Link href="/new" className="rounded-full bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-110">{t("landing.cta")}</Link>
          <span className="text-sm text-ink-soft">{t("landing.ctaNote")}</span>
          <Link href={`/${demoSlug}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline">{t("nav.demo")}</Link>
        </div>
```

`docs/lovable/LANDING-PROMPT.md`:

```markdown
<!-- old (How to use it, step 1) -->
1. Replace every `{{DEMO_URL}}` below with the demo café's address, `<PUBLIC_BASE_URL>/agala` (for example `https://your-project.vercel.app/agala`). If you do not know it yet, leave the placeholder and ask Lovable to swap it later (step 5).
<!-- new -->
1. Replace every `{{APP_URL}}` below with the app's address, `<PUBLIC_BASE_URL>` (for example `https://your-project.vercel.app`), and every `{{DEMO_URL}}` with the demo café's address, `<PUBLIC_BASE_URL>/agala`. If you do not know them yet, leave the placeholders and ask Lovable to swap them later (step 5).
```

```markdown
<!-- old (section 1, the CTA sentence) -->
There is exactly one call to action, the primary button "Open the demo café →" (Bulgarian: "Отворете демо кафенето →"), which links to `{{DEMO_URL}}`.
<!-- new -->
There is exactly one call to action, the primary button "Create your site →" (Bulgarian: "Създайте сайта си →"), which links to `{{APP_URL}}/new`. Under the button and its note there is one plain text link, "See the demo café" (Bulgarian: "Вижте демо кафенето"), to `{{DEMO_URL}}`: a link in the accent colour, not a second button.
```

```markdown
<!-- old (2.3 Hero, intro line) -->
The primary button links to `{{DEMO_URL}}` (same tab). Keep the arrow at the end of the button label.
<!-- new -->
The primary button links to `{{APP_URL}}/new` (same tab); the text link under the note links to `{{DEMO_URL}}`. Keep the arrow at the end of the button label.
```

```markdown
<!-- old (2.3 Hero, EN) -->
- Primary button: Open the demo café →
- Note under the button: A fictional café, Кафене „Ъгъла“, that we change live during the demo.
<!-- new -->
- Primary button: Create your site →
- Note under the button: Three designs, your menu from a photo, online in minutes. Then you run it from Telegram.
- Text link under the note: See the demo café
```

```markdown
<!-- old (2.3 Hero, BG) -->
- Primary button: Отворете демо кафенето →
- Note under the button: Измислено кафене, Кафене „Ъгъла“, което променяме на живо по време на демото.
<!-- new -->
- Primary button: Създайте сайта си →
- Note under the button: Три дизайна, менюто от снимка, онлайн за минути. После го управлявате от Telegram.
- Text link under the note: Вижте демо кафенето
```

```markdown
<!-- old (section 2 intro, the sentence about two English strings) -->
Two English strings deliberately contain Bulgarian (the demo café's name, Кафене „Ъгъла“, and the example message in step 1, “Капучиното става 3,20”): keep them in Bulgarian, they show what the owner actually types.
<!-- new -->
One English string deliberately contains Bulgarian (the example message in step 1, “Капучиното става 3,20”): keep it in Bulgarian, it shows what the owner actually types.
```

```markdown
<!-- old (section 4 rules) -->
- One call to action only, the primary button to `{{DEMO_URL}}`. No second button, no "Sign up", "Book a demo" or "Contact us".
<!-- new -->
- One call to action only, the primary button to `{{APP_URL}}/new`, plus the single text link to `{{DEMO_URL}}` under it. No second button, no "Sign up", "Book a demo" or "Contact us".
```

```markdown
<!-- old (section 5, step 1) -->
1. If the demo button still points to `{{DEMO_URL}}`, ask Lovable: "Change the primary button link to `<PUBLIC_BASE_URL>/agala`", with your real address, and publish again. Open the published page and click the button to check it lands on the demo café.
<!-- new -->
1. If the button or the link still show a placeholder, ask Lovable: "Change the primary button link to `<PUBLIC_BASE_URL>/new` and the demo text link to `<PUBLIC_BASE_URL>/agala`", with your real address, and publish again. Open the published page: the button must land on the template chooser, the link on the demo café.
```

`npm test -- test/i18n.test.ts` still passes (same keys, no empty strings).

- [ ] **Step 5: `.env.example` rows**

Append to `.env.example`:

```bash

# Automatic deploys of wizard-created sites (Vercel Pro team). Token: Account Settings -> Tokens, scoped to the team.
# Empty: the fake deployer is used (sites report READY at https://<slug>.example.test; nothing is deployed).
VERCEL_TOKEN=
# Team ID (team_...): Team Settings -> General. Needed with a team-scoped token.
VERCEL_TEAM_ID=
# Wizard abuse guards. RATE_SALT is hashed with the visitor's IP (openssl rand -hex 16); MAX_SITES_PER_DAY caps new sites per 24 h.
RATE_SALT=
MAX_SITES_PER_DAY=50
# The bot's username without @ (from @BotFather); builds the https://t.me/<bot>?start=<code> link on the wizard's done page.
TELEGRAM_BOT_USERNAME=
```

`scripts/env-set.mts` lists keys from `.env.example`, so the new keys become fillable with `npm run env:set -- VERCEL_TOKEN` without a code change (check: `npm run env:set` with no argument lists them).

- [ ] **Step 6: `scripts/site-delete.mts` and the package script**

```ts
// scripts/site-delete.mts
// npm run site:delete [-- --slug my-cafe]
// Deletes a wizard-created venue and its Vercel project. Asks for the slug, prints what will go, asks for the slug again.
// Storage objects under media/<venue id>/ are not removed (see cleanup-test-venues.mts for the pattern).
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { makeServerDeps } from "../src/server/deps";

const i = process.argv.indexOf("--slug");
const slugArg = i > 0 ? (process.argv[i + 1] ?? "") : "";
const rl = createInterface({ input: stdin, output: stdout });

const slug = (slugArg || (await rl.question("Slug of the site to delete: "))).trim();
if (!slug) {
  console.error("No slug given.");
  process.exit(1);
}
const deps = await makeServerDeps({ defer: (fn) => void fn() });
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  console.error(`No venue "${slug}".`);
  process.exit(1);
}
const deploy = venue.deploy;
console.log(`venue:          ${venue.name || "(unnamed draft)"} (${venue.id}), status ${venue.status}, template ${venue.template}${deps.isMemory ? " [MEMORY store]" : ""}`);
console.log(`vercel project: ${deploy ? `${deploy.project_id} (${deploy.provider}, ${deploy.status}${deploy.url ? `, ${deploy.url}` : ""})` : "none"}`);
console.log(`site:           ${deps.config.publicBaseUrl}/${venue.slug}`);
console.log("This deletes the venue, its menu, texts, members, invites, admin token, change log and media rows" + (deploy ? ", and the provider project above" : "") + ". It cannot be undone.");
const again = (await rl.question(`Type the slug again to confirm: `)).trim();
rl.close();
if (again !== slug) {
  console.error("Slug did not match; nothing deleted.");
  process.exit(1);
}
if (deploy) {
  if (deploy.provider === deps.deployer.provider) {
    await deps.deployer.deleteSite(deploy.project_id);
    console.log(`provider project ${deploy.project_id} deleted (${deploy.provider})`);
  } else {
    console.log(`provider project ${deploy.project_id} NOT deleted: it was created with "${deploy.provider}" but this environment's deployer is "${deps.deployer.provider}". Delete it in the Vercel dashboard.`);
  }
}
await deps.store.deleteVenue(venue.id);
console.log(`venue "${slug}" deleted. Storage objects under media/${venue.id}/ remain; remove them with the Supabase dashboard or the pattern in scripts/cleanup-test-venues.mts.`);
```

`package.json`, in `"scripts"` after the `"cleanup:test-venues"` line:

```json
// old
    "cleanup:test-venues": "tsx --env-file-if-exists=.env.local scripts/cleanup-test-venues.mts"
// new
    "cleanup:test-venues": "tsx --env-file-if-exists=.env.local scripts/cleanup-test-venues.mts",
    "site:delete": "tsx --env-file-if-exists=.env.local scripts/site-delete.mts"
```

(If Task 5 already added `"test:templates"` after it, keep both; order does not matter.)

- [ ] **Step 7: Verify and commit**

`npm run typecheck` → clean (`node:readline/promises` types come with `@types/node` 24). `npm test` → green. `npm run lint` → clean. Offline check of the script: `SITE_MANAGER_STORE=memory npx tsx scripts/site-delete.mts --slug agala` → prints the demo venue, asks for the slug, deletes it from the memory store and exits 0; the same with a wrong confirmation exits 1 with "Slug did not match". Read the README top to bottom once: every command named exists in `package.json`, every env key in the table exists in `.env.example` and `src/config.ts`.

```bash
git add README.md docs/IDEAS.md docs/lovable/LANDING-PROMPT.md .env.example package.json src/i18n/dicts.ts app/components/Landing.tsx scripts/site-delete.mts
git commit -m "Docs: wizard, deploy env keys, 3-minute demo script, parked integrations research; landing CTA to /new; site:delete script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Model: opus


