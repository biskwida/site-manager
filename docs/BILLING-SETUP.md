# Billing (Stripe, test mode): owner setup

Claudia charges through Stripe. This is what the owner configures once, in the Stripe dashboard (test mode first), Supabase and Vercel. Code: `src/billing`, `src/server/billing.ts`, `app/api/billing`, `app/api/stripe/webhook`, `app/billing/[slug]`.

Everything stays free and unlimited until `BILLING_ENABLED=true`. Do the steps in this order. **Do this guide only after the domain switch** ([DOMAIN-SWITCH.md](DOMAIN-SWITCH.md), section D): the webhook below points at `https://getclaudia.app`. For a test before the switch, use the old host's webhook URL (`https://site-manager-lovat.vercel.app/api/stripe/webhook`) and change the endpoint afterwards.

## 1. Database first

```
npm run db:apply -- supabase/migrations/2026-10-19-billing.sql
npm run db:apply -- supabase/policies.sql
npm run check:rls
```

The migration adds the venue billing columns and `billing_events`, and **grandfathers every venue that exists at that moment to plan `both`, status `active`** (all features, no trial, as today). That backfill runs only on the run that adds the columns, so applying it again changes nothing. The new columns and `billing_events` are server-only (RLS on, nothing granted to anon).

Apply it **before** turning `BILLING_ENABLED` on: with billing on, the code reads and writes these columns.

Venues created while `BILLING_ENABLED` was still off have no billing status. Turn billing on, then either leave them (they get no trial) or run `npm run venue:set -- --slug <s> --plan both --billing-status active` for each one you want grandfathered.

## 2. Products and prices (Stripe dashboard, test mode)

Product catalogue, "Add product". Create four prices, all in EUR, without tax included:

| Product | Price | Billing | Env name |
| --- | --- | --- | --- |
| Claudia Admin | 19 € | recurring, monthly | `STRIPE_PRICE_ADMIN` |
| Claudia Social media | 39 € | recurring, monthly | `STRIPE_PRICE_SOCIAL` |
| Claudia Both | 49 € | recurring, monthly | `STRIPE_PRICE_BOTH` |
| Website setup | 199 € | one-time | `STRIPE_PRICE_WEBSITE_SETUP` |

Copy each price's id (`price_...`, on the price's page) into the env var named in the table. Stripe Tax stays **off** until the company has a VAT registration (ask the accountant); Checkout collects the customer's VAT number.

## 3. Account settings

- Settings, Business, Public details: set the **business name** (it is shown on Checkout, receipts and invoices).
- Settings, Payment methods: enable **cards only** for now (turn the other methods off in the default configuration). Delayed methods such as bank debits are handled by the code (the website fee waits for `checkout.session.async_payment_succeeded`), but cards are all that was tested.
- Settings, Billing, Subscriptions and emails, **failed payment retries** ("Smart Retries" is the sensible choice, a few attempts over about two weeks), and when the retries run out, choose **"Mark the subscription as unpaid"** (not "cancel"). What each state means in Claudia:
  - first failed payment: Stripe says `past_due` and Claudia says `past_due`; the owner keeps working for a 7-day grace period, after which new owner changes stop. **There is no past-due reminder from Claudia yet** (a follow-up); until then, turn on Stripe's own failed-payment customer emails (Settings, Billing, Subscriptions and emails).
  - retries exhausted with "mark as unpaid": Stripe says `unpaid` and Claudia says `paused`: new owner changes stop; the website, menu page and published posts stay online. The owner fixes the card in Manage billing;
  - the owner (or you) cancels, or retries are set to cancel: Stripe says `canceled` and Claudia says `canceled`. Nothing goes offline; the owner can start a new subscription from the plan page.
  - A trial that ends with no card is paused by Stripe (`paused`), which Claudia also shows as `paused`.

## 4. API key

Developers, API keys: copy the secret key (`sk_test_...`) into `STRIPE_SECRET_KEY`. Test mode only for now; the plan page shows a "test mode" label while the key starts with `sk_test_`.

## 5. Webhook

Developers, Webhooks, "Add endpoint":

- Endpoint URL: `https://getclaudia.app/api/stripe/webhook`
- **API version: pick the one the app's Stripe library uses, `2026-09-30.endive`** (the `stripe` package is pinned to 23.0.0 and sends that version). An endpoint on another version delivers differently shaped events (for example where an invoice keeps its subscription id), and the app is only tested against this one.
- Events to send:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

Copy the endpoint's signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`. For local tests, `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints a secret for that session.

The endpoint verifies the signature on the raw body (a bad one is 400), applies each event and then records its id in `billing_events`. An event that failed to apply is not recorded, so Stripe's retry (after the 500) is applied; one that was recorded is ignored as a duplicate. Applying is idempotent, so two deliveries racing each other are harmless. It also derives the plan and status from the subscription's current state, so events arriving out of order end in the right place. It verifies and records even while `BILLING_ENABLED` is off.

## 6. Customer Portal

Settings, Billing, Customer portal (test mode), then:

- **Save the default configuration**: open the page, set the options below and press "Save changes". Until it is saved once, Stripe has no default portal configuration and opening the portal from the app fails.
- Turn it on and set the business information (name, support email, privacy and terms links).
- **Customers can switch plans**: on, with the three monthly prices (`Admin`, `Social media`, `Both`) as the products they can switch between.
- **Customers can cancel subscriptions**: on (cancel at the end of the period).
- **Customers can update payment methods** and **view invoice history**: on.

The dashboard's "Manage billing" button opens this portal. A plan switch comes back through `customer.subscription.updated`, and the plan follows the price.

## 7. Vercel env

Add to the Vercel project (Production, and Preview if you test there):

```
BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ADMIN=price_...
STRIPE_PRICE_SOCIAL=price_...
STRIPE_PRICE_BOTH=price_...
STRIPE_PRICE_WEBSITE_SETUP=price_...
```

Optional (defaults shown):

```
TRIAL_DAYS=14
TRIAL_CHANGE_LIMIT=20
TRIAL_REQUIRES_CARD=false
```

`TRIAL_REQUIRES_CARD=true` sends a new owner to `/billing/<slug>?required=1` (Checkout, card collected, nothing charged today) before the checklist. Redeploy after changing env vars.

## 8. Try it with the test card

1. Create a business at `https://getclaudia.app/start`. The free trial starts (14 days). The free trial allows `TRIAL_CHANGE_LIMIT` (20) owner changes over the whole trial (not per month); the 21st proposal is refused with the choose-a-plan line, and undo still works.
2. The checklist's plan card (or the dashboard's "Plan and payment") links to `/billing/<slug>`. Pick a plan, tick "Build me a website" if it is offered, and continue.
3. In Stripe Checkout pay with the test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode. Other useful test cards: `4000 0000 0000 0341` (card attaches, then payments fail, for the past-due path) and `4000 0025 0000 3155` (asks for 3-D Secure).
4. You land on `/dashboard/<slug>?billing=success`. Within a few seconds the webhook has set the plan and status (check Stripe, Developers, Webhooks, the endpoint's delivery log: 200 for each event).
5. "Manage billing" opens the portal. Cancel there and the venue goes to `canceled`; the website and posts stay online.

A Social media subscriber has no website; an Admin or Both subscriber with an own site or no site can add the 199 € website later from the dashboard ("Add a website") or the plan page: a one-off Checkout, after which "Build your website" appears.

Without a card, "if required" Checkout lets an owner with trial days left start the subscription with nothing charged yet; the plan starts when the trial ends. If no card is added by then, Stripe pauses the subscription and Claudia pauses new owner changes.

## What the limits and the tick do (with `BILLING_ENABLED=true`)

- **Plan limits** when a venue has no `change_limit`: they apply to venues with a Stripe subscription: Admin 40 a month, Both 150, Social none for site changes (it refuses site changes as "not in plan"). A venue's own `change_limit` still overrides. Existing venues (set to `active` / `both` by the migration, no subscription) stay unlimited until they subscribe.
- **Trial:** a free trial (no Stripe subscription) counts `TRIAL_CHANGE_LIMIT` over `trial_started_at`..`trial_ends_at`. Paying during the trial switches straight to the plan's monthly limit.
- **Paused / canceled / past due more than 7 days:** only new owner proposals are refused (marking an item sold out is always allowed); the reply carries the `/billing/<slug>` link. Scheduled changes already due, the auto sold-out reverts and undo still run; the website, menu page and posts stay online.
- **The cron tick** (`/api/tick`) pauses free trials whose `trial_ends_at` has passed (no Stripe subscription; a Stripe trial is left to the webhook) and sends two reminders, each once (`trial_reminder_sent`): `soon` at 3 days left or 15 of 20 changes used, `ended` at the end or the 20th change. Each goes to the owner chats and, with `RESEND_API_KEY` set, by email to the account owners.
- **`TRIAL_REQUIRES_CARD=true`:** while a venue is in a free trial with no subscription, the agent refuses proposals with an "add a card" line and the billing link.

## Going live later

Switch Stripe to live mode, make the same four prices, endpoint, portal settings and env values with the live keys, and decide Stripe Tax with the accountant first. Nothing in the code changes.
