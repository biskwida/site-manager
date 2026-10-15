# Reply to Instagram and Facebook comments from the chat — design (2026-10-15)

## Goal

When a customer comments under a post Site Manager published to the venue's Instagram account or Facebook Page, the owner gets the comment and a drafted reply in their chat, taps ✅, and the reply is posted as the venue. ✏️ lets them reword it, ❌ ignores it. Nothing is ever posted without the owner's tap. The owner can also ask in the chat: "отговори на коментара на Мария, че имаме безглутенови". The dashboard shows pending and answered comments.

Out of scope for v1: hiding or deleting customer comments, replying to DMs (a separate feature), comments on posts not published through Site Manager, Facebook Page mentions, live videos.

## Facts that shape it (verified 2026-10-14/15)

- Reading comments: Instagram Login token, `GET /{ig-media-id}/comments?fields=id,text,timestamp,username,from,parent_id,replies` on graph.instagram.com (max 50 per call, newest first, no time filter); Facebook Page token, `GET /{post-id}/comments?filter=toplevel&order=reverse_chronological&since=&fields=id,message,from,created_time,parent`. Scopes: `instagram_business_manage_comments`; `pages_read_user_content` (read) and `pages_manage_engagement` (reply).
- Replying: Instagram `POST /{ig-comment-id}/replies?message=` (top-level comments only); Facebook `POST /{comment-id}/comments` with `message` and the Page token. Both return the new comment id. Deleting our own reply: `DELETE /{comment-id}` on both.
- Webhooks (`instagram` object field `comments`, `page` object field `feed`) are delivered only to a Live app with Advanced Access and Business Verification, and venue Pages connected by OAuth are not subscribed to the app's webhooks today. Dev-mode testers can read and reply through the API. So v1 polls; webhooks come in phase 2 after App Review.
- Meta policy: store customer content at most 30 days; a Meta-channel owner can only receive a proactive message within 24 h of their last message (our router already enforces 23 h for `send`/`conclude`; `sendProposal` is not gated and Meta would reject it outside the window).
- Code today: `destination_syncs.result.published[]` holds, per published target, the Meta post/media id. The sync queue, change sets with external entities, the ✅/✏️/❌ buttons, `correction_for`, the tick and `GraphClient` with retry classification all exist and are reused. The agent has no precedent for runs the owner did not start; proposals today are created by the agent or by tools.

## Architecture

```
tick (every 5 min, per venue at most every 15 min)
  └─ pollComments(venue)                     src/social/comments-poll.ts
       ├─ posts published ≤14 days ago        from destination_syncs results
       ├─ GET comments per post (IG, FB)      src/social/comments-graph.ts
       ├─ upsert into social_comments         new rows only (comment_id unique)
       │    skip: venue's own account, replies to our replies, >30 days
       └─ for each NEW top-level comment → proposeReply(comment)
proposeReply                                  src/social/comments-propose.ts
  ├─ draftReply(): one small-model call       src/social/comments-draft.ts
  ├─ createChangeSet(source "comment", entity social_reply, apply_at null, expires 24 h)
  ├─ sendProposal to the primary owner (buttons); plain copy to other owners
  └─ social_comments.status = proposed, change_set_id
✅ apply → applyChangeSet (external no-op) → sync queue → adapter push
  ├─ facebook.ts / instagram.ts: relevant() also keeps social_reply rows; push posts the reply
  └─ result { replied: [{comment_id, reply_id}] } → social_comments.status = replied; line "Отговорът е публикуван"
✏️ change → existing correction_for flow → agent tool reply_to_comment builds a replacement set
❌ cancel → status ignored
Dashboard "Коментари" card: pending (Reply with text box / Ignore) + last 20 answered.
```

### Data

New table `social_comments` (schema-integrations.sql, RLS on, no anon):
`id uuid pk, venue_id fk cascade, network text check (facebook|instagram), post_ref text (Meta post/media id), comment_id text unique, parent_id text null, author_name text, author_id text, text text, created_at timestamptz, seen_at timestamptz, status text check (new|proposed|replied|ignored|expired|own), change_set_id uuid null, reply_id text null, replied_at timestamptz null`. Index on (venue_id, status). Purge rows older than 30 days in the tick (text and author are customer content).

Store methods (both stores, contract-tested): `upsertComments(venueId, rows[]) → inserted[]` (ignores known comment_ids), `listComments(venueId, {status?, limit?})`, `updateComment(id, patch)`, `purgeComments(before)`.

Change model: new external entity `social_reply`, op `social_reply`, row `{ network, comment_id, post_ref, author_name, comment_text, reply_text, permalink? }`; `isExternalEntity` includes it; `changes_entity_check` extended; preview lines: "• Отговор на коментар от Мария: „…“ → „…“"; undo row inverts to `after: null`, adapter deletes the reply.

`ChangeSource` gains `comment` (CHECK constraint extended). A `comment` set: does not count toward the monthly change limit (replies are reactions, not changes; see open questions), expires after 24 h instead of 2 h (tick expiry reads a per-source TTL), is not blocked by `ensureNoPending` (a pending menu proposal must not stop a reply) and does not block it either; `ensureNoPending` ignores `comment` sets in both directions.

### Polling

Tick step 9 (`if (d.sync)`): for each live venue with a facebook or instagram destination and `last_comment_poll_at` older than 15 min (stored in destination config): collect published targets from the last 14 days (`listSyncs` by venue, status done, filter results `published[]` with an id), call the comments endpoint per post with the destination token (Instagram: `freshToken` as in publishing), upsert, mark `last_comment_poll_at`. Budget: a venue with 20 recent posts costs 20 calls per 15 min; fine under Meta limits. Errors: token/permission errors mark the destination `error` through the existing classification; other errors are logged and retried next tick. Own-account comments (`from.id` equals `ig_user_id`/`page_id`) are stored with status `own` for context and never proposed. Nested comments (`parent_id` set) are stored but not proposed in v1 (Instagram cannot reply to a reply; Facebook could, later).

### Drafting

`draftReply({venue, post caption, comment, language})` → one Messages API call to `COMMENT_DRAFT_MODEL` (default `claude-haiku-5-5`, effort low), system prompt with: venue name, tagline/about, opening hours, the menu (names and prices), the post's caption, rules: answer in the comment's language (Bulgarian default), 1–2 sentences, warm, no emojis unless the comment has them, use the menu for price/allergen/availability questions and never invent facts, a complaint gets an apology and an invitation to write to the venue, never argue, never mention being an assistant. Output JSON `{ reply: string, kind: "question"|"praise"|"complaint"|"spam"|"other" }`. For `spam` the proposal says "Предлагам да не отговаряме" with ❌ preselected in the text (buttons unchanged). The draft model's output is validated (non-empty, ≤ 500 chars) and falls back to a neutral "Благодарим! Пишете ни на … за подробности." when the call fails.

### Notification

Proposal text: "💬 Нов коментар под поста „{caption excerpt}“ ({network}) от {author}: „{text}“\n\nПредложен отговор:\n„{reply}“" with the existing ✅ Приложи / ✏️ Промени / ❌ Откажи buttons. Sent to the primary owner (the owner member with the earliest `created_at`); other owners get a plain line with "отговорено от …" after the fact. If the primary owner's channel is a Meta channel and outside the 23-hour window, the proposal is held (status stays `new`, flagged `deferred`) and re-sent when that owner next writes or from the dashboard. Telegram owners are never deferred.

### Reply publishing

Adapters: `relevant()` keeps `social_post` and `social_reply` rows of their network. For a `social_reply` row push does `POST /{comment_id}/replies` (IG) or `POST /{comment_id}/comments` (FB) with the reply text, stores `{ replied: [{ comment_id, reply_id }] }`, idempotent through `prior` like publishing. Undo row: `DELETE /{reply_id}`. A deleted customer comment returns a Meta "not found"-class error: no retry, status `expired`, line "Коментарът вече не съществува". Lines in BG/EN via social-lines. The sync queue stays in order per destination; a stuck retry on a post would delay a reply, accepted for v1.

### Agent

New tool `reply_to_comment({ comment_id | author, reply_text })` in social-tools: lists the venue's `new|proposed` comments (last 7 days) for the model via `list_comments` (or inline in the tool description), creates a `social_reply` change set exactly like `proposeReply` (replacing a pending one for the same comment, reusing `correction_for`). Prompt rule 14: when the owner refers to a comment, use the tools; never post without a proposal. `userMessage` for a ✏️ on a comment set includes the comment and the previous draft so the owner can type just the new wording.

### Dashboard

`Коментари` card in `AdminPanel` (after Social): pending comments with the draft in an editable box, Reply and Ignore buttons (admin action `reply_comment` / `ignore_comment` → same change-set path, concluded on the owner's channel like other dashboard actions), and the last 20 replied/ignored. Owner-only.

### Scopes and reconnect

`IG_PUBLISH_SCOPES` += `instagram_business_manage_comments`; `FB_SCOPES` += `pages_read_user_content,pages_manage_engagement`. Existing connections must reconnect once; the dashboard card shows "Свържете отново, за да четем коментари" when a destination lacks the `comments` capability flag (stored in config at connect time).

### Phase 2 (after App Review grants Advanced Access)

At connect time subscribe the venue: Instagram `POST /me/subscribed_apps?subscribed_fields=comments` with the user token; Facebook `POST /{page}/subscribed_apps?subscribed_fields=feed` with the Page token (needs `pages_manage_metadata`). Extend `parseMetaWebhook` to turn `changes[]` with `field: comments|feed` (verb add, item comment) into `CommentEvent`s routed to the same upsert + propose path; polling stays as the fallback at a lower cadence (1 h).

## Testing

Unit: comment parsing for both networks (fixtures), own-account and nested skipping, 30-day purge, draft validation and fallback, proposal text, deferred Meta-window case, limit exemption, expiry TTL, `ensureNoPending` ignoring comment sets, adapter push and undo with the fake Meta server, agent tool with the fake tool-call harness, dashboard render, store contract for the new methods. Live check script `scripts/social-comments-live-check.mts`: posts a comment with a second tester account? Not possible through the API as another user; instead the script lists comments of the latest @sitemanager.bg post and replies to one chosen by id, then deletes the reply. Tests the same path as production minus the poll.

## Open questions (answer in one message)

1. Do replies count toward the monthly change limit (60 for Coffique)? Proposal: no, with a separate cap of 300 replies a month to bound cost.
2. Two owners: proposal with buttons to the first owner only, plain copy to the second? Or to both, first tap wins?
3. Draft tone source: until the brand/tone field exists, use the venue's tagline and about text. OK?
4. Spam or abuse: propose "не отговаряме" (owner still decides) or skip silently? Proposal: propose, so the owner sees it.
5. Conference demo: Instagram only (sitemanager.bg test account) or both networks? Facebook needs the Page connect and the two new scopes on the test Page.

## Effort

Three focused days with subagents: day 1 data, graph readers, poller, draft; day 2 adapters, agent tool, proposal flow, limit/expiry rules; day 3 dashboard card, live check, docs, review. Phase 2 half a day once Meta grants access.
