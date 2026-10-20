# Accounts (Supabase Auth): owner setup

Claudia owners sign in with an email link or Google (`/login`). This is what the owner configures once, in the Supabase and Google dashboards and in Vercel. Code: `src/server/session.ts`, `src/server/auth-callback.ts`, `app/login`, `app/auth`, `scripts/account-invite.mts`.

## 1. Database

Follow the "Database first" list in [DOMAIN-SWITCH.md](DOMAIN-SWITCH.md#a-database-first-before-deploying-this-branch) (all five migrations, then `policies.sql`). For the accounts alone it is:

```
npm run db:apply -- supabase/migrations/2026-10-19-venue-users.sql
npm run db:apply -- supabase/migrations/2026-10-19-billing.sql
npm run db:apply -- supabase/policies.sql
```

`policies.sql` also covers `billing_events`; it skips that table when the billing migration has not been applied, so the order is forgiving, but apply the billing migration first so the table gets its protection in the same run.

`venue_users` and `account_invites` are server-only (RLS on, nothing granted to anon or authenticated). `npm run check:rls` proves it.

## 2. Supabase dashboard

**Authentication, Providers, Email: keep "Confirm email" ON.** This is a security setting, not a preference. An account invite (`account:invite`) is a promise of a venue to whoever owns an email address, and `/auth/callback` claims it right after a sign-in. With "Confirm email" off, someone could register with an address they do not own and be handed that venue. The callback also refuses to claim unless Supabase reports the email as confirmed, but that check only protects you while this switch stays on. Invites are claimed in `/auth/callback` and nowhere else.

**Authentication, Providers, Google:** enable it and paste the Google OAuth client ID and secret. In the Google Cloud console the authorised redirect URI is the one Supabase shows on that page (`https://<project>.supabase.co/auth/v1/callback`).

**Authentication, URL Configuration:**
- Site URL: `https://getclaudia.app`
- Redirect URLs: `https://getclaudia.app/auth/callback`, `http://localhost:3000/auth/callback` and, for the testing window before the domain moves, `https://site-manager-lovat.vercel.app/auth/callback` (remove it once the app is only used on getclaudia.app)

**Authentication, SMTP Settings:** turn on custom SMTP and point it at Resend (host `smtp.resend.com`, port 465, user `resend`, password = the Resend API key, sender `Claudia <hello@getclaudia.app>`). The built-in Supabase mailer is rate-limited to a few emails an hour and sends from a shared address; the sign-in link email would be throttled and often land in spam.

## 3. Resend and Vercel env

- Resend: verify the sending domain getclaudia.app (the DNS records Resend lists).
- Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` (optional, default `Claudia <hello@getclaudia.app>`) and `APP_HOST=getclaudia.app`.
- `npm run account:invite -- --slug <s> --email <e>` stores the invite and emails the sign-in link only when `RESEND_API_KEY` is set AND `APP_HOST` is set explicitly in the env (the link must point at the real host). Otherwise it stores the invite and says so; the owner signs in at `/login` with that email and the first sign-in claims it.
- **Once any account is linked to a venue, every chat owner of that venue gets the dashboard link (`/dashboard/<slug>`, "log in with your email") instead of the key link, and only linked accounts can open it. Link each owner's email with `account:invite` before (or right after) the first one, or the other owners lose their way into the dashboard.**

## 4. Known caveat: email scanners and one-time links

Some mail providers and corporate scanners open every link in an email before the person does. A sign-in link is single-use, so a scanner can use it up and the owner sees "The link did not work or has expired". Nothing is lost: the owner asks for a new link at `/login` with the same email, and the invite is claimed on that first successful sign-in. If an owner reports this twice, send them to the Google button instead.
