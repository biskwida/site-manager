# Site Manager: template-first onboarding with automatic Vercel deploy

## Context

Site Manager manages a café's website from Telegram, but today a venue only exists if we create it by script and the site is served from our own app at `/[slug]`. The user decided (2026-10-10) not to build platform plugins now. Instead: a café owner picks one of **three templates**, fills in their info in a **web wizard with live preview**, can **upload a photo or PDF of their menu** and have Claude extract it, and on "Create" the site is **deployed automatically as a new Vercel project in our Pro account**. From then on the Telegram agent manages the content. Templates are tagged by business type so later we can add templates for other businesses (bars, restaurants, salons).

Anyone may create a site, with abuse guards. The Vercel team is already on Pro (unlimited projects, 6 000 deployments/day, concurrent builds, commercial use allowed).

Design requirement from the user: every template and the wizard must be built with the installed design skills: `impeccable` (reads `.impeccable.md` in the repo root), `design-taste-frontend`, `emil-design-eng`, `high-end-visual-design`, `apple-design`, `frontend-design`; reviewed with `review-animations` and `web-design-guidelines`. Hard constraint that overrides those skills' font lists: **every font must have a Cyrillic subset** (Bulgarian is the default language).

Previous research on WordPress/Shopify/Wix plugins, the generic embed, Google Business Profile and a GitHub connector is parked in `docs/IDEAS.md` (task 12).

## How it works (end to end)

1. Owner opens `/new` (linked from the Lovable landing). Picks a template from three live cards (each shows the demo café in that template), picks business type (café for now).
2. Fills steps: Basics → Look (accent, logo, cover) → Hours → Menu (type, or upload photo/PDF → Claude extracts, owner reviews) → Texts (BG+EN; "Write for me" drafts both) → Photos → Review. The right half is the chosen template rendering their data live.
3. "Create my site" → venue becomes live in our DB, owner gets the Telegram `/start` code with a QR, and the page says "Press Start in Telegram to publish". When the invite is redeemed, we deploy. This makes Telegram sign-in the human check and ties the agent into the first minute.
4. Deploy = Vercel API: create project `<slug>` (framework nextjs, env `SITE_MANAGER_URL` + `SITE_MANAGER_SLUG`, deployment protection off), create a production deployment with the **thin template app** files inlined (shell + chosen template + shared domain code, ~60 files, no node_modules), poll until READY. Tick polls; the bot sends "Вашият сайт е готов: https://…" and the wizard's done page updates.
5. The deployed site reads `${SITE_MANAGER_URL}/api/site/${slug}` with 10 s revalidation and 5 s client polling, exactly like Coffique. Content changes from Telegram appear in seconds; only a template switch redeploys.
6. Our own `/[slug]` keeps rendering the same template (preview, draft preview, fallback if Vercel is down).

## Existing code to reuse (verified by exploration)

- Venue creation: `store.createVenue(NewVenue)`, `seedMenuFrom(store, venueId, cats, items, texts)` in `src/seed/demo.ts`, `store.createInvite`, `store.getAdminToken` (used by `scripts/venue-create.mts`). Wizard payload maps onto `{ venue: NewVenue, categories: SeedCategory[], items: SeedItem[], texts: SeedTexts }`.
- Images: `store.saveMedia(venueId, bytes, contentType)` (Supabase bucket `media`, 5 MB, jpeg/png/webp/gif); `insertItem` accepts `image_media_id`; logo/cover/gallery are change ops (`set_logo_image`, `set_cover_image`, `add_gallery_image`) via `planChanges` + `createChangeSet` + `applyChangeSet` in `src/domain/changes.ts` — the wizard applies one auto-approved change set for images (keeps the change log honest).
- Rendering: `app/[slug]/components/*` (`SiteView`, `SiteHeader`, `TodayStatus`, `Specials`, `Highlights`, `AboutHours`, `Gallery`, `MenuList`, `SiteFooter`, `bits.tsx`, `useLiveSite.tsx`), all driven by `SiteState` + `now`; `LangProvider`/`useLang` in `src/i18n`; accent via `--accent` and `@theme inline reference` in `app/globals.css`. Dependency closure for a standalone template: `src/domain/{types,format,effective,hours,allergens}.ts`, `src/time.ts`, `src/i18n/{index.tsx,dicts.ts}`.
- Agent: `runTurn` is Telegram-bound; the wizard calls `@anthropic-ai/sdk` directly with `betaZodTool` the same way `src/agent/run.ts` does (`claude-opus-5-5`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, injectable `client` for tests).
- Public feed: `app/api/site/[slug]/route.ts`; Coffique's `src/lib/site-manager.ts` is the fetch pattern for the shell.
- Tests: `test/*.test.ts`, `test/helpers.ts` (`makeDemo`), `test/store-contract.ts`; memory store everywhere; Supabase contract opt-in.
- Deploy already exists for Site Manager itself (`vercel --prod`); `CRON_SECRET = TICK_SECRET`.

## Data model changes

`public.venues` (+ `NewVenue`/`Venue` in `src/domain/types.ts`, memory + Supabase stores):
- `template text not null default 'classic'` (check in registry ids), `business_type text not null default 'cafe'`
- `status text not null default 'live' check (status in ('draft','live'))`
- `deploy jsonb` = `{ provider: "vercel", project_id, deployment_id, url, status: "pending"|"building"|"ready"|"error", error?, updated_at }` or null
- `draft_token_hash text`, `created_ip_hash text`, `created_at` exists
- Policies: anon read on venues/categories/items/etc. only where the venue `status = 'live'`; drafts are reachable only through the server with the draft token. `scripts/check-rls.mts` gains the draft check.
- New `rate_limits (key text pk, count int, window_start timestamptz)` (memory: Map).

Store additions (`src/store/types.ts`, both implementations, contract test): `updateVenue(id, patch)`, `findVenueByDraftToken(token)`, `listVenues({ status?, deploying?: true })`, `setDeploy(id, deploy)`, `bumpRateLimit(key, windowMs, max): Promise<boolean>`, `deleteVenue(id)` (abandoned drafts; tick deletes drafts older than 48 h).

## Templates

`src/templates/` is the single source for designs, used by `app/[slug]` (preview, drafts, fallback) and bundled into the deployed shell.
- `src/templates/index.ts`: `TEMPLATES: Record<TemplateId, TemplateDef>`, `TemplateDef = { id, name_bg, name_en, tagline_bg, tagline_en, business_types: BusinessType[], fonts: () => NextFontObjects, Component: React.ComponentType<TemplateProps>, accentDefault, thumbnail }`; `TemplateProps = { state: SiteState; now: number; slug: string; page: "home"|"menu"; draft: DraftInfo|null; live: boolean; feedUrl: string }`.
- `src/templates/shared/`: `mediaUrl` (accepts Supabase https and, in wizard preview only, `blob:`), `useLiveSite` (polls `feedUrl` every 5 s; Supabase realtime stays an optional add-on in the main app only), price/allergen helpers re-exported from `src/domain`.
- `src/templates/classic/`: the current components moved (no visual change). Warm editorial: Literata + Onest, cream paper.
- `src/templates/nocturne/`: dark, bold, for bars and evening venues (pitch: The High End Bar). Grotesk display with Cyrillic (candidates: Unbounded, Manrope, Golos Text; verify subsets in `next/font/google`), deep near-black, one warm accent, large photography, film-grain overlay allowed.
- `src/templates/lumen/`: light, photo-first, airy, for specialty coffee (pitch: Coffique). Serif display + humanist sans with Cyrillic (candidates: Playfair Display, Cormorant Garamond, Prata + Golos Text).
- Each template task starts with a one-line Design Read (from `design-taste-frontend`), uses `emil-design-eng` and `apple-design` for motion (springs, interruptible, `prefers-reduced-motion`), `high-end-visual-design` for texture and spacing (its banned-font list yields to the Cyrillic rule), and is reviewed by `review-animations` + `web-design-guidelines`. Must pass: mobile 360 px, no horizontal scroll, Lighthouse a11y ≥ 95 in the Docker-less local run, both languages, open/closed/holiday states, empty gallery, 40-item menu.
- Import boundary test `test/templates-boundary.test.ts`: every file under `src/templates/**` may import only from `src/templates/**`, `src/domain/{types,format,effective,hours,allergens}`, `src/time`, `src/i18n`, `react`, `next/*`. This is what guarantees the shell bundle is complete.

## Thin shell app (what gets deployed per venue)

`templates/shell/`: `package.json` (next 16.4, react 19.3, tailwindcss 4, @tailwindcss/turbopack, typescript), `next.config.ts` (remotePatterns `*.supabase.co`, Tailwind turbopack rule), `tsconfig.json`, `app/layout.tsx` (loads the template's fonts, html lang), `app/page.tsx` + `app/menu/page.tsx` (server fetch of the feed with `next: { revalidate: 10 }`, render `<Template … live />`), `app/globals.css` (copied tokens), `app/robots.ts`, `app/sitemap.ts`, `app/opengraph-image.tsx` (venue name + cover), `app/not-found.tsx`, `src/` populated at deploy time from the manifest.

`src/deploy/manifest.ts`: `buildFiles(templateId): Promise<InlinedFile[]>` reads shell + `src/templates/shared` + `src/templates/<id>` + domain closure + i18n from disk, rewrites nothing (paths are preserved so `@/src/...` aliases keep working via the shell tsconfig). `next.config.ts` gains `outputFileTracingIncludes: { "/api/new/[id]/publish": ["./templates/shell/**", "./src/templates/**", "./src/domain/**", "./src/time.ts", "./src/i18n/**"] }` so the files exist in the serverless function.

`scripts/template-build.mts`: writes the manifest for each template to a temp dir, runs `npm install --no-audit --no-fund` and `next build` there. Run in `npm run test:templates` (slow, not in the default `npm test`) and before release. This is the offline proof that a deployed site builds.

## Deployer

`src/deploy/types.ts`: `Deployer { createSite(input: { slug, templateId, feedUrl }): Promise<{ projectId, deploymentId, url }>; status(deploymentId): Promise<{ state: "pending"|"building"|"ready"|"error", url?, error? }>; redeploy(projectId, templateId, feedUrl): Promise<{ deploymentId }>; addDomain?(projectId, domain): Promise<DnsInstructions>; deleteSite(projectId): Promise<void> }`.

`src/deploy/vercel.ts` (`VercelDeployer`, plain `fetch`, injectable for tests; envs `VERCEL_TOKEN` (team-scoped), `VERCEL_TEAM_ID` optional):
- `POST /v11/projects` `{ name: slug, framework: "nextjs", environmentVariables: [SITE_MANAGER_URL, SITE_MANAGER_SLUG → production+preview, type plain], ssoProtection: null }`; on `invalid_name`/conflict append `-site`, then `-<4 hex>`.
- `POST /v13/deployments?skipAutoDetectionConfirmation=1` `{ name, project: prj_id, target: "production", files: inline utf-8/base64, projectSettings: { framework: "nextjs", nodeVersion: "22.x" } }`.
- `GET /v13/deployments/{id}` → map `QUEUED|INITIALIZING|BUILDING` → building, `READY` → ready (read `alias[]`/`aliasAssigned` for the real production URL, never assume `<slug>.vercel.app`), `ERROR|CANCELED|BLOCKED` → error with `errorMessage`; on error fetch the last 20 `stderr` lines from `GET /v3/deployments/{id}/events` into `deploy.error` (never logged with the token).
- `POST /v10/projects/{id}/domains` + `GET /v6/domains/{domain}/config` for the optional custom-domain task.
- `src/deploy/fake.ts` (`FakeDeployer`): used when `VERCEL_TOKEN` is missing or `SITE_MANAGER_STORE=memory`; READY after two `status()` calls, url `https://<slug>.example.test`.
- Wiring: `ServerDeps.deployer`; `src/tick.ts` gains `pollDeployments(deps)` (venues with `deploy.status in pending|building`, max 10 per tick, 20-minute timeout → error) and `cleanupDrafts(deps)`. Vercel cron is daily, so the wizard done page also calls `POST /api/tick` with the admin key during the first 10 minutes (already allowed by `?key=` auth) — document this.

## Wizard

Routes (all server, memory-store friendly):
- `POST /api/new` → creates a draft venue (`status: draft`, random slug placeholder), sets cookie `sm_draft` (httpOnly, 7 days), applies rate limits (`ip:<hash>` 5 per hour, `global:day` `MAX_SITES_PER_DAY` default 50). IP hash = sha256(ip + `RATE_SALT`).
- `GET/PUT /api/new/[id]` → read/update draft fields: `template`, `business_type`, `name`, `slug` (validated `^[a-z0-9][a-z0-9-]{1,38}$`, uniqueness, reserved words `new, admin, api, embed`), `default_lang`, `address`, `phone`, `instagram`, `maps_url`, `hours` (`isValidHours`), `theme.accent`, `texts`, `categories[]`, `items[]`. Server re-validates every PUT with zod; items use `PRICE_MIN/MAX`, allergens `isAllergenCode`.
- `POST /api/new/[id]/media` → multipart image → `saveMedia` → `{ media_id, public_url }` (5 MB, image types only).
- `POST /api/new/[id]/extract` → `{ files: [{ media_type: image/*|application/pdf, data: base64 }] }` → Claude `claude-opus-5-5`, effort high, one `betaZodTool` `extract_menu` returning `{ categories: [{ name_bg, name_en, items: [{ name_bg, name_en, desc_bg, desc_en, price_eur, currency_seen: "EUR"|"BGN"|"unknown", allergens: number[] }] }], notes_bg, notes_en }`; PDF goes as a `document` block (base64, `application/pdf`, ≤ 10 MB, ≤ 20 pages), images as `image` blocks; BGN prices converted at 1.95583 and flagged; `suggestAllergens` merged in. Returned for review, never inserted directly. Refusal/`max_tokens` handled like `run.ts`.
- `POST /api/new/[id]/texts` → `{ facts }` → tool `draft_texts` returns tagline/about/welcome/footer_note in BG and EN, both natural (prompt rule: no literal translation, 40–120 words about).
- `POST /api/new/[id]/publish` → final validation, `createVenue` fields via `updateVenue`, `seedMenuFrom`, image change set applied, `status: live`, `createInvite(owner)`, `getAdminToken`; returns `{ slug, invite_code, admin_url }`. Deploy is **not** started here.
- Invite redemption (`redeemInvite` path in `src/bot/bot.ts`): when the redeemed invite's venue has `deploy == null` and `status == live`, enqueue `deployer.createSite` via `defer` and set `deploy.status = pending`; bot replies with the BG/EN "publishing, I'll message you when it's live" copy.
- `GET /api/new/[id]/status` → `{ status, deploy }` for the done page.

UI `app/new/` (client components, BG/EN via `src/i18n`, mobile-first, two-pane on ≥ 1024 px with the template preview sticky on the right; on mobile a "Preview" sheet):
- `page.tsx` template chooser (three live cards rendering the demo café, hover motion per `apple-design`), `[id]/page.tsx` stepper with steps `basics, look, hours, menu, texts, photos, review`, autosave on blur (PUT), optimistic preview built from local form state as a `SiteState` (`buildPreviewState(draft)` in `src/wizard/preview.ts`, unit-tested).
- Menu step: editable table (category tabs, drag order, inline price, allergen chips) + "Upload your current menu" dropzone (images/PDF) → extraction result shown as a diff-like review list with Accept all / per-row accept.
- Done page `app/new/[id]/done/page.tsx`: QR (`qrcode.react`) + `/start <code>` deep link `https://t.me/<bot>?start=<code>`, status line that polls `/status`, then the live URL and the dashboard link.
- Design: same skills as the templates; the wizard is the first thing a customer sees. Reviewer runs `web-design-guidelines` on `app/new/**`.
- Dashboard `app/admin/[slug]`: new "Your site" card: live URL, deploy status, "Change template" (redeploys), "Connect your domain" (optional task 11).

## Security and limits

- `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `RATE_SALT`, `MAX_SITES_PER_DAY` server-only; `.env.example` updated; grep the client bundle for `VERCEL_TOKEN` in the smoke script.
- Draft token only in the httpOnly cookie; `loadSite` returns 404 for drafts unless `draftToken` matches; admin API unchanged.
- Uploaded PDFs are never stored, only sent to Claude; images go through `saveMedia` limits.
- Project names come from the validated slug; deployment errors stored without secrets; Vercel responses never logged in full.
- Deleting a venue never deletes the Vercel project automatically (manual script `scripts/site-delete.mts` with confirmation).

## Task order (for superpowers:writing-plans, then subagent-driven-development)

1. Schema + types + Store additions (template, business_type, status, deploy, draft token, rate limits) in memory and Supabase; policies; check-rls; contract tests.
2. Template registry; move current components to `src/templates/classic`; `app/[slug]` dispatches on `venue.template`; `src/templates/shared` (`mediaUrl`, `useLiveSite` without Supabase); import-boundary test; no visual change.
3. Template `nocturne` (design skills; Cyrillic fonts; motion review).
4. Template `lumen` (design skills; Cyrillic fonts; motion review).
5. Shell app + manifest + `outputFileTracingIncludes` + `scripts/template-build.mts` + `npm run test:templates` (each template builds standalone offline).
6. Deployer interface + `VercelDeployer` (fetch-injected tests for create, poll, error, alias, name conflict) + `FakeDeployer` + tick polling + Telegram "site is live" copy BG/EN + deploy-on-invite-redeem.
7. Wizard API: draft create/update/media/publish/status + rate limits + validation tests.
8. Menu extraction (image + PDF) + "write for me" texts with a fake Anthropic client in tests; one skipped live test.
9. Wizard UI: chooser + stepper + live preview + menu table + extraction review (design skills; BG/EN).
10. Done page with QR and status polling; dashboard "Your site" card with template switch → redeploy.
11. Optional: custom domain in the dashboard (Pro): add domain, show DNS records, verify.
12. Docs: README (wizard, env table incl. Vercel token scope, demo script "template → wizard → Telegram Start → live site → change from Telegram"), `docs/IDEAS.md` (parked: WordPress/Shopify/Wix plugins, embed, Google push, GitHub connector, with the coverage table), Lovable landing CTA → `/new`; final whole-branch review.

Models: Fable for templates, wizard UI, extraction, deployer, and all reviewers; Opus for schema/store/manifest tasks.

## Verification

- Offline: `SITE_MANAGER_STORE=memory npm run dev` → `/new` → pick Nocturne → fill basics, upload a menu photo (extraction mocked when `ANTHROPIC_API_KEY` is absent, real when present) → publish → done page shows the code → simulate `/start` with the dev bot script → `FakeDeployer` reaches READY → bot message in the fake messenger → `/agala`-style page renders the chosen template. `npm test` green, `npm run test:templates` builds all three shells, `next build` green, `scripts/check-rls.mts` green, client bundle contains no `VERCEL_TOKEN`.
- Live (keys present): create a test venue through the wizard, redeem on the real phone, confirm the Vercel project appears in the team, production URL READY, site renders, Telegram change visible on it within 15 s, then `scripts/site-delete.mts` removes it.
- Design: `review-animations` and `web-design-guidelines` reports attached to each template task; screenshots at 360/768/1280 in both languages in the task reports.

## Interface contracts (binding for every task)

These names and signatures are fixed so tasks written independently fit together. Tasks may add private helpers but must not rename or reshape these.

### Domain (`src/domain/types.ts`)

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
  url: string | null;          // real production URL from the provider, with https://
  status: DeployStatus;
  error: string | null;        // short, secret-free
  template: TemplateId;        // template that was deployed
  updated_at: string;          // ISO
}
/** Moved here from src/server/site.ts (which re-exports it) so templates can import it. */
export interface DraftInfo { id: string; summary_bg: string; summary_en: string; key: string; }
// Venue gains:
//   template: TemplateId; business_type: BusinessType; status: VenueStatus;
//   deploy: DeployInfo | null; wizard_draft: WizardDraft | null;
```

### Wizard draft (`src/wizard/schema.ts`, zod 4; the JSON kept in `venues.wizard_draft` until publish)

```ts
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
export const RESERVED_SLUGS = ["new", "admin", "api", "embed", "draft", "demo", "www", "static", "_next"];
export interface WizardDraft {
  template: TemplateId; business_type: BusinessType;
  name: string; slug: string; default_lang: Lang;
  address: string; phone: string; instagram: string; maps_url: string;
  hours: WeekHours; theme: { accent: string };
  tagline_bg: string; tagline_en: string; about_bg: string; about_en: string;
  texts: { welcome: { bg: string; en: string }; footer_note: { bg: string; en: string } };
  logo_media_id: string | null; cover_media_id: string | null; gallery_media_ids: string[];
  categories: WizardCategory[];
  step: WizardStep;            // last step the owner reached
}
export interface WizardCategory { key: string; name_bg: string; name_en: string; items: WizardItem[] }
export interface WizardItem { key: string; name_bg: string; name_en: string; desc_bg: string; desc_en: string; price_eur: number; allergens: number[]; image_media_id: string | null }
export type WizardStep = "template" | "basics" | "look" | "hours" | "menu" | "texts" | "photos" | "review" | "done";
export const WIZARD_STEPS: readonly WizardStep[] = [...];
export const WizardDraftSchema: z.ZodType<WizardDraft>;          // full, used on publish
export const WizardPatchSchema = WizardDraftSchema.partial();     // used on PUT
export function emptyDraft(template: TemplateId): WizardDraft;    // sensible defaults, DEFAULT_HOURS, accent = template default
export function validateForPublish(d: WizardDraft): { ok: true } | { ok: false; errors: { path: string; bg: string; en: string }[] };
```

`src/wizard/preview.ts`: `buildPreviewState(d: WizardDraft, media: Media[], now: Date): SiteState` (ids `prev-cat-<key>`, `prev-item-<key>`, venue id `preview`, status live).

### Store (`src/store/types.ts`; memory + Supabase; covered by `test/store-contract.ts`)

```ts
export type VenuePatch = Partial<Pick<Venue,
  "slug" | "name" | "tagline_bg" | "tagline_en" | "about_bg" | "about_en" | "address" | "phone" | "maps_url" | "instagram" |
  "hours" | "tz" | "default_lang" | "theme" | "template" | "business_type" | "status" | "wizard_draft">>;
// NewVenue gains optional template, business_type, status, wizard_draft.
updateVenue(id: string, patch: VenuePatch): Promise<Venue>;           // throws on unknown id or slug conflict
setDeploy(id: string, deploy: DeployInfo | null): Promise<void>;
listVenues(opts?: { status?: VenueStatus; deploying?: boolean }): Promise<Venue[]>;  // deploying = deploy.status in ("pending","building")
setDraftToken(id: string, tokenHash: string | null): Promise<void>;
findVenueByDraftToken(tokenHash: string): Promise<Venue | null>;
listMembers(venueId: string): Promise<Member[]>;
deleteVenue(id: string): Promise<void>;                               // cascades content, members, invites, tokens, media rows (not storage objects)
/** Sliding window counter. Returns true when the call is allowed (count after increment <= max). */
bumpRateLimit(key: string, windowMs: number, max: number, now: string): Promise<boolean>;
```
`src/server/hash.ts`: `sha256Hex(s: string): string` (node:crypto), `newDraftToken(): string` (32 bytes hex).

SQL (`supabase/schema.sql`): venues + `template text not null default 'classic' check (template in ('classic','nocturne','lumen'))`, `business_type text not null default 'cafe' check (...)`, `status text not null default 'live' check (status in ('draft','live'))`, `deploy jsonb`, `wizard_draft jsonb`, `draft_token_hash text unique`; table `rate_limits (key text primary key, count int not null, window_start timestamptz not null)`. `supabase/policies.sql`: anon select on venues/categories/items/holidays/announcements/media/site_texts only when the venue is `status = 'live'` (join or subselect); `rate_limits` service-role only. `scripts/check-rls.mts` asserts a draft venue is invisible to anon.

### Templates (`src/templates/index.ts`)

```ts
export interface TemplateProps { state: SiteState; now: number; slug: string; page: "home" | "menu"; draft: DraftInfo | null; live: boolean; feedUrl: string; preview?: boolean }
export interface TemplateDef {
  id: TemplateId; name_bg: string; name_en: string; tagline_bg: string; tagline_en: string;
  business_types: BusinessType[]; accentDefault: string;
  /** CSS class string from next/font that sets --font-display and --font-body (and any extra vars). */
  fontVars: string;
  Component: React.ComponentType<TemplateProps>;
}
export const TEMPLATES: Record<TemplateId, TemplateDef>;
export function getTemplate(id: string | null | undefined): TemplateDef;   // falls back to classic
```
Each template folder: `index.ts` (exports `def: TemplateDef`), `fonts.ts` (next/font/google at module scope, subsets `["latin", "cyrillic"]`, `variable` names `--font-display`, `--font-body`), `Template.tsx` (`"use client"` root; sets `--accent`; applies `fontVars`; uses `useLiveSite` from shared), components. `src/templates/shared/`: `media.ts` (`mediaUrl(m: Media | null | undefined, opts?: { preview?: boolean }): string | null` – https on Supabase hosts, plus `blob:` and `data:` when `preview`), `useLiveSite.ts` (`useLiveSite(initial: SiteState, feedUrl: string, live: boolean): { state: SiteState; changed: Changed }` polling every 5 s, no Supabase), `types.ts` (`Changed`), `format.ts` re-exports.
Import boundary (enforced by `test/templates-boundary.test.ts`): files under `src/templates/**` import only `react`, `react-dom`, `next/*`, `src/templates/**`, `src/domain/{types,format,effective,hours,allergens}`, `src/time`, `src/i18n/*`.

Generated file for the shell: `src/templates/current.ts` = `export { def } from "./<id>";` (written by the manifest, git-ignored, also written for local shell builds).

### Shell and manifest (`templates/shell/`, `src/deploy/manifest.ts`)

```ts
export interface InlinedFile { file: string; data: string; encoding: "utf-8" | "base64" }
export const SHELL_ROOT = "templates/shell";
export const MANIFEST_DIRS = ["src/templates/shared", "src/domain", "src/time.ts", "src/i18n"];   // plus src/templates/<id>
export async function buildFiles(templateId: TemplateId, opts?: { root?: string }): Promise<InlinedFile[]>;  // deterministic order, paths relative to shell root
```
Shell reads env `SITE_MANAGER_URL` and `SITE_MANAGER_SLUG`; `app/page.tsx` and `app/menu/page.tsx` fetch `${SITE_MANAGER_URL}/api/site/${slug}` with `next: { revalidate: 10 }` and render `<def.Component state now slug page draft={null} live feedUrl={`${SITE_MANAGER_URL}/api/site/${slug}`} />`.

### Deployer (`src/deploy/types.ts`, `src/deploy/vercel.ts`, `src/deploy/fake.ts`, `src/deploy/run.ts`)

```ts
export interface DeployInput { slug: string; templateId: TemplateId; feedUrl: string }
export interface DeployStatusResult { state: DeployStatus; url: string | null; error: string | null }
export interface DomainInstructions { verified: boolean; records: { type: "A" | "CNAME" | "TXT"; name: string; value: string }[] }
export interface Deployer {
  readonly provider: "vercel" | "fake";
  createSite(i: DeployInput): Promise<{ projectId: string; deploymentId: string }>;
  status(deploymentId: string): Promise<DeployStatusResult>;
  redeploy(projectId: string, i: DeployInput): Promise<{ deploymentId: string }>;
  deleteSite(projectId: string): Promise<void>;
  addDomain?(projectId: string, domain: string): Promise<DomainInstructions>;
}
export class VercelDeployer implements Deployer {
  constructor(opts: { token: string; teamId?: string | null; fetch?: typeof fetch; files: (id: TemplateId) => Promise<InlinedFile[]>; log?: (s: string) => void });
}
export class FakeDeployer implements Deployer { /* ready after two status() calls; url https://<slug>.example.test */ }
// src/deploy/run.ts
export async function startDeploy(d: { store: Store; deployer: Deployer; feedUrlFor: (slug: string) => string; now: () => Date; log?: (s: string) => void }, venueId: string): Promise<void>;  // sets pending → building, or error; never throws
export async function pollDeployments(d: { store: Store; deployer: Deployer; messenger: Messenger | null; now: () => Date; venueId?: string }): Promise<{ ready: string[]; failed: string[] }>;  // notifies owner members on ready/error (BG/EN copy from src/bot/copy.ts)
```
Config (`src/config.ts`) gains: `vercelToken: string | null`, `vercelTeamId: string | null`, `rateSalt: string` (lenient default `"dev-salt"`), `maxSitesPerDay: number` (default 50), `telegramBotUsername: string | null` (`TELEGRAM_BOT_USERNAME`, for the `https://t.me/<bot>?start=<code>` link). `ServerDeps` gains `deployer: Deployer` and `startDeploy(venueId): void` (deferred). `BotDeps` gains `onOwnerJoined?: (venueId: string) => void`, called after a successful owner redeem; deps wire it to `startDeploy` when the venue is live with `deploy === null`.

### Wizard API (`app/api/new/**`, `src/server/wizard.ts`)

Cookie `sm_draft` = `<venueId>.<token>`, httpOnly, sameSite lax, path `/`, 7 days. Every `[id]` route: cookie id must equal the path id and `sha256Hex(token)` must match `findVenueByDraftToken`. Responses are JSON; errors `{ error: { code, bg, en } }` with 400/401/404/409/429.

```ts
// src/server/wizard.ts (pure functions over Store, tested with the memory store)
export async function createDraft(store: Store, template: TemplateId, now: Date): Promise<{ venue: Venue; token: string }>;
export async function updateDraft(store: Store, venue: Venue, patch: Partial<WizardDraft>): Promise<WizardDraft>;   // validates with WizardPatchSchema; slug uniqueness; merges
export async function publishDraft(store: Store, venue: Venue, now: Date): Promise<{ venue: Venue; inviteCode: string; adminToken: string }>;  // validateForPublish, updateVenue, seedMenuFrom, image change set (source "dashboard", auto-applied), status live, wizard_draft null, invite (owner, INVITE_TTL_MS), token
export function rateLimitKeys(ipHash: string): { ip: string; global: string };   // "new:ip:<hash>", "new:global"
```
Routes: `POST /api/new` `{ template }` → `{ id }` + cookie (429 on limit); `GET /api/new/[id]` → `{ draft, media: Media[] }`; `PUT /api/new/[id]` patch → `{ draft }`; `POST /api/new/[id]/media` multipart `file` → `{ media }`; `POST /api/new/[id]/extract` `{ files: [{ media_type, data }] }` → `ExtractResult`; `POST /api/new/[id]/texts` `{ facts: string }` → `DraftTexts`; `POST /api/new/[id]/publish` → `{ slug, invite_code, start_url, admin_url, site_url }`; `GET /api/new/[id]/status` → `{ status: VenueStatus; deploy: DeployInfo | null; site_url: string | null }` (polls the deployer when pending/building).

### Claude helpers (`src/wizard/extract.ts`, `src/wizard/texts.ts`)

```ts
export interface ExtractFile { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf"; data: string /* base64 */ }
export interface ExtractResult { categories: { name_bg: string; name_en: string; items: { name_bg: string; name_en: string; desc_bg: string; desc_en: string; price_eur: number; currency_seen: "EUR" | "BGN" | "unknown"; allergens: number[] }[] }[]; notes_bg: string; notes_en: string }
export async function extractMenu(client: Anthropic, cfg: { model: string }, files: ExtractFile[]): Promise<ExtractResult | "refused" | "error">;
export interface DraftTexts { tagline_bg; tagline_en; about_bg; about_en; welcome_bg; welcome_en; footer_note_bg; footer_note_en }
export async function draftTexts(client: Anthropic, cfg: { model: string }, facts: string, lang: Lang): Promise<DraftTexts | "refused" | "error">;
```
Both use `client.beta.messages.create` with one tool and `tool_choice: { type: "tool", name }`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, `output_config: { effort: "high" }`, `max_tokens: 16000`; validate the tool input with zod; BGN → EUR at 1.95583 rounded to cents; `suggestAllergens(name + desc)` merged into `allergens`.
