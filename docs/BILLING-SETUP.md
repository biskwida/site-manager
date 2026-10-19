# Billing (Stripe, test mode): owner setup

Claudia charges through Stripe. This is what the owner configures once, in the Stripe dashboard (test mode first), Supabase and Vercel. Code: `src/billing`, `src/server/billing.ts`, `app/api/billing`, `app/api/stripe/webhook`, `app/billing/[slug]`.

Everything stays free and unlimited until `BILLING_ENABLED=true`. Do the steps in this order.

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

## 3. API key

Developers, API keys: copy the secret key (`sk_test_...`) into `STRIPE_SECRET_KEY`. Test mode only for now; the plan page shows a "test mode" label while the key starts with `sk_test_`.

## 4. Webhook

Developers, Webhooks, "Add endpoint":

- Endpoint URL: `https://getclaudia.app/api/stripe/webhook`
- Events to send:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

Copy the endpoint's signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`. For local tests, `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints a secret for that session.

The endpoint verifies the signature on the raw body (a bad one is 400), records each event id in `billing_events` and applies it once, so Stripe's retries and duplicates are harmless. It also derives the plan and status from the subscription's current state, so events arriving out of order end in the right place. It verifies and records even while `BILLING_ENABLED` is off.

## 5. Customer Portal

Settings, Billing, Customer portal (test mode), then:

- Turn it on and set the business information (name, support email, privacy and terms links).
- **Customers can switch plans**: on, with the three monthly prices (`Admin`, `Social media`, `Both`) as the products they can switch between.
- **Customers can cancel subscriptions**: on (cancel at the end of the period).
- **Customers can update payment methods** and **view invoice history**: on.

The dashboard's "Manage billing" button opens this portal. A plan switch comes back through `customer.subscription.updated`, and the plan follows the price.

## 6. Vercel env

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

## 7. Try it with the test card

1. Create a business at `https://getclaudia.app/start`. The free trial starts (14 days, 20 changes).
2. The checklist's plan card (or the dashboard's "Plan and payment") links to `/billing/<slug>`. Pick a plan, tick "Build me a website" if it is offered, and continue.
3. In Stripe Checkout pay with the test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode. Other useful test cards: `4000 0000 0000 0341` (card attaches, then payments fail, for the past-due path) and `4000 0025 0000 3155` (asks for 3-D Secure).
4. You land on `/dashboard/<slug>?billing=success`. Within a few seconds the webhook has set the plan and status (check Stripe, Developers, Webhooks, the endpoint's delivery log: 200 for each event).
5. "Manage billing" opens the portal. Cancel there and the venue goes to `canceled`; the website and posts stay online.

Without a card, "if required" Checkout lets an owner with trial days left start the subscription with nothing charged yet; the plan starts when the trial ends. If no card is added by then, Stripe pauses the subscription and Claudia pauses new owner changes.

## Going live later

Switch Stripe to live mode, make the same four prices, endpoint, portal settings and env values with the live keys, and decide Stripe Tax with the accountant first. Nothing in the code changes.
