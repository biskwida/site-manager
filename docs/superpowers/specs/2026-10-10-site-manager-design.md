# Site Manager: a café or restaurant website that the owner runs from Telegram

## Context

**The business.** We build a small restaurant or café a website and sell it together with an agent. The owner never logs into anything: they message a Telegram bot, in Bulgarian or English, by text, voice note or photo, and the site changes. "Капучиното става 3,20", a photo of today's specials board, "баницата свърши", "затворени сме на 24 и 25 декември", "смени снимката на корицата", "добави шопска салата 7,50". Every change is previewed, approved with one tap, logged, and undoable. One deployment serves many venues; each venue has its own slug, owner chat and admin link.

**Hackathon framing** ("AI That Does the Work"): Claude does the understanding (casual Bulgarian, speech, handwriting on a whiteboard, which dish is meant, which allergen is missing). We build what it can't do without us: the website, the content model, the approval step, the scheduler, the change log and undo, and the multi-tenant plumbing that makes it sellable.

**Early customer evidence (from the user, 2026-10-10):** three venues the user knows have said what they would pay per month: Bar and Dinner Central, 30 €; Coffique, 20 €; Family House, 50 €. The pitch states this as "three venues already quoted us 20–50 € a month before we had a product" and prices the service at 25 € a month per venue (website hosting + agent), with setup included. The README pitch and the landing page use this; no invented testimonials.

**Decisions made with the user (2026-10-10):**
- New project, **not** under InstaPay. Folder: `/Users/tanyatopacharova/Projects/site-manager`. Public GitHub repo `biskwida/site-manager` (gh is logged in as `biskwida`). Working name "Site Manager".
- **Vercel-deployable**: one Next.js app (App Router) holds the public sites, the owner dashboard, the Telegram webhook and the tick endpoint. Supabase holds data, realtime and images. No long-running Node process in production; long polling only for local development.
- Telegram bot as the owner's interface. Text, voice notes (any OpenAI-compatible transcription API; Groq free tier by default) and photos.
- Languages: the site, the dashboard and the bot all work in **English and Bulgarian**. Each owner picks their language; every piece of site text is stored in both languages, and the agent writes or translates the other one.
- Models: `claude-opus-5-5`. Effort `medium` by default, `high` for turns with an image or a bulk/scheduled request. Configurable by env. Quality over cost.
- Features: price and text edits; sold-out with auto-return; daily specials from a photo; opening hours and holidays; images (dish, cover, logo, gallery); new dish setup with allergen check and bilingual descriptions; bulk price changes with rounding preview; scheduled changes with a reminder; change log and undo; theme accent colour.
- **Reuse from the donation project** (`/Users/tanyatopacharova/InstaPay/Hackaton`, branch `build/food-donation-agent`): patterns and a few small files only, because the framework changes to Next.js. See "What to copy" at the end. Everything else is new.

## Product behaviour

### Change sets

Every edit is a change set: a list of typed changes with before/after snapshots. Nothing touches the site except through one, so everything is previewable, logged and undoable.

- Statuses: `proposed` → `applied` | `rejected` | `expired` (2 h) | `cancelled`; `scheduled` (approved, `apply_at` in the future) → `applied`; `applied` → `reverted`.
- Ops: `set_price`, `set_sold_out {until}`, `add_item`, `update_item`, `remove_item` (soft), `set_item_image`, `set_cover_image`, `set_logo_image`, `add_gallery_image`, `remove_gallery_image`, `set_hours`, `add_holiday`, `remove_holiday`, `add_announcement`, `remove_announcement`, `set_text {key}` (about, tagline, welcome, footer note, address, phone, map link, instagram), `set_theme {accent}`.
- Each change stores `before` and `after` for the entity. Undo applies the inverse in reverse order as a new set with `source: "undo"`. Auto changes (sold-out return, special expiry) are sets with `source: "auto"`.

### Approval policy

- **Instant, undoable:** `set_sold_out` only.
- **Preview + approval:** everything else. The bot sends the preview (in the owner's language) with inline buttons **✅ Apply / Приложи · ✏️ Change / Промени · ❌ Cancel / Откажи**. Approving applies immediately inside the callback handler. "Change" makes the next owner message a correction; the agent proposes a replacement and cancels the old set. One `proposed` set per chat at a time.
- The owner dashboard offers the same decisions through RPCs with the owner's secret key; the tick applies dashboard-approved sets.

### Time behaviour without a server process

Vercel has no always-on process, so the design avoids needing one:
- **Read-time effectiveness.** The public site treats an item with `sold_out_until <= now` as available and a special with `special_expires_at <= now` as gone. No tick is needed for the two most common timed behaviours. A later tick writes the matching `auto` change sets so the log stays complete.
- **`/api/tick`** (secret header) applies due scheduled sets, writes the `auto` sets, sends reminders for sets due within 24 h, and expires stale proposals. It is triggered by Vercel Cron (`vercel.json`; Hobby plans allow only daily crons, Pro allows every minute, so the README states both) and **also at the start of every Telegram webhook call** for that venue (cheap: one query for due sets). Optional: Supabase `pg_cron` + `pg_net` hitting the endpoint every 5 minutes; SQL for it is included but commented.
- Helpers the model never computes itself: `nextOpening(hours, holidays, from)` for "until tomorrow's opening" (`until: "next_opening" | ISO`), `closingToday(hours, holidays, now)` for specials (`expires_at: "closing_today" | ISO`). All in the venue's time zone (default Europe/Sofia).

### Webhook flow (Next.js route handler)

`POST /api/telegram`: verify `X-Telegram-Bot-Api-Secret-Token`; hand the update to grammY's `webhookCallback(bot, "std/http")`; respond 200 immediately; run the agent in `after()` from `next/server` so Telegram never retries. `export const maxDuration = 300`. Long agent turns (photo parsing at high effort) still fit.

Local development: `npm run dev` (Next) plus `npm run bot:dev`, a script that runs the same `bot` with long polling against the local Next server's store code. Switching to the webhook: `npm run telegram:set-webhook -- https://<deployment>/api/telegram`.

### Conversation memory

Per chat: the last 8 exchanges as plain text (owner said / agent replied / change-set outcome) stored in `conversations` (Supabase; there is no process memory on Vercel), 30-minute TTL, prepended to the next user message. Previous tool-call histories are never replayed (preserved-thinking rules on Opus 5.5).

### Images

`message:photo` (largest size) or image `document` → `getFile` → download (never log the URL, it contains the bot token) → Supabase Storage bucket `media` at `<venue_id>/<uuid>.<ext>` → `media` row → the agent receives the image block plus "media_id: …". A specials board → `add_item` specials expiring at closing. "Това е новата снимка на капучиното" → `set_item_image`. "Смени корицата" → `set_cover_image`. Caption text is the message text. Images are served from Storage's public URL; Next `<Image>` is configured with that host.

### Voice

`message:voice` / `message:audio` → `getFile` → download `.oga` → speech-to-text through any **OpenAI-compatible transcription endpoint**, using the `openai` SDK with `baseURL = STT_BASE_URL`, `apiKey = STT_API_KEY`, `model = STT_MODEL`, `language = owner's language` → text. Default and recommended for the hackathon: **Groq's free tier** (`STT_BASE_URL=https://api.groq.com/openai/v1`, `STT_MODEL=whisper-large-v3`, key from console.groq.com; about 20 requests a minute and 2,000 a day on the free plan, check the console for current limits). OpenAI works with `STT_BASE_URL=https://api.openai.com/v1` and `STT_MODEL=whisper-1`. The bot echoes "🎤 Heard: “…”" / "🎤 Чух: „…“" before acting. Missing `STT_API_KEY` → polite "please type it" reply.

### Language

- Owner language: from Telegram `language_code` at `/start`, overridable with `/lang bg|en`, stored per member. The agent replies in it; previews are in it; the dashboard follows the browser or a toggle.
- Site content: every text field is `*_bg` and `*_en`. When the owner provides one language, the agent writes the other (translation, same meaning, natural tone) and the preview shows both. Public site: BG/EN toggle, default = venue `default_lang`.

### Allergens, bulk changes, new dishes, hours

- 14 EU allergens (Regulation (EU) 1169/2011, Annex II), codes 1–14, BG/EN names, keyword map in both languages. `suggestAllergens(text)` and `allergenWarnings(declared, text)` are pure and tested. The agent runs `check_allergens` for new or renamed dishes and must surface warnings in the preview. The site shows codes with a legend.
- `propose_bulk_price_change({ category_id | name_contains, percent | delta_eur, rounding })` computes old → new with `bulkPrices()`; the preview is a table. The model never does the arithmetic.
- `add_item` needs category (ask if unclear), price, allergens; the agent writes the missing-language name and short descriptions in both languages, without inventing ingredients.
- `set_hours` takes the full week; `add_holiday {date, note_bg, note_en}`; the site shows "Open until 18:00" / "Closed today" and upcoming holiday notices; an announcement can be added in the same set.

## Architecture

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
                         store/   Store interface: Supabase (prod) + memory (tests)
                                 │ service-role key (server only)
                                 ▼
                     Supabase: Postgres + RLS + Realtime + Storage(media)
                                 ▲ anon key (browser): public site reads + admin RPCs with key
```

## Data model (Supabase)

```sql
venues(id, slug unique, name, tagline_bg, tagline_en, about_bg, about_en,
       address, phone, maps_url, instagram, cover_media_id, logo_media_id,
       hours jsonb, tz text default 'Europe/Sofia', default_lang text default 'bg',
       theme jsonb default '{"accent":"#2f6b4f"}', created_at)
venue_members(venue_id, tg_chat_id bigint, role check in ('owner','staff'), lang text, created_at, pk(venue_id, tg_chat_id))
venue_invites(code text pk check(length>=8), venue_id, role, expires_at, used_at)      -- /start <code>
venue_admin_tokens(venue_id pk, token unique check(length(token)>=32))                  -- dashboard key
site_texts(venue_id, key text, text_bg, text_en, pk(venue_id, key))                    -- welcome, footer_note, …
categories(id, venue_id, name_bg, name_en, position, active)
items(id, venue_id, category_id, name_bg, name_en, desc_bg, desc_en, price_eur numeric,
      allergens int[], image_media_id, sold_out_until timestamptz, is_special bool,
      special_expires_at timestamptz, position, active, created_at, updated_at)
holidays(id, venue_id, date, note_bg, note_en)
announcements(id, venue_id, text_bg, text_en, expires_at, created_at)
media(id, venue_id, storage_path, public_url, is_gallery bool default false, position, created_at)
change_sets(id, venue_id, chat_id bigint, summary_bg, summary_en, preview_bg, preview_en,
      source check in ('text','voice','photo','dashboard','auto','undo'),
      status check in ('proposed','scheduled','applied','rejected','expired','cancelled','reverted'),
      apply_at, reminded_at, decided_at, applied_at, reverted_by, tg_message_id, created_at)
changes(id, change_set_id, position, op, entity, entity_id, before jsonb, after jsonb)
conversations(venue_id, chat_id, turns jsonb, updated_at, pk(venue_id, chat_id))
```

**Access:** `venues` holds no secrets (owner chat ids live in `venue_members`), so no view is needed; anon `select` on `venues`, `site_texts`, `categories`, `items`, `holidays`, `announcements`, `media`. No anon writes. No anon access to `venue_members`, `venue_invites`, `venue_admin_tokens`, `change_sets`, `changes`, `conversations`. Security-definer RPCs with the owner key: `admin_overview(p_key)` → json, `decide_change_set(p_key, p_id, p_decision)`, `cancel_change_set(p_key, p_id)`, `request_undo(p_key, p_id)`. Realtime publication: `items`, `categories`, `venues`, `holidays`, `announcements`, `site_texts`, `media`. Storage bucket `media`: public read, image MIME types, 5 MB. All DDL idempotent; explicit grants and revokes; `notify pgrst` after apply. Patterns copied from the donation repo's `supabase/policies.sql`.

## Agent tools (bound to one venue + chat; JSON in, JSON string out, never throw)

1. `get_site()` — texts, hours, today's status, holidays, announcements, theme, images present, gallery count, now with offset, owner language.
2. `get_menu()` — categories and items (ids, names, price, sold-out, special, allergens, has image).
3. `propose_changes({ summary, changes[] })` — validates, snapshots, renders preview in the owner's language (and stores the other), sends the Telegram preview with buttons, returns `{ change_set_id, preview }`. All-`set_sold_out` sets apply at once.
4. `schedule_changes({ summary, changes[], apply_at })`.
5. `propose_bulk_price_change({ … })`.
6. `check_allergens({ name, desc?, declared })`.
7. `undo({ change_set_id | "last" })`.
8. `list_changes({ limit })`.
9. `cancel_change_set({ change_set_id })`.

Guards: one tool at a time (queue); one `proposed` set per chat; ids must come from `get_*`; price range check; `apply_at` in the future; `"next_opening"` / `"closing_today"` resolved by helpers; media ids must belong to the venue; status-aware error messages with the next step (pattern from the donation tools).

Model routing in `run.ts`: effort `medium` default; `high` when the turn carries an image or the text matches bulk/scheduling cues; `AGENT_MODEL` and `AGENT_EFFORT` env overrides. `tool_choice: auto` with `disable_parallel_tool_use`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, refusal handling, `max_tokens 16000`.

## Web (Next.js App Router)

- `/` — product landing in EN/BG: "Your café's website, managed by chat", how it works, a demo link to `/agala`. Brief; the sites are the product.
- `/[slug]` — the café's home: cover, logo, name, tagline, today's status, announcements, specials today, about, highlights (a few items), hours, address with map link, phone, Instagram, gallery, footer. `/[slug]/menu` — full menu by category with images, prices, allergen codes, sold-out badges, EN/BG toggle. Client components subscribe to realtime and poll every 5 s; changed items flash briefly. Theme accent from `venues.theme`. Mobile-first (opened from a QR code).
- `/admin/[slug]?key=TOKEN` — QR code, pending approvals (Apply/Reject), scheduled (Cancel), change log with before → after and Undo, sold-out list with return times, links. Polls `admin_overview` every 3 s. Invalid key → friendly page.
- **Draft preview (added 2026-10-10 at the user's request):** every pending proposal on the dashboard has a "Preview on the site" link that opens `/[slug]?draft=<change_set_id>&key=TOKEN` (and `/[slug]/menu?draft=…&key=…`): the public pages render with the proposed changes applied on top of the live state, under a sticky "Draft preview, not live" banner with Apply / Reject buttons that call the same RPCs. Only a valid admin key renders a draft; without it the pages ignore `draft`. Accepting (on the phone or the dashboard) is what makes the draft live.
- i18n: copy the donation repo's `web/src/lib/i18n.tsx` layer (provider, `t/tx`, toggle, URL `?lang=` and localStorage), adapted to Next (client component, `useSearchParams`). WCAG AA contrast floor; self-hosted fonts via `next/font` (Literata + Onest, Cyrillic subsets).

## Multi-tenant operations

- `npm run venue:create -- --name "Кафене „Ъгъла“" --slug agala --lang bg` → creates the venue with default hours and empty menu (or `--seed demo` for the demo menu), prints the owner invite code and the admin link once.
- Owner: `/start <code>` in Telegram → linked as owner, gets the admin link and a 3-line guide. `/lang`, `/help`, `/menu` (sends the public link and QR), `/undo` (shortcut).
- Staff: `/start <staff-code>` → can mark sold-out and add specials; price changes need the owner (the tool checks the member role).

## File layout

```
site-manager/
  app/
    layout.tsx  page.tsx  globals.css
    [slug]/page.tsx  [slug]/menu/page.tsx  [slug]/components/*
    admin/[slug]/page.tsx  admin/[slug]/components/*
    api/telegram/route.ts  api/tick/route.ts
  src/
    config.ts  time.ts
    domain/{types,changes,preview,allergens,hours,pricing}.ts
    store/{types,memory,supabase}.ts
    agent/{prompt,tools,run,memory}.ts
    bot/{bot,media,voice,approvals,commands}.ts
    i18n/{index.tsx,dicts.ts}
    lib/{supabase-browser,supabase-server,format}.ts
  supabase/schema.sql  policies.sql  seed.sql  cron.sql (optional pg_cron)
  scripts/{db-apply,check-rls,venue-create,dev-bot,set-webhook,demo-reset,smoke}.ts
  test/*.test.ts
  vercel.json  next.config.ts  .env.example  README.md
  docs/superpowers/specs/2026-10-10-site-manager-design.md  docs/superpowers/plans/
```

Env (`.env.local`, git-ignored; Vercel project env in production): `ANTHROPIC_API_KEY`, `AGENT_MODEL=claude-opus-5-5`, `AGENT_EFFORT=medium`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `STT_API_KEY`, `STT_BASE_URL`, `STT_MODEL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (scripts only), `PUBLIC_BASE_URL` (the deployment URL, used for admin links and QR), `TICK_SECRET`, `DEMO_VENUE_SLUG=agala`.

Pinned versions confirmed on npm today: `next@16.4.0`, `react@19.3.0`, `react-dom@19.3.0`, `tailwindcss@4.3.3`, `@tailwindcss/postcss` (match 4.3.x), `@anthropic-ai/sdk@0.133.0`, `grammy@1.46.0`, `openai@7.32.0`, `@supabase/supabase-js@2.117.3`, `zod@4.6.5`, `pg@8.23.1`, `qrcode.react@4.2.0`, `typescript@7.0.2`, `vitest@5.0.3`, `tsx@4.23.15`. Check `next@16` App Router specifics (`after()` from `next/server`, `maxDuration` export, `next/font`) against the installed types rather than memory.

## Seed (demo venue)

Кафене „Ъгъла“ (slug `agala`), Sofia, Mon–Fri 08:00–18:00, Sat 09:00–16:00, Sun closed. Categories Кафе / Закуски / Сандвичи / Напитки, about 12 bilingual items with EUR prices and allergen codes, tagline and about in both languages, address, a map link, theme accent green. No images (neutral tiles) until the owner uploads them in the demo.

## Build order (solo, two to three days; all offline-testable with the memory store)

**Day 1: foundation and the agent loop**
1. Repo: `create-next-app` (TypeScript, App Router, Tailwind, src dir off, `app/` + `src/`), vitest, scripts, `.gitignore`, `.env.example`, README stub. `gh repo create biskwida/site-manager --public --source . --push`.
2. `supabase/schema.sql`, `policies.sql`, `seed.sql`; `scripts/db-apply.ts`, `check-rls.ts`, `venue-create.ts`.
3. `domain/`: types (change ops as a discriminated union), `applyChange` / `invertChange` / `validateChange` round-trip tests; `hours`, `pricing`, `allergens`, `preview` (both languages). TDD.
4. `store/`: interface, memory, Supabase (incl. `applyChangeSet` with the conditional status update, media upload, conversations).
5. `agent/`: tools with guards and ordered tests; prompt (bilingual rules); `run.ts` with effort routing and memory; `memory.ts`.
6. `bot/`: commands (`/start <code>`, `/lang`, `/help`, `/menu`, `/undo`), text path, approval buttons (`callbackQuery` answered first, then apply, then edit message), `dev-bot.ts` long polling. Offline e2e script: price change → approve → applied; sold-out instant; undo.

**Day 2: media, voice, the sites**
7. Photos → Storage → agent image blocks; whiteboard specials; image ops. Voice → transcription → echo.
8. `/api/telegram` (webhook secret, `after()`, `maxDuration`), `/api/tick`, `vercel.json` crons, `set-webhook.ts`.
9. Public site `/[slug]` and `/[slug]/menu` with realtime, theme, BG/EN, allergen legend, read-time effectiveness.
10. Admin page with RPCs; QR.

**Day 3 (or the end of day 2): sell-ready polish**
11. Landing `/`, README (pitch, deploy to Vercel step by step, env table, demo script, checklist, known gaps), `demo-reset`, `smoke`.
12. Deploy to Vercel (the user logs in; the session prepares everything and runs `vercel` if the CLI is authenticated), set the webhook, run the real demo twice, record a backup video.

Bulk price change and scheduled changes are last within their days; everything else is core.

## Verification

- `npm test` (vitest): domain round-trips for every op; hours across DST and holidays; bulk rounding; allergen keywords BG/EN; store contract (memory); tools in sequence; approval callback handling; tick behaviour (due sets, auto sets written once, reminder once, expiry).
- `npm run build` (Next) clean; `grep -r SUPABASE_SERVICE_ROLE .next/static` must be empty.
- Offline e2e script for the demo sequence against the memory store.
- Live (needs keys): `db:apply`, `check:rls`, `venue:create --seed demo`, `smoke` (text turn without Telegram), `bot:dev` real phone run, then the Vercel deployment with the webhook set and the same run again.

## Demo script (2 minutes)

1. Projector: `/agala` (the café's site). Phone: Telegram.
2. Voice note "Капучиното става три и двайсет" → "🎤 Чух…" → preview 2,90 € → 3,20 € → ✅ → the site updates live.
3. Photo of a whiteboard with three specials → preview with prices, "до затваряне в 18:00" → ✅ → "Специални предложения днес" appears.
4. "Баницата свърши" → greyed out instantly, "ще я върна утре в 08:00".
5. "Затворени сме на 24 и 25 декември. Весели празници!" → hours notice and announcement.
6. Send a photo with the caption "това е новата корица" → ✅ → the hero image changes.
7. "Върни цената на капучиното" → back to 2,90 €; open the admin page: QR code and the full change log.
8. If time: "Вдигни всички кафета с 10%" → rounded table → ✅.

## Risks and mitigations

- **Vercel function limits.** Telegram webhook responds immediately; the agent runs in `after()` with `maxDuration = 300`. If the plan's Fluid compute limits differ, the README says how to raise them. Local long polling is the fallback for the stage demo and needs no deployment at all.
- **Cron frequency on Hobby.** Read-time effectiveness means nothing visible depends on the cron; scheduled changes also apply on the next webhook. Pro or pg_cron for minute-level precision.
- **Bulgarian numbers in speech** ("три и двайсет"): the prompt covers spoken numbers; the preview catches mistakes. Keep typed fallbacks.
- **Handwriting:** rehearse with the real board; block letters; high effort for image turns.
- **Inline buttons:** answer the callback first, then apply, then edit the message; never leave the client spinning.
- **Realtime on the projector:** 5 s poll as a safety net.
- **One bot, one process:** never run `bot:dev` while the webhook is set (Telegram allows one or the other); `set-webhook.ts --delete` switches back.
- **Secrets:** service-role key and DB URL only in server code and scripts; Telegram file URLs never logged; admin tokens only in the owner's link and RPC parameters.

## Known gaps to state honestly

Only the venue's own site is managed (no delivery apps, no Google). Voice uses a third-party transcription service (Groq or OpenAI). Allergen detection is keyword-based and advisory. The demo venue is fictional. Payments and billing for selling the service are out of scope.

## What to copy from the donation project (and nothing else)

From `/Users/tanyatopacharova/InstaPay/Hackaton` (branch `build/food-donation-agent`); copy files, never import across repos; never read its `agent/.env`:
- `agent/src/agent/tools.ts`: the `betaZodTool` + `attempt()` JSON-error wrapper, the per-chat promise queue, `requireStatus` + next-step hints (pattern, not the tool bodies).
- `agent/src/agent/run.ts`: the `toolRunner` call (params, image blocks, refusal handling, close-out).
- `agent/src/store/supabase.ts`: `must` / `mustRows` (both; `mustRows` is module-private there) and the row-mapper style; `agent/src/store/types.ts`: `cleanPatch`, `newToken`.
- `agent/src/config.ts`: `need` / `optional` env parsing with clear errors.
- `agent/src/bot/bot.ts`: `pinOk`, photo download via `getFile` with the no-URL-logging rule, `startRun` before the acknowledgement, `bot.catch`.
- `agent/src/time.ts`: Sofia helpers with the UTC offset in the model's context (make the zone a parameter).
- `supabase/policies.sql`: idempotent RLS + grants, security-definer RPC with a token, realtime publication guard, bucket insert, `notify pgrst`; `agent/scripts/{db-apply,check-rls}.ts` harness style.
- `web/src/lib/i18n.tsx`, `web/src/index.css` (tokens, reduced-motion, flash/pop/line-in animations), `web/src/pages/Dashboard.tsx` (realtime + poll + debounce + sequence guard + change flash), `web/src/pages/OfferPortal.tsx` (RPC polling with settled states).
- `docs/lovable/PROMPTS.md` structure is not needed (no Lovable requirement this time); skip.

---

