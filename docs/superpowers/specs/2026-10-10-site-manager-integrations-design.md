# Site Manager: integrations for sites we did not build (design spec)

Status: approved direction on 2026-10-10, then parked in favour of template-first onboarding (see `2026-10-10-site-manager-templates-design.md`). This spec is the starting point for a separate build track.

## Scope for the integrations session of 2026-10-10 (binding; overrides the rest of this file where they differ)

Decided with the owner on 2026-10-10: this session builds **only the WordPress plugin, with full site access** (Deliverable 2 complete: read blocks and the write channel, plus the parts of our side that the write channel needs). Deliverables 1 (embed + JSON feed docs), 3 (Google Business Profile push) and 4 (GitHub connector) are deferred to later sessions. The Shopify and Wix apps stay a to-do.

What stays from Deliverable 3 because the write channel needs it: the `venue_destinations` and `destination_syncs` tables, the secret encryption, the `Destination` adapter interface, the registry and the sync runner. The Google adapter itself is not built.

Decisions that refine the design above:

- **Targets.** WordPress 6.5 or newer, PHP 8.1 or newer. Translations ship as `languages/site-manager-bg_BG.po` (source of truth) plus the generated `.l10n.php` and `.mo` files (WordPress 6.5 loads the PHP file first). Block labels seen by guests (menu, specials, hours…) are not tied to the WordPress locale: every block takes a `lang` attribute (`bg`, `en`, or `auto` = the venue's default language) and renders from the plugin's own BG/EN label table, which mirrors `site.*` in `src/i18n/dicts.ts`.
- **Read-time rules in PHP.** The plugin applies the same rules as `src/domain/effective.ts` and `src/domain/hours.ts` using the `now` field of the feed: an elapsed `sold_out_until` means available, an expired special is hidden, expired announcements are hidden, holidays are listed from today in the venue's time zone, and the hours block shows "open until / opens at / closed" in that zone. Prices format as `2,90 €` (BG) and `€2.90` (EN). The feed is cached in a transient for `cache_seconds` (default 30) and the last good copy is kept for 24 hours so a feed outage never breaks the page.
- **Connect flow.** The plugin's settings page generates a one-time code (10 characters, 15-minute expiry, hashed in an option) and shows one line to copy into the bot: `/connect <site url> <code>`. The bot command (owner only) validates the URL (https, no credentials in the URL, no private address; plain http is accepted only for `localhost`, `127.0.0.1` and `host.docker.internal` so the Docker smoke test works), calls `POST /wp-json/site-manager/v1/handshake` with the code and the venue slug, receives the plugin token once and stores it encrypted in `venue_destinations.secrets`. The plugin stores only the token's SHA-256 and the id of the WordPress admin who generated the code; every later write runs as that admin (`wp_set_current_user`), so content is not stripped by `kses` and revisions have an author. The plugin refuses the handshake when the slug does not match its own settings, so a token is bound to one venue.
- **Secrets at rest.** `secrets` is a `text` column holding base64 of AES-256-GCM (12-byte IV, 16-byte tag, ciphertext) under `DESTINATION_SECRET_KEY` (32 bytes, hex or base64). The memory store uses a fixed development key when the variable is missing and logs a warning; the Supabase path refuses to connect a destination without it. Secrets are never logged, never returned by any API, never read by `loadSite` or the public feed.
- **Change rows.** WordPress edits are `Change` rows with entities `wp_page`, `wp_media`, `wp_option`, `wp_menu` (and `wp_product` when WooCommerce is present) and ops `wp_edit_page`, `wp_upload_photo`, `wp_set_option`, `wp_edit_menu`, `wp_edit_product`. `before` and `after` hold the full editable fields (for a page: `title`, `content`, `elementor_data`, `featured_media`), so undo is content-based: the inverse set pushes `before` back. WordPress revisions are still created by `wp_update_post` and `POST /revert/{page}/{revision}` exists, but our undo does not depend on revision ids. The store's `applyChangeSet` treats `wp_*` entities as no-ops (they do not live in our database); a store decorator installed in `src/server/deps.ts` enqueues and runs the push for every apply path (bot button, dashboard, scheduled apply in the tick, agent instant apply), and the tick retries failed pushes with exponential backoff (1 min, 5 min, 25 min, 2 h, 10 h; five attempts). The bot's confirmation and the dashboard log show one line per destination: updated, will retry, or the short error.
- **Page builders.** Gutenberg, the Classic editor and Divi (shortcodes in `post_content`) are edited through `post_content`: the agent sends either a full `content` or exact `replacements` (`find` must occur exactly once). Elementor pages are edited by the same `replacements`, applied by the plugin inside the string values of `_elementor_data` (the plugin also clears Elementor's CSS cache). Unknown builders are reported by `wp_list_site` and refused by `wp_edit_page` with a message that suggests the hosted page. A preview is a pending copy in post meta (`_site_manager_pending`, 24-hour expiry) rendered at `<permalink>?sm_preview=<key>` by `the_title`/`the_content` filters; Elementor pages get no preview link (the Telegram preview shows the text diff instead). Nothing is written to the live post until the owner approves.
- **Photos.** `wp_upload_photo` uploads a photo the owner sent to the bot (from our media store) into the WordPress media library at apply time, optionally as the featured image of a page; the plugin records the source URL in attachment meta so the upload is idempotent and undo can find and delete it. Page content proposed in the same change set may reference such a photo as `{{sm_media_url:<media id>}}` / `{{sm_media_id:<media id>}}`; the preview request carries the Supabase URL for rendering and the push replaces the placeholders with the attachment's URL and id after the upload.
- **Options and menus.** `PUT /option` allows `blogname`, `blogdescription`, `custom_logo` and `site_icon` (attachment ids; a logo can be a placeholder for a photo uploaded in the same set). Navigation menus are replaced wholesale (`PUT /menu/{id}` with the full item list; `before` holds the previous list).
- **Plugin API hardening.** Every endpoint except `handshake` needs `Authorization: Bearer <token>` (constant-time hash compare); `handshake` is limited to 5 calls per minute per IP, the rest to 120 per minute; every call is appended to a 50-entry ring buffer (`sm_api_log`: time, IP, method, route, status, duration) shown on the settings page, which also has a "Disconnect" button that discards the token hash.
- **Owner surfaces.** A "WordPress" card on the dashboard (`app/admin/[slug]/components/WordPressCard.tsx`, rendered through a new optional `extra` slot of `AdminPanel`; connection status, the plugin download, the two settings to paste, the three steps in BG/EN, the last five pushes, Disconnect), served by a new route `app/api/admin/[slug]/wordpress/route.ts`. The bot gets `/connect`. The client onboarding will show the plugin later; not in this session. The plugin zip is built deterministically by `scripts/wp-plugin-zip.mts` into `public/wp/site-manager.zip` and committed; a test rebuilds it and fails when the committed file is stale.
- **Verification.** Offline: a fake plugin REST surface in `test/fake-wordpress.ts`, PHP render tests with a WordPress-function shim run in a `php:8.3-cli` container (`npm run wp:test`), `php -l` on every PHP file (`npm run wp:lint`), the contract test that every feed field the PHP reads exists in `SiteState`. Live: `integrations/wordpress/docker-compose.yml` (WordPress + MySQL) and `scripts/wp-smoke.mts`, which installs WordPress with WP-CLI, activates the plugin, points it at a feed, checks that the menu block renders, then runs connect → preview → apply → undo against the real container with the in-memory store.
- **Not in this session.** Embed pages and `public/embed.js`, `docs/lovable/INTEGRATION-PROMPT.md`, the Google adapter and its connect flow, the GitHub app, the `/connect` line in `/start`. `docs/INTEGRATION.md` covers WordPress only and says so.

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
