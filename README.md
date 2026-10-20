# Claudia (repo: site-manager)

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

## Creating a site with the wizard

Anyone can create a venue site at `/new` (linked from the landing). The owner picks one of six templates, each shown live with the demo café:

- `classic`: warm, editorial pages on cream paper (cafés, restaurants).
- `nocturne`: dark and bold, for bars and evening venues.
- `lumen`: light and airy, photos first, for specialty coffee.
- `furna`: warm and homely, with each tray from the oven by the hour, for bakeries and breakfast places.
- `mehana`: wine red, an embroidery border and the menu course by course, for taverns and Bulgarian kitchens.
- `kvartal`: Swiss grid, huge type and a numbered menu, for brunch by day and cocktails by night.

The owner then fills seven steps with the chosen template rendering their data on the right: Basics (name, web address, main language, contact), Look (accent colour, logo, cover), Hours, Menu (type it, or upload photos or a PDF of the current menu and let Claude read it into a review list you accept row by row), Texts (both languages; "Write for me" drafts all of them from a few facts), Photos (gallery), Review. "Create my site" makes the venue live in our database and shows a one-use Telegram code with a QR (`https://t.me/<bot>?start=<code>`; with more apps enabled, one link per app, see [Channels](#channels-telegram-messenger-instagram-whatsapp)). Pressing Start in Telegram links the owner's chat as the owner and, when `VERCEL_TOKEN` is set, starts the deploy: a new Vercel project named after the slug, built from the thin template shell, polled until READY; the bot then messages "your site is live" with the URL and the done page shows it. The deploy finishes without anyone watching: after Start (and after a template switch) the server polls the deployment every 10 s for up to 4 minutes inside `after()`, and the 5-minute cron, the done page and the dashboard (both nudge `POST /api/tick?key=`) cover anything slower. A chat that is already linked (to the demo café, say) can redeem the new code: the bot answers "You now manage <name>." and the chat moves to the new venue. Coming back to `/new` in the same browser offers "Continue your draft"; the Look step switches templates without starting over (an accent still on the old template's default follows the new template's default; the dashboard's template switch does the same), and a failed publish has a "Try again" button on the dashboard. From that moment the Telegram agent manages the content; the deployed site reads `/api/site/<slug>` every 10 s (server) and 5 s (client), so a price change from Telegram is visible on it in seconds. Content never needs a new deployment; only a template switch redeploys.

Guards:

- Drafts live in `venues.wizard_draft`, reachable only with a token in an httpOnly cookie (`sm_draft`, 7 days); the database keeps the token's SHA-256 only.
- `POST /api/new` allows 5 drafts per IP per hour (the IP is hashed with `RATE_SALT`) and `MAX_SITES_PER_DAY` new drafts per day in total.
- The two AI helpers (menu extraction, "Write for me") use the existing `ANTHROPIC_API_KEY` and are limited to 20 calls per draft per hour and 500 per day across all drafts.
- Uploads are capped at 4 MB per image (the browser downscales photos before sending them) and 30 images per draft; menu extraction accepts up to 6 files and 3 MB in total. Photos and PDFs sent for extraction go to Claude and are not stored; only images the owner places on the site are saved.
- Abandoned drafts are deleted after 48 h, with their stored images, by the global tick (the cron; per-venue ticks skip this).

- "Import photos from Instagram" (Photos step, and under the cover in Look) signs the owner in to their own Instagram professional account and copies the photos they pick; see [Instagram import](#instagram-import).

Without `ANTHROPIC_API_KEY` the wizard still works: the AI routes answer 503 and the two AI buttons are replaced by a one-line explanation. With `SITE_MANAGER_STORE=memory` the fake deployer reports READY after two polls at `https://<slug>.example.test`, so the whole flow runs offline. The fake deployer is offline-only: in production, per-venue Vercel projects need `VERCEL_TOKEN`. Without it no project is created and every site is served from the hosted `<PUBLIC_BASE_URL>/<slug>`: the done page shows that address as live once the owner pressed Start, a template switch applies at once, and custom domains answer "not available on this server".

## Demo (3 minutes): wizard to live site

| # | You do | What happens |
|---|---|---|
| 1 | Open `/new` on the projector | Six live cards: the demo café in Classic, Nocturne, Lumen, Furna, Mehana and Kvartal. |
| 2 | Pick Nocturne, type the name and address | The right pane is the bar's site, updating as you type; the web address fills itself from the name. |
| 3 | Menu step: upload a photo of the printed menu | "Reading your menu…", then a review list in Bulgarian and English with EUR prices (BGN converted and flagged) and allergen codes. Accept all. |
| 4 | Texts: type two facts, press "Write for me" | Tagline, about, greeting and footer in both languages appear in the fields and on the preview. |
| 5 | Review → "Create my site" | The done page: a QR code and `/start <code>`. "Press Start in Telegram to publish." |
| 6 | Phone: scan, press Start | The bot welcomes the owner, then: "Сайтът ви се публикува…". The done page polls; within 2–3 minutes the bot sends "🎉 Сайтът на … е готов: https://…" and the done page shows the link. |
| 7 | Open the live URL on the projector | The deployed site on its own Vercel project. |
| 8 | Phone: "Негронито става 11" → ✅ | Within 15 s the price changes on the deployed site. |

The phone may already be linked to the demo café: Start with the new code moves it to the new venue ("Вече управлявате …"), so one phone does both demos; send `/start <demo owner code>` afterwards to move it back.

Offline (`npm run dev:offline`, fake deployer) steps 1–5 and the dashboard run in the browser. Pressing Start needs the real bot (a token and a webhook or `bot:dev`), so offline the Telegram half of the flow is covered by the tests (`test/server-deps.test.ts`, `test/bot.test.ts`), not by hand.

## How it works

- **Change sets.** Every edit is a change set: a list of typed changes (`set_price`, `set_sold_out`, `add_item`, `update_item`, `remove_item`, image ops, `set_hours`, holidays, announcements, `set_text`, `set_theme`) with a before and after snapshot of each entity. Nothing touches the site except through one, so every edit is previewable, logged and undoable. Undo is a new set with the inverse changes; the original is marked `reverted`.
- **Approval policy.** Marking a dish sold out is instant (and undoable). Everything else is a preview in the owner's language with three buttons: ✅ Apply, ✏️ Change (the next message corrects the proposal), ❌ Cancel. One open proposal per chat; proposals expire after 2 hours. The owner's dashboard offers the same decisions, and a "Preview on the site" link that renders the proposal on the real pages under a "Draft preview" banner.
- **Time without a server process.** Vercel has no always-on process, so the public site computes availability when it is read: a dish whose sold-out time has passed shows as available, an expired special disappears. `/api/tick` applies due scheduled sets, writes the matching `auto` sets so the log is complete, sends reminders for sets due within 24 hours and expires stale proposals. It also polls deployments in flight and, on the global run only, deletes abandoned wizard drafts. It runs from Vercel Cron (every 5 minutes), at the start of every Telegram webhook call for that venue, and when the done page or the dashboard nudges it with the owner's key while a deploy is in flight. "Until tomorrow's opening" and "until closing today" are computed from the venue's hours and holidays in its time zone, never by the model.
- **Bilingual content.** Every text field is stored in Bulgarian and English. When the owner writes one language, the agent writes the other; the preview shows the owner's language only and ends with one line saying the other version was written. The site has a BG/EN toggle, the bot and the dashboard follow the owner's language (`/lang bg|en`).
- **Allergens.** The 14 EU allergens (Regulation (EU) 1169/2011, Annex II) with a keyword check in both languages. New or renamed dishes are checked and warnings appear in the preview. The menu shows the codes with a legend. The check is advisory.
- **Multi-venue.** One deployment, many venues. `npm run venue:create` makes a venue and prints one-use invite codes (owner and staff) and the admin link. Staff can mark dishes sold out and add today's specials; everything else needs the owner.

```
Owner's phone ── Telegram ──► POST /api/telegram (Next route, webhook secret)
                                 │ after(): agent turn
                                 ▼
                     Next.js app on Vercel  (one deployment, many venues)
                     ├─ app/[slug]            public site in the venue's template: home + menu (BG/EN, polls the feed)
                     ├─ app/new               the wizard: template, seven steps with a live preview, publish
                     ├─ app/admin/[slug]      owner dashboard (?key=TOKEN): QR, approvals, schedule, log, undo
                     ├─ app/api/new           wizard API: drafts, media, publish, deploy status, AI helpers
                     ├─ app/api/site/[slug]   public JSON feed (live venues only, CORS open)
                     ├─ app/api/telegram      grammY webhookCallback
                     ├─ app/api/tick          due scheduled sets, auto sets, reminders, deploy polling, draft cleanup
                     └─ src/
                         agent/     Anthropic tool runner, prompt, tools, memory
                         domain/    change ops apply/invert, preview, allergens, hours, pricing
                         bot/       commands, media, voice, approval buttons, bot copy
                         templates/ classic, nocturne, lumen, furna, mehana, kvartal (shared with the deployed sites)
                         wizard/    draft schema, menu extraction, text drafting
                         deploy/    Vercel deployer (+ fake), file manifest of the thin site shell
                         store/     Store interface: Supabase (prod) + memory (tests, offline mode)
                                 │ service-role key (server only)          │ VERCEL_TOKEN (server only)
                                 ▼                                         ▼
                     Supabase: Postgres + RLS + Storage(media)     Vercel: one project per venue
                                 ▲ anon key: read-only, live venues        (thin shell + template, reads
                                                                           /api/site/<slug> every 10 s / 5 s)
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
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Yes (the agent; the wizard's menu reading and "Write for me" use it too) |
| `AGENT_MODEL` | Default `claude-opus-5-5` | No |
| `AGENT_EFFORT` | `low`, `medium` (default) or `high`; image, bulk and scheduling turns use `high` automatically | No |
| `LANG_CLASSIFY_MODEL` | Default `claude-haiku-5-5`. Names the language of Latin text of four words or more (and marker-less Cyrillic from a member not stored as Bulgarian), so Claudia answers in the language the owner writes in | No |
| `TRANSLATE_MODEL` | Default `claude-haiku-5-5`. Translates what Claudia sends to a member whose language is neither Bulgarian nor English (cached per message; links, prices and venue names are never sent to it) | No |
| `TELEGRAM_BOT_TOKEN` | @BotFather in Telegram → `/newbot` | Yes |
| `TELEGRAM_WEBHOOK_SECRET` | Any random string: `openssl rand -hex 32` | Yes |
| `STT_API_KEY` | console.groq.com → API keys (free tier) or an OpenAI key | No: without it, voice notes get a polite "please type it" |
| `STT_BASE_URL` | Default `https://api.groq.com/openai/v1`; OpenAI: `https://api.openai.com/v1` | No |
| `STT_MODEL` | Default `whisper-large-v3`; OpenAI: `whisper-1`. Must be a Whisper model that returns `verbose_json` with the language it heard (`whisper-large-v3-turbo` works too): that label is how a voice note in any language is told apart. OpenAI's gpt-4o transcribe models answer `json` only and are not supported | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API → anon public key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → service_role key (server only) | Yes |
| `SUPABASE_DB_URL` | Supabase project → Settings → Database → Connection string (URI) | Only for `npm run db:apply` |
| `PUBLIC_BASE_URL` | `http://localhost:3000` locally; in production the app's production domain (no trailing slash), never a preview URL: it is copied into every venue project as `SITE_MANAGER_URL` (where the deployed site reads its feed) and used in admin links, QR codes and bot messages | Yes |
| `TICK_SECRET` | Any random string: `openssl rand -hex 32` | Yes |
| `DEMO_VENUE_SLUG` | Default `agala` | No |
| `NEXT_PUBLIC_CONTACT_EMAIL` | The address the landing page (`/`) shows as "Talk to us" in its closing section, as selectable text. Hidden when empty | No |
| `VERCEL_TOKEN` | vercel.com → Settings → Tokens → Create: set the scope to the **team** that owns the site projects, never a full-account token; expiry per your policy. The wizard creates one Vercel project per venue with it. Server-only | For per-venue Vercel projects; without it sites are served from the hosted `/<slug>` (the fake deployer is used only with `SITE_MANAGER_STORE=memory`) |
| `VERCEL_TEAM_ID` | Vercel → Team Settings → General → Team ID (`team_…`). Needed with a team-scoped token; empty for a personal account | With `VERCEL_TOKEN` |
| `RATE_SALT` | Any random string: `openssl rand -hex 16`. Hashed with the visitor's IP for the wizard's rate limits, so raw IPs are never stored. When unset it falls back to `dev-salt`, which works but makes the hashes guessable | Yes in production |
| `MAX_SITES_PER_DAY` | Default `50`: the global cap on new wizard drafts per 24 h | No |
| `TELEGRAM_BOT_USERNAME` | The bot's username without `@` (from @BotFather). Builds the `https://t.me/<bot>?start=<code>` link and QR on the wizard's done page | For the done page's Start link; without it only the code is shown |
| `INSTAGRAM_APP_ID` | developers.facebook.com → your Business app → Instagram → API setup with Instagram login → **Instagram app ID** (not the Facebook app id). See [Instagram import](#instagram-import) | No: without it (or the secret) the wizard hides "Import photos from Instagram" |
| `INSTAGRAM_APP_SECRET` | The same page → **Instagram app secret**. Server-only, never `NEXT_PUBLIC_`; it also signs the OAuth `state` (through a derived key) | With `INSTAGRAM_APP_ID` |
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
npm run db:apply      # applies supabase/schema.sql, policies.sql, schema-integrations.sql and policies-integrations.sql (idempotent); with file arguments, only those
npm run check:rls     # proves with the anon key what the browser can and cannot do; every line must say PASS (or SKIP before the demo venue exists)
npm run venue:create -- --name "Кафене „Ъгъла“" --slug agala --lang bg --seed demo
```

On a database created before the channels change, run the `chat_ref` migration before `db:apply` (see [docs/CHANNELS.md → Database migration](docs/CHANNELS.md#database-migration)).

The conversation-language change widens `venue_members.lang` to any two-letter language code and adds the translation cache: apply before deploying this version: `npm run db:apply -- supabase/migrations/2026-10-16-chat-lang.sql`.

`venue:create` prints the site URL, the admin link and two one-use invite codes (owner and staff, valid 7 days) once. Keep them; they are not shown again. With `--seed demo` the demo café's own name and menu are used. Without it you get an empty venue with default hours and `--name` is required. `--site-url https://…` marks the venue as having its own site (see [Venues with their own site](#venues-with-their-own-site)).

Then, in two terminals:

```bash
npm run dev           # the site and the dashboard on http://localhost:3000
npm run bot:dev       # the bot, by long polling (refuses to start while a webhook is set)
```

On the phone, open the bot and send `/start <owner code>`. The bot links the chat as the owner and replies with the admin link and a short guide. Other commands: `/lang bg|en`, `/help`, `/menu` (public, menu and dashboard links), `/undo`.

Other scripts:

| Command | What it does |
|---|---|
| `npm run invite:create -- --slug my-cafe [--role owner\|staff] [--site-url https://…]` | A one-use invite for an existing venue: reuses the open invite for that role or creates one (valid 7 days), and prints the code and links once. `--site-url` sets the venue's own site first. |
| `npm run demo:reset` | Wipes the demo venue's content and change log, re-seeds the menu, texts, hours and theme. Linked phones, invite codes and the admin link stay. |
| `npm run smoke -- --dry` | One real agent turn ("Капучиното става 3,20" by default, `--text "…"` to change it) against an in-memory demo venue; prints the model, effort, reply and resulting proposal. |
| `npm run smoke -- --chat <chat id>` | The same against Supabase, with the preview really sent to that linked Telegram chat. |
| `npm run cleanup:test-venues` | Deletes venues whose slug starts with `test-` (left by the live store contract test) and their images. |
| `npm run telegram:set-webhook -- --delete` | Removes the webhook so `bot:dev` can poll again. |
| `npm run wp:zip` | Rebuilds `public/wp/site-manager.zip` from `integrations/wordpress/site-manager` deterministically; `npm test` fails while the committed zip is stale. |
| `npm run wp:smoke` | Throwaway WordPress + MySQL in Docker: installs WP, renders the plugin's blocks from the production feed, then connect → preview → apply → undo → options → menus → rate limit → log through our code; `-- --keep` leaves it at http://localhost:8088, `-- --feed <url>` picks another feed. |
| `npm run test:templates` | Writes each template's thin shell to a temp dir, runs `npm install` (needs network) and `next build` there: the offline proof that a deployed site builds. Slow; not part of `npm test`. Run before a release. |
| `npm run site:delete -- --slug my-cafe` | Deletes a venue (typically one created by the wizard) and its Vercel project. Prints the venue and the project id and asks you to type the slug again before deleting. Storage objects are not removed. |
| `npm run venue:set -- --slug coffique --change-limit 60` | Sets a venue's monthly change limit (`--change-limit none` clears it) and prints the limit and this month's count. See "Monthly change limit". |

## Monthly change limit

Pricing plans include a number of changes per month: Menu plan 40, Everywhere plan 150 (Coffique, the first customer: 60). `venues.change_limit` holds it; `null`, the default, means unlimited.

- **One change** is one change set that reaches status `applied`, however many rows it has. Scheduled sets count when they are applied. A set that is applied and later undone still counts.
- **Never counted:** undo sets (undo is a safety feature and is never limited) and the automatic sets the tick writes when a sold-out mark or a special runs out. Rejected, expired and cancelled sets never reached `applied`.
- **The month** is the calendar month in the venue's time zone (`venue.tz`, e.g. Europe/Sofia), so it starts at local midnight on the 1st.
- **At the limit** the agent proposes nothing new (it relays "This month's limit of 60 changes is reached (60/60). New changes from 1 November."), and `applyChangeSet` refuses any counted set, including a scheduled one that comes due: the set becomes `cancelled` and the owner gets the same line. Every applied confirmation ends with "Changes this month: 12/60", and the dashboard's change log shows the count.

```bash
npm run venue:create -- --seed coffique --slug coffique --change-limit 60   # a new venue with its limit
npm run venue:set -- --slug coffique --change-limit 60                    # an existing venue
npm run venue:set -- --slug coffique --change-limit none                  # back to unlimited
```

The column comes from `supabase/schema.sql` (`npm run db:apply`); until it is applied every venue reads as unlimited.

## Instagram import

In the wizard's Photos step (and under the cover in Look) the owner can press "Import photos from Instagram": they sign in to **their own** Instagram Business or Creator account on instagram.com (Meta's official OAuth, "Instagram API with Instagram Login", scope `instagram_business_basic`), come back to a grid of their recent photos (images and carousel images, newest 50; videos are skipped), tick the ones they want and choose for each one: gallery, cover, logo or a dish on the menu. The picked images are copied into our media storage; nothing is scraped and no handle-only lookup exists.

How it is kept safe: the start route redirects to `https://www.instagram.com/oauth/authorize` with an HMAC-signed `state` (draft id, nonce, 10-minute expiry) and sets a matching httpOnly `sm_ig_nonce` cookie; the callback (`/api/new/instagram/callback`) checks the signature, the expiry, the nonce cookie and that the `sm_draft` cookie is the same draft, exchanges the code for a short-lived token server-side, reads the media once, stores only a sanitized list (`venues.instagram_import`: id, CDN URL, caption up to 280 characters, permalink, date) and drops the token: it is never stored, logged or sent to the browser. The list expires after an hour (Instagram's CDN URLs are signed and short-lived) and is cleared on publish. The import fetches only URLs from that stored list, only on `*.cdninstagram.com` / `*.fbcdn.net` over https (redirects re-checked), with a 10 s timeout, 4 MB per image on the actual bytes, the type sniffed from the bytes; it counts toward the 30-image draft cap and allows 10 imports per draft per hour. The public feed and `GET /api/new/<id>` never include the list, and `PUT /api/new/<id>` cannot set it.

Owner setup (once):

1. Apply the schema change: `npm run db:apply` (adds `venues.instagram_import`; publishing works without it, the import needs it).
2. developers.facebook.com → My Apps → Create app → type **Business** (Instagram Login needs a Business app).
3. Add the **Instagram** product → **API setup with Instagram login**.
4. Under "Set up Instagram business login" → **Business login settings** → **OAuth redirect URIs**: add exactly `<PUBLIC_BASE_URL>/api/new/instagram/callback`. For the current production deployment that is `https://site-manager-lovat.vercel.app/api/new/instagram/callback`. Meta generally wants https redirect URIs, so test on the deployment rather than `localhost`.
5. Copy the **Instagram app ID** and **Instagram app secret** from the same page (they differ from the Facebook app id and secret) and set them: `npm run env:set -- INSTAGRAM_APP_ID`, `npm run env:set -- INSTAGRAM_APP_SECRET`, and the same two in Vercel (Production). Redeploy.
6. While the app is in **Development** mode only accounts with a role on the app can sign in: App roles → Roles → add the café's Instagram account as an **Instagram Tester**, then accept the invite on instagram.com (Settings → Apps and websites → Tester invites; Meta moves this menu now and then). The account must be a Business or Creator account.
7. For cafés you do not manage: Meta requires **Advanced Access** to `instagram_business_basic`, which goes through **App Review** (a screencast of this flow, a privacy policy URL) and **Business verification** of the business that owns the app; then switch the app to **Live**. Check the current requirements in the App Dashboard's App Review section.

Without the two keys the button is hidden and `/api/new/<id>/instagram/*` answers 503 `instagram_unavailable`.

The Graph API version is pinned: `IG_GRAPH_URL = "https://graph.instagram.com/v25.0"` in `src/server/instagram.ts` (the version Meta's Instagram Login docs used on 2026-10-11). Meta supports each version for about two years and announces the retirement date in the App Dashboard and its changelog; bump the constant (and re-run one real import) before that date, or when a newer field or behaviour is needed.

## Channels: Telegram, Messenger, Instagram, WhatsApp

The owner can use Facebook Messenger, Instagram Direct or WhatsApp instead of Telegram, with the same invite code, the same agent and the same three approval buttons. One Facebook Page, one Instagram professional account and one WhatsApp number serve every venue. A channel is on when its token is set (`META_PAGE_TOKEN` for Messenger and Instagram, `WHATSAPP_TOKEN` for WhatsApp); without them the app is Telegram-only.

- **Identity.** A chat is a `chat_ref`: `tg:<chat id>`, `fb:<PSID>`, `ig:<id>`, `wa:<digits>`. Incoming messages from every channel go through one function (`handleInbound`, `src/bot/inbound.ts`); outgoing ones through `ChannelRouter` (`src/channels/router.ts`).
- **Webhook.** `POST /api/meta` serves all three Meta channels (signature check with `META_APP_SECRET`, `GET` verification with `META_VERIFY_TOKEN`).
- **The 24-hour rule.** Meta channels only accept messages within 24 hours of the owner's last one. Replies and previews always arrive; reminders and other messages the service starts on its own are skipped on Meta channels when the owner has been silent that long (Telegram gets them all).
- **Invite links.** `npm run venue:create` prints one link per enabled channel (`startLinks`, `src/channels/links.ts`): `t.me/<bot>?start=<code>`, `m.me/<page>?ref=<code>`, `ig.me/m/<user>?ref=<code>`, `wa.me/<digits>?text=<code>`. Sending the bare code also links a chat.
- **Owner setup in several apps.** The done page and the dashboard list one owner link per enabled app (`enabledApps` / `connectLinks`, `src/server/connect-apps.ts`): Telegram whenever `TELEGRAM_BOT_USERNAME` is set; WhatsApp, Messenger and Instagram only when `CHANNELS_ENABLED=true` **and** that channel's token (`WHATSAPP_TOKEN`, `META_PAGE_TOKEN`) and handle (`WHATSAPP_NUMBER`, `MESSENGER_PAGE_HANDLE`, `INSTAGRAM_USERNAME`) are set, so an owner is never sent to an app this deployment does not answer. With several apps the done page offers "Connect another app" after the first one links; the dashboard's "Your apps" card shows the linked chats per app (owners and staff) and "Connect another" makes a fresh single-use owner code (`new_owner_code`, rate-limited) for one more app or a second phone. Keep `CHANNELS_ENABLED=false` until the Meta webhooks point at this deployment.
- **Scripts.** `npm run meta:setup` (checks the tokens, subscribes the Page, sets the Messenger Get Started button, prints the webhook URL), `npm run meta:sim -- fb text "…"` (a signed fake webhook against `npm run dev:offline`), `npm run db:dry-run` (the `chat_ref` migration inside a rolled-back transaction).

Setup, step by step (Meta app, tokens, Testers, webhooks, App Review, WhatsApp test number, Vercel preview, database migration): **[docs/CHANNELS.md](docs/CHANNELS.md)**.

## Access

Who can manage a venue:

- **Owner.** Proposes and approves changes from the chat, gets the dashboard link (`/menu`, the welcome message), connects WordPress and social accounts, and can see who has access with `/members`.
- **Staff.** Marks items sold out and adds today's specials; no dashboard link, no `/members`.
- **The dashboard key.** `/admin/<slug>?key=…` works without any chat: whoever holds it can approve, cancel and undo changes.

**One code per person.** An invite code links one chat and is then used up; codes expire after 7 days. Give each person (and each extra phone or app) their own code, so you can later remove exactly that chat. A chat belongs to one venue at a time.

| To… | Run |
| --- | --- |
| See who has access and which codes are still open | `npm run member:list -- --slug coffique` (WhatsApp numbers show their last four digits; codes only their last four characters) |
| Remove one chat | `npm run member:remove -- --slug coffique --ref tg:123456` (WhatsApp: the full `wa:<digits>`, or `wa:…3456` as the list shows it). Refuses a chat that is not that venue's member. The bot then treats the chat as a stranger, and its pending proposals can no longer be applied. |
| Cancel codes that were not used yet | `npm run invite:cancel -- --slug coffique [--role owner\|staff]` (members already linked stay) |
| Replace the dashboard key | `npm run admin:rotate-key -- --slug coffique`. The old link stops working at once; the new one is printed once (keep it out of git and chat logs). The owner also gets it from the bot with `/menu`. |

Owners see the same list in the chat with `/members`; removing access is deliberately left to these scripts for now.

## Landing page

`/` is the getclaudia.app marketing page, part of this app (route group `app/(landing)/`, copy in `src/landing/copy.ts`, videos and pictures in `public/landing/`). It never redirects: signed out it shows "Log in" (to `/login`), signed in "Dashboard" (to `/dashboard`). Every button leads into onboarding: "Start free" to `/start?lang=`, each plan to `/start?plan=admin|social|both&lang=`. Its fonts and tokens load for that route group only (`app/(landing)/landing.css`, every class namespaced `lp-`), so the wizard, the dashboard and the venue sites look as before.

## Deploy to Vercel

1. Install and log in: `npm i -g vercel`, then `vercel login`.
2. Link the project from this folder: `vercel link`.
3. Add every required key from the table above for Production, either in the Vercel dashboard (Project → Settings → Environment Variables) or one by one with `vercel env add ANTHROPIC_API_KEY production` (it asks for the value). `SUPABASE_DB_URL` is not needed on Vercel. For the wizard also add `RATE_SALT`, `TELEGRAM_BOT_USERNAME` and, for real site deploys, `VERCEL_TOKEN` and `VERCEL_TEAM_ID`.
4. Add `CRON_SECRET` with the same value as `TICK_SECRET`. Vercel Cron sends it as `Authorization: Bearer …`, and `/api/tick` accepts that.
5. Apply the database migrations first (accounts, billing and the new venue columns): the exact order is in [docs/DOMAIN-SWITCH.md, "Database first"](docs/DOMAIN-SWITCH.md#a-database-first-before-deploying-this-branch), and the whole launch order (deploy, accounts, domain, billing) is at the top of that file. The code writes the new columns, so a deploy against an old database breaks publishing.
6. Deploy: `vercel --prod`. Note the deployment URL.
7. Set `PUBLIC_BASE_URL` to the production domain (`https://<deployment>`, no trailing slash; not a preview URL, because every venue project gets it as its feed origin) and deploy again (`vercel --prod`).
8. Point Telegram at the deployment: `npm run telegram:set-webhook -- https://<deployment>` (it appends `/api/telegram` and the webhook secret). Stop any `bot:dev` first; Telegram allows a webhook or polling, never both.
9. Check the tick: `curl -H "x-tick-secret: <TICK_SECRET>" https://<deployment>/api/tick` should answer `{"ok":true,…}`.
10. If the venue was created against `http://localhost:3000`, its admin link changes only in the host: replace it with the deployment URL (the key stays the same).

Cron: `vercel.json` runs `/api/tick` every 5 minutes (`*/5 * * * *`; the team is on Pro). On Hobby, which allows only daily crons, change it to `0 3 * * *` or call the tick every 5 minutes from Supabase with `pg_cron` + `pg_net` using `supabase/cron.sql`. Little depends on it: sold-out returns and expired specials are computed when the page is read, every webhook call runs the tick for its venue, a deploy is watched in the background for 4 minutes after it starts, and the done page and the dashboard nudge `POST /api/tick?key=` while a deploy is in flight. The cron finishes slower deploys and deletes abandoned drafts. The webhook route has `maxDuration = 300`; the agent runs after the response (`after()`), so Telegram never retries.

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

- **Anon key.** The browser no longer uses it: public pages, the dashboard and the wizard read through the app's own server routes. Its grants stay locked down anyway: it can read only live venues (and of `venues` only the public feed's columns, granted column by column; `deploy`, `wizard_draft`, `draft_token_hash`, `publishing_at` and `instagram_import` answer `42501`) and their public site tables (`venues`, `site_texts`, `categories`, `items`, `holidays`, `announcements`, `media`), never drafts, members, invites, admin tokens, change sets, changes, conversations or `rate_limits`; it cannot call `bump_rate_limit`; every write is refused (`42501`). `npm run check:rls` proves this against the live project.
- **Service-role key.** Only in server code (`src/server/deps.ts`, the route handlers) and the scripts. The build is checked for it: `grep -rl "SUPABASE_SERVICE_ROLE\|service_role" .next/static` finds nothing.
- **The admin link is the key.** Whoever has `/admin/<slug>?key=…` can approve, cancel and undo changes for that venue. Share it only with the owner; if it leaks, `npm run admin:rotate-key` replaces it (see [Access](#access)). The dev server's request log skips admin URLs, the admin API, the tick and any URL with `?key=`.
- **Webhook secret.** `/api/telegram` rejects any request without Telegram's `X-Telegram-Bot-Api-Secret-Token` header matching `TELEGRAM_WEBHOOK_SECRET`. `/api/tick` needs `TICK_SECRET` (header or Bearer) or a venue's admin key (that venue only).
- **Telegram file URLs** contain the bot token, so they are never logged. Photos are downloaded server-side and stored in Supabase Storage (the site uses the Storage public URL); voice notes are downloaded, transcribed and not stored.
- **Invite codes** are one-use and expire after 7 days. Reloading the done page shows the same open code instead of issuing a new one.
- **Public feed.** `/api/site/<slug>` sends the venue's public state only; the deploy record (provider ids, build errors) and the wizard draft are stripped.
- **Draft token.** A wizard draft is reachable only with the `sm_draft` httpOnly cookie (`<venue id>.<token>`); the database holds the token's SHA-256 only. Drafts are invisible to the anon key (the policies expose only `status = 'live'` venues; `npm run check:rls` proves it with a throwaway draft), and `/<slug>` renders a draft only for the browser holding its cookie.
- **Vercel token.** `VERCEL_TOKEN` is read only in `src/config.ts` and used only by the server-side deployer; it is never logged. The deployer logs short lines only (method, path, status, error code, project and deployment ids), never a Vercel response body, and `deploy.error` keeps a short message plus at most the last 20 build-log lines. Check a build with `grep -rl VERCEL_TOKEN .next/static` (it must find nothing).
- **Rate limits.** 5 new drafts per IP per hour and `MAX_SITES_PER_DAY` per day; 20 AI calls per draft per hour and 500 per day. The IP is hashed with `RATE_SALT` before it is stored; set `RATE_SALT` in production.
- **Uploaded menus.** Photos and PDFs sent for extraction go to Claude and are not stored; only images the owner places on the site are saved.
- **Instagram import.** The owner's Instagram access token exists only during the OAuth callback request: never stored, logged or sent to the browser. The app secret never leaves the server (the OAuth `state` is signed with a key derived from it). The callback path is excluded from the dev request log (its query holds the one-time code). Only Instagram CDN URLs from the list read at sign-in are ever fetched. See [Instagram import](#instagram-import).
- **Deleting a venue** never deletes its Vercel project automatically; `npm run site:delete` does both, with a typed confirmation.

## Known gaps

- Only the venue's own site is managed: no delivery apps, no Google Business profile. Integrations with existing sites (WordPress, embed, Google Business Profile, GitHub, Shopify/Wix) are parked in [docs/IDEAS.md](docs/IDEAS.md).
- Custom domains exist (dashboard → "Your own domain", Vercel deployer only) but have not been tried against a real domain.
- Deleting a venue with `site:delete` leaves its storage objects (images) in Supabase Storage; it says so and `scripts/cleanup-test-venues.mts` shows how to remove them. Abandoned drafts are cleaned up together with their images.
- Voice uses a third-party transcription service (Groq or OpenAI).
- Allergen detection is keyword-based and advisory.
- The demo venue is fictional.
- Payments and billing for selling the service are out of scope.
- The 5-minute cron needs Vercel Pro; on Hobby it must be daily (see Deploy).
- Overnight opening hours (closing after midnight) are not supported yet: `set_hours` requires open < close on the same day.
- The offline memory mode never renders photos: its `memory://` URLs are not served.
- Comment replies are polled (every 15 minutes per venue), not pushed: Meta delivers comment webhooks only to a Live app with Advanced Access (docs/CHANNELS.md, "Comment webhooks"). Replies to replies are not proposed; Facebook Page mentions and live videos are out of scope.

## What is verified

Checked on 2026-10-11 on `build/templates`:

- `npm test`: 434 tests pass (53 files). One file is skipped by default: the live Supabase store contract, which runs only with `SUPABASE_CONTRACT=1`.
- `npx tsc --noEmit` and `npm run lint`: clean.
- `SITE_MANAGER_STORE=memory npm run build`: succeeds; no service-role key, Vercel token or bot token in `.next/static`.
- `npm run e2e`: the demo sequence offline (proposal and approve, instant sold-out, a special until closing, scheduled holidays, undo, a bulk change applied from the dashboard, the tick writing auto sets and applying the schedule): `OFFLINE E2E OK`.
- Live against the real Supabase project (on `64cdf1f`, after the final fixes): `db:apply`, `check:rls` 19/19, the store contract (`SUPABASE_CONTRACT=1`) 23/23, including `deleteVenue` with storage, `findOpenInvite` and `claimDeploy` by deployment id.
- `npm run test:templates`: the classic, nocturne and lumen venue shells build standalone (on `2a75740`; classic rebuilt after the `<html lang>` change).
- `npm run test:templates`: all six venue shells (classic, nocturne, lumen, furna, mehana, kvartal) build standalone on `build/merge-main` (2026-10-11, after the final fix pass; template fonts use `preload: false`).
- Live Claude calls: menu extraction from a photo and "Write for me" return usable bilingual results; `npm run smoke -- --dry` turned "Капучиното става 3,20" into a `set_price` proposal 2,90 € → 3,20 €.
- `npm run dev:offline`: the chooser offers "Continue your draft" after a reload, and the Look step switches the preview between templates.
- The bot token is valid (`getMe` answers as @restaurant_site_manager_bot), and the Vercel production deployment at https://site-manager-lovat.vercel.app serves `/agala`, answers the tick and receives the Telegram webhook.
- Channels branch (`build/channels`), offline: `npm test` 241 tests pass (37 files, 1 skipped), `npm run typecheck` and `npm run lint` clean; `npm run e2e` (`OFFLINE E2E OK`) includes the Messenger leg (a `fb:` owner links with a bare code, taps apply, a proactive reminder inside the 24 h window is sent and one after 25 h of silence is skipped); `npm run meta:sim -- fb text "help"` against `npm run dev:offline` answered `200 EVENT_RECEIVED` and the reply appeared as `→ [fb:4242] …`.
- Channels branch, `chat_ref` migration on the live (shared) database: the first `npm run db:dry-run` caught a defect (`drop not null` on a primary-key column before the key swap), fixed in the migration; then the dry run passed (alone and with `schema.sql` + `policies.sql`, including production's Telegram-only upserts), and `db:apply -- supabase/migrations/2026-10-10-chat-ref.sql`, `db:apply` and `check:rls` (16 × PASS) ran. Live: 0 rows without `chat_ref` in `venue_members` (1 row) and `conversations` (1 row), both primary keys on `(venue_id, chat_ref)`, 3 `fill_chat_ref` triggers.
- Channels branch, Vercel preview (2026-10-11): https://site-manager-channels-biskwida.vercel.app with Vercel Authentication off; `GET /api/meta` handshake → `ping`, wrong verify token → `403`, unsigned `POST` → `401`. Live on a phone: WhatsApp (Meta test number) and Messenger (Page "Site Manager") each linked an owner of the `kanali-test` venue with a one-use code, and a working-hours change went through preview → ✅ → applied. `npm run meta:setup` now registers the app's webhook objects (`whatsapp_business_account`, `page`, `instagram`) and subscribes the WhatsApp Business Account to the app; without those two steps Meta delivered nothing.
- Merge of `origin/main` (templates + WordPress) into `build/channels` (2026-10-11), offline: `npx vitest run` 576 passed / 3 skipped (75 files, 1 skipped), `npm run typecheck` and `npm run lint` clean, `npm run build` succeeds with no service-role key, destination key or Meta secret in `.next/static`, `npm run e2e` `OFFLINE E2E OK`, `npm run wp:test` ALL PASSED. `/connect` now goes through `handleInbound`, so it works from Messenger, Instagram and WhatsApp too.

## What is not verified

- No real Vercel deploy yet: there is no `VERCEL_TOKEN`, so no venue project has been created, built and polled to READY, and no template-switch redeploy has run against Vercel.
- No live custom domain.
- The full loop (wizard → phone `/start` → deployed site → a Telegram edit showing on it) has not been run end to end.
- `npm run e2e` does not cover the wizard.
- The real phone run: `/start` with an invite code, voice notes, the whiteboard photo, the cover photo, the approval buttons and `/undo` on a phone have not been run end to end against the deployment.
- Voice transcription with the configured provider and image turns at `high` effort were not part of the live smoke run.
- Instagram live: the Instagram professional account is not yet linked to the Page as far as the Graph API sees it, and the owner's Instagram account is not yet an Instagram Tester. The webhook object is registered. Remaining: link the account (Page → Settings → Linked accounts), add the tester, then send code via `ig.me/m/<username>?ref=<code>`.
- Not yet tried on the phone: a voice note and a photo on WhatsApp/Messenger, a dashboard undo inside the 24 h window, and a proactive reminder being skipped after 24 h of silence (covered offline by `npm run e2e`). The WhatsApp API Setup token lasts 24 hours; replace it with a system-user token before relying on WhatsApp.
- How Meta delivers the `?ref=` code on a first contact (the Get Started postback set by `meta:setup`, a `referral` on the first message, or a separate referral event) is covered by parser tests only; the bare code sent as a message is the fallback `venue:create` prints.

## Works with your existing website

A café that already has a WordPress site keeps it: the **Site Manager plugin** (`public/wp/site-manager.zip`, source in `integrations/wordpress/site-manager`) shows the live menu, specials, hours, announcements and photos as blocks and shortcodes, and, after the owner sends one `/connect` line to the bot, lets the agent edit the site's pages, photos, title, logo, menus and WooCommerce products through the same preview → ✅ → undo flow. Set `DESTINATION_SECRET_KEY` (32 bytes, `openssl rand -hex 32`) in production to enable connecting. Full guide: [docs/INTEGRATION.md](docs/INTEGRATION.md). Checks: `npm run wp:lint`, `npm run wp:test`, `npm run wp:smoke` (Docker).

A WordPress push that fails (the site is down) is retried with backoff, but only when the tick runs: on the owner's next message to the bot and at the daily cron (03:00 UTC), or every 5 minutes with `supabase/cron.sql` or a Pro cron. So "will retry" can mean a few hours on the Hobby plan.

## Venues with their own site

Use this when the venue's site was built by hand outside Site Manager and reads our public feed (`/api/site/<slug>`), as https://coffique.vercel.app does for `coffique`. The venue gets `site_url`; when the owner redeems the invite **no Vercel project is created** (`startDeploy` logs `own site, skipped`). The bot's welcome names that site and says it is connected and managed by the agent; the dashboard links it with a short note, without deploy status, template switch or custom-domain card. Changes still go through the bot and the dashboard as usual and reach the site through the feed.

```bash
# a new venue
npm run venue:create -- --name "Coffique" --slug coffique --site-url https://coffique.vercel.app
# an existing venue: sets site_url first, then prints an owner invite (reuses an open one)
npm run invite:create -- --slug coffique --site-url https://coffique.vercel.app
```

Run `npm run db:apply` once first so the `venues.site_url` column exists. `--site-url` takes an https URL only.

## Posting to Facebook and Instagram

The owner sends the bot a photo with a line such as "Днешното предложение, пусни го във Facebook и Instagram". The agent proposes a post (`social_post`: the exact caption and the targets, feed post and/or story per network), the owner taps ✅, and the photo is published to the venue's **own** Facebook Page and/or Instagram professional account. The confirmation lists each network (published with links / will retry / error, and on a failure which targets did already go out). Undo deletes the Facebook feed post; a Facebook story cannot be deleted through the API and disappears on its own within 24 hours, which the undo line says; Instagram media cannot be deleted through the API either, so undo answers with the links and asks the owner to delete them by hand. Instagram accepts JPEG only (Telegram photos are JPEG); the tool refuses other images for Instagram and checks the caption limits (2,200 characters, 30 hashtags, 20 @-mentions). An Instagram feed photo taller than 4:5 or wider than 1.91:1 is padded at proposal time (edge-coloured borders, a JPEG copy in our storage; the preview says so) and only the Instagram feed post uses the copy; this needs `sharp`, which Next.js installs for image optimisation; without it such a photo is refused with a clear message.

How it works: the post is a change set with one `social_post` row (applied as a no-op like the WordPress rows); the `facebook` and `instagram` destinations (`src/destinations/facebook.ts`, `instagram.ts`, Graph `v25.0`) publish it through the same sync queue, store hook and tick retries. Each network has its own sync row, so a failure on one never re-posts the other. No target goes out twice: a run claims the row first (`leased_until`, 5 minutes, so two ticks never push the same row); each target is written to the row as "attempted" before the publishing call; on a retry an Instagram target asks its container for its status (PUBLISHED: done; FINISHED: publish the same container) and a Facebook target looks for the post among the Page's recent posts/stories before posting again (when the Page cannot be checked, it fails and asks the owner to check the Page). Only an invalid token or a missing permission marks the connection as broken. Page tokens and Instagram tokens are encrypted with `DESTINATION_SECRET_KEY`, never logged and never sent to the browser. Instagram tokens older than 30 days (never younger than 24 hours) are refreshed by the tick and before publishing; a failed refresh never stops a publish.

Owner setup in the dashboard ("Facebook and Instagram" card; the wizard's done page links to it):

- **Instagram:** a professional account (Business or Creator) — Settings → Account type and tools → Switch to professional account; while the app is in development, the account must be added as Instagram Tester and accept the invite.
- **Facebook:** a Facebook Page for the venue where you are an admin (or have full control); you sign in with your personal Facebook profile that manages the Page. With several Pages the owner picks one after signing in.
- Posts are public on your profile/Page once the app is live (while it is in development, only people with a role on the app see them); undo deletes Facebook posts, Instagram posts must be deleted by hand.

Meta app setup (once, the same Business app as the Instagram import):

1. Apply the schema change: `npm run db:apply -- schema-integrations.sql` (only this file; it allows the `facebook`/`instagram` destinations and the `social_post` change rows, and adds `destination_syncs.leased_until`). Then `npm run check:rls`.
2. **Facebook:** add the **Facebook Login for Business** product. Under Facebook Login → Settings → **Valid OAuth Redirect URIs** add exactly `<PUBLIC_BASE_URL>/api/social/facebook/callback`. Set `META_APP_ID` (App settings → Basic → App ID) next to the existing `META_APP_SECRET` (`npm run env:set -- META_APP_ID`, and in Vercel). Scopes asked: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, and for [comment replies](#replying-to-comments) `pages_read_user_content`, `pages_manage_engagement`. With Facebook Login for Business you can instead create a Configuration (a user access token with those five permissions) and set its id as `META_LOGIN_CONFIG_ID`: the login then sends `config_id` instead of `scope`.
3. **Instagram:** Instagram → API setup with Instagram login → Business login settings → **OAuth redirect URIs**: add `<PUBLIC_BASE_URL>/api/social/instagram/callback` (next to the import's `/api/new/instagram/callback`). Uses the existing `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`. Scopes asked: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`, and for [comment replies](#replying-to-comments) `instagram_business_manage_comments`.
4. While the app is in **Development** mode only people with a role on the app can connect: add the owner's Facebook profile as a tester/developer and the Instagram account as an **Instagram Tester** (accept the invite on instagram.com).
5. **Later, for cafés you do not manage:** Advanced Access to the scopes above through **App Review** (screencast of the connect and post flow, privacy policy URL) and **Business verification**, then switch the app to **Live**.

Without `META_APP_ID` + `META_APP_SECRET` the Facebook button is hidden; without `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET` the Instagram button is hidden; without `DESTINATION_SECRET_KEY` (production) both are. Routes: `GET /api/admin/<slug>/social/{facebook,instagram}/start?key=` (admin key), `GET /api/social/facebook/callback`, `POST /api/social/facebook/select` (Page chooser), `GET /api/social/instagram/callback`, `POST /api/admin/<slug>/social` `{ action: "disconnect", kind }`. The connect flow is separate from the wizard's photo import: its own state key, nonce cookie (`sm_social_nonce`, path `/api/social`) and callbacks; a callback returns to the dashboard (with the admin key) only when the nonce cookie matches, otherwise, and after a declined login, it shows a short BG/EN page. Out of scope for now: video/reels, carousels, posting by staff.

## Replying to comments

When a customer comments under one of the venue's posts (Facebook Page or Instagram), every owner gets the comment with a drafted reply and the usual ✅ / ✏️ / ❌ buttons; the first tap wins. ✅ posts the reply as the venue, ✏️ lets the owner reword it ("Мария: имаме безглутенови от вторник"), ❌ ignores it. Spam or abuse gets a "hide" proposal instead (✅ hides it; "изтрий го" deletes it, which cannot be undone; there is no API to report it to Meta). Nothing is ever posted without an owner's tap. Modes per venue (`set_comment_mode` from the chat: "спри известията за коментари", "известия за коментари веднъж дневно в 10", "уведомявай ме за всеки коментар"; or the dashboard toggle): `each` (default: one proposal per comment within 15 minutes), `digest` (one batch a day at `comment_digest_hour`, venue time), `off` (dashboard only). In every mode the owner can ask "отговори на всички неотговорени коментари" / "answer the unanswered comments" (one batch proposal), "отговори само на въпросите", or "колко коментара чакат?". The dashboard's "Коментари" / "Comments" card shows pending comments with an editable draft (Reply posts at once, Ignore), the last 20 answered, the mode and the monthly count.

Comments are read on all of the account's posts from the last 14 days, including ones posted outside Site Manager, so they keep coming after a reconnect (which drops the post history). How it works: the tick polls (per venue at most every 15 minutes) the comments of the feed posts of the last 14 days (the ones the bot published, whose Meta ids `destination_syncs` results hold, plus one page of the account's own posts: Instagram `GET /{ig-user}/media` without stories, Facebook `GET /{page}/posts?since=`; Instagram `GET /{media}/comments`, Facebook `GET /{post}/comments?filter=toplevel`), stores new ones in `social_comments` (the venue's own comments and replies-to-replies are stored but never proposed), drafts a reply with one small-model call (`COMMENT_DRAFT_MODEL`, default `claude-haiku-5-5`: the venue's name, tagline, about, hours, phone, menu with prices and allergens, and the post's caption; the comment's language, whatever it is (letters name Cyrillic, Greek and the like; a Latin comment of two words or more goes to the language classifier, one word or no answer is English); 1–2 sentences; never invented facts; a neutral fallback line when the call fails) and creates a change set with source `comment` and one `social_reply` (or `social_moderate`) row per comment. After ✅ the Facebook/Instagram adapters post the reply (`POST /{comment}/comments`, `POST /{ig-comment}/replies`) through the same sync queue as posts; undo deletes the reply (`DELETE /{reply}`) or un-hides. A comment deleted by its author is skipped without retry ("коментарът вече не съществува" / "the comment no longer exists"). Comment sets never count toward the monthly change limit; a separate `comment_limit` (default 300 replies and moderations a month, `venues.comment_limit`, null = unlimited) applies. They expire after 24 hours (not 2), never block a pending menu proposal and are never blocked by one. Owners on Messenger, Instagram or WhatsApp get a proposal only within 23 hours of their last message; otherwise the comment waits for their next message or the dashboard (Telegram owners are never deferred). Comment text is customer content: after 30 days the text and the author (name and Meta id) are blanked (on the comment rows and on comment change sets), the blank rows are deleted after 60 days (so a reply made early in the month still counts toward `comment_limit`), and logs carry only ids, counts and error codes.

Setup: apply `npm run db:apply -- schema.sql` (venue columns, `change_sets.proposal_refs`, the `comment` source) and `npm run db:apply -- schema-integrations.sql policies-integrations.sql` (the `social_comments` table and its RLS), then `npm run check:rls`. The logins now ask for `pages_read_user_content` + `pages_manage_engagement` (Facebook) and `instagram_business_manage_comments` (Instagram): **existing connections must be connected again once** (a connection stores `comments: true` only when made with these scopes; until then the card says "Свържете отново …" / "Connect … again"); with Facebook Login for Business add the two permissions to the configuration behind `META_LOGIN_CONFIG_ID`. While the app is in development mode only testers' comments are readable. Live check (Instagram only; the Facebook side is covered by the fake-Meta tests): `npm run social:comments-live -- --comment <id>` (reads `IG_TEST_TOKEN` from `.env.local`) lists the comments under the account's latest post, replies to one (without `--comment`: the first top-level customer comment the venue has not answered), reads the reply back (its `from.id` must equal the stored `ig_user_id`, which the re-reply guard relies on) and deletes the reply even when a check fails (`--keep` leaves it; if the delete fails it prints the reply id to remove by hand). Not built yet (phase 2, after App Review): Meta webhooks for comments, see docs/CHANNELS.md.
