# Switching Claudia to app.getclaudia.app

Owner's checklist. Nothing here is automatic: do the steps in order. The redirect in `proxy.ts` is **off** until step 4: it needs both `APP_HOST` (set explicitly) and `LEGACY_HOSTS` in the Vercel env. With either missing, every host behaves as today.

When on, `proxy.ts` answers 308 for the owner's browser pages (`/start`, `/login`, `/dashboard`, `/onboarding`, `/admin/...`) opened on a host listed in `LEGACY_HOSTS`, keeping the path and the query. Previews, LAN addresses, localhost, `/api/*`, venue pages, `/new` and the chat bots are never redirected.

Before you start, run `npm run slugs:check`. It lists live venues whose slug is now reserved (`start`, `login`, `dashboard`, `onboarding`, `auth`, `app`, `billing`). It changes nothing. If it names a venue, sort that out first.

1. **Vercel domain.** In the `site-manager` project (team `team_ldiZAmDSugSiVqMxmWQ4MWKn`) add the domain `app.getclaudia.app`.
2. **DNS.** In the `getclaudia.app` zone (Vercel team `biskwida-dev`) add a CNAME record: name `app`, value as Vercel shows it in step 1. Wait until Vercel marks the domain valid.
3. **Meta redirect URIs.** Keep the old ones and add the new ones. Facebook Login and Instagram Login are separate products with separate redirect URI lists:
   - Facebook Login: `https://app.getclaudia.app/api/social/facebook/callback`
   - Instagram Login (its own list, covers both flows): `https://app.getclaudia.app/api/new/instagram/callback` and `https://app.getclaudia.app/api/social/instagram/callback`
4. **Switch on, at a quiet hour.** First make sure the landing's start links already point at `https://app.getclaudia.app` (an in-progress wizard draft cookie belongs to the host that set it and would be lost on a redirect). Then set these together in the Vercel project env and redeploy:
   - `PUBLIC_BASE_URL=https://app.getclaudia.app` (no trailing slash)
   - `APP_HOST=app.getclaudia.app`
   - `LEGACY_HOSTS=site-manager-lovat.vercel.app`
5. **Telegram webhook (optional).** `/api/telegram` keeps working on the old host, so this can wait. To move it: `npm run telegram:set-webhook -- https://app.getclaudia.app` (the script takes the base URL as its argument; without one it uses `PUBLIC_BASE_URL` from `.env.local`). Note it drops pending updates.
6. **Verify.**
   - An old link such as `https://site-manager-lovat.vercel.app/admin/<slug>?key=<key>` answers 308 to `https://app.getclaudia.app/admin/<slug>?key=<key>` (`curl -sI` shows `location`) and the admin page opens there.
   - `https://site-manager-lovat.vercel.app/api/site/<slug>` still answers 200.
7. **Rollback.** Unset `LEGACY_HOSTS` and redeploy. Every host then behaves as before.

The old host stays as an alias forever: old `/admin/<slug>?key=` links, chat invites and every `/api/*` path keep working there.
