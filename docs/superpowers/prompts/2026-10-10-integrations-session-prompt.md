# Prompt for a parallel Claude Code session: Site Manager integrations track

Copy everything below the line into a new Claude Code session opened in `/Users/tanyatopacharova/Projects/site-manager`. Replace the "My changes" section with your own edits before sending.

---

You are building the **integrations track** of Site Manager (a café website managed from Telegram by a Claude agent). Another Claude session is working in this same repository at the same time on the **templates track** (branch `build/templates`: three site templates, a `/new` wizard, automatic Vercel deploys). You two must not collide. Read everything below before touching anything.

## 1. Read first, in this order

1. `docs/superpowers/specs/2026-10-10-site-manager-integrations-design.md` — the design for your track (embed snippet + JSON feed docs, WordPress plugin with read blocks then a write channel, Google Business Profile push with a "destination" layer, GitHub connector for custom and AI-built sites; Shopify and Wix only as a to-do). This is your spec.
2. `docs/superpowers/specs/2026-10-10-site-manager-templates-design.md` — the other track's spec, including its binding "Interface contracts". Do not implement anything from it; you only need to know what it changes so you avoid those files.
3. `docs/superpowers/specs/2026-10-10-site-manager-design.md`, `README.md`, `docs/superpowers/plans/2026-10-10-site-manager-mvp.md` — the existing product and its conventions (change sets, preview → approve → undo, BG/EN everywhere, memory store for offline tests).
4. `.impeccable.md` — design context for any UI you build (dashboard cards, embed pages).

## 2. My changes to the spec

[Write your changes here before sending. Examples: "skip the GitHub connector", "WordPress write channel is required for the demo", "Google push can wait", "embed must support a dark theme", "target WordPress 6.5+ and PHP 8.1".]

Apply these to the integrations spec first (edit the spec file, commit it), then plan from the edited spec.

## 3. Isolation rules (non-negotiable)

- Work in a separate git worktree and branch, created from `build/templates` so you inherit both specs:
  ```bash
  git worktree add ../site-manager-integrations -b build/integrations build/templates
  cd ../site-manager-integrations && npm install
  ```
  Never commit to `main` or `build/templates`. Never run `git checkout` in `/Users/tanyatopacharova/Projects/site-manager` itself. Do not merge; at the end, push `build/integrations` and open a PR against `main` with a note that it must be rebased after `build/templates` merges.
- Files the templates track is editing — treat as **append-only** (add new exports, new cases, new columns at the end; never reorder, rename or restructure): `src/domain/types.ts`, `src/store/types.ts`, `src/store/memory.ts`, `src/store/supabase.ts`, `supabase/schema.sql`, `supabase/policies.sql`, `src/server/deps.ts`, `src/tick.ts`, `src/bot/bot.ts`, `src/bot/copy.ts`, `src/config.ts`, `app/admin/[slug]/page.tsx`, `src/server/admin.ts`, `next.config.ts`, `.env.example`, `README.md`, `scripts/check-rls.mts`, `test/store-contract.ts`. Put everything else in new files: `src/destinations/**`, `app/embed/**`, `public/embed.js`, `integrations/wordpress/**`, `app/api/github/**`, `docs/INTEGRATION.md`, `docs/lovable/INTEGRATION-PROMPT.md`, new `test/*.test.ts`.
- Do not touch `app/[slug]/**`, `src/templates/**`, `templates/**`, `src/deploy/**`, `src/wizard/**`, `app/new/**`, `app/api/new/**` — those belong to the other track. The embed pages must import rendering components from `src/templates/classic/**` if that folder exists in your worktree, otherwise from `app/[slug]/components/**`, and say which in your plan.
- New database tables (`venue_destinations`, `destination_syncs`) go in a separate SQL file `supabase/schema-integrations.sql` applied by `scripts/db-apply.mts` after `schema.sql`, with their policies in `supabase/policies-integrations.sql`.
- Do not deploy to Vercel production and do not change the Telegram webhook. Preview deployments of your branch are fine. Do not run `npm run demo:reset`, `cleanup:test-venues` or anything that writes to the live Supabase project except `db:apply` for your two new tables, and ask me before that.

## 4. Security rules (same as the main build)

- Never read or print `.env.local` values; never commit `.env*` except `.env.example`.
- Service-role key, database URL, destination secrets (plugin tokens, Google refresh tokens, GitHub app key) only in server code and scripts; grep the client bundle before you finish.
- Destination secrets encrypted at rest with a new `DESTINATION_SECRET_KEY` env; never logged; the public feed and `loadSite` never read the destinations table.
- Every write to a customer's site goes through the existing preview → one-tap approval → audit log → undo flow. No direct writes from tools.
- Webhooks (GitHub) verify their signature; WordPress plugin endpoints require the bearer plugin token and are rate-limited.
- Both languages for every user-facing string, Bulgarian first and natural, English natural; the agent replies in Bulgarian when the message is Cyrillic (already implemented, keep it).

## 5. How to work

1. Use `superpowers:brainstorming` only if my changes leave the design ambiguous; otherwise go straight to `superpowers:writing-plans` and write `docs/superpowers/plans/2026-10-10-site-manager-integrations.md` from the edited spec, with TDD tasks, full code in every step, no placeholders.
2. Then execute with `superpowers:subagent-driven-development`: a fresh implementer per task, spec review + code-quality review after each task, fix loops, final whole-branch review. Use the most capable model (Fable) for the WordPress write channel, the destination/sync layer, the GitHub connector, agent tools and all reviewers; a cheaper model for mechanical tasks.
3. Ask me all your questions in one batch at the start, then work without interruptions. If something is blocked (API approval, missing key), build the dry-run path and keep going.
4. Everything must be testable offline with `SITE_MANAGER_STORE=memory`: fake WordPress REST surface, fake Google client, fake GitHub API. Live tests are `it.skip` unless the env key is present.
5. Finish with: `npm test` green, `npm run typecheck` green, `npm run build` green, README section "Works with your existing website", `docs/INTEGRATION.md`, a pushed branch and PR, and a final report listing what was verified live, what only offline, and what is left.

## 6. Facts you may need

- Production: https://site-manager-lovat.vercel.app (demo café `/agala`, Coffique `/coffique`); public feed `GET /api/site/<slug>`; dashboard `/admin/<slug>?key=…`; admin API `POST /api/admin/<slug>` with `{ action, change_set_id }`.
- Coffique's own site reads the feed: repo `biskwida/coffique`, local `~/Coffique`, file `src/lib/site-manager.ts`. Do not modify that repo in this track unless my changes say so.
- Vercel team `biskwida-dev` is on Pro. Hobby/Pro limits are irrelevant for you; you deploy nothing.
- Market numbers and platform capabilities are in the spec; do not re-research them.
