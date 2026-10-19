# Switching Claudia to app.getclaudia.app

Owner's checklist. Nothing here is automatic: do the steps in this order. Until step 4 nothing changes for owners.

The code side is already in place: `proxy.ts` sends the owner's browser pages (`/start`, `/login`, `/dashboard`, `/onboarding`, `/admin/...`) from any other host to `APP_HOST` (default `app.getclaudia.app`), keeping the path and the query. `/api/*`, venue pages, `/new` and the chat bots are never redirected.

Before you start, run `npm run slugs:check`. It lists live venues whose slug is now reserved (`start`, `login`, `dashboard`, `onboarding`, `auth`, `app`, `billing`). It changes nothing. If it names a venue, sort that out first.

1. **Vercel domain.** In the `site-manager` project (team `team_ldiZAmDSugSiVqMxmWQ4MWKn`) add the domain `app.getclaudia.app`.
2. **DNS.** In the `getclaudia.app` zone (Vercel team `biskwida-dev`) add a CNAME record: name `app`, value as Vercel shows it in step 1. Wait until Vercel marks the domain valid.
3. **Meta redirect URIs.** In the Meta app, add these Valid OAuth Redirect URIs and keep the old ones:
   - `https://app.getclaudia.app/api/social/instagram/callback`
   - `https://app.getclaudia.app/api/social/facebook/callback`
   - `https://app.getclaudia.app/api/new/instagram/callback`
4. **`PUBLIC_BASE_URL`.** At a quiet hour set `PUBLIC_BASE_URL=https://app.getclaudia.app` in the Vercel project env (no trailing slash) and redeploy. New admin links, OAuth redirects and venue feed origins use it from then on.
5. **Telegram webhook.** Run `scripts/set-webhook.mts` again (`npm run telegram:set-webhook`) so Telegram points at the new host.
6. **Old host.** `site-manager-lovat.vercel.app` stays as an alias forever. Old `/admin/<slug>?key=` links, chat invites and every `/api/*` path keep working there; only the browser pages redirect.
