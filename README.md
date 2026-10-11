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

## Creating a site with the wizard

Anyone can create a venue site at `/new` (linked from the landing). The owner picks one of three templates (`classic` warm editorial, `nocturne` dark for bars and evenings, `lumen` light and photo-first for daytime coffee), each shown live with the demo café, then fills seven steps with the chosen template rendering their data on the right: Basics (name, web address, main language, contact), Look (accent colour, logo, cover), Hours, Menu (type it, or upload photos or a PDF of the current menu and let Claude read it into a review list you accept row by row), Texts (both languages; "Write for me" drafts all of them from a few facts), Photos (gallery), Review. "Create my site" makes the venue live in our database and shows a one-use Telegram code with a QR (`https://t.me/<bot>?start=<code>`). Pressing Start in Telegram links the owner's chat as the owner and, when `VERCEL_TOKEN` is set, starts the deploy: a new Vercel project named after the slug, built from the thin template shell, polled until READY; the bot then messages "your site is live" with the URL and the done page shows it. The deploy finishes without anyone watching: after Start (and after a template switch) the server polls the deployment every 10 s for up to 4 minutes inside `after()`, and the 5-minute cron, the done page and the dashboard (both nudge `POST /api/tick?key=`) cover anything slower. A chat that is already linked (to the demo café, say) can redeem the new code: the bot answers "You now manage <name>." and the chat moves to the new venue. Coming back to `/new` in the same browser offers "Continue your draft"; the Look step switches templates without starting over, and a failed publish has a "Try again" button on the dashboard. From that moment the Telegram agent manages the content; the deployed site reads `/api/site/<slug>` every 10 s (server) and 5 s (client), so a price change from Telegram is visible on it in seconds. Content never needs a new deployment; only a template switch redeploys.

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
| 1 | Open `/new` on the projector | Three live cards: the demo café in Classic, Nocturne and Lumen. |
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
- **Bilingual content.** Every text field is stored in Bulgarian and English. When the owner writes one language, the agent writes the other; the preview shows both. The site has a BG/EN toggle, the bot and the dashboard follow the owner's language (`/lang bg|en`).
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
                         templates/ classic, nocturne, lumen (shared with the deployed sites)
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
| `TELEGRAM_BOT_TOKEN` | @BotFather in Telegram → `/newbot` | Yes |
| `TELEGRAM_WEBHOOK_SECRET` | Any random string: `openssl rand -hex 32` | Yes |
| `STT_API_KEY` | console.groq.com → API keys (free tier) or an OpenAI key | No: without it, voice notes get a polite "please type it" |
| `STT_BASE_URL` | Default `https://api.groq.com/openai/v1`; OpenAI: `https://api.openai.com/v1` | No |
| `STT_MODEL` | Default `whisper-large-v3`; OpenAI: `whisper-1` | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API → anon public key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → service_role key (server only) | Yes |
| `SUPABASE_DB_URL` | Supabase project → Settings → Database → Connection string (URI) | Only for `npm run db:apply` |
| `PUBLIC_BASE_URL` | `http://localhost:3000` locally; in production the app's production domain (no trailing slash), never a preview URL: it is copied into every venue project as `SITE_MANAGER_URL` (where the deployed site reads its feed) and used in admin links, QR codes and bot messages | Yes |
| `TICK_SECRET` | Any random string: `openssl rand -hex 32` | Yes |
| `DEMO_VENUE_SLUG` | Default `agala` | No |
| `NEXT_PUBLIC_LANDING_URL` | The published Lovable landing (`https://…`). When set, `/` redirects there. Read at build time | No |
| `VERCEL_TOKEN` | vercel.com → Settings → Tokens → Create: set the scope to the **team** that owns the site projects, never a full-account token; expiry per your policy. The wizard creates one Vercel project per venue with it. Server-only | For per-venue Vercel projects; without it sites are served from the hosted `/<slug>` (the fake deployer is used only with `SITE_MANAGER_STORE=memory`) |
| `VERCEL_TEAM_ID` | Vercel → Team Settings → General → Team ID (`team_…`). Needed with a team-scoped token; empty for a personal account | With `VERCEL_TOKEN` |
| `RATE_SALT` | Any random string: `openssl rand -hex 16`. Hashed with the visitor's IP for the wizard's rate limits, so raw IPs are never stored. When unset it falls back to `dev-salt`, which works but makes the hashes guessable | Yes in production |
| `MAX_SITES_PER_DAY` | Default `50`: the global cap on new wizard drafts per 24 h | No |
| `TELEGRAM_BOT_USERNAME` | The bot's username without `@` (from @BotFather). Builds the `https://t.me/<bot>?start=<code>` link and QR on the wizard's done page | For the done page's Start link; without it only the code is shown |
| `INSTAGRAM_APP_ID` | developers.facebook.com → your Business app → Instagram → API setup with Instagram login → **Instagram app ID** (not the Facebook app id). See [Instagram import](#instagram-import) | No: without it (or the secret) the wizard hides "Import photos from Instagram" |
| `INSTAGRAM_APP_SECRET` | The same page → **Instagram app secret**. Server-only, never `NEXT_PUBLIC_`; it also signs the OAuth `state` (through a derived key) | With `INSTAGRAM_APP_ID` |
| `MESSENGER_PAGE_HANDLE`, `INSTAGRAM_USERNAME`, `WHATSAPP_NUMBER` | The Page username (`m.me/<handle>`), the Instagram username without `@` (`ig.me/m/<user>`) and the WhatsApp number with country code (`wa.me/<digits>`), as in the channels guide. Owner links on the done page and in the dashboard's "Your apps" card (`src/server/connect-apps.ts`) | No; shown only with `CHANNELS_ENABLED` |
| `CHANNELS_ENABLED` | `true` offers Messenger, Instagram and WhatsApp next to Telegram. Keep it unset (false) until the channels code that answers those apps is deployed, or owners would message a bot that never replies | No (default false: Telegram only) |

Offline mode also reads two keys that are not in `.env.example`: `SITE_MANAGER_STORE=memory` (set by the scripts below) and `DEMO_OWNER_CHAT_ID` (optional: links that Telegram chat as the demo owner in the memory store).

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
| `npm run wp:zip` | Rebuilds `public/wp/site-manager.zip` from `integrations/wordpress/site-manager` deterministically; `npm test` fails while the committed zip is stale. |
| `npm run wp:smoke` | Throwaway WordPress + MySQL in Docker: installs WP, renders the plugin's blocks from the production feed, then connect → preview → apply → undo → options → menus → rate limit → log through our code; `-- --keep` leaves it at http://localhost:8088, `-- --feed <url>` picks another feed. |
| `npm run test:templates` | Writes each template's thin shell to a temp dir, runs `npm install` (needs network) and `next build` there: the offline proof that a deployed site builds. Slow; not part of `npm test`. Run before a release. |
| `npm run site:delete -- --slug my-cafe` | Deletes a venue (typically one created by the wizard) and its Vercel project. Prints the venue and the project id and asks you to type the slug again before deleting. Storage objects are not removed. |

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

## Landing page (Lovable)

The public marketing landing is built in [Lovable](https://lovable.dev) from the prompt pack in [docs/lovable/LANDING-PROMPT.md](docs/lovable/LANDING-PROMPT.md) (bilingual copy, the pitch facts, design tokens, the "Create your site" button to `/new` and the demo link). After publishing it in Lovable, set `NEXT_PUBLIC_LANDING_URL` to its address and redeploy: `/` then redirects there. The variable is baked in at build time, so setting it without a redeploy changes nothing. Without it, the app's own `/` renders a short fallback landing.

## Deploy to Vercel

1. Install and log in: `npm i -g vercel`, then `vercel login`.
2. Link the project from this folder: `vercel link`.
3. Add every required key from the table above for Production, either in the Vercel dashboard (Project → Settings → Environment Variables) or one by one with `vercel env add ANTHROPIC_API_KEY production` (it asks for the value). `SUPABASE_DB_URL` is not needed on Vercel. For the wizard also add `RATE_SALT`, `TELEGRAM_BOT_USERNAME` and, for real site deploys, `VERCEL_TOKEN` and `VERCEL_TEAM_ID`.
4. Add `CRON_SECRET` with the same value as `TICK_SECRET`. Vercel Cron sends it as `Authorization: Bearer …`, and `/api/tick` accepts that.
5. Deploy: `vercel --prod`. Note the deployment URL.
6. Set `PUBLIC_BASE_URL` to the production domain (`https://<deployment>`, no trailing slash; not a preview URL, because every venue project gets it as its feed origin) and deploy again (`vercel --prod`). If you have the Lovable landing, set `NEXT_PUBLIC_LANDING_URL` before this deploy too.
7. Point Telegram at the deployment: `npm run telegram:set-webhook -- https://<deployment>` (it appends `/api/telegram` and the webhook secret). Stop any `bot:dev` first; Telegram allows a webhook or polling, never both.
8. Check the tick: `curl -H "x-tick-secret: <TICK_SECRET>" https://<deployment>/api/tick` should answer `{"ok":true,…}`.
9. If the venue was created against `http://localhost:3000`, its admin link changes only in the host: replace it with the deployment URL (the key stays the same).

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

## Security notes

- **Anon key.** The browser no longer uses it: public pages, the dashboard and the wizard read through the app's own server routes. Its grants stay locked down anyway: it can read only live venues (and of `venues` only the public feed's columns, granted column by column; `deploy`, `wizard_draft`, `draft_token_hash`, `publishing_at` and `instagram_import` answer `42501`) and their public site tables (`venues`, `site_texts`, `categories`, `items`, `holidays`, `announcements`, `media`), never drafts, members, invites, admin tokens, change sets, changes, conversations or `rate_limits`; it cannot call `bump_rate_limit`; every write is refused (`42501`). `npm run check:rls` proves this against the live project.
- **Service-role key.** Only in server code (`src/server/deps.ts`, the route handlers) and the scripts. The build is checked for it: `grep -rl "SUPABASE_SERVICE_ROLE\|service_role" .next/static` finds nothing.
- **The admin link is the key.** Whoever has `/admin/<slug>?key=…` can approve, cancel and undo changes for that venue. Share it only with the owner. The dev server's request log skips admin URLs, the admin API, the tick and any URL with `?key=`.
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

## What is verified

Checked on 2026-10-11 on `build/templates`:

- `npm test`: 434 tests pass (53 files). One file is skipped by default: the live Supabase store contract, which runs only with `SUPABASE_CONTRACT=1`.
- `npx tsc --noEmit` and `npm run lint`: clean.
- `SITE_MANAGER_STORE=memory npm run build`: succeeds; no service-role key, Vercel token or bot token in `.next/static`.
- `npm run e2e`: the demo sequence offline (proposal and approve, instant sold-out, a special until closing, scheduled holidays, undo, a bulk change applied from the dashboard, the tick writing auto sets and applying the schedule): `OFFLINE E2E OK`.
- Live against the real Supabase project (on `64cdf1f`, after the final fixes): `db:apply`, `check:rls` 19/19, the store contract (`SUPABASE_CONTRACT=1`) 23/23, including `deleteVenue` with storage, `findOpenInvite` and `claimDeploy` by deployment id.
- `npm run test:templates`: the classic, nocturne and lumen venue shells build standalone (on `2a75740`; classic rebuilt after the `<html lang>` change).
- Live Claude calls: menu extraction from a photo and "Write for me" return usable bilingual results; `npm run smoke -- --dry` turned "Капучиното става 3,20" into a `set_price` proposal 2,90 € → 3,20 €.
- `npm run dev:offline`: the chooser offers "Continue your draft" after a reload, and the Look step switches the preview between templates.
- The bot token is valid (`getMe` answers as @restaurant_site_manager_bot), and the Vercel production deployment at https://site-manager-lovat.vercel.app serves `/agala`, answers the tick and receives the Telegram webhook.

## What is not verified

- No real Vercel deploy yet: there is no `VERCEL_TOKEN`, so no venue project has been created, built and polled to READY, and no template-switch redeploy has run against Vercel.
- No live custom domain.
- The full loop (wizard → phone `/start` → deployed site → a Telegram edit showing on it) has not been run end to end.
- `npm run e2e` does not cover the wizard.
- The real phone run: `/start` with an invite code, voice notes, the whiteboard photo, the cover photo, the approval buttons and `/undo` on a phone have not been run end to end against the deployment.
- The Lovable landing is not published yet, so the `/` redirect has not been seen with a real `NEXT_PUBLIC_LANDING_URL`.
- Voice transcription with the configured provider and image turns at `high` effort were not part of the live smoke run.

## Works with your existing website

A café that already has a WordPress site keeps it: the **Site Manager plugin** (`public/wp/site-manager.zip`, source in `integrations/wordpress/site-manager`) shows the live menu, specials, hours, announcements and photos as blocks and shortcodes, and, after the owner sends one `/connect` line to the bot, lets the agent edit the site's pages, photos, title, logo, menus and WooCommerce products through the same preview → ✅ → undo flow. Set `DESTINATION_SECRET_KEY` (32 bytes, `openssl rand -hex 32`) in production to enable connecting. Full guide: [docs/INTEGRATION.md](docs/INTEGRATION.md). Checks: `npm run wp:lint`, `npm run wp:test`, `npm run wp:smoke` (Docker).

A WordPress push that fails (the site is down) is retried with backoff, but only when the tick runs: on the owner's next message to the bot and at the daily cron (03:00 UTC), or every 5 minutes with `supabase/cron.sql` or a Pro cron. So "will retry" can mean a few hours on the Hobby plan.
