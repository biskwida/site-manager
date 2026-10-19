# Claudia on getclaudia.app: sign-up, onboarding for any business, trial and payment — design

Date: 19 Oct 2026. Owner's request: "move the creation page of the website to the Claudia landing page we have a domain for, separate the pages so even if you have a website you can connect to the onboarding steps and connect Claudia, plan for registration and payment to allow to try it". It continues the paused 16 Oct request: app on getclaudia.app, a Stripe button, onboarding without a website, client login.

## Owner decisions (19 Oct 2026)

| Topic | Decision |
|---|---|
| Domain | **app.getclaudia.app** for the app. The landing page stays at getclaudia.app. The old site-manager-lovat.vercel.app keeps working. |
| Login | **An email link plus "Sign in with Google"**, no passwords. This replaces the secret `?key=` dashboard links. |
| Prices | **The landing page's prices go into Stripe**: Admin 19 €, Social media 39 €, Both 49 € a month, and the ready website 199 € once (no setup fee with your own site). Prices exclude VAT. Stripe runs in **test mode** now and goes live after the company (ЕООД) is registered. |
| Trial | **Decided 19 Oct: 2 weeks free with limited changes, no card.** Settings: `TRIAL_DAYS` = 14, `TRIAL_CHANGE_LIMIT` = 20 (website changes and posts together, counted over the whole trial; undo never counts), `TRIAL_REQUIRES_CARD` = false. All three can change later without code. |

## Why

Today anyone can open `/new`, build a website and get a chat code. There is no account, no login, no plan and no payment, and every venue is assumed to have a website made by Claudia. Most businesses already have a website (or only care about Instagram and Google). Claudia also has to be able to charge before the conference (29 Oct) shows it to about 5,000 people.

## Goals

1. **One place to start.** getclaudia.app → "Start free" goes to app.getclaudia.app/start, which covers sign-up, the "what do you need?" choice and onboarding.
2. **Three paths, one onboarding:**
   - **A. "Make me a website"**: today's wizard, now tied to the account.
   - **B. "I already have a website"**: the name, the website address and its platform (WordPress / Wix / Squarespace / Shopify / other / I don't know). No site gets built. WordPress sites get the plugin connection on the web, not only `/connect` in the bot. Other platforms get Claudia for social media, Google and a menu page they can link to.
   - **C. "Only social media and Google"**: no website at all.

   All three end on the same **onboarding checklist**: connect your chat, connect Instagram and Facebook, (later) connect Google, choose a plan.
3. **Accounts:** an owner signs in with an email link or Google, sees their businesses at `/dashboard`, and manages billing there. Staff stay chat-only.
4. **Trial and payment:**
   - Every new business starts on a trial.
   - Choosing a plan opens Stripe Checkout, and billing changes go through the Stripe Customer Portal.
   - Stripe webhooks keep the plan state.
   - When the trial ends unpaid, Claudia **pauses changes but never takes the website down**.

## Non-goals (v1)

- Changing what each plan can do beyond today's limits. v1 gates on the plan as follows: **Admin** = website changes, **Social** = social media and comments, **Both** = everything. The existing monthly change limit stays.
- Live payments. These come after the ЕООД is registered, Stripe is activated and an accountant has checked that Stripe invoices are valid in Bulgaria.
- Google Business connection. The checklist shows it as "coming soon".
- Moving the landing page into the app, or moving the app's Vercel project to another team.
- Team accounts (several logins per business). The schema allows them; there is no UI.

## Anti-goals: what would make this a failure even if it works

- **Today's owners are locked out.** Coffique and the other existing venues, their `?key=` links and their chats must keep working.
- **An unpaid trial takes a website offline.**
- **A card or a password is asked for before the owner has seen any value.**
- **Owner data is exposed in a URL.** Login links are one-time, short-lived Supabase links, never a reusable key.

## Constraints

- The stack stays the same: Next.js 16 app router on Vercel (team `team_ldiZAmDSugSiVqMxmWQ4MWKn`) and Supabase (Postgres + **Supabase Auth**, which is new).
- **Stripe** through the official `stripe` Node SDK. A dependency is added only with this design.
- **Email:**
  - Supabase's built-in mailer only sends to the project's own team addresses, so production needs custom SMTP.
  - Use **Resend** with the sender `hello@getclaudia.app`. DNS records (SPF/DKIM) go on getclaudia.app, which lives in Vercel team biskwida-dev.
  - Owner step: create the Resend account and add the DNS records.
- **Google sign-in:** an OAuth client in the Google Cloud project, with the redirect `https://<project>.supabase.co/auth/v1/callback`.
- **Bilingual:** BG and EN everywhere, matching the landing toggle (`?lang=` from the landing, then the browser language). Prices are written the site's way ("19 €" / "€19"), without VAT, and say so.
- **Keys and secrets:** the owner adds every key to Vercel and `.env.local` themselves. That covers `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` and the Google client secret.
- **Meta Development mode:** until App Review, Instagram and Facebook connects work only for testers. The checklist says so in plain words and shows the tester steps (see the Meta Live-mode to-do).

## How it works

### Domains

- **app.getclaudia.app**
  - Add it to the site-manager Vercel project. The DNS record is a CNAME in the biskwida-dev team's getclaudia.app zone.
  - Set `PUBLIC_BASE_URL=https://app.getclaudia.app`.
  - Add the new OAuth redirect URIs next to the old ones: Instagram Login, Facebook Login and Supabase Google.
  - Point the Telegram webhook at the new host.
- **Per-venue sites** read `${PUBLIC_BASE_URL}/api/site/<slug>`. Both hosts serve the same app, so existing deploys keep working.
- **The old host** redirects browser pages (`/start`, `/login`, `/dashboard`, `/onboarding`, `/admin`) to the new host, **keeping the query string** so legacy `?key=` links survive. Never redirected: `/api/*` (callbacks, webhooks), `/<slug>`, and `/new` (the draft cookie is host-bound, so an owner mid-wizard keeps their draft). The old host stays an alias forever, because per-venue deploys and WordPress plugins hold it.
- **`/` on the new host** sends signed-in owners to `/dashboard` and everyone else to getclaudia.app.
- **Switch order:** register the new OAuth redirect URIs with Meta and Supabase/Google first, then set `PUBLIC_BASE_URL`, then re-run `scripts/set-webhook.mts`. Meta webhooks may stay on the old host (alias). Do it at a quiet hour, since in-flight OAuth started on the old host would lose its cookie.
- **Reserved slugs** gain `start`, `login`, `dashboard`, `onboarding`, `auth`, `app`, `billing` (check first that no live venue uses them).
- **Landing (claudia-landing):**
  - "Talk to us" becomes **"Start free"** → `https://app.getclaudia.app/start?lang=<bg|en>`.
  - Each plan's button goes to `/start?plan=admin|social|both`.
  - Add a **"Log in"** link → `/login`.
  - The data-deletion link moves to the new host.

### Accounts

- Supabase Auth (`@supabase/ssr` cookies) with **magic link** and **Google**.
- New table `venue_users (venue_id, user_id → auth.users, role owner|staff, created_at)`, with RLS and an index on `user_id`.
- **The `/login` page** offers an email field and the Google button. The callback is `/auth/callback`, after which the owner lands on `/dashboard`.
- **`/dashboard`** lists the user's businesses. **`/dashboard/[slug]`** is today's admin page, with the session in place of `?key=`.
- **`?key=`** keeps working for legacy links, and the page offers "add your email to log in next time".
- **Existing venues:** operator CLI `account:invite --slug coffique --email …` sends a sign-in link and links the user as owner on first sign-in.
- **From the chat:** `/menu` keeps sending the dashboard link. For venues that have an account, the link goes to `/dashboard/<slug>`, which asks the owner to sign in.
- **Every admin API route** (`app/api/admin/[slug]/**`) accepts either a valid `?key=` or a session whose user owns the venue. The OAuth connect callbacks (`src/server/social-connect.ts`) return to `/dashboard/<slug>` for a session owner and to `/admin/<slug>?key=` for a key owner. `/admin/[slug]` stays next to `/dashboard/[slug]`, and `findVenueByAdminToken` is never retired.

### Onboarding

1. `/start?plan=&lang=`: sign up (email link or Google) if the owner isn't signed in yet. The chosen plan is remembered.
2. `/start/choose`: three cards (A / B / C).
3. The paths:
   - **A** goes to the wizard (`/new`). The cookie stays the draft key. Publish links the signed-in user as the `venue_users` owner. Path A needs a plan with website changes (Admin or Both). `/start?plan=social` offers paths B and C first and explains that a website comes with Admin or Both.
   - Paths B and C create the venue directly as `live` with one owner invite (the way `scripts/venue-create.mts` does), never through the wizard publish.
   - **B** goes to `/start/own-site`: business name, website address, platform, city and address (for maps and ads), opening hours (optional), and a menu import (optional: photo, PDF or the site's menu page through the existing extract). It creates a venue with `site_mode='own'` and `site_url` set.
   - **C** goes to `/start/social`: business name, city and address, Instagram handle. It creates a venue with `site_mode='none'`.
4. `/onboarding/[slug]`: a checklist with status that can be resumed any time.
   1. Connect your chat: Telegram, WhatsApp or Messenger links (the existing invite deep links), with a tick when the owner has joined.
   2. Connect Instagram and Facebook: the existing social connect, plus the note for Development mode.
   3. **Path B only:** connect the website.
      - WordPress: the plugin download plus a one-time code on the web (the same handshake as `/connect`).
      - Other platforms: "Link to your menu page: app.getclaudia.app/<slug>/menu", plus a copy-paste snippet. A full embed comes later.
   4. Google Business: "coming soon".
   5. Your plan: the trial days left and a "Choose plan" button.

**New venue column `site_mode`:** `claudia | own | none`, default `claudia`. A backfill sets `own` where `site_url` is set. It makes today's rule explicit:
- `startDeploy` runs only for `claudia`.
- The hosted `/<slug>` redirects to the owner's site for `own`. For `none` it renders the default template with whatever the venue has (name, address, hours, menu, Instagram link), with no new template.
- `site_mode` is the source of truth. `site_url` stays as the own site's address.
- Dashboard cards follow the mode.
- The bot's welcome text names the right thing ("your website" / "your Instagram").

### Trial, plans and payment

- **New venue columns:**
  - `plan`: `admin | social | both | null`
  - `trial_started_at`, `trial_ends_at`
  - `billing_status`: `trialing | active | past_due | paused | canceled`
  - `past_due_since`
  - `stripe_customer_id`, `stripe_subscription_id`
  - `trial_reminder_sent`: `null | 'soon' | 'ended'`
  - All of these are server-only: never in the public feed (`PublicVenue`) and no anon grants (`policies.sql`, `test/policies-grants.test.ts`).
- **New table `billing_events`** stores the processed Stripe event IDs, so a webhook is handled only once.
- **Settings (environment variables):**
  - `TRIAL_DAYS`, default 14
  - `TRIAL_REQUIRES_CARD`, default `false`
  - `STRIPE_PRICE_ADMIN` / `_SOCIAL` / `_BOTH` / `_WEBSITE_SETUP`
  - `BILLING_ENABLED`: when off, everything stays free and unlimited, as today
- **At signup:** `trial_started_at = now`, `trial_ends_at = now + TRIAL_DAYS` and `billing_status = trialing`.
- **Trial changes:** while `trialing` with no paid subscription, the change limit is `TRIAL_CHANGE_LIMIT` (default 20), counted from `trial_started_at` to `trial_ends_at`, not per calendar month. It uses the same counting rules as `src/domain/limits.ts`. At 20, new owner proposals pause with the choose-a-plan link (undo still works). Paying during the trial switches straight to the plan's monthly limit.
  - With `TRIAL_REQUIRES_CARD=true`, signup goes straight to Stripe Checkout (subscription with `trial_period_days`, card collected).
  - Otherwise Checkout is opened only when the owner presses "Choose plan".
  - Without a card, Stripe's `payment_method_collection: 'if_required'` lets an owner with days of trial left start the subscription with no charge yet.
- **Checkout:**
  - `mode: subscription`, the plan's monthly price, and **plus the 199 € setup line for path A**, added once at the first payment.
  - Customer email from the account, locale `bg` or `en`.
  - The VAT number is collected in Checkout (`tax_id_collection`).
  - Stripe Tax stays **off** until the company has a VAT registration (open point for the accountant).
- **Webhook `/api/stripe/webhook`** handles:
  - `checkout.session.completed`
  - `customer.subscription.created/updated/deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

  Each one sets `plan` and `billing_status`, idempotently, with the signature checked.
- **"Build me a website" on the plan page** (mockup, 19 Oct): under the three plans, a 199 € once add-on, available only with Admin or Both (greyed out with Social media).
  - **Path A venues:** the box is ticked and locked, and the fee is charged at the first payment.
  - **Path B and C venues:** ticking it adds the fee to Checkout. After payment the dashboard shows "Build your website", which opens the wizard on the **existing** venue (`wizard_draft` on that row, prefilled from it). Publishing switches `site_mode` to `claudia` and starts the deploy.
- **Customer Portal:** a "Manage billing" button on the dashboard (change plan, card, invoices, cancel).
- **Gating** (only when `BILLING_ENABLED`):
  - **`trialing` / `active`:** the plan's features apply. Admin = website changes, Social = social, comments and boosts, Both = all. A feature outside the plan is **shown, not hidden**: one friendly line in chat, or a locked dashboard card, with the upgrade link.
  - **Plan limits:** Admin 40 changes a month, Both 150. Social has no site changes; its own limit is the existing `comment_limit`. `venues.change_limit` stays the per-venue override.
  - **`past_due`:** works for 7 days with a reminder.
  - **`paused` / `canceled`:**
    - Only **owner-initiated** new proposals are blocked. Claudia answers with "your trial has ended / your plan is paused, choose a plan: <link>".
    - Websites, menus and posts already published **stay online**.
    - Scheduled changes and auto sold-out reverts still run, so nothing breaks half-way.
  - **Existing venues** get `billing_status='active'` and `plan='both'` from the billing migration, which must run **before** `BILLING_ENABLED` is turned on. Nothing changes for Coffique and the pilots until the owner changes a venue with `venue:set --plan/--billing-status`.
- **Both trial branches are built.** The default is no card. With `TRIAL_REQUIRES_CARD=true`, the new owner goes through Stripe Checkout with `trial_period_days` right after choosing a path.
- **Reminders** come from the existing `/api/tick`:
  - 3 days before the trial ends, or when 15 of the 20 trial changes are used: a chat message and an email.
  - The day it ends: the same.
  - Each is sent once (marked in the store).

## What's left to the builder

- Page layout and styling. Reuse the landing's look (fonts, greige palette) so getclaudia.app → app.getclaudia.app feels like one product.
- The exact wording of the BG and EN copy, in the existing tone (short, warm, no jargon).
- How the dashboard is split into components.

## Calls I made (the owner should check these)

1. Paused trials keep everything online and only stop new changes.
2. Existing venues are grandfathered as `active` / `both`.
3. The 199 € website fee is charged with the first payment, not at publish, so path A can still be tried for free.
4. Stripe Tax stays off and VAT handling waits for the accountant.
5. Staff stay chat-only, with no logins.
6. Resend is the email sender.
7. No Google connect step yet.

## Builder-check answers (19 Oct 2026)

Settled from the reviewer's questions (calls, owner to check): both trial branches built behind the setting; a feature outside the plan is shown with an upgrade line, not hidden; path A needs Admin or Both; a path C page reuses the default template; grandfathering lasts until the owner changes a venue; `past_due_since` and `trial_reminder_sent` added; only owner-initiated changes pause; `/admin/[slug]` and `?key=` stay; `/new` is never host-redirected.

**Reality check for the conference:** until Meta App Review (which needs the ЕООД), step 2 of the checklist (Instagram/Facebook) works only for owners added as Meta testers. The checklist says so; Telegram + website changes work for everyone.

## Open points

- **Invoices:** can Stripe invoices serve as Bulgarian фактури, or is a local invoicing tool needed (accountant)?
- **VAT:** registration status of the future ЕООД, and whether to show prices with VAT.
- **The plan names** in `limits.ts` (Menu 40 / Everywhere 150) don't match the landing's plans. Decide the change limits per plan: suggestion Admin 40, Both 150, Social with no site-change limit.
