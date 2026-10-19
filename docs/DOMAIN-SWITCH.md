# Switching Claudia to getclaudia.app

Owner's checklist. There is no app subdomain: the app, the landing page and the sign-in all live on **getclaudia.app**.

**Precondition:** do this only after the landing page has been moved into the app (a later task). Today getclaudia.app serves the separate `claudia-landing` project; if you attach it to the app first, getclaudia.app shows no landing page.

Nothing here is automatic: do the steps in order. The redirect in `proxy.ts` is **off** until step 4: it needs both `APP_HOST` (set explicitly) and `LEGACY_HOSTS` in the Vercel env. With either missing, every host behaves as today.

When on, `proxy.ts` answers 308 for the owner's browser pages (`/start`, `/login`, `/dashboard`, `/onboarding`, `/admin/...`) opened on a host listed in `LEGACY_HOSTS`, keeping the path and the query. Previews, LAN addresses, localhost, `/api/*`, venue pages, `/new` and the chat bots are never redirected. `/` on getclaudia.app never redirects to itself: when `LANDING_URL` points at the same host, the app renders its own landing.

Before you start, run `npm run slugs:check`. It lists live venues whose slug is now reserved (`start`, `login`, `dashboard`, `onboarding`, `auth`, `app`, `billing`). It changes nothing. If it names a venue, sort that out first.

1. **Attach the apex domain to the app.** The domain `getclaudia.app` must belong to the `site-manager` Vercel project (team `team_ldiZAmDSugSiVqMxmWQ4MWKn`). It now belongs to team `biskwida-dev` and serves the `claudia-landing` project. Either move it (Vercel → Domains → Move, to the site-manager team), or add it to the site-manager project and complete Vercel's TXT verification. There is no CNAME step. Remove it from `claudia-landing` once the app serves the landing.
2. **Check the domain.** Wait until Vercel shows `getclaudia.app` as valid on the site-manager project.
3. **Meta redirect URIs.** Keep the old ones and add the new ones. Facebook Login and Instagram Login are separate products with separate redirect URI lists:
   - Facebook Login: `https://getclaudia.app/api/social/facebook/callback`
   - Instagram Login (its own list, covers both flows): `https://getclaudia.app/api/new/instagram/callback` and `https://getclaudia.app/api/social/instagram/callback`
4. **Switch on, at a quiet hour.** First make sure the landing's start links point at `https://getclaudia.app` (an in-progress wizard draft cookie belongs to the host that set it and would be lost on a redirect). Then set these together in the Vercel project env and redeploy:
   - `PUBLIC_BASE_URL=https://getclaudia.app` (no trailing slash)
   - `APP_HOST=getclaudia.app`
   - `LEGACY_HOSTS=site-manager-lovat.vercel.app`
5. **Telegram webhook (optional).** `/api/telegram` keeps working on the old host, so this can wait. To move it: `npm run telegram:set-webhook -- https://getclaudia.app` (the script takes the base URL as its argument; without one it uses `PUBLIC_BASE_URL` from `.env.local`). Note it drops pending updates.
6. **Verify.**
   - An old link such as `https://site-manager-lovat.vercel.app/admin/<slug>?key=<key>` answers 308 to `https://getclaudia.app/admin/<slug>?key=<key>` (`curl -sI` shows `location`) and the admin page opens there.
   - `https://site-manager-lovat.vercel.app/api/site/<slug>` still answers 200.
   - `https://getclaudia.app/` shows the landing page and does not loop.
7. **Rollback.** Unset `LEGACY_HOSTS` and redeploy. Every host then behaves as before.

The old host stays as an alias forever: old `/admin/<slug>?key=` links, chat invites and every `/api/*` path keep working there.
