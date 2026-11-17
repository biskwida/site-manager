Plan: docs/superpowers/plans/2026-11-13-google-business-profile.md

# Google Business Profile: hours, holidays and review replies from the chat

Date: 31 October 2026. Owner decisions from the chat of 31 Oct 2026 (Tanya); everything marked *my call* is the author's and can be overturned.

## 1. Intent

Claudia already changes a venue's website from the owner's chat (Telegram, WhatsApp, Messenger) with a preview and one tap to approve. The pitch promises the same for Google: "say *closed today* and your Google listing says it too", and "a review comes in, she drafts the reply, you tick". Google approved Claudia's Business Profile API access (project `claudia-512010`, Basic API Access, 300 QPM) and verified the OAuth app, so refresh tokens are permanent. Nothing exists in code yet beyond placeholders (`DestinationKind` has `"google"`, the onboarding checklist shows "Google Business — Coming soon", the registry comment says it comes later).

This release makes the promise true for **opening hours, holiday hours and review replies**. Menu sync and Google posts are a second release (section 9).

## 2. Goals, non-goals, anti-goals

Goals
- One message updates the website and the Google listing together: regular hours, "closed today / on <date>", holiday ranges.
- New Google reviews reach the owner in the chat with a drafted reply; the owner ticks, edits or cancels; Claudia posts the reply.
- The owner connects Google with one "Connect Google" button, signed in as themselves (Owner or Manager of the profile), and can disconnect any time.
- Coffique is the first live profile; Tanya's Google account (`tanya.topacharova@gmail.com`, Manager at Coffique) does the first connect.

Non-goals (this release)
- Menu / food menus, Google posts, photos, address or pin changes, `moreHours` (kitchen/delivery hours), Q&A, insights, Tripadvisor.
- Creating or claiming profiles.

Anti-goals
- Anything written to Google without the owner's tap for that specific change (Google's policy on express consent; also Claudia's rule).
- Replying to a review automatically, ever, including "auto mode" for comments: reviews stay owner-approved regardless of `comment_mode`.
- Silently reverting an edit Google made to the profile.
- Keeping Google review text longer than 30 days.

## 3. Constraints (from Google, verified 11–31 Oct 2026)

- Business Information API v1: `PATCH locations/{id}?updateMask=regularHours` and `=specialHours`; both replace the whole field, so always send all seven days / all future special periods. `validateOnly=true` dry-runs. Special hours: each period < 24 h, `closed:true` for a closed day; Google's consumer rule says up to 6 consecutive days of special hours, 7+ days should be "temporarily closed" (`openInfo.status`), which this release does **not** set (section 5.3).
- Reviews: `mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews` (list) and `.../reviews/{r}/reply` (PUT `{comment}`; DELETE to remove). Reply text limit 4,096 characters per Google's API reference; Claudia caps at `REPLY_MAX` (500) like comments.
- Quota 300 queries per minute per project. Reviews are polled, not pushed (no webhook for reviews in v4; notifications via Pub/Sub exist but are out of scope — *my call*: polling is simpler and matches the comment poller).
- OAuth scope `https://www.googleapis.com/auth/business.manage`, `access_type=offline`, `prompt=consent`. Refresh tokens are permanent for a verified app but can be revoked by the owner or expire after 6 months without use; the connection must survive that (section 5.1).
- Policy: tell the owner within 48 h of account changes; allow disconnect within 7 business days (ours is immediate); store Google data ≤ 30 days; no indirect API access for third parties.

## 4. The owner's experience

### 4.1 Connecting
On the dashboard's Google card (next to Facebook and Instagram): **Connect Google**. The owner signs in with Google, consents, and comes back to the dashboard. If their account manages one location, it's connected; if several, a chooser page (same pattern as the Facebook Page chooser) lists them by name and address. The card then shows the profile name, address, the last sync, and **Disconnect**. The onboarding checklist's "Google Business — Coming soon" becomes a real step that links to the same button.

On connect, Claudia posts in the chat (owner's language): "Google connected: *Coffique, ул. Кракра 24*. From now on, hours and holidays you change here go to Google too, after your tick. New Google reviews will come here with a drafted reply."

### 4.2 Hours and holidays
No new commands. The existing `set_hours`, `add_holiday`, `remove_holiday` changes gain a Google line in the preview and in the confirmation, exactly like the Facebook/WordPress sync lines today:

```
Hours: Mon–Fri 08:00–19:00, Sat 09:00–16:00, Sun closed
Website ✓ · Google listing ✓
```

"Closed today" = `add_holiday` for today (already how the website works) → Google special hours for today, `closed:true`. "Closed 24–26 December" = three holidays → three special periods. A holiday removed → the period is removed on the next push. Google shows special hours only on top of regular hours, so the first Google push after connect always sends `regularHours` (section 5.3).

If the push fails, the owner sees the same kind of line as for Facebook today ("Google listing: not updated — I'll retry" / after the last retry: "Google listing: not updated. Open your profile to change it by hand: <link>").

Address, name, categories, pin, menu: unchanged on Google; if the owner asks, Claudia says she can't change that on Google yet and gives the "Edit profile" deep link.

### 4.3 Reviews
Every 15 minutes (per connected venue, same cadence as comments) Claudia fetches new reviews. For each new review with text (star-only reviews are included; the draft thanks for the rating), she sends the owner one proposal, in the review's language:

```
New Google review from Maria K. ★★★★★
"Best cappuccino in Sofia, the vegan option is great."
Reply: "Thank you, Maria! The plant-milk cappuccino is a favourite here too — see you soon. ✓"
[✅ Reply] [✏️ Change] [❌ Skip]
```

Reviews come one at a time, newest first, at most 10 per poll; the rest wait for the next poll (same `COMMENT_SET_MAX_ROWS` cap). Negative reviews (1–2 stars) get a draft that acknowledges, apologises without admitting fault, and invites the person to write to the venue; the owner always sees it first. The daily comments digest (if on) counts Google reviews too.

`comment_mode = auto` does not apply to reviews. `list_comments` in the chat includes pending reviews ("2 Google reviews waiting").

### 4.4 Disconnecting and failures
Disconnect deletes the token and pending Google syncs; reviews already stored are purged on the normal 30-day schedule. If a token is revoked or refresh fails with `invalid_grant`, the destination goes to `error` and the owner gets one message: "Google disconnected itself (the permission was removed). Connect Google again from the dashboard: <link>." No repeats until reconnected.

## 5. How it's built (decisions)

### 5.1 Connection = a `google` destination
- Reuse `venue_destinations` with `kind:"google"`. `config` (not secret): `account_name` (`accounts/123`), `location_name` (`locations/456`), `location_v4` (`accounts/123/locations/456`, for reviews), `title`, `address` (one line), `connected_at`, `last_review_poll_at`, `last_hours_push_at`, `google_user_email` (the account that connected, for the 48-h notice and support). `secrets`: `{refresh_token}` encrypted with `encryptSecrets` (`DESTINATION_SECRET_KEY`). Access tokens are short-lived and are **not stored**: every push/poll exchanges the refresh token (`https://oauth2.googleapis.com/token`, cached in memory for the request only).
- OAuth flow mirrors `social-connect.ts`: `handleGoogleStart` (302 to `accounts.google.com/o/oauth2/v2/auth` with `scope=business.manage`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`, signed state with nonce cookie, `ret` for onboarding), `handleGoogleCallback` (verify state, exchange code, list `accounts/-/locations` with `readMask=name,title,storefrontAddress,metadata`; one location → upsert; several → `handleGoogleSelect` chooser page), `backToDashboard` with `social_result` values `google_connected`, `google_choose`, `google_error`, `google_no_locations`.
- Routes: `app/api/admin/[slug]/social/google/start`, `app/api/social/google/callback`, `app/api/social/google/select`; disconnect through the existing `POST {action:"disconnect", kind:"google"}`. Redirect URI already registered on the OAuth client: `https://site-manager-lovat.vercel.app/api/google/callback` — **the builder adds `/api/social/google/callback` on the Google client for the old host and getclaudia.app** (one-line task for Tanya, listed in section 8), or keeps `/api/google/callback` as a route that forwards. *My call:* register the new path; one route, no forwarders.
- Config: `googleClientId`, `googleClientSecret` in `src/config.ts` (both optional; the Connect button shows only when both are set, like `socialAvailability`). Env names already on Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Token death: a refresh that returns `invalid_grant` marks the destination `error` with `last_error:"revoked"` and sends the one-time chat notice (4.4); `CONNECTION_CODES` gains the Google code so `runSync` does the same on push.

### 5.2 Hours sync = a destination adapter
- `src/destinations/google.ts`: `googleAdapter` with `kind:"google"`, `relevant(changes)` = ops `set_hours`, `add_holiday`, `remove_holiday` (nothing else in this release), `push(ctx)`:
  1. Get an access token from the refresh token.
  2. Build `regularHours.periods` from the venue's **effective** `WeekHours` after the change set (`src/domain/effective.ts`): one period per open day; days with `null` are omitted (closed). Split shifts are not a thing in Claudia's `DayHours`, so one period per day. Overnight closing (close ≤ open, e.g. 22:00–02:00) → `closeDay` = next day.
  3. Build `specialHours.specialHourPeriods` from **all future holidays** of the venue (date ≥ today in the venue's timezone): `{startDate:{year,month,day}, closed:true}`. Past dates are never sent. More than 6 consecutive closed days: still sent as special hours (Google accepts them; the "temporarily closed" status is a later feature), and the sync line adds "7+ days closed: Google may show this as temporarily closed only if you set it in your profile" — *my call*, keeps v1 simple.
  4. `PATCH locations/{id}?updateMask=regularHours,specialHours&validateOnly=true`, then the real PATCH. First push after connect always includes `regularHours` even if only a holiday changed (Google requires regular hours for special hours; config flag `hours_pushed:true` after the first success).
  5. Read back: `GET locations/{id}?readMask=regularHours,specialHours,metadata`; `metadata.hasGoogleUpdated` or a `pendingMask` is reported in the result as "sent, Google is reviewing" (line text), never retried. Result stored in `destination_syncs.result`; `syncLines` gets a Google label (`Google listing` / «Google профил»).
- Errors: 401/403 with `invalid_grant`/`ACCESS_TOKEN_SCOPE_INSUFFICIENT` → connection code; 429 → retry with the standard backoff; 400 from validateOnly → `ok:false, retry:false` with Google's message in `last_error` and an owner line "Google refused the hours: <short reason>".
- The adapter is pure over `fetch`; a `FakeGoogle` in `test/fake-google.ts` mirrors `FakeMeta` (token endpoint, `accounts/-/locations`, PATCH with `validateOnly`, GET read-back, reviews list, reply PUT/DELETE, `failNext`, `calls`).

### 5.3 Reviews = the comment pipeline with a second source
- Store: `social_comments.network` gains `'google'` (SQL check + `SocialNetwork` type). A review is stored as a comment row: `comment_id` = review name (`accounts/…/reviews/…`), `post_ref` = location name, `author_name` = reviewer display name, `text` = review comment (may be empty), `created_at` = `createTime`, plus two new nullable columns `rating smallint` and `review_updated_at timestamptz` (a review edited by the author is treated as new: `updateTime` newer than `review_updated_at` → status back to `new`, previous reply shown in the draft context). Migration `supabase/migrations/2026-10-31-google-reviews.sql`.
- Poll: `pollVenueReviews` in `src/social/reviews-poll.ts`, called from tick step 9 next to `pollVenueComments` for venues with a connected `google` destination and `planIncludes(plan,"comments")`. Lists reviews (`pageSize=50`, `orderBy=updateTime desc`), stops at the first review already seen with the same `updateTime`, upserts the rest. Reviews with `reviewReply` already present (replied outside Claudia) are stored as `replied`. Retention: text redacted after 30 days, rows deleted after 60 (existing purge, now covering `google`).
- Draft: `draftReply` gets a `kind:"review"` context with the star rating, the venue's real offer (menu/products from `get_site`) and the rule set for negative reviews (4.3). Language = the review's.
- Propose: `proposeForComments` handles review rows with `mode:"each"` always (auto mode ignored for `network:"google"`), proposal text from a new `reviewProposalText` (stars + excerpt + draft), ops `social_reply` on entity `social_reply` reused with `network:"google"`. First tap wins, 24 h TTL, same as comments.
- Publish: `googleAdapter.relevant` also takes `social_reply` changes whose target network is `google`; `push` PUTs `reviews/{r}/reply {comment}` and `afterSocialPush` marks the row `replied` with `reply_id` = review name. Deleting a reply (owner: "remove my reply to Maria") → DELETE, later release unless trivial — *my call*: out of scope.
- Dashboard: `CommentsCard` lists reviews with a ★ rating and "Google" badge; the immediate "reply from the dashboard" path works the same.
- Limits: review replies count toward `comment_limit` like comment replies (the plan already prices "replies to comments"; *my call*).

### 5.4 Chat and prompt
- Prompt rule: when the owner asks to change Google hours or reply to a review, use the existing tools; Google is a destination, not a separate command. Add: "Google listing: hours and holidays sync after approval; reviews arrive automatically. Address, menu, posts on Google: not yet — give the Edit-profile link <https://business.google.com/>."
- `get_site` returns `destinations: [{kind:"google", title, connected}]` so the model can answer "is Google connected?".
- i18n: all new owner-facing lines in BG and EN (`src/i18n/*`), plus the dashboard card and onboarding step; the slide-2 wording "just say closed today" is the behaviour to match.

### 5.5 Security and privacy
- State signing, nonce cookie, admin-key-or-session checks: identical to the Facebook flow (`checkState`).
- The refresh token never leaves the server or the logs; errors log the class and Google's `error` code only.
- Privacy policy (getclaudia.app/privacy): add Google Business Profile to the list of connected services, what is stored (profile name, address, hours, reviews ≤ 30 days, the connecting account's email), and how to disconnect. Section 8 lists it as a Tanya task.
- Google's limited-use requirement for `business.manage` data: reviews are used only to draft the reply shown to the owner; nothing is used for other purposes or shared.

## 6. Data and schema summary

- `venue_destinations`: no schema change (kind `google` already allowed).
- `social_comments`: `network` check adds `google`; new columns `rating smallint null`, `review_updated_at timestamptz null`.
- `changes`: no new entity (reuse `social_reply`); `payload.network` distinguishes.
- Config: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (exist), reuse `DESTINATION_SECRET_KEY`, `PUBLIC_BASE_URL` for the redirect.

## 7. Testing

- Unit: hours → `regularHours` mapping (closed days omitted, overnight close, all seven days), holidays → `specialHours` (future only, sorted, `closed:true`), first-push-includes-regular-hours, read-back lines.
- Flow: `social-connect` style tests for start/callback/select/disconnect with `FakeGoogle` (state tampering, expired nonce, zero/one/many locations, `invalid_grant`).
- Reviews: poll stop-at-seen, edited review re-proposed, replied-outside-Claudia stored as replied, auto mode ignored, 10-per-poll cap, reply PUT after ✅, limit accounting, 30/60-day purge.
- Tick and store contracts updated; `check:rls` unchanged (no new tables).
- Live check before the owner test: `validateOnly` PATCH against Coffique with Tanya's token from the dashboard, then one real hours push and read-back; one review reply on a real review only with Tanya's explicit go.

## 8. Tanya's tasks (outside the code)

1. Google Cloud → OAuth client `claudia-web`: add redirect URIs `https://site-manager-lovat.vercel.app/api/social/google/callback` and `https://getclaudia.app/api/social/google/callback`.
2. Enable "My Business Business Information API" and "My Business Account Management API" and "Google My Business API" (v4, for reviews) on project `claudia-512010` if not already enabled; confirm quota shows 300 QPM.
3. Privacy page paragraph (I'll draft it; you approve).
4. After the first connect at Coffique: tell the Coffique owner that Claudia now manages hours and reviews there and that they may remove Tanya's Manager access later only if the connecting account changes.

## 9. Later releases (not in this spec)

- Menu via v4 `getFoodMenus`/`updateFoodMenus` (whole-menu replace, sold-out handling, `canHaveFoodMenus` check).
- Google posts (`localPosts`) from the same photo → post flow as Instagram, if `mybusiness.googleapis.com` posts work on the project (reported `SERVICE_DISABLED` for new projects).
- `moreHours`, temporarily-closed status for 7+ day closures, address/pin guided edits, Pub/Sub review notifications, reply deletion, Tripadvisor.

## 10. Left to the builder

- Exact Google error-code mapping into `CONNECTION_CODES` and `socialErrorText`.
- Chooser page markup (copy the Facebook select page).
- Draft prompt wording for reviews (keep `draftReply`'s contract and the no-"AI assistant" rule).
- Whether `rating` is shown in the dashboard as stars or a number.

## 11. Rulings after the builder check (31 Oct 2026, author's calls)

1. **Reviews ride the existing comment pipeline as a third network.** Widen `CommentNetwork`/`SocialNetwork`/`NETWORK_NAMES`/`commentNetworkOf`/`relevantFor` to include `"google"`; `pushCommentChanges` gains a Google branch (reply PUT) instead of a parallel review path. `sync.ts`'s `social` flag treats `google` as social, so only `CONNECTION_CODES` mark the destination `error`; a hours push that exhausts its retries leaves the connection intact and tells the owner. `SocialReplyRow` gains optional `rating`; `list_comments` shows reviews as "★★★★★ Google review from <name>", and `reply_to_comments` accepts review rows unchanged.
2. **Comment modes and reviews:** `off` mutes reviews too (the owner asked for silence); `each` and `digest` both deliver reviews **one at a time, immediately** (reviews are rarer and matter more than comments; the digest only counts them). `auto` never applies. Tick step 9 therefore polls reviews when the mode is not `off`.
3. **Holidays:** a Claudia holiday is one full closed day; a range is one holiday per day, so "24–26 December" = three `closed:true` periods. Prune with the venue's `tz` ("today" in local time). Undo is an ordinary change set, so the push recomputes from effective state; no special undo path.
4. **Empty hours:** if every day is `null`, the adapter refuses (`ok:false, retry:false`, line "Google needs opening hours before it can take holidays — tell me your hours first"). **First connect reads Google's current hours**: if Google's regular hours differ from the website's, the connect message becomes a proposal, "Google says Mon–Fri 08:00–20:00; your website says 08:00–19:00. Keep the website's hours on Google ✅ / Use Google's hours on the website ✏️"; nothing is pushed until the owner answers. If they match (or Google has none), `hours_pushed` is set only after the first real push, as before. This removes the silent-overwrite risk.
5. **validateOnly stays inside `push`** (after the tick). A refusal is rare (bad time format) and the chat line + retry-free failure is acceptable for v1; a pre-approval dry-run hook is a later improvement.
6. **Chooser filter:** list only locations that are verified (`metadata` / `openInfo` as available) and have a `storefrontAddress` or a service area; a location without an address shows its title only. No eligible location → `google_no_locations` with the dashboard text "Your Google account manages no verified business profile; ask the profile owner to add you as a Manager."
7. **Canonical host for the connect:** the app host `site-manager-lovat.vercel.app` (getclaudia.app still serves the landing until the domain switch). `redirect_uri` is built from the request's host (as `social-connect.ts` does), never from `PUBLIC_BASE_URL`, so both registered URIs work.
8. **Quota:** no stagger in v1 (a venue costs ~2 calls per 15 min plus a read-back per push; hundreds of venues fit in 300 QPM). Revisit at ~500 venues.
9. **Plan gating:** hours pushes are part of the same change set and are gated by nothing extra; they do not count twice against `change_limit`. Reviews follow the `comments` feature and `comment_limit`.
10. **`hasGoogleUpdated` / `pendingMask`:** a line only ("sent, Google is reviewing"); nothing on the dashboard in v1.
