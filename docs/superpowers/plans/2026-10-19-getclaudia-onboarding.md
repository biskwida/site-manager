# Claudia on getclaudia.app: sign-up, onboarding, trial and payment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Owners start at getclaudia.app, sign up on app.getclaudia.app with an email link or Google, and pick one of three paths: make me a website, I have a website, only social media.
- Every path finishes the same onboarding checklist.
- Every business gets a trial and pays through Stripe (test mode), without breaking today's owners.

**Architecture:**
- **Accounts:** Supabase Auth (`@supabase/ssr`) adds accounts next to today's chat identities. A `venue_users` table links accounts to venues.
- **Explicit `site_mode`:** a new venue column replaces the implicit "`site_url` = own site" rule.
- **Billing:** billing columns on `venues`, Stripe Checkout and Portal, and an idempotent webhook.
- **Gating:** one entitlement check in the agent tools, next to the existing monthly limit check. Trial reminders run from the existing tick.
- **Domain:** the app gets app.getclaudia.app. Browser pages on the old host redirect there, while `/api/*` and venue pages stay on both hosts.

**Tech Stack:**
- Next.js 16 (app router), TypeScript, vitest
- Supabase Postgres + Auth
- New dependencies: `@supabase/ssr`, `stripe`
- Resend over SMTP for Supabase Auth emails, and over HTTP for reminders
- Landing: the separate repo ~/Projects/claudia-landing

**Spec:** docs/superpowers/specs/2026-10-19-getclaudia-onboarding-design.md

## Global Constraints

- **Today's owners keep working, unchanged:** `/admin/[slug]?key=`, `findVenueByAdminToken`, chat invites, per-venue deploys and every `/api/*` path on site-manager-lovat.vercel.app.
- **`BILLING_ENABLED` off means behaviour identical to today.** Every billing and gating code path checks it first.
- **Billing and account data is server-only:** never in `PublicVenue` (`src/server/site.ts`), no anon or authenticated grants in `supabase/policies.sql`, and a test in `test/policies-grants.test.ts`.
- **Store parity:** every new `Store` method exists in `src/store/memory.ts` and `src/store/supabase.ts`. Every schema change ships as a file in `supabase/migrations/2026-10-19-*.sql` and is mirrored in `supabase/schema.sql`.
- **Bilingual copy:** all owner-facing copy is BG and EN. The page language comes from `?lang=`, then the `claudia-lang` cookie, then `Accept-Language`. Prices are written `19 €` (BG) / `€19` (EN), with "без ДДС" / "excl. VAT".
- **Secrets:** no secret in code, logs or URLs. Keys come from env, and the owner adds them.
- **Paused never means offline:** a `paused` or `canceled` venue never loses its website, menu page or published posts.
- **Env names (exact):**
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser auth)
  - `BILLING_ENABLED`, `TRIAL_DAYS` (default 14), `TRIAL_CHANGE_LIMIT` (default 20), `TRIAL_REQUIRES_CARD` (default false)
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRICE_ADMIN`, `STRIPE_PRICE_SOCIAL`, `STRIPE_PRICE_BOTH`, `STRIPE_PRICE_WEBSITE_SETUP`
  - `RESEND_API_KEY`, `EMAIL_FROM` (default `Claudia <hello@getclaudia.app>`)
  - `LANDING_URL` (default `https://getclaudia.app`), `APP_HOST` (default `app.getclaudia.app`)
- **Trial (owner, 19 Oct):** 2 weeks free, 20 changes counted over the whole trial (`trial_started_at`..`trial_ends_at`), no card. Paying during the trial switches straight to the plan's monthly limit.
- **Plans:** `admin` (website changes, 40 a month), `social` (social, comments and boosts; no site changes), `both` (everything, 150 a month). `venues.change_limit`, when not null, overrides the plan's number.

## Review Focus

1. **An owner with only a legacy `?key=` link** opens the dashboard on the new host. Every card and button works (no 401 from the admin APIs), and OAuth connects return to the key URL.
2. **A Stripe webhook delivered twice, or out of order** (`subscription.updated` before `checkout.session.completed`) leaves exactly one correct `plan` / `billing_status`.
3. **A trial ends while a scheduled change is due.** The scheduled change and the auto sold-out revert still apply. Only new owner proposals are refused, with the payment link line.
4. **A signed-in owner opens `/new` on another device** (no draft cookie). They can start a fresh draft, and publish links the venue to their account.
5. **An own-site (`site_mode='own'`) or social-only (`'none'`) venue's owner joins the chat.** No Vercel project is created, and the welcome names the right thing.

---

### Task 1: The new host and host redirects

**Files:**
- Create: `proxy.ts` (Next 16 middleware file), `test/host-redirect.test.ts`
- Modify: `src/config.ts` (`appHost`, `landingUrl`), `src/wizard/schema.ts:13` (`RESERVED_SLUGS`), `app/page.tsx`
- Docs: `docs/DOMAIN-SWITCH.md`, the owner's checklist (Vercel domain, DNS CNAME in team biskwida-dev, the Meta redirect URIs, `PUBLIC_BASE_URL`, `scripts/set-webhook.mts`)

**Interfaces:**
- Produces: `hostRedirect(url: URL, appHost: string): URL | null`, a pure function in `src/server/host.ts`. It returns the redirect target for a browser page on another host, or null.

- [ ] **Step 1: Failing tests** in `test/host-redirect.test.ts`:
  - `site-manager-lovat.vercel.app/admin/coffique?key=abc` → `https://app.getclaudia.app/admin/coffique?key=abc`. The query is kept.
  - `/dashboard`, `/login`, `/start?plan=both&lang=bg`, `/onboarding/x` redirect.
  - `/api/telegram`, `/api/site/coffique`, `/coffique`, `/coffique/menu`, `/new`, `/new/abc` → null.
  - Already on `app.getclaudia.app`, or `localhost:3000` → null.
  - `RESERVED_SLUGS` contains `start`, `login`, `dashboard`, `onboarding`, `auth`, `app`, `billing`.
- [ ] **Step 2:** Run `npx vitest run test/host-redirect.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `hostRedirect` handles prefixes `/start /login /dashboard /onboarding /admin` and uses 308.
  - `proxy.ts` calls it, with a matcher that excludes `/api` and `/_next`.
  - `app/page.tsx`: when there is a session, redirect to `/dashboard`; otherwise redirect to `config.landingUrl`. Keep the fallback landing when no landing URL is set.
  - Before the reserved slugs change, add a check script: `npm run slugs:check` lists venues whose slug is newly reserved.
- [ ] **Step 4:** Run the full `npx vitest run`, `npx tsc --noEmit` and `npm run lint`. Expect PASS.
- [ ] **Step 5: Commit:** `Domain: app.getclaudia.app redirects for browser pages, reserved slugs`

### Task 2: `site_mode`, an explicit choice between a Claudia site, an own site, or none

**Files:**
- Create: `supabase/migrations/2026-10-19-site-mode.sql`
- Modify:
  - `supabase/schema.sql`
  - `src/domain/types.ts` (`Venue.site_mode`, `SiteMode`)
  - both stores (row mapping)
  - `src/deploy/run.ts:39` (deploy only for `claudia`)
  - `src/server/site.ts:79` (`own` → redirect; `none` → default template render)
  - `src/server/admin.ts:65-78,237` (cards by mode)
  - `src/bot/inbound.ts:235-247,283` (welcome text and deploy trigger by mode)
  - `scripts/venue-create.mts` (`--site-mode`)
  - `src/server/site.ts` `PublicVenue` (omit `site_mode`? keep it server-only)
- Test: `test/site-mode.test.ts`

**Interfaces:**
- Produces: `type SiteMode = "claudia" | "own" | "none"` and `Venue.site_mode: SiteMode`.
- Migration: column default `'claudia'`, backfill `own` where `site_url is not null`, and a check constraint.

- [ ] **Step 1: Failing tests:**
  - `startDeploy` skips `own` and `none` and runs for `claudia`.
  - `/<slug>` for `own` redirects to `site_url`.
  - `/<slug>` for `none` renders 200 with the venue name and its Instagram link.
  - The welcome for `none` says "your Instagram" / "твоя Instagram", not "website".
  - Admin overview hides deploy, template and domain for `own` and `none`.
  - The migration file contains the backfill `update public.venues set site_mode='own' where site_url is not null`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement.** Every existing `site_url !== null` own-site check becomes `site_mode === "own"`, except where the URL itself is needed.
- [ ] **Step 4:** Full suite, tsc and lint.
- [ ] **Step 5: Commit:** `Venues: explicit site_mode (claudia | own | none)`

### Task 3: Accounts with Supabase Auth (email link and Google)

**Files:**
- Create:
  - `supabase/migrations/2026-10-19-venue-users.sql`
  - `src/server/session.ts`
  - `app/login/page.tsx` (+ client form)
  - `app/auth/callback/route.ts`
  - `app/auth/signout/route.ts`
  - `scripts/account-invite.mts` (`npm run account:invite -- --slug <s> --email <e>`)
  - `test/session.test.ts`, `test/account-invite.test.ts`
- Modify:
  - `package.json` (`@supabase/ssr`)
  - `src/store/types.ts` + both stores
  - `supabase/schema.sql`, `supabase/policies.sql`
  - `test/policies-grants.test.ts`

**Interfaces:**
- Produces:
  - `Store.linkVenueUser(venueId, userId, role: Role): Promise<void>` (idempotent)
  - `Store.listVenuesForUser(userId): Promise<Venue[]>`
  - `Store.isVenueOwner(venueId, userId): Promise<boolean>`
  - `Store.createPendingAccountInvite(venueId, email): Promise<void>` and `Store.claimAccountInvites(userId, email): Promise<string[]>` (venue ids linked on first sign-in)
  - `getSessionUser(): Promise<{ id: string; email: string } | null>` in `src/server/session.ts`
- Tables:
  - `venue_users (venue_id uuid refs venues on delete cascade, user_id uuid refs auth.users on delete cascade, role text check owner|staff, created_at, primary key (venue_id,user_id))`
  - `account_invites (venue_id, email citext, created_at, claimed_at)`
  - Both have RLS on and no anon grants.

- [ ] **Step 1: Failing tests:**
  - Store methods on the memory store: link is idempotent; list returns only linked venues; claim links the matching email's invites once.
  - `/auth/callback` with a code exchanges it and calls `claimAccountInvites`, then redirects to `/dashboard`, or to `next` when it is a same-origin path. An off-site `next` is ignored.
  - The grants test fails if `venue_users` or `account_invites` get anon grants.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `/login`: an email field (`signInWithOtp`, `emailRedirectTo=/auth/callback`), a "Continue with Google" button (`signInWithOAuth`) and BG/EN copy.
  - `account:invite` stores the invite and sends the sign-in link through Supabase admin `generateLink` + Resend. It never prints the link.
- [ ] **Step 4:** Full suite, tsc and lint.
- [ ] **Step 5: Commit:** `Accounts: Supabase Auth (email link + Google), venue_users, account:invite`

### Task 4: The dashboard on the session, with legacy keys kept

**Files:**
- Create:
  - `app/dashboard/page.tsx` (the venue list)
  - `app/dashboard/[slug]/page.tsx` (renders today's admin UI)
  - `src/server/admin-auth.ts`
  - `test/admin-auth.test.ts`
- Modify:
  - every route under `app/api/admin/[slug]/**` (use `authorizeAdmin`)
  - `src/server/social-connect.ts:143-162,264,320` (return URL by auth kind)
  - `src/bot/links.ts` + `src/bot/inbound.ts:238,256,280` (`dashboardLink`)
  - the admin client fetches (send `?key=` only when present)
  - `app/admin/[slug]/page.tsx` (an "add your email to log in next time" banner)

**Interfaces:**
- Produces:
  - `authorizeAdmin(req: Request, slug: string, deps): Promise<{ venue: Venue; via: "key" | "session"; key?: string } | null>`: a key matching the slug, or a session user who owns the venue.
  - `dashboardLink(baseUrl, venue, token, hasAccount: boolean): string`: `/dashboard/<slug>` when the venue has an owner account, else `adminUrl(...)`.

- [ ] **Step 1: Failing tests:**
  - A key for another slug → null.
  - A session user who doesn't own the venue → null.
  - An owner session → `via: "session"`.
  - The social connect callback for a session returns to `/dashboard/<slug>`, and for a key to `/admin/<slug>?key=…`.
  - `/menu` in chat for a venue with an owner account sends the `/dashboard/<slug>` link.
  - An owner with only a legacy key: GET `/api/admin/<slug>?key=` → 200, as today.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement.** No admin route may keep its own key check.
- [ ] **Step 4:** Full suite, tsc and lint.
- [ ] **Step 5: Commit:** `Dashboard: session or legacy key on every admin route; dashboard links in chat`

### Task 5: Onboarding with three paths and one checklist

**Files:**
- Create:
  - `app/start/page.tsx` (sign-up gate, remembers `plan` and `lang`)
  - `app/start/choose/page.tsx`
  - `app/start/own-site/page.tsx`
  - `app/start/social/page.tsx`
  - `app/onboarding/[slug]/page.tsx`
  - `app/api/start/venue/route.ts`
  - `app/api/onboarding/[slug]/route.ts` (status)
  - `app/api/onboarding/[slug]/wordpress/route.ts` (web WordPress code)
  - `src/server/onboarding.ts`
  - `test/onboarding.test.ts`
- Modify:
  - `src/server/wizard.ts` (`publishDraft`: link the session user as owner; `/new` accepts a signed-in user without the cookie by starting a new draft)
  - `app/new/[id]/done/page.tsx` (link to `/onboarding/<slug>`)
  - `src/destinations/connect.ts` (reuse the WordPress handshake from the web)

**Interfaces:**
- Produces:
  - `createOwnVenue(d, user, input: { path: "own" | "none"; name; site_url?; platform?; address; city; instagram?; lang }): Promise<{ slug; invite_code }>`: venue `live`, the right `site_mode`, an owner invite, a `venue_users` owner, and the trial fields when billing is enabled.
  - `onboardingStatus(store, venue): { chat: boolean; instagram: boolean; facebook: boolean; website: "n/a" | "connected" | "todo"; plan: { status; trial_days_left } }`

- [ ] **Step 1: Failing tests:**
  - Path B creates `site_mode='own'` with `site_url`, no deploy, and an owner link.
  - Path C creates `site_mode='none'`.
  - Both are rate-limited like `/api/new` (5 per IP per hour).
  - The slug comes from the name, avoiding reserved and taken slugs.
  - The status shows `chat: true` after the invite is redeemed.
  - `/start?plan=social` lists paths B and C before A. Path A shows "a website comes with Admin or Both".
  - Publish with a session links the user. Publish without a session behaves as today.
  - An existing `own`/`none` venue whose owner bought the website add-on gets a wizard draft on the same row (`startDraftForVenue(venueId, user)`), prefilled from the venue. Publish keeps the slug and sets `site_mode='claudia'`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The pages reuse the landing's look (fonts, greige palette).
  - Checklist copy for Instagram and Facebook includes the Meta tester note.
  - Google Business is shown as "Скоро" / "Coming soon".
- [ ] **Step 4:** Full suite, tsc and lint.
- [ ] **Step 5: Commit:** `Onboarding: /start with three paths (website, own site, social only) and a shared checklist`

### Task 6: Billing data and Stripe (test mode)

**Files:**
- Create:
  - `supabase/migrations/2026-10-19-billing.sql` (the venue billing columns, `billing_events`, grandfather backfill `plan='both', billing_status='active'` for every existing venue)
  - `src/billing/plans.ts`
  - `src/billing/stripe.ts`
  - `app/api/billing/checkout/route.ts`
  - `app/api/billing/portal/route.ts`
  - `app/api/stripe/webhook/route.ts`
  - `app/billing/[slug]/page.tsx` (choose a plan)
  - `test/billing.test.ts`
- Modify:
  - `package.json` (`stripe`)
  - `src/config.ts`
  - `src/domain/types.ts` (`Plan`, `BillingStatus`, Venue billing fields)
  - both stores
  - `src/server/site.ts` (`PublicVenue` omits)
  - `supabase/policies.sql` + grants test
  - `scripts/venue-set.mts` (`--plan`, `--billing-status`, `--trial-ends`)

**Interfaces:**
- Produces:
  - `PLANS: Record<Plan, { priceEnv: string; changeLimit: number | null; features: Feature[] }>`, where `type Feature = "site" | "social" | "comments" | "boost"`.
  - `startTrial(now, config): { trial_started_at; trial_ends_at; billing_status: "trialing" }`
  - `checkoutSession(stripe, venue, user, plan, { withSetupFee: boolean; trialDaysLeft: number; requireCard: boolean; lang }): Promise<string /* url */>`
  - `applyStripeEvent(store, event): Promise<"applied" | "duplicate" | "ignored">` (idempotent via `billing_events`)

- [ ] **Step 1: Failing tests**, using a fake Stripe client and signed test payloads:
  - Checkout for path A with Admin includes the setup price once.
  - The add-on: a B/C venue with `withSetupFee: true` gets the setup price once. `plan='social'` with the add-on → 400 ("website needs Admin or Both").
  - A trial with no card sends `payment_method_collection: "if_required"` and `trial_period_days` = the days left.
  - `TRIAL_REQUIRES_CARD=true` sends `"always"`.
  - The same event id twice → second call returns `"duplicate"`, with no change.
  - `subscription.updated` (active) arriving before `checkout.session.completed` gives the final `active` and the right plan.
  - `invoice.payment_failed` → `past_due` with `past_due_since` set.
  - `subscription.deleted` → `canceled`.
  - A bad signature → 400.
  - The migration backfills every existing venue to `both` / `active`.
  - `BILLING_ENABLED=false`: the checkout route → 404.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Checkout: `locale` bg/en, `customer_email` from the account, `tax_id_collection` on, no automatic tax.
  - The Portal comes from the dashboard's "Manage billing".
  - `docs/BILLING-SETUP.md` covers the owner's Stripe test-mode steps: products and prices, webhook endpoint `https://app.getclaudia.app/api/stripe/webhook`, and the env keys.
- [ ] **Step 4:** Full suite, tsc and lint.
- [ ] **Step 5: Commit:** `Billing: plans, trial, Stripe Checkout/Portal and idempotent webhook (test mode)`

### Task 7: Gating and trial reminders

**Files:**
- Create: `src/billing/entitlements.ts`, `src/billing/reminders.ts`, `test/entitlements.test.ts`
- Modify:
  - `src/agent/tools.ts` (`ensureEntitled(feature)` next to `ensureWithinLimit`, called by propose, `social_post`, comment replies and `propose_boost`)
  - `src/agent/boost-tools.ts`
  - `src/store/usage.ts` / `src/domain/limits.ts` (the plan limit when `change_limit` is null and billing is enabled)
  - `src/tick.ts` (reminders)
  - `src/bot/copy.ts` (lines)
  - `src/server/admin.ts` (locked cards, trial banner)

**Interfaces:**
- Produces:
  - `entitlement(venue, feature, now, config): { ok: true } | { ok: false; reason: "paused" | "not_in_plan" | "past_due_expired" }`
  - `sendTrialReminders(d, now): Promise<number>`, called from the tick. It sets `trial_reminder_sent` to `"soon"` (3 days before) or `"ended"`. It sends a chat message to the owners and an email to the account owners, once each.

- [ ] **Step 1: Failing tests:**
  - With `BILLING_ENABLED=false`, everything is ok.
  - A trialing Admin plan: `site` ok, `social` → `not_in_plan`, with a chat line that has the upgrade link.
  - A `paused` venue: proposals are refused with the trial-ended line.
  - A `paused` venue: a scheduled set due now is still applied by the tick, and an auto sold-out revert still runs.
  - `past_due`: ok for 7 days after `past_due_since`, then `past_due_expired`.
  - Reminders fire once at 3 days left and once at the end; a second tick sends nothing.
  - The trial end flips `trialing` → `paused` only when no active subscription exists.
  - Plan limits: an Admin venue with null `change_limit` gets 40, and Both gets 150.
  - Trial limit: a trialing venue with no subscription gets 20 changes counted from `trial_started_at` (not the calendar month); the 21st proposal is refused with the choose-a-plan line, undo still works; after `checkout.session.completed` during the trial the plan's monthly limit applies.
  - The reminder also fires once when 15 of the 20 trial changes are used.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement.** The refusal line is thrown as a tool error with exact owner text, the same way `ensureWithinLimit` does it.
- [ ] **Step 4:** Full suite, tsc and lint.
- [ ] **Step 5: Commit:** `Billing: plan gating in the agent, paused never offline, trial reminders`

### Task 8: Landing buttons (repo ~/Projects/claudia-landing)

**Files:**
- Modify:
  - `lib/copy.ts` (`START_URL`, `LOGIN_URL`, CTA labels "Започнете безплатно" / "Start free", "Вход" / "Log in")
  - `components/Landing.tsx` (hero, nav and closing CTAs → `${APP_URL}/start?lang=`, plan buttons → `?plan=admin|social|both`, a Log in link in the nav)
  - `lib/privacy.ts:5` (the data-deletion URL → app.getclaudia.app)

**Interfaces:** `APP_URL` defaults to `https://app.getclaudia.app` and can be overridden by `NEXT_PUBLIC_APP_URL`.

- [ ] **Step 1:** Change the links and copy. Keep "Talk to us" as a secondary link (mailto).
- [ ] **Step 2:** Run `npm run lint` and `npm run build`. Check in the preview that every CTA carries the current `lang`, and every plan button its `plan`.
- [ ] **Step 3: Commit:** `Landing: Start free and Log in go to app.getclaudia.app`. Deploy from a git-archive export with `--scope biskwida-dev`, **only after the owner says go**.

---

## Owner steps (not code; listed in docs/DOMAIN-SWITCH.md and docs/BILLING-SETUP.md)

1. Vercel: add `app.getclaudia.app` to the site-manager project, and add the CNAME in the biskwida-dev DNS zone.
2. Meta: add the new redirect URIs (Instagram Login and Facebook Login), keeping the old ones.
3. Supabase:
   - enable Email (magic link) and Google
   - Site URL `https://app.getclaudia.app`
   - redirect URL `https://app.getclaudia.app/auth/callback`
   - custom SMTP = Resend
4. Google Cloud: an OAuth client for sign-in, with redirect `https://<project>.supabase.co/auth/v1/callback`.
5. Resend: create the account, verify getclaudia.app (SPF/DKIM), add `RESEND_API_KEY`.
6. Stripe (test mode):
   - three monthly prices (19 / 39 / 49 €) and one one-time price (199 €)
   - the webhook endpoint
   - the keys in Vercel
7. Switch: set `PUBLIC_BASE_URL`, run `npm run db:apply` for the three migrations, re-run `scripts/set-webhook.mts`, deploy. `BILLING_ENABLED` stays **false** until the billing migration has run and a test signup has worked end to end.
