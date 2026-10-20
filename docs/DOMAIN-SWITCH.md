# Switching Claudia to getclaudia.app

## Launch order

Do these in order. Each letter is a section of this file or of the guide it names.

- **A. Database first** (below). Before the branch is deployed anywhere.
- **B. Deploy on the old host and verify.** Deploy the branch to `site-manager-lovat.vercel.app` (the domain has not moved yet) and check: `/` shows the landing page; `/new` still publishes a site; one change through a chat (Telegram) goes through; `/admin/<slug>?key=` shows the cards; `/api/site/<slug>` answers 200; the WordPress sync still works.
- **C. Accounts.** [AUTH-SETUP.md](AUTH-SETUP.md): Supabase providers, SMTP, redirect URLs, Resend, env.
- **D. Domain switch.** The numbered steps further down in this file.
- **E. Billing.** [BILLING-SETUP.md](BILLING-SETUP.md), only after D (the Stripe webhook points at getclaudia.app). `BILLING_ENABLED` stays `false` until then.
- **F. After launch.** Run `npm run account:invite -- --slug <s> --email <e>` for every chat owner **before** linking the first account to a venue (see AUTH-SETUP, section 3: once one account is linked, only linked accounts can open the dashboard). Run `npm run slugs:check` again from time to time; the policy for look-alike addresses (a new business whose address imitates an existing one or a reserved word) is a manual review of new slugs for now.

## A. Database first, before deploying this branch

The code of this branch **writes** the new columns (`site_mode`, `site_platform`, `created_via`, the billing fields, the `venue_users` link). Reads are safe on an old database (a missing column reads as empty), but writes are not: a publish, a `/start` or a plan change against a database without them fails. So apply the migrations first, in this order:

```
npm run db:apply -- supabase/migrations/2026-10-19-site-mode.sql
npm run db:apply -- supabase/migrations/2026-10-19-site-platform.sql
npm run db:apply -- supabase/migrations/2026-10-19-created-via.sql
npm run db:apply -- supabase/migrations/2026-10-19-venue-users.sql
npm run db:apply -- supabase/migrations/2026-10-19-billing.sql
npm run db:apply -- supabase/policies.sql
npm run check:rls
npm run slugs:check
```

`billing.sql` **grandfathers every venue that exists at that moment to plan `both`, status `active`** (all features, no trial, as today). It is safe while `BILLING_ENABLED=false`: nothing reads the billing fields until it is switched on. Applying any of these twice changes nothing. `policies.sql` goes last because it makes the new tables server-only; `check:rls` proves it, and `slugs:check` lists live venues whose address is now reserved (it changes nothing).

## D. Domain switch

Owner's checklist for the switch itself. There is no app subdomain: the app, the landing page and the sign-in all live on **getclaudia.app**.

**Precondition:** the landing page now lives in this app (`/`), so deploy this version on the old host and check `/` there first. Today getclaudia.app still serves the separate `claudia-landing` project; once the domain moves to the app, `/` is the landing page.

Nothing here is automatic: do the steps in order. The redirect in `proxy.ts` is **off** until step 4: it needs both `APP_HOST` (set explicitly) and `LEGACY_HOSTS` in the Vercel env. With either missing, every host behaves as today.

When on, `proxy.ts` answers 308 for the owner's browser pages (`/start`, `/login`, `/dashboard`, `/onboarding`, `/admin/...`) opened on a host listed in `LEGACY_HOSTS`, keeping the path and the query. Previews, LAN addresses, localhost, `/api/*`, venue pages, `/new` and the chat bots are never redirected. `/` is the landing page on every host and never redirects.

Before you start, run `npm run slugs:check` (it is also in section A). It lists live venues whose slug is now reserved (`start`, `login`, `dashboard`, `onboarding`, `auth`, `app`, `billing`, `pricing`). It changes nothing. If it names a venue, sort that out first.

1. **Attach the apex domain to the app.** The domain `getclaudia.app` must belong to the `site-manager` Vercel project (team `team_ldiZAmDSugSiVqMxmWQ4MWKn`). It now belongs to team `biskwida-dev` and serves the `claudia-landing` project. Either move it (Vercel → Domains → Move, to the site-manager team), or add it to the site-manager project and complete Vercel's TXT verification. There is no CNAME step. Remove it from `claudia-landing` once the app serves the landing.
2. **Check the domain.** Wait until Vercel shows `getclaudia.app` as valid on the site-manager project.
3. **Meta redirect URIs.** Keep the old ones and add the new ones. Facebook Login and Instagram Login are separate products with separate redirect URI lists:
   - Facebook Login: `https://getclaudia.app/api/social/facebook/callback`
   - Instagram Login (its own list, covers both flows): `https://getclaudia.app/api/new/instagram/callback` and `https://getclaudia.app/api/social/instagram/callback`
4. **Switch on, at a quiet hour.** The landing's buttons are relative links, so they stay on whichever host serves the page. Then set these together in the Vercel project env and redeploy:
   - `PUBLIC_BASE_URL=https://getclaudia.app` (no trailing slash)
   - `APP_HOST=getclaudia.app`
   - `LEGACY_HOSTS=site-manager-lovat.vercel.app`
5. **Telegram webhook (optional).** `/api/telegram` keeps working on the old host, so this can wait. To move it: `npm run telegram:set-webhook -- https://getclaudia.app` (the script takes the base URL as its argument; without one it uses `PUBLIC_BASE_URL` from `.env.local`). Note it drops pending updates.
6. **Verify.**
   - An old link such as `https://site-manager-lovat.vercel.app/admin/<slug>?key=<key>` answers 308 to `https://getclaudia.app/admin/<slug>?key=<key>` (`curl -sI` shows `location`) and the admin page opens there.
   - `https://site-manager-lovat.vercel.app/api/site/<slug>` still answers 200.
   - `https://getclaudia.app/` shows the landing page and does not loop.
7. **Rollback.** Unset `LEGACY_HOSTS` and redeploy. Every host then behaves as before. If the domain itself moves back to the old project, also reset `PUBLIC_BASE_URL` and `APP_HOST` (to the old host, or unset `APP_HOST`) and point the Meta redirect URIs, the Supabase Site URL and Redirect URLs and the Stripe webhook URL back at the host that serves the app.

The old host stays as an alias forever: old `/admin/<slug>?key=` links, chat invites and every `/api/*` path keep working there.
