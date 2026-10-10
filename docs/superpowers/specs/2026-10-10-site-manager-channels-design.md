# Site Manager: Messenger, Instagram and WhatsApp as owner channels (design spec)

Date: 2026-10-10. Branch `build/channels` (worktree `~/Projects/site-manager-channels`, forked from `build/templates` at 5a34ddf). Research behind the choices: `docs/research/2026-10-10-messaging-channels.md` in the hackathon repo.

## Context

Today the owner of a venue talks to Site Manager only through Telegram. In Bulgaria most café owners live in Viber, WhatsApp, Messenger and Instagram. The user decided (2026-10-10):

- Same model as Telegram on every channel: **one** Facebook Page, **one** Instagram professional account, **one** WhatsApp Business number for the whole service. The owner writes to it from the app they already have; nothing is installed on their phone.
- Build **Messenger, Instagram and WhatsApp** now (all three are Meta products with one webhook format and one developer app). Viber later (EUR 100/month per bot).
- Messages the bot starts on its own (reminders, "applied as scheduled", "expired") are **skipped on Meta channels when the owner has been silent for 24 h** (Meta's customer-service window). Telegram keeps them. No paid templates in this version.
- WhatsApp starts on Meta's **free test number**; a real SIM and Meta Business verification come later and need no code change.
- Webhooks live on a **Vercel preview deployment** of this branch until the branch merges; production is untouched. The production Supabase project is shared, so the schema change must be **backward compatible** with the code running in production.

Out of scope: Viber, paid Meta templates, Instagram story replies and reactions, group chats, per-channel analytics.

## Goals

1. An owner on Messenger, Instagram or WhatsApp can link to their venue with the invite code, then change the site by text, voice note or photo, and approve with one tap, exactly like Telegram.
2. One agent, one store, one set of copy. Channel code is a thin adapter layer; `src/agent/*` does not know which channel it talks to.
3. Everything runs offline with the memory store and fake webhooks; the live test is one owner phone talking to the preview deployment.

## Identity: `chat_ref`

The numeric Telegram chat id is replaced by a string with a channel prefix:

```
tg:<telegram chat id>      fb:<Messenger PSID>      ig:<Instagram-scoped id>      wa:<WhatsApp phone, digits>
```

`src/channels/ref.ts`: `type Channel = "tg" | "fb" | "ig" | "wa"`, `makeRef(channel, id)`, `parseRef(ref): { channel, id }` (throws on malformed input), `channelOf(ref)`, `isMetaChannel(channel)` (fb, ig, wa).

Domain (`src/domain/types.ts`): `Member.tg_chat_id: number` → `Member.chat_ref: string`; `Member.last_seen_at: string | null` (new). `ChangeSet.chat_id: number | null` → `chat_ref: string | null`; `ChangeSet.tg_message_id: number | null` → `message_ref: string | null` (Telegram message id as text; Meta ids as given).

Store interface (`src/store/types.ts`): every `chatId: number` parameter becomes `chatRef: string` (`findMember`, `setMemberLang`, `redeemInvite`, `findProposed`, `getConversation`, `setConversation`), plus `touchMember(chatRef, nowIso)` which sets `last_seen_at` (no-op when the member does not exist). `upsertMember` takes `last_seen_at` optional.

Agent (`src/agent/run.ts`, `tools.ts`, `memory.ts`), bot, tick, admin server, scripts and tests follow the rename mechanically. `RunRequest.chatId` → `chatRef`.

### SQL, two phases

Phase 1 (this branch, additive, production keeps working):

```sql
alter table venue_members add column chat_ref text, add column last_seen_at timestamptz;
update venue_members set chat_ref = 'tg:' || tg_chat_id where chat_ref is null;
alter table venue_members alter column chat_ref set not null, alter column tg_chat_id drop not null,
  drop constraint venue_members_pkey, add primary key (venue_id, chat_ref);
create unique index if not exists venue_members_chat_ref_key on venue_members (chat_ref);
create unique index if not exists venue_members_tg_chat_id_key on venue_members (venue_id, tg_chat_id);  -- production upsert's onConflict target

alter table change_sets add column chat_ref text, add column message_ref text;
update change_sets set chat_ref = 'tg:' || chat_id where chat_id is not null and chat_ref is null;
update change_sets set message_ref = tg_message_id::text where tg_message_id is not null and message_ref is null;

alter table conversations add column chat_ref text;
update conversations set chat_ref = 'tg:' || chat_id where chat_ref is null;
alter table conversations alter column chat_ref set not null, alter column chat_id drop not null,
  drop constraint conversations_pkey, add primary key (venue_id, chat_ref);
create unique index if not exists conversations_chat_id_key on conversations (venue_id, chat_id);
```

Written as `supabase/migrations/2026-10-10-chat-ref.sql`, idempotent (guards with `if not exists` / `do $$ ... $$` blocks), and folded into `supabase/schema.sql` for fresh databases. `scripts/db-apply.mts` gains an optional file argument so the migration can be applied alone: `npm run db:apply -- supabase/migrations/2026-10-10-chat-ref.sql`.

The Supabase store on this branch reads and writes `chat_ref` / `message_ref` and, **only for `tg:` refs**, also writes the legacy `tg_chat_id` / `chat_id` / `tg_message_id` columns (three lines in the mappers, each marked `// legacy: remove in phase 2`). Production code keeps finding members by `tg_chat_id`, so a Telegram owner linked through the preview deployment also works in production and vice versa.

Phase 2 (after merge to main and the production deploy): `supabase/migrations/2026-10-11-drop-legacy-chat-ids.sql` drops `tg_chat_id`, `change_sets.chat_id`, `tg_message_id`, `conversations.chat_id` and the two legacy unique indexes; the three mapper lines go. Listed in the plan as the last task, run by hand after the merge.

## Architecture

```
Owner phone ── Telegram ──────► POST /api/telegram  (grammY, as today)  ─┐
Owner phone ── Messenger ─────► POST /api/meta  object=page             ├─► InboundMessage ─► handleInbound ─► startRun ─► agent
Owner phone ── Instagram ─────► POST /api/meta  object=instagram        │                      (src/bot/inbound.ts)
Owner phone ── WhatsApp ──────► POST /api/meta  object=whatsapp_business_account ┘

agent / tick / admin ─► Messenger (interface) ─► ChannelRouter ─► TelegramMessenger | MetaMessenger (fb, ig) | WhatsAppMessenger
```

### Inbound core: `src/bot/inbound.ts`

Channel-agnostic. One type and one function:

```ts
export interface InboundMessage {
  chatRef: string;
  kind: "text" | "voice" | "photo" | "button";
  text?: string;                 // text body, caption, or button data
  langHint?: Lang;               // Telegram language_code; absent on Meta
  media?: { download: () => Promise<{ bytes: Uint8Array; contentType: string }>; name?: string };
  messageRef?: string;           // the message the button belongs to (Telegram edits it)
  referralCode?: string;         // m.me / ig.me ?ref=, or wa.me ?text=
}
export async function handleInbound(d: BotDeps, m: InboundMessage): Promise<void>;
```

Behaviour, moved out of `bot.ts` and `media.ts` without change:

- `touchMember(chatRef, now)` first (keeps `last_seen_at` fresh for the 24 h rule).
- **Linking.** `/start CODE`, a bare message that is only an invite code (`^[A-Z0-9-]{8,}$` after trim and upper-case), or `referralCode` → `redeemInvite`. A non-member who sends anything else gets `noAccess(channel)`. Telegram copy keeps "Send /start <code>"; Meta copy says "Send the code you received from us".
- **Commands** `/lang bg|en`, `/help`, `/menu`, `/undo` work on every channel when typed. `help(channel)` lists them only for Telegram; Meta help says "write 'language en'/'език bg' to switch" and the agent handles those phrases as today (plain text).
- **Text** → `startRun`; **photo** → download, `imageMediaType`, 5 MB cap, `saveMedia`, `startRun` with the image; **voice** → download, `transcribe(bytes, lang, contentType)`, `heard(text)`, `startRun`. `langHint ?? detectLang(text) ?? member.lang`.
- **Button** → `parseCallback(text)` → `handleDecision` → `messenger.conclude(...)` (below) and the optional reply.
- Acknowledgement: `messenger.typing(chatRef)` best-effort after `startRun`.

`createBot` (Telegram) becomes a translator: each grammY handler builds an `InboundMessage` and calls `handleInbound`; `bot.catch` stays. `voice.ts`: `makeTranscriber` takes the content type and picks the file name (`voice.ogg`, `voice.m4a`, `voice.mp3`, `voice.aac`); Groq's Whisper accepts all four.

### Outbound: `Messenger` interface and `ChannelRouter`

`src/bot/messenger.ts` keeps the `Messenger` name (the whole code base imports it) and changes shape:

```ts
export interface Messenger {
  send(chatRef: string, text: string, opts?: { proactive?: boolean }): Promise<string | null>;   // message ref or null; never throws
  sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null>;
  /** Telegram: edits the proposal message to `full` and removes the buttons. Meta: sends `short` as a new message. */
  conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: { proactive?: boolean }): Promise<void>;
  typing(chatRef: string): Promise<void>;                                                       // best-effort
}
```

- `TelegramMessenger` (grammY `Api`) — as today; ignores `short`, `proactive`; `typing` = `sendChatAction`.
- `MetaMessenger` (`src/channels/meta/send.ts`) — Messenger **and** Instagram: `POST https://graph.facebook.com/v25.0/me/messages` with the Page access token; `sendProposal` = button template with three postback buttons (`cs:apply:<id>`, `cs:change:<id>`, `cs:cancel:<id>`; labels from `copy`, ≤ 20 chars); `typing` = `sender_action: typing_on`. Text over 2,000 chars (Messenger limit, Instagram 1,000) is split on paragraph boundaries.
- `WhatsAppMessenger` (`src/channels/whatsapp/send.ts`) — `POST https://graph.facebook.com/v25.0/{phone_number_id}/messages`; `sendProposal` = `interactive.type: "button"` with the same three ids; text over 4,096 chars split; `typing` = mark-as-read with `typing_indicator` on the last inbound message id (kept per chat in memory; skipped when unknown).
- `ChannelRouter implements Messenger` (`src/channels/router.ts`): parses the prefix and dispatches; an unconfigured channel logs once and returns null. **24 h rule:** when `opts.proactive` and the channel is Meta, it loads the member and skips the send unless `last_seen_at` is within 23 h (one hour margin), logging `[router] skipped proactive <ref>: outside 24h window`. Callers in `tick.ts` (reminder, applied-as-scheduled, expired) and `server/admin.ts` (applied/undone from the dashboard) pass `proactive: true`; the agent and `handleDecision` never do (the owner just wrote).

`DecisionResult.edit` becomes `{ full: string; short: string }` (`short` is the existing toast text). `tick.ts`/`admin.ts` call `conclude` with the status line as `short`.

Fetch is injected into both Meta senders for tests; tokens never appear in logs or errors (same rule as `downloadTelegramFile`).

### Meta webhook: `app/api/meta/route.ts` → `src/server/meta.ts`

- `GET`: `hub.mode=subscribe`, `hub.verify_token === config.metaVerifyToken` → returns `hub.challenge` as text, else 403.
- `POST`: reads the raw body, checks `X-Hub-Signature-256` (`sha256=` + HMAC-SHA256 of the raw body with `META_APP_SECRET`, constant-time compare) → 401 on mismatch. Parses, responds `200 "EVENT_RECEIVED"` **immediately**, and runs `handleInbound` for each message in `after()` (Meta retries anything slower than ~20 s and resends on non-2xx). `maxDuration = 300`.
- Dedupe: an in-memory set of the last 500 message ids per function instance; a repeated id is ignored. Best effort; a redelivered text would at worst start a second agent turn.
- `src/channels/meta/parse.ts`: `parseMetaWebhook(body): InboundMessage[]` handles
  - `object: "page"` and `object: "instagram"`: `entry[].messaging[]`; `sender.id` → `fb:`/`ig:`; `message.text`; `message.attachments[]` type `image` → photo (`payload.url`, public CDN link, fetched without token), type `audio` → voice; `message.quick_reply.payload` and `postback.payload` → button; `postback.referral.ref` / `referral.ref` → `referralCode`; `message.is_echo`, `read`, `delivery`, `reaction`, stickers/gifs → ignored.
  - `object: "whatsapp_business_account"`: `entry[].changes[].value.messages[]`; `from` → `wa:`; `type` `text` → text, `image` (`image.id`, `image.caption`) → photo, `audio` (`audio.id`) → voice, `interactive.button_reply.id` → button, `button.payload` (template-style tap) → button; `statuses[]` ignored. Media download is the two-step Graph call (`GET /{media-id}` → `url`, then `GET url` with the bearer token; URL valid 5 min, so both calls happen inside `download()`).
  - Unknown shapes are logged (object, keys only) and skipped; the parser never throws on bad input.

### Config and enablement

`src/config.ts` gains optional keys; a channel is **enabled when its token is present**, and `ChannelRouter` only gets adapters for enabled channels:

| Key | Used for |
|---|---|
| `META_APP_SECRET` | webhook signature (required when any Meta token is set) |
| `META_VERIFY_TOKEN` | webhook GET verification (we invent it; `openssl rand -hex 16`) |
| `META_PAGE_TOKEN` | Page access token for Messenger and Instagram sends (long-lived or system-user token) |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API token (system user; may equal `META_PAGE_TOKEN`) |
| `WHATSAPP_PHONE_NUMBER_ID` | send endpoint |
| `MESSENGER_PAGE_HANDLE`, `INSTAGRAM_USERNAME`, `WHATSAPP_NUMBER` | invite deep links only |

`.env.example` documents each with where to click. `loadConfig` throws when a Meta token is set without `META_APP_SECRET` or `META_VERIFY_TOKEN`.

### Invite links: `src/channels/links.ts`

`startLinks(config, code)` returns the enabled channels' deep links:

```
telegram:  https://t.me/<bot>?start=<code>
messenger: https://m.me/<page>?ref=<code>
instagram: https://ig.me/m/<username>?ref=<code>
whatsapp:  https://wa.me/<digits>?text=<code>
```

Consumers: `scripts/venue-create.mts` prints them; the wizard done page (templates plan, task 10) renders them next to the Telegram QR (one-line note added to the templates plan, not implemented here); README's demo section lists them.

### Scripts

- `scripts/meta-setup.mts` (`npm run meta:setup`): with the configured tokens, `GET /me` (Page name and id), `POST /{page-id}/subscribed_apps` with `subscribed_fields=messages,messaging_postbacks,messaging_referrals` (Messenger webhooks need this), `GET /{phone_number_id}` (WhatsApp display number), and prints the enabled channels and the webhook URL to paste into the Meta app (`<PUBLIC_BASE_URL>/api/meta`). Never prints a token.
- `scripts/meta-sim.mts` (`npm run meta:sim -- fb|ig|wa text "Капучиното става 3,20"` and `… button cs:apply:<id>`): signs a fake webhook with `META_APP_SECRET` and posts it to a local `next dev` so the whole path runs offline against the memory store; replies are printed by a console messenger.
- `scripts/e2e-offline.mts` grows one Meta leg: fake `fb:` owner redeems a code with a bare message, proposes, taps apply, and a proactive reminder is skipped after the clock jumps 25 h.

### Telegram unchanged for the owner

Same commands, same buttons, same message editing. The only visible difference is none. `scripts/set-webhook.mts`, `dev-bot.mts` untouched.

## Onboarding guide (docs, written as part of this work)

`docs/CHANNELS.md`, in English with a Bulgarian summary, step by step for the user, since account creation and key entry are theirs:

1. Facebook Page for the service (or reuse one). Instagram professional account linked to that Page; in the Instagram app: Settings → Messages and story replies → Connected tools → Allow access to messages.
2. Meta Business portfolio; Meta developer app of type Business with products **Messenger**, **Instagram**, **WhatsApp**.
3. Tokens: Messenger → Instagram settings → Generate token for the Page (grants `pages_messaging`, `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`); WhatsApp → API Setup → test number: copy Phone number ID, add the owner's phone to the 5 allowed recipients, generate a token (temporary 24 h, or create a system user for a permanent one). App settings → Basic → App secret.
4. `npm run env:set -- META_APP_SECRET` and the other keys (values never echoed). `vercel env add <KEY> preview` for the preview deployment.
5. Deploy the branch: `vercel` (preview) → URL. Webhooks: Messenger and Instagram → Webhooks → callback `<url>/api/meta`, verify token, subscribe `messages`, `messaging_postbacks`, `messaging_referrals`; WhatsApp → Configuration → same callback, subscribe `messages`. `npm run meta:setup`.
6. Testers: App roles → add the owner's Facebook account (Messenger) and Instagram account (Instagram Testers; they accept in the IG app). WhatsApp test number: the recipient list from step 3.
7. Try it: `npm run venue:create` prints the links; open `m.me/...?ref=CODE` on the phone.
8. Later: App Review for `pages_messaging` and `instagram_manage_messages` (~20 days per cycle, see research note), real WhatsApp number + Business verification; no code change.

## Error handling

- Signature or verify-token mismatch → 401/403, logged without the body.
- Media download or transcription failure → the same `photoFailed` / `voiceFailed` copy as Telegram, sent through the router.
- Send failure (token expired, user blocked the Page, outside window error 10/2018278 on Meta, 131047 on WhatsApp) → logged with the error code, returns null; the proposal still exists and the dashboard shows it.
- Unconfigured channel referenced by a stored `chat_ref` (token removed) → router logs once per channel and drops the message.
- Agent turn failures are unchanged (`handleRun` logs and swallows).

## Testing

Unit (vitest, offline):
- `ref.test.ts` round-trips and rejects malformed refs.
- `meta-parse.test.ts` fixtures: fb text / image / audio / postback / quick reply / referral / echo / read; ig text / image / audio / postback; wa text / image / audio / button_reply / status; unknown object; malformed body.
- `meta-server.test.ts`: GET verify ok/bad, POST bad signature 401, good signature 200 with `after` capturing the deferred `handleInbound` calls, dedupe.
- `meta-send.test.ts`, `whatsapp-send.test.ts`: injected fetch asserts URL, auth, body (button template, interactive buttons), splitting, error → null, no token in error text.
- `router.test.ts`: dispatch by prefix, unconfigured channel, proactive skip after 23 h and send inside it.
- `inbound.test.ts`: bare code links a member, referral links, non-member copy per channel, `/lang` on fb, photo and voice paths through fake download/transcribe.
- Existing `bot.test.ts`, `bot-media.test.ts`, `approvals.test.ts`, `tick.test.ts`, `admin-server.test.ts`, `store-contract.ts`, `supabase-mappers.test.ts` updated to `chat_ref` / `message_ref` and `conclude`; a mapper test asserts the legacy columns are written for `tg:` refs only.
- `npm run typecheck`, `npm run lint`, `next build` green; `scripts/check-rls.mts` green (RLS unchanged, new columns inherit).

Offline end-to-end: `npm run e2e` (extended), and `meta:sim` against `npm run dev:offline`.

Live, on the preview deployment: the user's phone as tester on Messenger, Instagram and the WhatsApp test number: link with the deep link, text change → proposal with three buttons → apply → site updates; voice note; photo of the specials board; dashboard undo while inside the window arrives, after 25 h is skipped (checked in logs, not waited for: `last_seen_at` is set back by SQL for the test).

## Task order (for the plan)

1. `chat_ref` rename: ref helpers, domain, store interface, memory store, Supabase store with legacy dual-write, migration SQL + schema.sql + db-apply file argument, all tests.
2. `Messenger` interface change (`conclude`, `typing`, `proactive`), Telegram adapter, approvals/tick/admin callers, tests.
3. `handleInbound` extraction; Telegram translator; transcriber content type; copy per channel; tests stay green.
4. Config keys, `.env.example`, `links.ts`, `venue-create` output.
5. Meta parser + fixtures.
6. `MetaMessenger` (fb + ig) and `WhatsAppMessenger`.
7. `ChannelRouter` with the 24 h rule; deps wiring.
8. `/api/meta` route + `src/server/meta.ts` (verify, signature, dedupe, `after`).
9. Scripts `meta:setup`, `meta:sim`; e2e leg.
10. `docs/CHANNELS.md`, README section, templates-plan note for the done page; preview deployment + env; live test with the user's accounts.
11. Phase 2 migration file (run after merge).

## Interface contracts (binding for the plan)

```ts
// src/channels/ref.ts
export type Channel = "tg" | "fb" | "ig" | "wa";
export function makeRef(channel: Channel, id: string | number): string;
export function parseRef(ref: string): { channel: Channel; id: string };
export function channelOf(ref: string): Channel;
export function isMetaChannel(c: Channel): boolean;

// src/bot/inbound.ts — InboundMessage as above
export async function handleInbound(d: BotDeps, m: InboundMessage): Promise<void>;

// src/bot/messenger.ts — Messenger as above; proposalButtons(lang) → [{ id, label }] shared by all adapters

// src/channels/meta/parse.ts
export function parseMetaWebhook(body: unknown, deps: { waDownload: MediaFetch; fetchUrl: MediaFetch }): InboundMessage[];  // each message carries eventId for dedupe

// src/channels/meta/send.ts
export class MetaMessenger implements Messenger { constructor(o: { pageToken: string; fetch?: typeof fetch; now?: () => Date }) }
// src/channels/whatsapp/send.ts
export class WhatsAppMessenger implements Messenger { constructor(o: { token: string; phoneNumberId: string; fetch?: typeof fetch }) }
// src/channels/router.ts
export class ChannelRouter implements Messenger { constructor(o: { store: Store; now: () => Date; adapters: Partial<Record<Channel, Messenger>> }) }

// src/channels/meta/graph.ts
export type MediaFetch = (idOrUrl: string) => Promise<{ bytes: Uint8Array; contentType: string; name?: string }>;

// src/server/meta.ts — imports MediaFetch from src/channels/meta/graph.ts
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean;
export interface MetaServerDeps { config: Pick<Config, "metaAppSecret" | "metaVerifyToken">; botDeps: BotDeps; handleRun: (r: RunRequest) => Promise<void>; defer: (fn: () => Promise<void>) => void; waDownload: MediaFetch; fetchUrl: MediaFetch }
export async function handleMetaRequest(req: Request, deps: MetaServerDeps): Promise<Response>;
export function resetDedupe(): void;  // tests only

// src/channels/links.ts
export function startLinks(cfg: Pick<Config, "telegramBotUsername" | "messengerPageHandle" | "instagramUsername" | "whatsappNumber">, code: string): { telegram?: string; messenger?: string; instagram?: string; whatsapp?: string };

// src/store/types.ts additions
touchMember(chatRef: string, nowIso: string): Promise<void>;
```

Graph API version pinned in one constant: `src/channels/meta/graph.ts` → `GRAPH = "https://graph.facebook.com/v25.0"`.
