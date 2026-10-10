# Site Manager: integrations for sites we did not build (design spec)

Status: approved direction on 2026-10-10, then parked in favour of template-first onboarding (see `2026-10-10-site-manager-templates-design.md`). This spec is the starting point for a separate build track.

## Context

Site Manager manages a venue's website from Telegram, but only sites we host (`/[slug]`) or wire by hand (Coffique reads our JSON feed). Owners with an existing WordPress, Wix, Squarespace, Shopify, custom or AI-built (Lovable, Claude) site should be able to use the agent without rebuilding.

Research (2026-10-10): WordPress ≈ 42 % of all websites globally and 65–87 % of CMS sites in Bulgaria; ~63 % of Bulgarian sites use no CMS (custom, agency, static, AI-built); Shopify ≈ 5 % global but negligible in Bulgaria; Wix ≈ 4 % global, ≈ 3 % BG; Squarespace, Joomla, Drupal small. Every venue has a Google Business Profile. Platform write access: WordPress plugin = full server access; Shopify app = API with scopes, theme-code writes gated by app review; Wix app = menus (Developer Preview), business hours, media, no page-text or code API; Squarespace = products API only; custom site = no API, but sites in a GitHub repository with auto-deploy (Vercel, Netlify, Lovable hosting) can be edited through pull requests.

Decision: **pull-first, then the biggest access each platform allows.** Deliverables in order:
1. Generic embed snippet + JSON feed docs (custom, AI-built, Wix, Squarespace, Joomla).
2. WordPress plugin: read blocks first, then a full write channel (page text, photos, menus, theme options).
3. Google Business Profile push (regular hours, holiday hours, specials as posts).
4. GitHub connector for custom and AI-built sites (agent edits the repository; pull request = change set; preview URL = draft; approve = merge; undo = revert).
Shopify and Wix apps are a to-do only.

Safety rule for every write path: nothing reaches a customer's site without the existing preview → one-tap approval → audit log → undo/auto-revert flow; destination secrets are encrypted at rest, server-only, never logged.

## Market coverage (Bulgaria café/restaurant sites; global in brackets)

| Level of change the agent can make | Platforms | Share of sites with a website |
|---|---|---|
| Everything (text, photos, pages, layout, menu, hours) | WordPress plugin; GitHub connector | ~35–45 % (~50–55 %) |
| Live sections (menu, specials, hours, announcements, photos) via embed | Wix, Squarespace, Joomla, Drupal, static/agency custom | ~50 % (~40 %) |
| Hosted page + link/QR only | Sites nobody can edit | ~5 % |
| Hours, holidays, specials on Google | Every venue | 100 % |
| Whole site because we host it | Venues with no website | 100 % of those |

## Existing code to reuse

- Public JSON: `app/api/site/[slug]/route.ts` → `loadSite` (`src/server/site.ts`), read-time effectiveness applied; never exposes admin keys.
- Rendering components (`src/templates/classic/**` after the templates track lands; `app/[slug]/components/**` before) driven by `SiteState`.
- Change-set engine: `planChanges`/`applyChanges` in `src/domain/changes.ts`, `Store.applyChangeSet`; `applyChangeSet` callers in `src/server/deps.ts`, bot approvals, admin API, tick.
- `src/tick.ts` for retries; Store interface with memory + Supabase implementations; `SITE_MANAGER_STORE=memory` for offline.
- Coffique integration `~/Coffique/src/lib/site-manager.ts` as the JSON-feed reference; `docs/lovable/LANDING-PROMPT.md` as the prompt-pack pattern.

## Deliverable 1: embed + JSON feed docs

- `app/embed/[slug]/[block]/page.tsx`: iframe-safe server pages for blocks `menu`, `specials`, `hours`, `announcements`, `photos`, `text/[key]`; query `lang`, `theme`, `accent`; `Cache-Control: public, max-age=30`; CSP `frame-ancestors *` only on `/embed/*` (headers in `next.config.ts`).
- `public/embed.js` (< 3 KB, no deps): reads `data-venue`, `data-block`, `data-lang`, `data-accent` from its own script tag, injects an auto-resizing iframe (postMessage height), falls back to a link to `/[slug]`. No cookies.
- `docs/INTEGRATION.md`: embed snippet per block, JSON feed schema (reference `SiteState` + sample), Next.js and plain-fetch examples with revalidation and local fallback, hosted page + QR path.
- `docs/lovable/INTEGRATION-PROMPT.md` (BG/EN): prompt an owner pastes into Lovable or Claude Code to make an AI-built site read menu/hours/specials/texts/photos from the feed.
- Dashboard card "Connect your website" with copyable snippets; `/connect` line in the bot `/start` copy.
- Tests: `test/embed.test.ts` (blocks render from the memory store, `lang`, 404 unknown slug, no admin fields), `test/embed-js.test.ts`.

## Deliverable 2: WordPress plugin

`integrations/wordpress/site-manager/` (PHP, outside the Next.js build):
- `site-manager.php` (settings: base URL, slug, cache seconds; uninstall cleanup), `includes/class-sm-client.php` (`wp_remote_get` + transient cache, readable error, never breaks the page), `includes/shortcodes.php` (`[site_manager_menu|specials|hours|announcements|photos]`, `[site_manager_text key=...]`, `lang` attr, server-side HTML with CSS variables), `blocks/` (Gutenberg wrappers with ServerSideRender), `readme.txt`, `CHANGELOG.md`, `scripts/wp-plugin-zip.mts`.
- `test/wp-plugin-contract.test.ts`: the JSON fields the PHP reads exist in `SiteState`. Manual smoke in a throwaway `wordpress` Docker container documented in `docs/INTEGRATION.md`.

Write channel (second task):
- Connect: plugin shows a one-time code; owner sends `/connect <code>`; our server calls `POST /wp-json/site-manager/v1/handshake` and receives a plugin token (random 32 bytes, hashed in WP options, encrypted in `venue_destinations.secrets`). No WP admin credentials leave the site.
- Endpoints under `/wp-json/site-manager/v1/` (bearer plugin token, rate-limited, logged to an option ring buffer visible on the settings page): `GET /site`, `GET|PUT /page/{id}` (revision first; `preview: true` returns a WP preview link), `POST /media`, `PUT /media/{id}`, `PUT /option` (allow-list: blogname, blogdescription, logo/accent theme mods, WooCommerce hours), `GET|PUT /menu/{id}`, `POST /revert/{page_id}/{revision_id}`, WooCommerce `GET|PUT /product/{id}` when present.
- Our side: `src/destinations/wordpress.ts` implements `Destination` and adds agent tools `wp_list_site`, `wp_read_page`, `wp_edit_page`, `wp_upload_photo`, `wp_set_option`, `wp_edit_menu`, each producing `Change` rows (`entity: "wp_page" | "wp_media" | "wp_option" | "wp_menu"`, before/after snapshots) so preview → approve → undo applies unchanged; Apply publishes, Cancel deletes the draft revision, Undo restores the revision. Page builders: Gutenberg/Classic edited as blocks/HTML; Elementor/Divi text widgets edited inside the stored JSON/shortcodes; if detection fails, refuse and offer the embed block.
- Tests: `test/destinations-wordpress.test.ts` (fake plugin REST surface), `test/agent-wordpress-tools.test.ts`.

## Deliverable 3: Google Business Profile push (first "destination")

- Tables (memory + Supabase): `venue_destinations (id, venue_id, kind google|wordpress|github|shopify|wix, config jsonb, secrets bytea encrypted with DESTINATION_SECRET_KEY, status, created_at)`, RLS service-role only, never read by `loadSite`; `destination_syncs (id, change_set_id, destination_id, status pending|done|failed, attempts, last_error, payload jsonb, updated_at)`. Store: `listDestinations`, `enqueueSync`, `listPendingSyncs`, `markSync`; `scripts/check-rls.mts` checks both tables.
- `src/destinations/types.ts` (`Destination { kind, render(state, changes): Payload | null, push(payload, secrets) }`), `registry.ts`, `sync.ts` (`enqueueForChangeSet` after a successful `applyChangeSet` in `src/server/deps.ts`; `runPendingSyncs` from `src/tick.ts`, exponential backoff, max 5 attempts), `google.ts` (hours → `regularHours`, holidays → `specialHours` wholesale replace, announcements/specials → Local Posts; OAuth refresh token in secrets; **dry-run** when `GOOGLE_BP_CLIENT_ID` missing).
- Bot: confirmation appends one line per destination ("Google: updated / will retry / not connected") BG/EN. Dashboard "Connect Google" → `app/api/admin/[slug]/google/start` + `/callback`.
- Apply for Business Profile API access immediately; demo runs in dry-run until approved.

## Deliverable 4: GitHub connector (code access for custom and AI-built sites)

- GitHub App (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`); owner installs on one repository from the dashboard; installation id + repo in `venue_destinations` (kind `github`); tokens minted per call. Webhook `app/api/github/route.ts` (signature-checked) for `pull_request` and `deployment_status`.
- Change entity `code`, op `pr`: `after = { branch, pr_number, preview_url, summary_bg, summary_en, files[] }`, `before = { base_sha }`.
- Agent tool `code_change(request, photos[])` available only when a `github` destination exists; hands the work to a sandboxed coding agent (Managed Agents preferred) with a strict brief (small diff, no dependency changes, no page deletions, must build); result = branch + PR; host builds a preview.
- Telegram card: summary in the owner's language, changed files, preview URL; Apply = squash-merge (only with green checks), Cancel = close + delete branch, Undo = revert PR; never push to the default branch; scheduled merges via the tick.
- Structured content keeps flowing through the JSON feed; the code path is only for what the feed cannot express.
- Tests: `test/destinations-github.test.ts` (fake GitHub API: install → PR → preview → merge; close on cancel; revert on undo; refuse Apply on red checks; webhook signature), `test/agent-code-change.test.ts`; one skipped live test on a throwaway Coffique fork.
- Demo on Coffique: "Добави коледна секция с тези две снимки" → PR with Vercel preview → Approve → live → Undo → reverted.

## Task order

1. Embed pages + CSP + tests. 2. `public/embed.js` + dashboard card + `/connect` copy. 3. `docs/INTEGRATION.md` + Lovable integration prompt. 4. Destination tables + Store + RLS + secret encryption. 5. Destination types/registry/sync hook/tick runner. 6. WordPress plugin read blocks + zip + contract test. 7. WordPress write channel + agent tools. 8. Google adapter (dry-run + live) + connect flow + bot lines. 9. GitHub connector + `code_change` tool. 10. IDEAS.md (Shopify, Wix), README "Works with your existing website", final review.

Demo-critical path if time runs short: 1–3, 6–7, 9 on Coffique; Google stays in dry-run.

## Verification

- Offline: embed blocks render and update within 30 s after a dashboard apply; `npm test`, `next build`, `check-rls` green; no destination secrets in the client bundle.
- WordPress: Docker `wordpress`, upload zip, menu block renders and updates after a Telegram change; `/connect`, change the About text, preview link, Apply, Undo restores the revision.
- GitHub: app on a throwaway Coffique fork; PR with Vercel preview appears in Telegram; Apply merges; Undo reverts; webhook rejects bad signatures.
- Coffique keeps building and reading the feed.
