# Site Manager

A website for a small café or restaurant that the owner runs from Telegram. The owner never logs into anything: they message a bot, in Bulgarian or English, by text, voice note or photo ("Капучиното става 3,20", a photo of today's specials board, "баницата свърши", "затворени сме на 24 и 25 декември"), and the site changes. Claude does the understanding: casual Bulgarian, speech, handwriting on a whiteboard, which dish is meant, which allergen is missing, the translation into the other language. The app does what the model cannot do on its own: the website, the content model, a preview the owner approves with one tap, a scheduler, a change log with undo, and the multi-venue plumbing that makes it sellable. One deployment serves many venues, each with its own slug, owner chat and admin link.

**Price:** 25 € per venue per month (website hosting + the agent), setup included.

**Evidence:** four venues quoted us a monthly price before the product existed: Bar and Dinner Central (30 €), Coffique (20 €), Family House (50 €) and The High End Bar (70 €). That is the whole claim; there are no testimonials.

Built for the "AI That Does the Work" hackathon. Full design: [docs/superpowers/specs/2026-10-10-site-manager-design.md](docs/superpowers/specs/2026-10-10-site-manager-design.md).

## Demo (2 minutes)

The demo café is Кафене „Ъгъла“ at `/agala`. The projector shows the café's site; the presenter holds a phone with Telegram open on the bot.

| # | You say (on the phone) | What happens |
|---|---|---|
| 1 | (nothing yet) | Projector on `/agala`, the café's site. Phone on Telegram, in the bot chat. |
| 2 | Voice note: "Капучиното става три и двайсет" | The bot echoes "🎤 Чух: „…“", then sends a preview "Капучино: 2,90 € → 3,20 €" with ✅ / ✏️ / ❌. Tap ✅: the site updates live. |
| 3 | Photo of a whiteboard with three specials | A preview with the three dishes, prices and "до затваряне в 18:00". Tap ✅: "Специални предложения днес" appears on the site. |
| 4 | "Баницата свърши" | No preview (sold-out is instant and undoable): the banitsa is greyed out at once, and the bot says it will be back at tomorrow's opening. |
| 5 | "Затворени сме на 24 и 25 декември. Весели празници!" | A preview with two holidays and an announcement. Tap ✅: the holiday notice and the announcement show on the site. |
| 6 | Photo with the caption "това е новата корица" | A preview of the new cover image. Tap ✅: the hero image changes. |
| 7 | "Върни цената на капучиното" | An undo preview "3,20 € → 2,90 €". Tap ✅: the price is back. Open the admin page: the QR code and the full change log. |
| 8 | If time: "Вдигни всички кафета с 10%" | A table of old → new prices, rounded to 0,10 €. Tap ✅: all coffees change at once. |

The same sequence runs offline, without a phone or keys: `npm run e2e`.

## How it works

- **Change sets.** Every edit is a change set: a list of typed changes (`set_price`, `set_sold_out`, `add_item`, `update_item`, `remove_item`, image ops, `set_hours`, holidays, announcements, `set_text`, `set_theme`) with a before and after snapshot of each entity. Nothing touches the site except through one, so every edit is previewable, logged and undoable. Undo is a new set with the inverse changes; the original is marked `reverted`.
- **Approval policy.** Marking a dish sold out is instant (and undoable). Everything else is a preview in the owner's language with three buttons: ✅ Apply, ✏️ Change (the next message corrects the proposal), ❌ Cancel. One open proposal per chat; proposals expire after 2 hours. The owner's dashboard offers the same decisions, and a "Preview on the site" link that renders the proposal on the real pages under a "Draft preview" banner.
- **Time without a server process.** Vercel has no always-on process, so the public site computes availability when it is read: a dish whose sold-out time has passed shows as available, an expired special disappears. `/api/tick` applies due scheduled sets, writes the matching `auto` sets so the log is complete, sends reminders for sets due within 24 hours and expires stale proposals. It runs from Vercel Cron and at the start of every Telegram webhook call for that venue. "Until tomorrow's opening" and "until closing today" are computed from the venue's hours and holidays in its time zone, never by the model.
- **Bilingual content.** Every text field is stored in Bulgarian and English. When the owner writes one language, the agent writes the other; the preview shows both. The site has a BG/EN toggle, the bot and the dashboard follow the owner's language (`/lang bg|en`).
- **Allergens.** The 14 EU allergens (Regulation (EU) 1169/2011, Annex II) with a keyword check in both languages. New or renamed dishes are checked and warnings appear in the preview. The menu shows the codes with a legend. The check is advisory.
- **Multi-venue.** One deployment, many venues. `npm run venue:create` makes a venue and prints one-use invite codes (owner and staff) and the admin link. Staff can mark dishes sold out and add today's specials; everything else needs the owner.

```
Owner's phone ── Telegram ──► POST /api/telegram (Next route, webhook secret)
                                 │ after(): agent turn
                                 ▼
                     Next.js app on Vercel  (one deployment, many venues)
                     ├─ app/[slug]            public site: home + menu (BG/EN, realtime)
                     ├─ app/admin/[slug]      owner dashboard (?key=TOKEN): QR, approvals, schedule, log, undo
                     ├─ app/api/telegram      grammY webhookCallback
                     ├─ app/api/tick          due scheduled sets, auto sets, reminders (cron + per-webhook)
                     └─ src/
                         agent/   Anthropic tool runner, prompt, tools, memory
                         domain/  change ops apply/invert, preview, allergens, hours, pricing, i18n copy
                         bot/     commands, media, voice, approval buttons
                         store/   Store interface: Supabase (prod) + memory (tests, offline mode)
                                 │ service-role key (server only)
                                 ▼
                     Supabase: Postgres + RLS + Realtime + Storage(media)
                                 ▲ anon key (browser): public reads and realtime "refetch now" signals
```

The public pages and the dashboard read through the app's own server routes (`/api/site/[slug]`, `/api/admin/[slug]`), so the whole web layer also runs on the in-memory store.

## Run locally

Requirements: Node 22 or newer.

```bash
npm install
cp .env.example .env.local
npm run env:set -- ANTHROPIC_API_KEY   # asks for the value with echo off, writes it only into .env.local
```

`npm run env:set` with no argument lists the keys and asks which one to fill. `.env.local` is git-ignored.

| Key | Where to get it | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Yes (the agent) |
| `AGENT_MODEL` | Default `claude-opus-5-5` | No |
| `AGENT_EFFORT` | `low`, `medium` (default) or `high`; image, bulk and scheduling turns use `high` automatically | No |
| `TELEGRAM_BOT_TOKEN` | @BotFather in Telegram → `/newbot` | Yes |
| `TELEGRAM_WEBHOOK_SECRET` | Any random string: `openssl rand -hex 32` | Yes |
| `STT_API_KEY` | console.groq.com → API keys (free tier) or an OpenAI key | No: without it, voice notes get a polite "please type it" |
| `STT_BASE_URL` | Default `https://api.groq.com/openai/v1`; OpenAI: `https://api.openai.com/v1` | No |
| `STT_MODEL` | Default `whisper-large-v3`; OpenAI: `whisper-1` | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API → anon public key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → service_role key (server only) | Yes |
| `SUPABASE_DB_URL` | Supabase project → Settings → Database → Connection string (URI) | Only for `npm run db:apply` |
| `PUBLIC_BASE_URL` | `http://localhost:3000` locally; the deployment URL in production (no trailing slash). Used in admin links, QR codes and bot messages | Yes |
| `TICK_SECRET` | Any random string: `openssl rand -hex 32` | Yes |
| `DEMO_VENUE_SLUG` | Default `agala` | No |
| `NEXT_PUBLIC_LANDING_URL` | The published Lovable landing (`https://…`). When set, `/` redirects there. Read at build time | No |
| `META_APP_SECRET` | Meta app → App settings → Basic → App secret. Verifies webhook signatures ([docs/CHANNELS.md](docs/CHANNELS.md)) | With any Meta token |
| `META_VERIFY_TOKEN` | Any random string (`openssl rand -hex 16`), also pasted into the app's Webhooks "Verify token" field | With any Meta token |
| `META_PAGE_TOKEN` | Meta app → Messenger → Access Tokens → Generate token for the Page. Enables Messenger and Instagram | No: without it, no Messenger/Instagram |
| `WHATSAPP_TOKEN` | Meta app → WhatsApp → API Setup (24 h) or a system-user token (permanent). Enables WhatsApp | No: without it, no WhatsApp |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup → Phone number ID | With `WHATSAPP_TOKEN` |
| `MESSENGER_PAGE_HANDLE` | The Page username, for the `m.me/<handle>?ref=<code>` invite link | No (link only) |
| `INSTAGRAM_USERNAME` | The Instagram professional account's username, for the `ig.me/m/<user>?ref=<code>` link | No (link only) |
| `WHATSAPP_NUMBER` | The WhatsApp number with country code, for the `wa.me/<digits>?text=<code>` link | No (link only) |
| `DEMO_OWNER_CHAT_REF` | Memory mode only, not in `.env.example`: links that chat as the demo owner, e.g. `fb:4242` or `tg:<chat id>` (for `npm run meta:sim`) | No |

Offline mode also reads keys that are not in `.env.example`: `SITE_MANAGER_STORE=memory` (set by the scripts below), `DEMO_OWNER_CHAT_REF` (optional: links that chat, on any channel, as the demo owner in the memory store) and the older `DEMO_OWNER_CHAT_ID` (the same for a Telegram chat id).

### Offline mode (no keys, no database)

```bash
npm run e2e           # the demo sequence against the in-memory store; ends with "OFFLINE E2E OK"
npm run dev:offline   # the site at http://localhost:3000/agala; the dev log prints the admin link
npm test              # unit and integration tests
```

`dev:offline` seeds the demo café in memory on every start (changes are lost when it stops). The agent and the phone need the real mode.

### Real mode (Supabase, Telegram, Anthropic)

```bash
npm run db:apply      # applies supabase/schema.sql and policies.sql (idempotent)
npm run check:rls     # proves with the anon key what the browser can and cannot do; every line must say PASS (or SKIP before the demo venue exists)
npm run venue:create -- --name "Кафене „Ъгъла“" --slug agala --lang bg --seed demo
```

On a database created before the channels change, run the `chat_ref` migration before `db:apply` (see [docs/CHANNELS.md → Database migration](docs/CHANNELS.md#database-migration)).

`venue:create` prints the site URL, the admin link and two one-use invite codes (owner and staff, valid 7 days) once. Keep them; they are not shown again. With `--seed demo` the demo café's own name and menu are used. Without it you get an empty venue with default hours and `--name` is required.

Then, in two terminals:

```bash
npm run dev           # the site and the dashboard on http://localhost:3000
npm run bot:dev       # the bot, by long polling (refuses to start while a webhook is set)
```

On the phone, open the bot and send `/start <owner code>`. The bot links the chat as the owner and replies with the admin link and a short guide. Other commands: `/lang bg|en`, `/help`, `/menu` (public, menu and dashboard links), `/undo`.

Other scripts:

| Command | What it does |
|---|---|
| `npm run demo:reset` | Wipes the demo venue's content and change log, re-seeds the menu, texts, hours and theme. Linked phones, invite codes and the admin link stay. |
| `npm run smoke -- --dry` | One real agent turn ("Капучиното става 3,20" by default, `--text "…"` to change it) against an in-memory demo venue; prints the model, effort, reply and resulting proposal. |
| `npm run smoke -- --chat <chat id>` | The same against Supabase, with the preview really sent to that linked Telegram chat. |
| `npm run cleanup:test-venues` | Deletes venues whose slug starts with `test-` (left by the live store contract test) and their images. |
| `npm run telegram:set-webhook -- --delete` | Removes the webhook so `bot:dev` can poll again. |

## Channels: Telegram, Messenger, Instagram, WhatsApp

The owner can use Facebook Messenger, Instagram Direct or WhatsApp instead of Telegram, with the same invite code, the same agent and the same three approval buttons. One Facebook Page, one Instagram professional account and one WhatsApp number serve every venue. A channel is on when its token is set (`META_PAGE_TOKEN` for Messenger and Instagram, `WHATSAPP_TOKEN` for WhatsApp); without them the app is Telegram-only.

- **Identity.** A chat is a `chat_ref`: `tg:<chat id>`, `fb:<PSID>`, `ig:<id>`, `wa:<digits>`. Incoming messages from every channel go through one function (`handleInbound`, `src/bot/inbound.ts`); outgoing ones through `ChannelRouter` (`src/channels/router.ts`).
- **Webhook.** `POST /api/meta` serves all three Meta channels (signature check with `META_APP_SECRET`, `GET` verification with `META_VERIFY_TOKEN`).
- **The 24-hour rule.** Meta channels only accept messages within 24 hours of the owner's last one. Replies and previews always arrive; reminders and other messages the service starts on its own are skipped on Meta channels when the owner has been silent that long (Telegram gets them all).
- **Invite links.** `npm run venue:create` prints one link per enabled channel (`startLinks`, `src/channels/links.ts`): `t.me/<bot>?start=<code>`, `m.me/<page>?ref=<code>`, `ig.me/m/<user>?ref=<code>`, `wa.me/<digits>?text=<code>`. Sending the bare code also links a chat.
- **Scripts.** `npm run meta:setup` (checks the tokens, subscribes the Page, prints the webhook URL), `npm run meta:sim -- fb text "…"` (a signed fake webhook against `npm run dev:offline`), `npm run db:dry-run` (the `chat_ref` migration inside a rolled-back transaction).

Setup, step by step (Meta app, tokens, Testers, webhooks, App Review, WhatsApp test number, Vercel preview, database migration): **[docs/CHANNELS.md](docs/CHANNELS.md)**.

## Landing page (Lovable)

The public marketing landing is built in [Lovable](https://lovable.dev) from the prompt pack in [docs/lovable/LANDING-PROMPT.md](docs/lovable/LANDING-PROMPT.md) (bilingual copy, the pitch facts, design tokens and the demo link). After publishing it in Lovable, set `NEXT_PUBLIC_LANDING_URL` to its address and redeploy: `/` then redirects there. The variable is baked in at build time, so setting it without a redeploy changes nothing. Without it, the app's own `/` renders a short fallback landing.

## Deploy to Vercel

1. Install and log in: `npm i -g vercel`, then `vercel login`.
2. Link the project from this folder: `vercel link`.
3. Add every required key from the table above for Production, either in the Vercel dashboard (Project → Settings → Environment Variables) or one by one with `vercel env add ANTHROPIC_API_KEY production` (it asks for the value). `SUPABASE_DB_URL` is not needed on Vercel.
4. Add `CRON_SECRET` with the same value as `TICK_SECRET`. Vercel Cron sends it as `Authorization: Bearer …`, and `/api/tick` accepts that.
5. Deploy: `vercel --prod`. Note the deployment URL.
6. Set `PUBLIC_BASE_URL` to that URL (`https://<deployment>`, no trailing slash) and deploy again (`vercel --prod`). If you have the Lovable landing, set `NEXT_PUBLIC_LANDING_URL` before this deploy too.
7. Point Telegram at the deployment: `npm run telegram:set-webhook -- https://<deployment>` (it appends `/api/telegram` and the webhook secret). Stop any `bot:dev` first; Telegram allows a webhook or polling, never both.
8. Check the tick: `curl -H "x-tick-secret: <TICK_SECRET>" https://<deployment>/api/tick` should answer `{"ok":true,…}`.
9. If the venue was created against `http://localhost:3000`, its admin link changes only in the host: replace it with the deployment URL (the key stays the same).

Cron: `vercel.json` runs `/api/tick` once a day (`0 3 * * *`), because the Hobby plan allows only daily crons. Nothing visible depends on it: sold-out returns and expired specials are computed when the page is read, and every webhook call runs the tick for its venue. On Pro you can change the schedule to `*/5 * * * *`, or call the tick every 5 minutes from Supabase with `pg_cron` + `pg_net` using `supabase/cron.sql`. The webhook route has `maxDuration = 300`; the agent runs after the response (`after()`), so Telegram never retries.

## Demo-day checklist

- [ ] Exactly one of: the webhook is set to the deployment, **or** `npm run bot:dev` is running (never both). `npm run telegram:set-webhook -- --delete` switches to polling.
- [ ] `npm run demo:reset` (clean menu and change log; the phone stays linked).
- [ ] Phone on Telegram with the bot chat open, already linked as the owner (`/start <owner code>` done once).
- [ ] Projector on `https://<deployment>/agala` (or `http://localhost:3000/agala`).
- [ ] The admin page (the link from `venue:create` or the bot's `/start` reply) open in a second tab.
- [ ] The whiteboard photo and the new cover photo ready in the phone's gallery.
- [ ] Backup: if voice fails, type the same sentence. If something goes wrong on stage, `/undo` reverts the last change.
- [ ] Rehearse the full script once and run `npm run demo:reset` again.
- [ ] Messenger/Instagram/WhatsApp: the owner's account is a Tester on the Meta app; send the code via the deep link from `venue:create`.

## Security notes

- **Anon key (in the browser).** It can read only the public site tables (`venues`, `site_texts`, `categories`, `items`, `holidays`, `announcements`, `media`). It cannot read members, invites, admin tokens, change sets, changes or conversations, and every write is refused by the grants (`42501`). `npm run check:rls` proves this against the live project.
- **Service-role key.** Only in server code (`src/server/deps.ts`, the route handlers) and the scripts. The build is checked for it: `grep -rl "SUPABASE_SERVICE_ROLE\|service_role" .next/static` finds nothing.
- **The admin link is the key.** Whoever has `/admin/<slug>?key=…` can approve, cancel and undo changes for that venue. Share it only with the owner. The dev server's request log skips admin URLs, the admin API, the tick and any URL with `?key=`.
- **Webhook secret.** `/api/telegram` rejects any request without Telegram's `X-Telegram-Bot-Api-Secret-Token` header matching `TELEGRAM_WEBHOOK_SECRET`. `/api/tick` needs `TICK_SECRET` (header or Bearer) or a venue's admin key (that venue only).
- **Telegram file URLs** contain the bot token, so they are never logged. Photos are downloaded server-side and stored in Supabase Storage (the site uses the Storage public URL); voice notes are downloaded, transcribed and not stored.
- **Invite codes** are one-use and expire after 7 days.

## Known gaps

- Only the venue's own site is managed: no delivery apps, no Google Business profile.
- Voice uses a third-party transcription service (Groq or OpenAI).
- Allergen detection is keyword-based and advisory.
- The demo venue is fictional.
- Payments and billing for selling the service are out of scope.
- Vercel Hobby cron is daily (see Deploy); minute-precise scheduling needs Pro or `supabase/cron.sql`.
- Overnight opening hours (closing after midnight) are not supported yet: `set_hours` requires open < close on the same day.
- The offline memory mode never renders photos: its `memory://` URLs are not served.

## What is verified

Checked on 2026-10-10 on this branch:

- `npm test`: 170 tests pass (26 files). One file is skipped by default: the live Supabase store contract, which runs only with `SUPABASE_CONTRACT=1`.
- `npx tsc --noEmit` and `npm run lint`: clean.
- `npm run e2e`: the demo sequence offline (proposal and approve, instant sold-out, a special until closing, scheduled holidays, undo, a bulk change applied from the dashboard, the tick writing auto sets and applying the schedule): `OFFLINE E2E OK`.
- `npx next build`: succeeds; no service-role key and no bot token in `.next/static`.
- Live against the real Supabase project: `db:apply`, `cleanup:test-venues`, `venue:create --seed demo` (the `agala` venue), `demo:reset`, and `check:rls` with all 13 checks passing.
- `npm run smoke -- --dry`: a real Anthropic call (`claude-opus-5-5`, effort `medium`) turned "Капучиното става 3,20" into a `set_price` proposal 2,90 € → 3,20 € with the approval buttons.
- The production build served locally against live Supabase: `/agala` and `/agala/menu` render the demo menu, the admin page answers with a valid key, a wrong key and a tick without a secret get 401.
- `npm run dev:offline` serves `/agala` from the in-memory store.
- The bot token is valid (`getMe` answers as @restaurant_site_manager_bot).
- Channels branch (`build/channels`), offline: `npm test` 229 tests pass (37 files, 1 skipped), `npm run typecheck` and `npm run lint` clean; `npm run e2e` (`OFFLINE E2E OK`) includes the Messenger leg (a `fb:` owner links with a bare code, taps apply, a proactive reminder inside the 24 h window is sent and one after 25 h of silence is skipped); `npm run meta:sim -- fb text "help"` against `npm run dev:offline` answered `200 EVENT_RECEIVED` and the reply appeared as `→ [fb:4242] …`.
- Channels branch, `chat_ref` migration on the live (shared) database: the first `npm run db:dry-run` caught a defect (`drop not null` on a primary-key column before the key swap), fixed in the migration; then the dry run passed (alone and with `schema.sql` + `policies.sql`, including production's Telegram-only upserts), and `db:apply -- supabase/migrations/2026-10-10-chat-ref.sql`, `db:apply` and `check:rls` (16 × PASS) ran. Live: 0 rows without `chat_ref` in `venue_members` (1 row) and `conversations` (1 row), both primary keys on `(venue_id, chat_ref)`, 3 `fill_chat_ref` triggers.
- Channels branch, Vercel preview: deployed, alias https://site-manager-channels-biskwida.vercel.app; the public URL is behind Vercel Authentication (`302`). The same build with `next start` answered the webhook handshake with `ping`, a wrong verify token with `403` and an unsigned `POST /api/meta` with `401`.
- The Vercel production deployment at https://site-manager-lovat.vercel.app: the environment is set, `/agala` answers 200 with the live menu, `/api/tick` answers 401 without the secret and a tick report with it, and the Telegram webhook points at `/api/telegram`.

## What is not verified

- The real phone run: `/start` with an invite code, voice notes, the whiteboard photo, the cover photo, the approval buttons and `/undo` on a phone have not been run end to end against the deployment.
- The Lovable landing is not published yet, so the `/` redirect has not been seen with a real `NEXT_PUBLIC_LANDING_URL`.
- Voice transcription with the configured provider and image turns at `high` effort were not part of the live smoke run.
- The preview cannot receive Meta webhooks yet: it is behind Vercel Authentication (`302`). Set Project → Settings → Deployment Protection → Vercel Authentication to "Only Production Deployments", or create a "Protection Bypass for Automation" secret and append `?x-vercel-protection-bypass=<secret>` to the callback URL in the Meta app.
- The preview's `META_APP_SECRET` is a random placeholder (made for `meta:sim`); replace it with the real App secret: `printf '%s' "<secret>" | vercel env add META_APP_SECRET preview --force` (never typed into chat), then redeploy.
- Messenger, Instagram and WhatsApp live: the Meta app, Page, Instagram account and tokens do not exist yet. Remaining, in order (details in [docs/CHANNELS.md](docs/CHANNELS.md)): create the Page, the Instagram professional account and the Meta app; `npm run env:set --` `META_APP_SECRET` (the current value is a random placeholder for `meta:sim`), `META_PAGE_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `MESSENGER_PAGE_HANDLE`, `INSTAGRAM_USERNAME`, `WHATSAPP_NUMBER` (keep or replace `META_VERIFY_TOKEN`), copy them to the preview and redeploy; paste `https://site-manager-channels-biskwida.vercel.app/api/meta` and the verify token into Messenger → Webhooks, Instagram → Webhooks and WhatsApp → Configuration; `npm run meta:setup`; add the owner as Tester (Facebook and Instagram, accepted) and as a WhatsApp test recipient; then `venue:create -- --name "Тест Канали" --slug kanali-test` and the phone run per channel (link, text → preview → ✅, a voice note, a photo, a dashboard undo inside the window).
