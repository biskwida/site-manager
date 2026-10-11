# Channels: Telegram, Messenger, Instagram, WhatsApp

The owner of a venue can run their site from Telegram, Facebook Messenger, Instagram Direct or WhatsApp. Each channel works the same way: they link once with the invite code from `npm run venue:create`, then change the site by text, voice note or photo and approve with one tap. One Facebook Page, one Instagram professional account and one WhatsApp number serve every venue, exactly like the one Telegram bot. Nothing is installed on the owner's phone.

A channel is switched on by its token: `META_PAGE_TOKEN` enables Messenger and Instagram, `WHATSAPP_TOKEN` (with `WHATSAPP_PHONE_NUMBER_ID`) enables WhatsApp. Without them the app is Telegram-only, as before. Design: [superpowers/specs/2026-10-10-site-manager-channels-design.md](superpowers/specs/2026-10-10-site-manager-channels-design.md).

## What the owner needs to know: the 24-hour rule

On Messenger, Instagram and WhatsApp, Meta lets a business write to someone only within 24 hours of that person's last message. For the owner this means:

- Answers to their own messages, previews and "✅ Applied" always arrive, because they just wrote.
- Messages the service starts on its own (the reminder before a scheduled change, "applied as scheduled", "proposal expired", a change applied or undone from the dashboard) arrive only if the owner wrote to the bot in the last 24 hours. Otherwise they are skipped; the dashboard still shows everything.
- Telegram has no such limit and gets every message.

In words for the owner: "Write to the bot at least once a day if you want its reminders on Messenger, Instagram or WhatsApp. Everything is always visible on your dashboard."

(The app uses 23 hours to keep a margin. Paid Meta templates, which would lift the limit, are not part of this version.)

## Onboarding: eight steps

You create the accounts and paste the keys; the app needs no code change. Every key goes into `.env.local` with `npm run env:set -- KEY` (asks with echo off, writes only into `.env.local`) and into the Vercel preview with the loop in "Preview deployment" below. Never paste a key into chat, a file in git, or a terminal command line.

1. **Facebook Page and Instagram account.**
   - A Facebook Page for the service (or reuse one you admin): facebook.com → Pages → Create new Page.
   - An Instagram professional account (Business or Creator) linked to that Page: Instagram app → Settings and activity → Account type and tools → Switch to professional account; then Facebook Page → Settings → Linked accounts → Instagram → Connect.
   - Allow apps to read Instagram messages: Instagram app → Settings and activity → Messages and story replies → Message requests / Connected tools → **Allow access to messages** (on).
   - Keys for the invite links: `npm run env:set -- MESSENGER_PAGE_HANDLE` (the Page username, as in `m.me/<handle>`), `npm run env:set -- INSTAGRAM_USERNAME` (no `@`).

2. **Meta Business portfolio and the developer app.**
   - business.facebook.com → Create a business portfolio (if you do not have one); add the Page to it (Settings → Accounts → Pages → Add).
   - developers.facebook.com → My Apps → Create app → type **Business** (newer dashboards: choose the use cases "Engage with customers on Messenger from Meta", "Manage messaging & content on Instagram" and "Connect with customers through WhatsApp"), attach it to the business portfolio.
   - In the app: Add products → **Messenger**, **Instagram**, **WhatsApp** (on newer dashboards these are the use cases above, under Use cases → Customize).

3. **Tokens and the app secret.**
   - App secret: App settings → Basic → App secret → Show. `npm run env:set -- META_APP_SECRET`.
   - Verify token: invent one, `openssl rand -hex 16`, and keep it for step 5. `npm run env:set -- META_VERIFY_TOKEN`.
   - Page token (Messenger and Instagram): Messenger → Settings (or Messenger API Settings) → Access Tokens → Add or remove Pages → pick the Page → **Generate token**; the Instagram settings page has the same button for the linked Instagram account. The token must carry `pages_messaging`, `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`. `npm run env:set -- META_PAGE_TOKEN`.
   - WhatsApp: WhatsApp → API Setup → the free **test number**. Copy the "Phone number ID": `npm run env:set -- WHATSAPP_PHONE_NUMBER_ID`. Copy the test number itself (digits with country code) for the invite link: `npm run env:set -- WHATSAPP_NUMBER`. Under "To", add the owner's phone as a recipient (they get a confirmation code on WhatsApp). Generate a token: the API Setup token lasts 24 hours; for a permanent one create a system user (Business settings → Users → System users → Add → Generate new token, with `whatsapp_business_messaging` and `whatsapp_business_management`, and assign the app and the WhatsApp account to it). `npm run env:set -- WHATSAPP_TOKEN`. A system-user token may serve as `WHATSAPP_TOKEN` only, never as `META_PAGE_TOKEN`: the send and check calls (`me/messages`, `GET /me`) resolve to the token's owner, which must be the Page. For a long-lived `META_PAGE_TOKEN`, derive a Page access token: from the Page settings in the Meta app (Access Tokens → Generate token), or with a system-user token that has the Page assigned, `GET https://graph.facebook.com/v25.0/{page-id}?fields=access_token`, and use the returned Page token.

4. **Keys in place.** Check that `.env.local` has the eight keys above (`META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `MESSENGER_PAGE_HANDLE`, `INSTAGRAM_USERNAME`, `WHATSAPP_NUMBER`); `npm run env:set` with no argument lists every key. The app refuses to start with a Meta token but without `META_APP_SECRET` and `META_VERIFY_TOKEN`, or with `WHATSAPP_TOKEN` but without `WHATSAPP_PHONE_NUMBER_ID`. Copy them to the Vercel preview (see "Preview deployment").

5. **Deploy and connect the webhooks.**
   - Deploy the branch as a preview (see "Preview deployment"); the webhook URL is `<preview URL>/api/meta`.
   - Messenger → Settings → Webhooks (newer dashboards: Use cases → Messenger → Customize → Configure webhooks) → Callback URL `<preview URL>/api/meta`, Verify token = your `META_VERIFY_TOKEN` → Verify and save → subscribe the Page to `messages`, `messaging_postbacks`, `messaging_referrals`.
   - Instagram → Webhooks → the same callback and verify token → subscribe `messages`, `messaging_postbacks`, `messaging_referral`. Use the **Instagram API with Facebook Login** setup (Messenger API for Instagram), not "API setup with Instagram login": the code sends with the Page token through `graph.facebook.com` and verifies signatures with the Meta app secret, which is what the Facebook Login setup uses.
   - WhatsApp → Configuration → Webhook → Edit → the same callback and verify token → Webhook fields → subscribe `messages`.
   - **Or let the script do all of step 5:** `npm run meta:setup` registers the app's webhook objects itself (`whatsapp_business_account` → `messages`; `page` → `messages`, `messaging_postbacks`, `messaging_referrals`; `instagram` → `messages`, `messaging_postbacks`, `messaging_referral`) with the callback URL and verify token, and subscribes the WhatsApp Business Account to the app when `WHATSAPP_BUSINESS_ACCOUNT_ID` is set (`npm run env:set -- WHATSAPP_BUSINESS_ACCOUNT_ID`, the ID shown next to the Phone number ID). In the 2026-10-11 live test Meta delivered nothing until both were done; the dashboard alone had left the app with only a `user` object and the WhatsApp account subscribed to Meta's own test app.
   - `npm run meta:setup` (with `PUBLIC_BASE_URL` pointing at the preview): prints the Page name and id, subscribes the app to the Page's `messages,messaging_postbacks,messaging_referrals` (Messenger needs this besides the dashboard), sets the Messenger **Get Started** button (`me/messenger_profile`; a first contact through `m.me/<page>?ref=<code>` then delivers the code with the Get Started postback), prints the WhatsApp display number, the enabled channels and the webhook URL to paste. It never prints a token.

6. **Testers.** Until App Review (step 8) only people with a role on the app can talk to the bot.
   - Messenger: App roles → Roles → Add People → **Testers** → the owner's Facebook account. The owner must **accept the invitation** (developers.facebook.com/requests, or the notification on Facebook); until then the bot does not receive their messages.
   - Instagram: App roles → Roles → Instagram Testers → Add → the owner's Instagram username. The owner accepts in the Instagram app: Settings and activity → Website permissions → Apps and websites → Tester invites → Accept.
   - WhatsApp test number: no roles, only the recipient list from step 3, **at most 5 phone numbers**. Each recipient confirms with the code WhatsApp sends them.

7. **Try it.** `npm run venue:create -- --name "Тест Канали" --slug kanali-test` prints the owner and staff codes, one owner link and one staff link per enabled channel (`startLinks` in `src/channels/links.ts`), and the bare codes to send on Messenger, Instagram or WhatsApp:
   - Messenger `https://m.me/<page>?ref=<code>`, Instagram `https://ig.me/m/<username>?ref=<code>`, WhatsApp `https://wa.me/<digits>?text=<code>`, Telegram `https://t.me/<bot>?start=<code>`.
   - Open the link on the owner's phone and send. If the link does not carry the code (Meta passes `?ref=` only on some first contacts), sending the bare code alone as a message links the chat too. Then "Капучиното става 3,20" → a preview with three buttons → tap ✅ → "✅ Приложено" and `/kanali-test` updates.

8. **Later, for real customers.**
   - **App Review** for `pages_messaging` and `instagram_manage_messages` (App Review → Permissions and features → Request advanced access), with a screencast of the flow. Meta currently warns of about **20 days per submission**; a rejection restarts the clock, so plan 3 to 6 weeks. Business verification of the portfolio is a separate step. Testers keep working meanwhile.
   - **WhatsApp**: a real number (a SIM not registered on WhatsApp) added under WhatsApp → API Setup → Add phone number, plus Meta Business verification to lift the test-number limits. Update `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_NUMBER`; no code change.

### WhatsApp test-number limits

- Messages go only to the recipient list: at most **5 numbers**, each confirmed by code.
- The display name is Meta's ("Test Number"), not yours.
- The API Setup token expires after 24 hours; use a system-user token (step 3) for anything longer than one sitting.
- Interactive buttons (the ✅ / ✏️ / ❌ preview) work only inside the 24-hour window, which is always the case for a preview the owner just asked for.

## Preview deployment (Vercel)

Webhooks live on a preview deployment of this branch until it merges; production (`site-manager-lovat.vercel.app`, Telegram only) is untouched. Never run `vercel --prod` from this branch and never point the Telegram webhook at the preview: production keeps the Telegram webhook.

```bash
cp ../site-manager/.vercel/project.json .vercel/project.json   # link the worktree to the same Vercel project (.vercel is git-ignored)
# Copy every non-empty key to the Preview target; values go through a pipe, never onto the screen.
# Skipped: VERCEL_OIDC_TOKEN (Vercel's own), SUPABASE_DB_URL (scripts only), DEMO_OWNER_CHAT_REF (memory mode only).
for k in $(grep -E '^[A-Z_0-9]+=.+' .env.local | cut -d= -f1); do
  case "$k" in VERCEL_OIDC_TOKEN|SUPABASE_DB_URL|DEMO_OWNER_CHAT_REF) continue;; esac
  case "$k" in NEXT_PUBLIC_*) type="--type config";; *) type="";; esac   # Vercel refuses NEXT_PUBLIC_ keys without --type config
  grep "^$k=" .env.local | cut -d= -f2- | tr -d '\n' | vercel env add "$k" preview $type --yes --force >/dev/null && echo "ok $k"
done
vercel --yes                                                    # preview deployment; prints the deployment URL
vercel alias set <deployment URL> site-manager-channels-biskwida.vercel.app   # a stable name, so Meta's callback URL survives redeploys
printf '%s' "https://site-manager-channels-biskwida.vercel.app" | vercel env add PUBLIC_BASE_URL preview --type config --yes --force
vercel --yes                                                    # redeploy so admin links use it
vercel alias set <new deployment URL> site-manager-channels-biskwida.vercel.app
npm run meta:setup                                              # with PUBLIC_BASE_URL pointing at the preview
```

After every redeploy, move the alias with `vercel alias set` again; the Meta callback URL then stays the same.

While the webhooks live on the preview (until merge), the production daily cron still runs the old Telegram-only code: for an owner linked on Messenger, Instagram or WhatsApp it applies scheduled change sets and expires stale proposals without messaging them. The dashboard shows the result; the chat stays silent.

Check the webhook (the verify token is read from `.env.local` inside the URL and never printed):

```bash
curl -s "https://site-manager-channels-biskwida.vercel.app/api/meta?hub.mode=subscribe&hub.verify_token=$(grep '^META_VERIFY_TOKEN=' .env.local | cut -d= -f2-)&hub.challenge=ping"   # → ping
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://site-manager-channels-biskwida.vercel.app/api/meta" -d '{}'                                   # → 401
```

### Vercel Deployment Protection

Meta cannot reach a preview protected by Vercel Authentication: this project has it on for every deployment except custom domains, so a preview URL answers `302` to Vercel's login page and the webhook verification fails. Before step 5, in Vercel → Project → Settings → Deployment Protection, either

- set Vercel Authentication to **"Only Production Deployments"** (the webhook is protected by its own HMAC signature check, the admin pages by their key), or
- create a **"Protection Bypass for Automation"** secret and append `?x-vercel-protection-bypass=<secret>` to the callback URL in the Meta app (all three webhook settings, and the curl checks above).

### Replace the placeholder app secret

The preview's `META_APP_SECRET` is currently a random value made for `npm run meta:sim`; Meta's signatures will not verify until it is the real App secret (App settings → Basic). Set it in `.env.local` with `npm run env:set -- META_APP_SECRET` and on the preview with

```bash
printf '%s' "<secret>" | vercel env add META_APP_SECRET preview --force   # or: grep '^META_APP_SECRET=' .env.local | cut -d= -f2- | tr -d '\n' | vercel env add META_APP_SECRET preview --force
```

then redeploy (`vercel --yes`) and move the alias. Never type or paste the secret into chat.

### Current preview

- Stable URL: https://site-manager-channels-biskwida.vercel.app (alias), webhook `https://site-manager-channels-biskwida.vercel.app/api/meta`.
- Deployment on 2026-10-10: https://site-manager-k0m6uxem4-biskwida-dev.vercel.app (`PUBLIC_BASE_URL` for Preview = the stable URL).
- Vercel Authentication was switched off on 2026-10-11; the public URL answers the handshake (`ping`), a wrong token with `403` and an unsigned POST with `401`. The same build run locally with `next start` answered the handshake with `ping`, a wrong verify token with `403` and an unsigned POST with `401`.

## Database migration

The Supabase project is shared with production, which still runs the Telegram-only code. Phase 1 of the identity change (`chat_ref` = `tg:<id>`, `fb:<PSID>`, `ig:<id>`, `wa:<digits>`) is additive: it adds `chat_ref`, `message_ref` and `last_seen_at`, moves the primary keys to `chat_ref`, keeps the old bigint columns with unique indexes for production's upserts, and adds a `fill_chat_ref` trigger that fills `chat_ref` from the old columns when production writes a row. Production keeps working before and after.

Order (from this worktree, `SUPABASE_DB_URL` in `.env.local`). Always start with the dry run; apply only when it ends with `DRY RUN OK`:

```bash
npm run db:dry-run      # runs the migration inside a transaction and ROLLS BACK; must end with "DRY RUN OK"
npm run db:apply -- supabase/migrations/2026-10-10-chat-ref.sql   # FIRST: the migration alone
npm run db:apply        # then schema.sql + policies.sql + schema-integrations.sql + policies-integrations.sql (idempotent; schema.sql already has the new shape)
npm run check:rls       # every line PASS
```

`npm run db:dry-run` (`scripts/db-dry-run.mts`) takes file arguments like `db:apply` (`npm run db:dry-run -- supabase/migrations/2026-10-10-chat-ref.sql schema.sql policies.sql` tries the whole sequence) and checks, before rolling back: no `venue_members` row without `chat_ref`, the `fill_chat_ref` trigger present on the three tables, and production's two upserts (`on conflict (venue_id, tg_chat_id)` and `on conflict (venue_id, chat_id)`) still working and filling `chat_ref`.

Status on 2026-10-10: **applied to the shared database.** The first dry run found a defect (`column "tg_chat_id" is in a primary key`: `drop not null` ran before the primary-key swap); the two `drop not null` lines now follow the key-swap blocks. Then `db:dry-run` passed (alone and with `schema.sql` + `policies.sql`), the migration, `db:apply` and `check:rls` (16 × PASS) ran, and the live database has 0 rows without `chat_ref` in `venue_members` and `conversations`, both primary keys on `(venue_id, chat_ref)` and the `fill_chat_ref` trigger on all three tables.

### Phase 2 (after merge)

Phase 1 left the Telegram-only production build working through a bridge: the legacy bigint columns (`venue_members.tg_chat_id`, `change_sets.chat_id`, `change_sets.tg_message_id`, `conversations.chat_id`), their unique indexes (`venue_members_tg_chat_id_key`, `conversations_chat_id_key`, and on databases migrated from the first schema also `venue_members_chat_idx`) and the `fill_chat_ref` trigger function with its three triggers. Phase 2 removes all of it once production runs the new code.

Run order (the order matters: the merged code still sends the legacy fields on every write, so dropping the columns first would make PostgREST reject every insert and upsert with `PGRST204` and stop all writes in production):

1. Merge `build/channels` and deploy production. Wait until the new build serves traffic: the old build still writes the bigint columns and needs the bridge.
2. Move the Meta keys (`META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `MESSENGER_PAGE_HANDLE`, `INSTAGRAM_USERNAME`, `WHATSAPP_NUMBER`) to the Production target in Vercel, redeploy production, and repoint the three Meta callback URLs (Messenger, Instagram, WhatsApp) from the preview alias to `<production URL>/api/meta`. Then retire the preview (remove the alias and the Preview-only keys).
3. Deploy the code cleanup below (remove the legacy writes, `legacyTelegramId`, `legacyColumns` and the legacy parts of `schema.sql`). This is safe while the columns still exist: they are nullable since phase 1, and the `fill_chat_ref` trigger only fills `chat_ref` when it is null, so rows written without the legacy fields are complete.
4. Only then, on a quiet moment, run `npm run db:apply -- supabase/migrations/2026-10-11-drop-legacy-chat-ids.sql`. There is no `db:dry-run` check wired for this file. The file is idempotent and drops, in order, the three `fill_chat_ref` triggers, the `fill_chat_ref` function (it references the legacy columns, so it must go first), the legacy indexes, the legacy columns, then reloads the PostgREST schema cache.

Never run a bare `npm run db:apply` (which applies `schema.sql`) against a database where phase 2 has run until the `schema.sql` cleanup from step 3 has landed: the old `schema.sql` would re-add the legacy columns, indexes and the bridge trigger.

Code cleanup list (step 3; do not do it before production is on the new code, and land it before the migration in step 4):

- `src/store/supabase.ts`: delete `legacyColumns` (around lines 109-113) and its two uses (around lines 291 and 330), the `tg_chat_id: legacyTelegramId(...)` field (around line 252), the `chat_id: legacyTelegramId(chatRef)` field (around line 428), and the `legacyTelegramId` import.
- `src/channels/ref.ts`: delete `legacyTelegramId`.
- `test/supabase-mappers.test.ts` and `test/ref.test.ts`: delete the tests that cover the legacy columns and `legacyTelegramId`.
- `supabase/schema.sql`: delete the legacy columns, the two legacy unique indexes (`venue_members_tg_chat_id_key`, `conversations_chat_id_key`) and the `fill_chat_ref` function with its triggers.

## Offline: no Meta account needed

- `DEMO_OWNER_CHAT_REF` (memory mode only, not in `.env.example`): links that chat as the demo owner when `npm run dev:offline` seeds the café, for example `fb:4242`, `ig:4242`, `wa:4242` or `tg:<chat id>`. The older `DEMO_OWNER_CHAT_ID` (a Telegram chat id) still works.
- `npm run meta:sim` signs a fake Meta webhook with `META_APP_SECRET` and posts it to the local server, so the whole path runs against the memory store:

```bash
# .env.local: META_APP_SECRET, META_VERIFY_TOKEN (any values) and DEMO_OWNER_CHAT_REF=fb:4242
npm run dev:offline
npm run meta:sim -- fb text "Капучиното става 3,20"     # the preview appears in the dev log as "→ [fb:4242] …"
npm run meta:sim -- fb button cs:apply:<id>             # the id from the preview's buttons
npm run meta:sim -- wa text "menu" --sender 4242        # --sender <id>, --url <url> anywhere on the line
```

- `npm run e2e` includes a Messenger leg: a `fb:` owner links with a bare code, gets a proposal, taps apply, and a proactive reminder is skipped after the clock jumps 25 hours.

## Резюме (български)

Собственикът може да управлява сайта си през Telegram, Messenger, Instagram или WhatsApp: веднъж изпраща кода си, после пише, говори или снима, и потвърждава с един бутон.
Една Facebook страница, един Instagram акаунт и един WhatsApp номер обслужват всички заведения; каналът се включва, когато има токен.
Правило 24 часа: в Messenger, Instagram и WhatsApp напомнянията и съобщенията, които ботът започва сам, пристигат само ако собственикът е писал през последните 24 часа; таблото винаги показва всичко.
Осем стъпки: страница и Instagram, бизнес портфолио и приложение в Meta, токени и app secret, ключове с `npm run env:set -- KEY`, preview в Vercel и webhook `<URL>/api/meta`, тестери, проба с линковете от `venue:create`, после App Review.
До App Review ботът отговаря само на тестери; собственикът трябва да приеме поканата (Facebook и Instagram).
App Review отнема около 20 дни за всеки опит; WhatsApp тестовият номер праща само до 5 потвърдени номера.
Webhook-ът живее на preview в Vercel (https://site-manager-channels-biskwida.vercel.app); production и Telegram webhook-ът не се пипат.
Preview-то е зад Vercel Authentication: изберете „Only Production Deployments“ или bypass секрет, иначе Meta не стига до webhook-а; сменете и META_APP_SECRET с истинския.
Базата: първо `npm run db:dry-run`, после миграцията, после `npm run db:apply` и `npm run check:rls`; миграцията е приложена на 2026-10-10.
Офлайн: `DEMO_OWNER_CHAT_REF=fb:4242`, `npm run dev:offline` и `npm run meta:sim` пускат целия път без акаунт в Meta.
