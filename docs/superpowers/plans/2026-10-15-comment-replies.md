# Comment Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a customer comments under a post Site Manager published to the venue's Instagram account or Facebook Page, every owner gets the comment with a drafted reply and the ✅ / ✏️ / ❌ buttons; the first tap wins, ✅ posts the reply as the venue, ✏️ rewords it through the agent, ❌ ignores it. Spam gets a "hide" proposal instead. The owner picks `each`, `digest` (one batch a day at a chosen hour) or `off`, can ask the agent to answer the unanswered comments, and sees pending and answered comments on the dashboard. Nothing is ever posted without an owner's tap.

**Architecture:** The tick polls (every 5 min, per venue at most every 15 min) the comments of the posts Site Manager published in the last 14 days (`destination_syncs.result.published[]` holds the Meta post/media ids), upserts them into a new `social_comments` table (customer content, purged after 30 days), drafts a reply with one small-model call, and turns each new top-level comment into a change set with source `comment` and one `social_reply` (or `social_moderate`) row. The existing approval flow (`handleDecision`), the store hook, the sync queue and the Facebook/Instagram adapters publish the reply after ✅ exactly as they publish posts; `relevant()` of both adapters also keeps the new row kinds. A `comment` set is sent to every owner (`change_sets.proposal_refs`), never counts toward the monthly change limit (a separate `comment_limit`, 300 a month, caps comment actions), expires after 24 h instead of 2 h and never blocks or is blocked by a pending menu proposal. The agent gets `list_comments`, `reply_to_comments` and `set_comment_mode`; the dashboard gets a "Коментари" card. Phase 2 (webhooks after App Review) is documented, not built.

**Tech Stack:** TypeScript, Next.js 16 (route handlers + client components), vitest, zod 4, `@anthropic-ai/sdk` 0.133 (`beta.messages.create`), Supabase (Postgres + RLS) and the in-memory store, Meta Graph v25.0 through `GraphClient` (`src/destinations/meta-graph.ts`) and the in-memory `FakeMeta` (`test/fake-meta.ts`).

**Spec:** docs/superpowers/specs/2026-10-15-comment-replies-design.md

## Global Constraints

- Poll cadence: the tick runs every 5 min; a venue's comments are read at most every 15 min (`last_comment_poll_at` in the destination config; `COMMENT_POLL_EVERY_MS = 15 * 60_000`).
- Post window: only posts published in the last 14 days are read (`COMMENT_POST_WINDOW_MS = 14 * 24 * 3_600_000`).
- Comments per call: at most 50 per post per poll (`limit=50`, first page only; `COMMENTS_PER_CALL = 50`).
- Retention: `social_comments` rows older than 30 days are purged by the tick (`COMMENT_RETENTION_MS = 30 * 24 * 3_600_000`); comments older than 30 days are never stored.
- Proposal TTL: a change set with source `comment` expires after 24 h (`COMMENT_PROPOSAL_TTL_MS = 24 * 3_600_000`); every other source keeps 2 h (`PROPOSAL_TTL_MS`).
- Comment limit: `venues.comment_limit` default 300 comment actions (replies + moderations) per calendar month in the venue's zone, same `monthWindow` as the change limit; `comment` sets never count toward `change_limit`.
- Scopes: `IG_PUBLISH_SCOPES` = `instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments`; `FB_SCOPES` = `pages_manage_posts,pages_read_engagement,pages_show_list,pages_read_user_content,pages_manage_engagement`; a destination connected with the new scopes stores `config.comments = true`.
- Defaults: `comment_mode` `each`, `comment_digest_hour` 9 (venue tz), `comment_limit` 300, `COMMENT_DRAFT_MODEL` `claude-haiku-5-5`.
- Meta window: owners on Messenger/Instagram/WhatsApp get a comment proposal only within `PROACTIVE_WINDOW_MS` (23 h) of their last message; otherwise the comment is held (`deferred = true`, status `new`) and retried on the next tick; Telegram owners are never deferred.
- Copy: every owner-facing string exists in Bulgarian and English (`src/bot/copy.ts` BG/EN pairs, `src/i18n/dicts.ts` key parity checked by `test/i18n.test.ts`).
- Tests: every task's tests are committed in the same commit as the code they cover; `npx vitest run` is green before each commit.
- Secrets: Page tokens, Instagram tokens and comment text never appear in logs; log lines carry venue ids, counts and error codes only (`[comments] ...`).

## Review Focus

1. A comment deleted by its author before the owner's ✅: the reply call returns Meta's "not found" class (`MetaApiError.notFound`); the push must not retry and must not stop the other rows of a batch: the sync row ends `done` with `gone: [<comment_id>]`, the comment row becomes `expired` and the owner's line reads "Коментарът вече не съществува" — pinned to Task 7, test "a reply to a comment that no longer exists is not retried, marks the comment expired and says so".
2. The same comment arriving twice (two polls, or a Facebook page whose `since` filter returns it again): `upsertComments` must ignore a known `comment_id` so no second proposal is ever made — pinned to Task 2, test "upsertComments inserts new comment ids only and returns just the inserted rows", and Task 4, test "a second poll inside the window makes no call; after 15 minutes it polls again and stores nothing twice".
3. A venue with two owners who both tap within seconds: `handleDecision` must apply once, conclude the other owner's message with "решено от друг собственик", and answer the late tap with "вече решено" — pinned to Task 6, test "two owners: the first tap applies, the second owner's message is concluded and a later tap answers already decided".
4. A digest at 09:00 Sofia across the DST change (25 Oct 2026, 04:00 EEST → 03:00 EET): the digest must go out once on the 24th at 06:00Z and once on the 25th not before 07:00Z — pinned to Task 8, test "sends the digest once a day at the venue's local hour across the DST change".
5. An Instagram token that expires between the poll and the reply: the poll stored the comment; the reply push gets Meta code 190 → `sm_meta_token`, no retry, destination `error`, the owner's line says to reconnect, the comment stays `proposed` (nothing is marked replied) — pinned to Task 7, test "a revoked Instagram token fails the reply without retry, marks the destination and leaves the comment proposed".

## File Structure

Create:

- `src/domain/comment-preview.ts` — preview lines (BG/EN) for `social_reply` and `social_moderate` rows and their undo rows.
- `src/social/comments-graph.ts` — Graph reads and writes for comments (list, reply, hide/unhide/delete, delete reply) on both networks, normalised to `IncomingComment`.
- `src/social/comments-poll.ts` — `pollVenueComments`: which posts to read, the 15-minute cadence, own-account/nested/old filtering, upsert, error classification; `purgeOldComments`.
- `src/social/comments-draft.ts` — `draftReply`: the one small-model call, JSON parsing, validation, the neutral fallback.
- `src/social/comments-propose.ts` — `createCommentSet` (rows → change set → proposals to every reachable owner) and `proposeForComments` (draft + create, `each` or batch), the comment-limit check, `commentsOfSet`, `cancelCommentSet`.
- `src/destinations/comment-push.ts` — `pushCommentChanges`: the shared reply/moderate/undo loop both adapters run over their comment rows, idempotent through `prior`.
- `src/social/comments-status.ts` — `afterSocialPush`: `social_comments` status updates from a sync result.
- `src/social/comments-digest.ts` — `runCommentDigests`: once a day at `comment_digest_hour` in the venue's zone.
- `src/agent/comment-tools.ts` — `list_comments`, `reply_to_comments`, `set_comment_mode` agent tools.
- `app/admin/[slug]/components/CommentsCard.tsx` — the dashboard "Коментари" card.
- `scripts/social-comments-live-check.mts` — lists the comments of the latest post of a real Instagram account, replies to one by id, deletes the reply.
- `test/comment-preview.test.ts`, `test/comments-graph.test.ts`, `test/comments-poll.test.ts`, `test/comments-draft.test.ts`, `test/comments-propose.test.ts`, `test/comments-adapters.test.ts`, `test/comments-digest.test.ts`, `test/agent-comment-tools.test.ts`, `test/admin-comments.test.tsx`, `test/comments-connect.test.ts`.

Modify:

- `src/domain/types.ts` — `social_reply` / `social_moderate` ops, entities and row types, `CommentNetwork`, `CommentMode`, `ChangeSource` `comment`, `set_comment_mode` op, venue comment fields, `ChangeSet.proposal_refs`.
- `src/domain/changes.ts` — validate/plan `set_comment_mode`.
- `src/domain/preview.ts` — dispatch the new entities to `comment-preview.ts`; the `set_comment_mode` line.
- `src/domain/limits.ts` — `countsTowardLimit("comment") === false`; `COMMENT_LIMIT_DEFAULT`.
- `src/store/types.ts` — `SocialComment` and friends, the new store methods, `NewVenue`/`VenuePatch`/`NewChangeSet`/`ChangeSetPatch` fields.
- `src/store/memory.ts`, `src/store/supabase.ts` — both implementations; `countAppliedChangeSets` excludes `comment`.
- `supabase/schema.sql` — venue columns + constraints, `change_sets.proposal_refs`, `change_sets_source_check`.
- `supabase/schema-integrations.sql` — `changes_entity_check` with the new entities, the `social_comments` table.
- `supabase/policies-integrations.sql`, `scripts/check-rls.mts` — RLS on `social_comments`, anon cannot read it.
- `src/server/site.ts` — `PublicVenue` strips the comment fields.
- `src/destinations/social-common.ts` — `relevantFor` keeps comment rows of the network; `publishedTargets`.
- `src/destinations/facebook.ts`, `src/destinations/instagram.ts` — push `social_reply` / `social_moderate` rows, undo, not-found handling; `freshInstagramToken` export.
- `src/destinations/social-lines.ts`, `src/destinations/social-errors.ts` — lines and error texts for replies and moderation.
- `src/destinations/sync.ts` — `afterSocialPush` hook after a push.
- `src/bot/copy.ts` — comment proposal, conclusion, limit and expiry copy (BG/EN).
- `src/bot/approvals.ts` — any owner may decide a `comment` set; other owners' messages concluded; comment statuses on ❌.
- `src/bot/progress.ts` — labels for the new tools.
- `src/agent/tools.ts` — `ensureNoPending` ignores `comment` sets; registers `commentTools`.
- `src/agent/prompt.ts` — rule 14 and the ✏️ comment context in `userMessage`.
- `src/agent/run.ts` — loads the corrected comment set's rows for the ✏️ context.
- `src/tick.ts` — per-source TTL in step 1 (concluding every owner's message), steps 9 (poll + propose + purge) and 10 (digest).
- `src/server/deps.ts` — `comments` tick deps (draft function) and `COMMENT_DRAFT_MODEL`.
- `src/server/tick.ts` — passes `comments` deps.
- `src/config.ts`, `.env.example`, `test/config.test.ts` — `COMMENT_DRAFT_MODEL`.
- `src/server/admin.ts`, `app/api/admin/[slug]/route.ts`, `app/admin/[slug]/components/AdminPanel.tsx`, `src/i18n/dicts.ts` — overview, actions, card, keys.
- `src/server/social-connect.ts` — scopes and the `comments` capability flag.
- `test/fake-meta.ts` — comments, replies, hide/unhide/delete on both hosts.
- `test/store-contract.ts`, `test/site-server.test.ts`, `test/supabase-mappers.test.ts`, `test/social-connect.test.ts`, `test/change-limit.test.ts` — extended.
- `README.md`, `docs/CHANNELS.md` — the owner-facing section and the phase-2 webhook note.

---

## Task 1: Domain types, preview lines, limit rule, SQL constraints

**Files:**
- Modify: `src/domain/types.ts` (the social block at the end, `ChangeSource`, `ChangeOp`, `OP_NAMES`)
- Modify: `src/domain/limits.ts` (`countsTowardLimit`)
- Modify: `src/domain/preview.ts` (the `switch` at the end of `renderPreview`, lines 198-208)
- Create: `src/domain/comment-preview.ts`
- Modify: `src/bot/progress.ts` (`LABELS`)
- Modify: `supabase/schema-integrations.sql` (the `changes_entity_check` block)
- Modify: `supabase/schema.sql` (the `change_sets` table and a new constraint block after `change_sets_applied_idx`)
- Modify: `src/i18n/dicts.ts` (`admin.source.comment` in both languages)
- Test: `test/comment-preview.test.ts`

**Interfaces:**

Consumes: `Change`, `Lang`, `Row` from `src/domain/types.ts`; `quote`, `tr` from `src/domain/format.ts`.

Produces (in `src/domain/types.ts`):

```ts
export type CommentNetwork = "facebook" | "instagram";
export type CommentMode = "each" | "digest" | "off";
export const COMMENT_MODES: readonly CommentMode[] = ["each", "digest", "off"];
export type SocialOpName = "social_post" | "social_reply" | "social_moderate";
export type SocialEntity = "social_post" | "social_reply" | "social_moderate";
export const SOCIAL_ENTITIES: readonly SocialEntity[] = ["social_post", "social_reply", "social_moderate"];
export type ModerateAction = "hide" | "unhide" | "delete";
export interface SocialReplyRow { network: CommentNetwork; comment_id: string; post_ref: string; author_name: string; comment_text: string; reply_text: string; permalink?: string }
export interface SocialModerateRow { network: CommentNetwork; comment_id: string; author_name: string; comment_text: string; action: ModerateAction }
export function isSocialEntity(e: string): e is SocialEntity;
export type ChangeSource = "text" | "voice" | "photo" | "dashboard" | "auto" | "undo" | "comment";
// ChangeOp gains: | { op: "set_comment_mode"; mode: CommentMode; digest_hour?: number }
```

Produces (in `src/domain/comment-preview.ts`):

```ts
export function commentPreviewLines(c: Change, lang: Lang): string[];
export function excerpt(text: string, max?: number): string; // first line, ≤ max chars (default 60), "…" when cut
```

- [ ] **Step 1: Write the failing test** `test/comment-preview.test.ts`:

```ts
// test/comment-preview.test.ts — social_reply / social_moderate rows in the change engine and their preview lines.
import { describe, expect, it } from "vitest";
import { applyChange, invertChanges, planChange, validateChange } from "@/src/domain/changes";
import { commentPreviewLines, excerpt } from "@/src/domain/comment-preview";
import { countsTowardLimit } from "@/src/domain/limits";
import { renderPreview } from "@/src/domain/preview";
import { COMMENT_MODES, isExternalEntity, isSocialEntity, OP_NAMES, SOCIAL_ENTITIES, type Change } from "@/src/domain/types";
import { progressLabel } from "@/src/bot/progress";
import { state, TZ } from "./fixtures";

const reply: Change = {
  position: 0, op: "social_reply", entity: "social_reply", entity_id: "17890000000000001", before: null,
  after: { network: "instagram", comment_id: "17890000000000001", post_ref: "17950000000000002", author_name: "Мария", comment_text: "Имате ли безглутенови?", reply_text: "Да, имаме безглутенов хляб всеки ден." },
};
const hide: Change = {
  position: 0, op: "social_moderate", entity: "social_moderate", entity_id: "9001", before: null,
  after: { network: "facebook", comment_id: "9001", author_name: "Spam Bot", comment_text: "Buy followers at ...", action: "hide" },
};
const del: Change = { ...hide, after: { ...hide.after, action: "delete" } };

describe("comment entities in the change engine", () => {
  it("are external social entities and apply as no-ops", () => {
    expect(SOCIAL_ENTITIES).toEqual(["social_post", "social_reply", "social_moderate"]);
    expect(isSocialEntity("social_reply")).toBe(true);
    expect(isSocialEntity("wp_page")).toBe(false);
    expect(isExternalEntity("social_reply")).toBe(true);
    expect(isExternalEntity("social_moderate")).toBe(true);
    expect(COMMENT_MODES).toEqual(["each", "digest", "off"]);
    expect(OP_NAMES).toContain("set_comment_mode");
    const s = state();
    expect(applyChange(s, reply)).toEqual(s);
    expect(applyChange(s, hide)).toEqual(s);
    const [inv] = invertChanges([reply]);
    expect(inv).toMatchObject({ op: "social_reply", before: reply.after, after: null });
  });

  it("comment sets never count toward the monthly change limit", () => {
    expect(countsTowardLimit("comment")).toBe(false);
    expect(countsTowardLimit("text")).toBe(true);
    expect(countsTowardLimit("undo")).toBe(false);
  });

  it("set_comment_mode is a venue change with both fields and a preview line", () => {
    const s = state();
    const ctx = { newId: () => "n", now: "2026-10-15T09:00:00.000Z" };
    expect(validateChange(s, { op: "set_comment_mode", mode: "digest", digest_hour: 10 }, ctx)).toBeNull();
    expect(validateChange(s, { op: "set_comment_mode", mode: "digest", digest_hour: 24 }, ctx)).toMatch(/digest_hour/);
    expect(validateChange(s, { op: "set_comment_mode", mode: "weekly" as never }, ctx)).toMatch(/mode/);
    const c = planChange(s, { op: "set_comment_mode", mode: "digest", digest_hour: 10 }, ctx);
    expect(c).toMatchObject({ entity: "venue", entity_id: s.venue.id, before: { comment_mode: "each", comment_digest_hour: 9 }, after: { comment_mode: "digest", comment_digest_hour: 10 } });
    expect(renderPreview(s, [c], "bg", TZ)).toBe("• Известия за коментари: при всеки → веднъж дневно в 10:00");
    expect(renderPreview(s, [c], "en", TZ)).toBe("• Comment notifications: each comment → once a day at 10:00");
    const off = planChange(s, { op: "set_comment_mode", mode: "off" }, ctx);
    expect(off.after).toEqual({ comment_mode: "off", comment_digest_hour: 9 });
    expect(renderPreview(s, [off], "bg", TZ)).toBe("• Известия за коментари: при всеки → изключени");
  });
});

describe("commentPreviewLines", () => {
  it("shows a reply as comment → reply, in both languages", () => {
    expect(commentPreviewLines(reply, "bg")).toEqual(["• Отговор на коментар от Мария (Instagram): „Имате ли безглутенови?“ → „Да, имаме безглутенов хляб всеки ден.“"]);
    expect(commentPreviewLines(reply, "en")).toEqual(["• Reply to a comment by Мария (Instagram): “Имате ли безглутенови?” → “Да, имаме безглутенов хляб всеки ден.”"]);
    expect(renderPreview(state(), [reply], "bg", TZ)).toContain("Отговор на коментар от Мария");
  });
  it("shows an undo of a reply as a removal", () => {
    const [inv] = invertChanges([reply]);
    expect(commentPreviewLines(inv, "bg")).toEqual(["• Изтрива отговора на коментара от Мария (Instagram)"]);
    expect(commentPreviewLines(inv, "en")).toEqual(["• Deletes the reply to Мария's comment (Instagram)"]);
  });
  it("shows hide, delete (not undoable) and their undo rows", () => {
    expect(commentPreviewLines(hide, "bg")).toEqual(["• Скрива коментар от Spam Bot (Facebook): „Buy followers at ...“"]);
    expect(commentPreviewLines(hide, "en")).toEqual(["• Hides a comment by Spam Bot (Facebook): “Buy followers at ...”"]);
    expect(commentPreviewLines(del, "bg")).toEqual(["• Изтрива коментар от Spam Bot (Facebook): „Buy followers at ...“", "  (изтриването не може да се отмени)"]);
    expect(commentPreviewLines(del, "en")).toEqual(["• Deletes a comment by Spam Bot (Facebook): “Buy followers at ...”", "  (a deletion cannot be undone)"]);
    const [unhide] = invertChanges([hide]);
    expect(commentPreviewLines(unhide, "bg")).toEqual(["• Показва отново коментара от Spam Bot (Facebook)"]);
    expect(commentPreviewLines(unhide, "en")).toEqual(["• Shows Spam Bot's comment again (Facebook)"]);
    const [undel] = invertChanges([del]);
    expect(commentPreviewLines(undel, "bg")).toEqual(["• Коментарът от Spam Bot е изтрит и не може да бъде върнат (Facebook)"]);
    expect(commentPreviewLines(undel, "en")).toEqual(["• Spam Bot's comment was deleted and cannot be restored (Facebook)"]);
  });
  it("cuts long comments to one line of 60 characters", () => {
    expect(excerpt("a".repeat(80))).toBe(`${"a".repeat(59)}…`);
    expect(excerpt("first line\nsecond")).toBe("first line…");
    expect(excerpt("short")).toBe("short");
    const long = { ...reply, after: { ...reply.after, comment_text: "x".repeat(100) } };
    expect(commentPreviewLines(long, "bg")[0]).toContain(`„${"x".repeat(59)}…“`);
  });
  it("has progress labels for the comment tools", () => {
    expect(progressLabel("reply_to_comments", "bg")).toBe("💬 Подготвям отговора…");
    expect(progressLabel("list_comments", "en")).toBe("💬 Reading the comments…");
    expect(progressLabel("set_comment_mode", "en")).toBe("💬 Preparing the proposal…");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run test/comment-preview.test.ts
```

Expected: fails to compile/import: `@/src/domain/comment-preview` does not exist; `isSocialEntity`, `SOCIAL_ENTITIES`, `COMMENT_MODES` are not exported.

- [ ] **Step 3: Domain types.** In `src/domain/types.ts` replace the social block (from `// --- Social posting (social track, appended 2026-10-11) ---` to the end) with:

```ts
// --- Social posting (social track, appended 2026-10-11) and comment replies (2026-10-15) ---
/** Ops produced by the social tools (src/agent/social-tools.ts, src/agent/comment-tools.ts) and the comment poller; never by planChange. */
export type SocialOpName = "social_post" | "social_reply" | "social_moderate";
/** Entities that live on Facebook/Instagram: the store applies them as no-ops, the destinations publish them. */
export type SocialEntity = "social_post" | "social_reply" | "social_moderate";
export const SOCIAL_ENTITIES: readonly SocialEntity[] = ["social_post", "social_reply", "social_moderate"];
export function isSocialEntity(e: string): e is SocialEntity {
  return (SOCIAL_ENTITIES as readonly string[]).includes(e);
}
export type SocialTarget = "facebook_post" | "facebook_story" | "instagram_post" | "instagram_story";
export const SOCIAL_TARGETS: readonly SocialTarget[] = ["facebook_post", "facebook_story", "instagram_post", "instagram_story"];
/** `after` of a social_post row (entity_id = our media id); undo swaps it into `before`. */
export interface SocialPostRow {
  media_id: string;
  image_url: string;
  caption: string;
  targets: SocialTarget[];
  /** Instagram feed only: a padded JPEG copy (our storage) when the photo is outside 4:5..1.91:1. */
  ig_feed_image_url?: string;
  ig_feed_ratio?: "4:5" | "1.91:1";
}
/** Entities that live outside our database (the owner's WordPress site, Facebook, Instagram): applied as no-ops, written by destination pushes. */
export function isExternalEntity(e: string): e is WpEntity | SocialEntity {
  return isWpEntity(e) || isSocialEntity(e);
}

// --- Comment replies (2026-10-15) ---
export type CommentNetwork = "facebook" | "instagram";
/** How the owner hears about new comments: one proposal each, one digest a day, or only on the dashboard. */
export type CommentMode = "each" | "digest" | "off";
export const COMMENT_MODES: readonly CommentMode[] = ["each", "digest", "off"];
export type ModerateAction = "hide" | "unhide" | "delete";
/** `after` of a social_reply row (entity_id = Meta's comment id); undo swaps it into `before` and the adapter deletes the reply. */
export interface SocialReplyRow {
  network: CommentNetwork;
  comment_id: string;
  post_ref: string;
  author_name: string;
  comment_text: string;
  reply_text: string;
  permalink?: string;
}
/** `after` of a social_moderate row (entity_id = Meta's comment id). Undo of hide un-hides; a delete cannot be undone. */
export interface SocialModerateRow {
  network: CommentNetwork;
  comment_id: string;
  author_name: string;
  comment_text: string;
  action: ModerateAction;
}
```

Then change `ChangeSource`:

```ts
/** "comment": made by the comment poller or reply_to_comments; sent to every owner, 24 h TTL, outside the monthly change limit. */
export type ChangeSource = "text" | "voice" | "photo" | "dashboard" | "auto" | "undo" | "comment";
```

Add to `ChangeOp` (after `set_theme`) and to `OP_NAMES`:

```ts
  | { op: "set_comment_mode"; mode: CommentMode; digest_hour?: number };
```

```ts
  "set_text", "set_theme", "set_comment_mode",
```

Add to `Venue` (after `change_limit`):

```ts
  /** Comment replies (2026-10-15). Server-only, never in the public feed. */
  comment_mode: CommentMode;
  /** 0–23, the venue's local hour for the daily digest. */
  comment_digest_hour: number;
  /** Comment actions (replies + moderations) per calendar month; null = unlimited. Default 300. */
  comment_limit: number | null;
  /** ISO of the last digest sent (or skipped for lack of comments); one per local day. */
  last_comment_digest_at: string | null;
```

Add to `ChangeSet` (after `message_ref`):

```ts
  /** Comment sets: one proposal message per owner chat, `{ "<chat_ref>": "<message_ref>" }`; chat_ref/message_ref keep the first owner. */
  proposal_refs: Record<string, string> | null;
```

(The venue and change-set fields are typed here so Task 2 can fill them in both stores; until Task 2 the test fixtures below give them values.)

- [ ] **Step 4: `set_comment_mode` in `src/domain/changes.ts`.** Import `COMMENT_MODES` from `./types`. In `validateChange` add before `default:`:

```ts
    case "set_comment_mode": {
      if (!(COMMENT_MODES as readonly string[]).includes(op.mode)) return `mode must be one of ${COMMENT_MODES.join(", ")}.`;
      if (op.digest_hour !== undefined && !(Number.isInteger(op.digest_hour) && op.digest_hour >= 0 && op.digest_hour <= 23)) return "digest_hour must be a whole hour 0–23 in the venue's time zone.";
      return null;
    }
```

In `planChange` add before the closing of the switch:

```ts
    case "set_comment_mode": {
      const after: Row = { comment_mode: op.mode, comment_digest_hour: op.digest_hour ?? v.comment_digest_hour };
      return change(position, op, "venue", v.id, { comment_mode: v.comment_mode, comment_digest_hour: v.comment_digest_hour }, after);
    }
```

- [ ] **Step 5: Limit rule.** In `src/domain/limits.ts` change `countsTowardLimit` and add the default:

```ts
/** Comment actions a venue may take per calendar month when `comment_limit` is not set explicitly (spec decision 1). */
export const COMMENT_LIMIT_DEFAULT = 300;

/** Whether an applied set of this source uses up one change of the month. Comment replies are reactions, not changes (they have their own cap). */
export function countsTowardLimit(source: ChangeSource): boolean {
  return source !== "undo" && source !== "auto" && source !== "comment";
}
```

- [ ] **Step 6: Preview lines.** Create `src/domain/comment-preview.ts`:

```ts
// src/domain/comment-preview.ts
// Preview lines for social_reply and social_moderate rows (replies and moderation of customer comments on the venue's
// Facebook Page / Instagram account). Pure; both languages; undo-safe (an inverted row has after = null).
import { quote, tr } from "./format";
import type { Change, Lang, Row } from "./types";

const NAME: Record<string, string> = { facebook: "Facebook", instagram: "Instagram" };
export const EXCERPT_MAX = 60;

/** The first line of a comment, at most `max` characters, "…" when cut. */
export function excerpt(text: string, max = EXCERPT_MAX): string {
  const line = text.split("\n")[0].trim();
  const cut = line.length < text.trim().length || line.length > max;
  return cut ? `${Array.from(line).slice(0, max - 1).join("")}…` : line;
}

function rowOf(c: Change): Row {
  return c.after ?? c.before ?? {};
}
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function commentPreviewLines(c: Change, lang: Lang): string[] {
  const row = rowOf(c);
  const net = NAME[str(row.network)] ?? str(row.network);
  const author = str(row.author_name) || tr(lang, "клиент", "a customer");
  const text = quote(excerpt(str(row.comment_text)), lang);
  if (c.entity === "social_reply") {
    if (c.after === null) return [`• ${tr(lang, `Изтрива отговора на коментара от ${author}`, `Deletes the reply to ${author}'s comment`)} (${net})`];
    return [`• ${tr(lang, `Отговор на коментар от ${author}`, `Reply to a comment by ${author}`)} (${net}): ${text} → ${quote(str(row.reply_text), lang)}`];
  }
  const action = str(row.action);
  if (c.after === null) {
    // Undo of a moderation: a hidden comment is shown again; a deleted one is gone for good.
    if (action === "delete") return [`• ${tr(lang, `Коментарът от ${author} е изтрит и не може да бъде върнат`, `${author}'s comment was deleted and cannot be restored`)} (${net})`];
    if (action === "unhide") return [`• ${tr(lang, `Скрива коментар от ${author}`, `Hides a comment by ${author}`)} (${net}): ${text}`];
    return [`• ${tr(lang, `Показва отново коментара от ${author}`, `Shows ${author}'s comment again`)} (${net})`];
  }
  if (action === "delete") return [`• ${tr(lang, `Изтрива коментар от ${author}`, `Deletes a comment by ${author}`)} (${net}): ${text}`, `  (${tr(lang, "изтриването не може да се отмени", "a deletion cannot be undone")})`];
  if (action === "unhide") return [`• ${tr(lang, `Показва отново коментара от ${author}`, `Shows ${author}'s comment again`)} (${net})`];
  return [`• ${tr(lang, `Скрива коментар от ${author}`, `Hides a comment by ${author}`)} (${net}): ${text}`];
}
```

- [ ] **Step 7: Dispatch in `src/domain/preview.ts`.** Add `import { commentPreviewLines } from "./comment-preview";` and in the `switch` after the `social_post` case:

```ts
      case "social_reply":
      case "social_moderate":
        lines.push(...commentPreviewLines(c, lang));
        break;
      case "set_comment_mode": {
        const mode = (m: unknown) => (m === "each" ? tr(lang, "при всеки", "each comment") : m === "off" ? tr(lang, "изключени", "off") : null);
        const hour = (h: unknown) => `${String(h ?? 9).padStart(2, "0")}:00`;
        const label = (row: Row) => mode(row.comment_mode) ?? tr(lang, `веднъж дневно в ${hour(row.comment_digest_hour)}`, `once a day at ${hour(row.comment_digest_hour)}`);
        lines.push(`• ${tr(lang, "Известия за коментари", "Comment notifications")}: ${label(b)} → ${label(a)}`);
        break;
      }
```

(`b` and `a` are the `before`/`after` rows the switch already reads for the other cases; `Row` is already imported there.)

- [ ] **Step 8: Progress labels.** In `src/bot/progress.ts` add to `LABELS`:

```ts
  list_comments: ["💬 Чета коментарите…", "💬 Reading the comments…"],
  reply_to_comments: ["💬 Подготвям отговора…", "💬 Preparing the reply…"],
  set_comment_mode: ["💬 Подготвям предложението…", "💬 Preparing the proposal…"],
```

- [ ] **Step 9: SQL constraints and the source chip.** In `supabase/schema-integrations.sql` replace the `changes_entity_check` add with:

```sql
alter table public.changes drop constraint if exists changes_entity_check;
alter table public.changes add constraint changes_entity_check
  check (entity in ('venue', 'category', 'item', 'holiday', 'announcement', 'media', 'site_text', 'wp_page', 'wp_media', 'wp_option', 'wp_menu', 'wp_product', 'social_post', 'social_reply', 'social_moderate'));
```

In `supabase/schema.sql` change the inline check in `create table if not exists public.change_sets` to `check (source in ('text', 'voice', 'photo', 'dashboard', 'auto', 'undo', 'comment'))` and add after `change_sets_applied_idx`:

```sql
-- Comment replies (2026-10-15): proposals made by the comment poller / reply_to_comments. Re-created so an existing database learns the new source.
alter table public.change_sets drop constraint if exists change_sets_source_check;
alter table public.change_sets add constraint change_sets_source_check
  check (source in ('text', 'voice', 'photo', 'dashboard', 'auto', 'undo', 'comment'));
```

In `src/i18n/dicts.ts` add after `"admin.source.undo"` in `en`: `"admin.source.comment": "comment",` and in `bg`: `"admin.source.comment": "коментар",`.

- [ ] **Step 10: Fixtures.** In `test/fixtures.ts` `venue()` add after `change_limit: null,`: `comment_mode: "each", comment_digest_hour: 9, comment_limit: 300, last_comment_digest_at: null,`. The stores do not know these fields until Task 2; `tsc` will complain in `src/store/memory.ts` `createVenue` and `src/store/supabase.ts` `toVenue` (missing properties). Add them now with the defaults so the tree typechecks: in `src/store/memory.ts` `createVenue` after `change_limit: v.change_limit ?? null,` add `comment_mode: "each", comment_digest_hour: 9, comment_limit: 300, last_comment_digest_at: null,`; in `createChangeSet` after `message_ref: cs.message_ref ?? null,` add `proposal_refs: null,`. In `src/store/supabase.ts` `toVenue` after the `change_limit` line add `comment_mode: "each", comment_digest_hour: 9, comment_limit: 300, last_comment_digest_at: null,` and in `toChangeSet` after `message_ref` add `proposal_refs: null,`. Task 2 replaces these with the real columns.

- [ ] **Step 11: Run the tests and the typecheck**

```
npx vitest run test/comment-preview.test.ts test/social-preview.test.ts test/preview.test.ts test/changes.test.ts test/limits.test.ts test/i18n.test.ts test/progress.test.ts
npm run typecheck
```

Expected: all green; `test/limits.test.ts` still passes (it tests `undo`/`auto`), `test/i18n.test.ts` sees `admin.source.comment` in both dictionaries.

- [ ] **Step 12: Commit**

```
git add src/domain/types.ts src/domain/changes.ts src/domain/limits.ts src/domain/preview.ts src/domain/comment-preview.ts src/bot/progress.ts src/store/memory.ts src/store/supabase.ts src/i18n/dicts.ts supabase/schema.sql supabase/schema-integrations.sql test/fixtures.ts test/comment-preview.test.ts
git commit -m "Comments: social_reply/social_moderate entities, comment source, set_comment_mode op, preview lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: Store — `social_comments`, venue comment fields, `proposal_refs`, contract tests

**Files:**
- Modify: `src/store/types.ts` (`NewVenue`, `VenuePatch`, `NewChangeSet`, `ChangeSetPatch`; a new "Comment replies" block at the end)
- Modify: `src/store/memory.ts` (`createVenue`, `createChangeSet`, `deleteVenue`, `clearVenueContent`, `countAppliedChangeSets`; a new block at the end)
- Modify: `src/store/supabase.ts` (`toVenue`, `toChangeSet`, `createChangeSet`, `countAppliedChangeSets`; a new block at the end; `toComment` mapper)
- Modify: `src/server/site.ts` (`PublicVenue`, `publicSiteState`, lines 52-66)
- Modify: `supabase/schema.sql` (venue columns, `change_sets.proposal_refs`), `supabase/schema-integrations.sql` (`social_comments`), `supabase/policies-integrations.sql`, `supabase/policies.sql` (comment line 22 only), `scripts/check-rls.mts` (the last loop)
- Test: `test/store-contract.ts` (new `it` blocks at the end; two existing limit tests extended), `test/site-server.test.ts` (lines 65-68), `test/supabase-mappers.test.ts` (line 14-16), `test/policies-grants.test.ts` (the secret list)

**Interfaces:**

Consumes: `CommentMode`, `CommentNetwork`, `Venue`, `ChangeSet` from `src/domain/types.ts`; `COMMENT_LIMIT_DEFAULT` from `src/domain/limits.ts`.

Produces (in `src/store/types.ts`):

```ts
export type CommentStatus = "new" | "proposed" | "replied" | "ignored" | "expired" | "own" | "nested" | "hidden" | "deleted";
export const COMMENT_STATUSES: readonly CommentStatus[];
export interface SocialComment {
  id: string; venue_id: string; network: CommentNetwork; post_ref: string; comment_id: string; parent_id: string | null;
  author_id: string; author_name: string; text: string; created_at: string; seen_at: string; status: CommentStatus;
  change_set_id: string | null; reply_id: string | null; replied_at: string | null;
  post_caption: string; post_permalink: string | null; draft_text: string | null; draft_kind: string | null; deferred: boolean;
}
export type NewSocialComment = Pick<SocialComment, "network" | "post_ref" | "comment_id" | "parent_id" | "author_id" | "author_name" | "text" | "created_at" | "seen_at" | "status" | "post_caption"> & { post_permalink?: string | null };
export type SocialCommentPatch = Partial<Pick<SocialComment, "status" | "change_set_id" | "reply_id" | "replied_at" | "draft_text" | "draft_kind" | "deferred">>;
export interface Store {
  upsertComments(venueId: string, rows: NewSocialComment[]): Promise<SocialComment[]>;           // inserted rows only; known comment_ids ignored
  listComments(venueId: string, opts?: { status?: CommentStatus[]; limit?: number; since?: string }): Promise<SocialComment[]>; // newest first
  getComment(id: string): Promise<SocialComment | null>;
  findComment(venueId: string, commentId: string): Promise<SocialComment | null>;                 // by Meta's comment id
  updateComment(id: string, patch: SocialCommentPatch): Promise<void>;
  purgeComments(before: string): Promise<number>;                                                 // created_at < before, every venue
  countCommentActions(venueId: string, fromIso: string, toIso: string): Promise<number>;         // status replied|hidden|deleted with replied_at in [from, to)
}
// NewVenue gains comment_mode?, comment_digest_hour?, comment_limit?; VenuePatch gains the four venue comment fields;
// NewChangeSet and ChangeSetPatch gain proposal_refs?: Record<string, string> | null.
```

- [ ] **Step 1: Write the failing contract tests.** Append to `test/store-contract.ts` inside the `describe` (before its closing `});`):

```ts
    // --- Comment replies (appended 2026-10-15) ---
    it("stores the venue's comment settings with defaults (each, 9, 300) and updates them", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "tc1", name: "Test" });
      expect(v).toMatchObject({ comment_mode: "each", comment_digest_hour: 9, comment_limit: 300, last_comment_digest_at: null });
      const w = await s.createVenue({ slug: "tc2", name: "Test", comment_mode: "digest", comment_digest_hour: 10, comment_limit: null });
      expect(w).toMatchObject({ comment_mode: "digest", comment_digest_hour: 10, comment_limit: null });
      const u = await s.updateVenue(v.id, { comment_mode: "off", comment_digest_hour: 8, comment_limit: 50, last_comment_digest_at: LATER });
      expect(u).toMatchObject({ comment_mode: "off", comment_digest_hour: 8, comment_limit: 50, last_comment_digest_at: LATER });
      expect(await s.getVenueBySlug("tc1")).toEqual(u);
      expect((await s.updateVenue(v.id, { comment_limit: null })).comment_limit).toBeNull();
    });

    it("upsertComments inserts new comment ids only and returns just the inserted rows", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "tc3", name: "Test" });
      const other = await s.createVenue({ slug: "tc4", name: "Other" });
      const row = (comment_id: string, extra: Partial<NewSocialComment> = {}): NewSocialComment => ({
        network: "instagram", post_ref: "media-1", comment_id, parent_id: null, author_id: "u1", author_name: "Мария", text: `Коментар ${comment_id}`,
        created_at: "2026-10-15T08:00:00.000Z", seen_at: NOW, status: "new", post_caption: "Днешното предложение", ...extra,
      });
      const first = await s.upsertComments(v.id, [row("c1"), row("c2", { created_at: "2026-10-15T08:05:00.000Z" })]);
      expect(first.map((c) => c.comment_id)).toEqual(["c1", "c2"]);
      expect(first[0]).toMatchObject({ venue_id: v.id, status: "new", change_set_id: null, reply_id: null, replied_at: null, draft_text: null, draft_kind: null, deferred: false, post_permalink: null });
      const second = await s.upsertComments(v.id, [row("c2"), row("c3", { parent_id: "c1", status: "nested", created_at: "2026-10-15T08:10:00.000Z" })]);
      expect(second.map((c) => c.comment_id)).toEqual(["c3"]); // c2 was known
      expect(await s.upsertComments(v.id, [])).toEqual([]);
      const listed = await s.listComments(v.id);
      expect(listed.map((c) => c.comment_id)).toEqual(["c3", "c2", "c1"]); // newest created_at first
      expect((await s.listComments(v.id, { status: ["new"] })).map((c) => c.comment_id)).toEqual(["c2", "c1"]);
      expect((await s.listComments(v.id, { status: ["new"], limit: 1 })).map((c) => c.comment_id)).toEqual(["c2"]);
      expect((await s.listComments(v.id, { since: "2026-10-15T08:01:00.000Z" })).map((c) => c.comment_id)).toEqual(["c3", "c2"]);
      expect(await s.listComments(other.id)).toEqual([]);
      expect((await s.findComment(v.id, "c1"))?.id).toBe(first[0].id);
      expect(await s.findComment(other.id, "c1")).toBeNull();
      expect(await s.getComment(first[0].id)).toEqual(first[0]);
      expect(await s.getComment(crypto.randomUUID())).toBeNull();
    });

    it("updates a comment, counts actions in a month window and purges old rows", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "tc5", name: "Test" });
      const cs = await s.createChangeSet({ venue_id: v.id, chat_ref: null, summary_bg: "x", summary_en: "x", preview_bg: "", preview_en: "", source: "comment", status: "proposed", changes: [] });
      const base = { network: "facebook" as const, post_ref: "p1", parent_id: null, author_id: "u", author_name: "A", text: "t", seen_at: NOW, status: "new" as const, post_caption: "" };
      const [a, b, c, old] = await s.upsertComments(v.id, [
        { ...base, comment_id: "fa", created_at: "2026-10-15T08:00:00.000Z" },
        { ...base, comment_id: "fb", created_at: "2026-10-15T08:01:00.000Z" },
        { ...base, comment_id: "fc", created_at: "2026-10-15T08:02:00.000Z" },
        { ...base, comment_id: "fold", created_at: "2026-09-01T08:00:00.000Z" },
      ]);
      await s.updateComment(a.id, { status: "proposed", change_set_id: cs.id, draft_text: "Благодарим!", draft_kind: "praise", deferred: true });
      expect(await s.getComment(a.id)).toMatchObject({ status: "proposed", change_set_id: cs.id, draft_text: "Благодарим!", draft_kind: "praise", deferred: true });
      await s.updateComment(a.id, { status: "replied", reply_id: "r1", replied_at: "2026-10-15T09:00:00.000Z", deferred: false });
      await s.updateComment(b.id, { status: "hidden", replied_at: "2026-10-15T09:01:00.000Z" });
      await s.updateComment(c.id, { status: "replied", reply_id: "r3", replied_at: "2026-11-01T09:00:00.000Z" });
      await s.updateComment(old.id, { status: "ignored" });
      await expect(s.updateComment(crypto.randomUUID(), { status: "ignored" })).rejects.toThrow();
      expect(await s.countCommentActions(v.id, "2026-09-30T21:00:00.000Z", "2026-10-31T22:00:00.000Z")).toBe(2);
      expect(await s.countCommentActions(v.id, "2026-10-31T22:00:00.000Z", "2026-11-30T22:00:00.000Z")).toBe(1);
      expect(await s.purgeComments("2026-09-15T00:00:00.000Z")).toBe(1);
      expect((await s.listComments(v.id)).map((x) => x.comment_id)).toEqual(["fc", "fb", "fa"]);
      expect(await s.purgeComments("2026-09-15T00:00:00.000Z")).toBe(0);
    });

    it("stores one proposal message ref per owner chat on a change set", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "tc6", name: "Test" });
      const cs = await s.createChangeSet({ venue_id: v.id, chat_ref: "tg:10", summary_bg: "x", summary_en: "x", preview_bg: "", preview_en: "", source: "comment", status: "proposed", message_ref: "42", proposal_refs: { "tg:10": "42", "fb:77": "m.9" }, changes: [] });
      expect(cs.proposal_refs).toEqual({ "tg:10": "42", "fb:77": "m.9" });
      const plain = await s.createChangeSet({ venue_id: v.id, chat_ref: "tg:10", summary_bg: "x", summary_en: "x", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [] });
      expect(plain.proposal_refs).toBeNull();
      await s.updateChangeSet(plain.id, { proposal_refs: { "tg:10": "43" } });
      expect((await s.getChangeSet(plain.id)).proposal_refs).toEqual({ "tg:10": "43" });
      expect((await s.listChangeSets(v.id, { status: ["proposed"] })).find((x) => x.id === cs.id)?.proposal_refs).toEqual({ "tg:10": "42", "fb:77": "m.9" });
    });
```

Add `import type { NewSocialComment, Store } from "@/src/store/types";` (replacing the existing `Store` type import). In the existing test "counts applied change sets in [from, to)…" widen the helper's source type to `"text" | "voice" | "dashboard" | "auto" | "undo" | "comment"` and add, after the `auto` line: `await applied("comment", "2026-10-10T10:00:00.000Z"); // replies are reactions, not changes` (the expected counts 3 / 1 / 1 stay). In "refuses to apply a counted set once the month's limit is reached…" add after the `auto` block:

```ts
      // Comment replies have their own cap (comment_limit) and never use a change.
      const reply = await s.createChangeSet({ ...base, chat_ref: null, source: "comment", status: "proposed", changes: [] });
      expect(await s.applyChangeSet(reply.id, LATER)).toBe("applied");
```

In `test/site-server.test.ts` lines 65-68: add `expect("comment_mode" in pub.venue).toBe(false); expect("comment_limit" in pub.venue).toBe(false);` and extend the destructure to `const { deploy: _d, wizard_draft: _w, instagram_import: _i, site_url: _s, change_limit: _l, comment_mode: _cm, comment_digest_hour: _ch, comment_limit: _cl, last_comment_digest_at: _cd, ...rest } = state.venue;` with `void _cm; void _ch; void _cl; void _cd;`. In `test/supabase-mappers.test.ts` line 14 add `comment_mode: "each", comment_digest_hour: 9, comment_limit: 300, last_comment_digest_at: null` to the `toMatchObject` and a line `expect(toVenue({ id: "v", slug: "s", name: "n", comment_limit: null, comment_mode: "off", created_at: "2026-10-09T09:00:00Z" })).toMatchObject({ comment_limit: null, comment_mode: "off" });`. In `test/policies-grants.test.ts` add `"comment_mode", "comment_digest_hour", "comment_limit", "last_comment_digest_at"` to the `secret` list.

- [ ] **Step 2: Run and watch them fail**

```
npx vitest run test/store-memory.test.ts -t "comment"
npx vitest run test/store-memory.test.ts -t "proposal message ref"
```

Expected: `TypeError: s.upsertComments is not a function`; `comment_mode` of the second venue is `"each"` instead of `"digest"` (the Task 1 stub ignores the input); `proposal_refs` is `null` instead of the object.

- [ ] **Step 3: Store types.** In `src/store/types.ts`:
  - `NewVenue`: after `change_limit?` add `comment_mode?: CommentMode; comment_digest_hour?: number; comment_limit?: number | null;`.
  - `VenuePatch`: add `"comment_mode" | "comment_digest_hour" | "comment_limit" | "last_comment_digest_at"` to the `Pick`.
  - `NewChangeSet`: add `proposal_refs?: Record<string, string> | null;` after `message_ref?`.
  - `ChangeSetPatch`: add `"proposal_refs"` to the `Pick`.
  - Import `CommentMode` and `CommentNetwork` from `../domain/types`.
  - Append:

```ts
// --- Comment replies (appended 2026-10-15; spec docs/superpowers/specs/2026-10-15-comment-replies-design.md) ---
/** new: seen, not proposed yet · proposed: a change set is waiting · replied/hidden/deleted: the action went out · ignored: ❌ or un-hidden · expired: the proposal timed out or the comment is gone · own: the venue's own comment · nested: a reply to a reply (never proposed in v1). */
export type CommentStatus = "new" | "proposed" | "replied" | "ignored" | "expired" | "own" | "nested" | "hidden" | "deleted";
export const COMMENT_STATUSES: readonly CommentStatus[] = ["new", "proposed", "replied", "ignored", "expired", "own", "nested", "hidden", "deleted"];
/** One customer comment under a post Site Manager published. Customer content: purged after 30 days (src/social/comments-poll.ts). */
export interface SocialComment {
  id: string;
  venue_id: string;
  network: CommentNetwork;
  /** Meta post id (Facebook) or media id (Instagram). */
  post_ref: string;
  /** Meta's comment id; unique across networks. */
  comment_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  text: string;
  /** When the customer wrote it (Meta's timestamp). */
  created_at: string;
  /** When the poll stored it. */
  seen_at: string;
  status: CommentStatus;
  change_set_id: string | null;
  reply_id: string | null;
  /** When the reply or moderation went out (countCommentActions). */
  replied_at: string | null;
  /** The caption of the post it is under (for the proposal text and the dashboard). */
  post_caption: string;
  post_permalink: string | null;
  /** The drafted reply and its kind, kept so the dashboard and ✏️ show them without a second model call. */
  draft_text: string | null;
  draft_kind: string | null;
  /** Held because no owner could be reached inside Meta's 24 h window; retried by the next tick. */
  deferred: boolean;
}
export type NewSocialComment = Pick<SocialComment, "network" | "post_ref" | "comment_id" | "parent_id" | "author_id" | "author_name" | "text" | "created_at" | "seen_at" | "status" | "post_caption"> & { post_permalink?: string | null };
export type SocialCommentPatch = Partial<Pick<SocialComment, "status" | "change_set_id" | "reply_id" | "replied_at" | "draft_text" | "draft_kind" | "deferred">>;
// Declaration merging: the Store interface above gains the comment methods.
export interface Store {
  /** Inserts the rows whose comment_id is not stored yet and returns exactly those (a comment seen by two polls is stored once). */
  upsertComments(venueId: string, rows: NewSocialComment[]): Promise<SocialComment[]>;
  /** Newest first (created_at, then id). `since` keeps created_at >= since. Default limit 100. */
  listComments(venueId: string, opts?: { status?: CommentStatus[]; limit?: number; since?: string }): Promise<SocialComment[]>;
  getComment(id: string): Promise<SocialComment | null>;
  /** By Meta's comment id, within one venue. */
  findComment(venueId: string, commentId: string): Promise<SocialComment | null>;
  /** Throws on an unknown id. Keys set to undefined are ignored. */
  updateComment(id: string, patch: SocialCommentPatch): Promise<void>;
  /** Deletes every venue's rows with created_at < before; returns how many. */
  purgeComments(before: string): Promise<number>;
  /** Replies and moderations that went out in [fromIso, toIso): rows with status replied, hidden or deleted and replied_at in the window. */
  countCommentActions(venueId: string, fromIso: string, toIso: string): Promise<number>;
}
```

- [ ] **Step 4: Memory store.** In `src/store/memory.ts`:
  - imports: add `COMMENT_LIMIT_DEFAULT` from `../domain/limits`, and `type NewSocialComment, type SocialComment, type SocialCommentPatch, type CommentStatus` from `./types`.
  - `createVenue`: replace the Task 1 stub line with `comment_mode: v.comment_mode ?? "each", comment_digest_hour: v.comment_digest_hour ?? 9, comment_limit: v.comment_limit === undefined ? COMMENT_LIMIT_DEFAULT : v.comment_limit, last_comment_digest_at: null,`.
  - `createChangeSet`: replace `proposal_refs: null,` with `proposal_refs: cs.proposal_refs ? clone(cs.proposal_refs) : null,`.
  - `countAppliedChangeSets` already uses `countsTowardLimit` (Task 1 excludes `comment`): nothing to change.
  - `deleteVenue`: add `for (const [cid, c] of this.comments) if (c.venue_id === id) this.comments.delete(cid);`. `clearVenueContent`: the same line with `venueId`.
  - Append inside the class:

```ts
  // --- Comment replies (appended 2026-10-15) ---
  comments = new Map<string, SocialComment>(); // by row id
  async upsertComments(venueId: string, rows: NewSocialComment[]) {
    this.site(venueId);
    const known = new Set([...this.comments.values()].map((c) => c.comment_id));
    const out: SocialComment[] = [];
    for (const r of rows) {
      if (known.has(r.comment_id)) continue;
      known.add(r.comment_id);
      const row: SocialComment = { id: crypto.randomUUID(), venue_id: venueId, ...clone(r), post_permalink: r.post_permalink ?? null, change_set_id: null, reply_id: null, replied_at: null, draft_text: null, draft_kind: null, deferred: false };
      this.comments.set(row.id, row);
      out.push(clone(row));
    }
    return out;
  }
  async listComments(venueId: string, opts: { status?: CommentStatus[]; limit?: number; since?: string } = {}) {
    return [...this.comments.values()]
      .filter((c) => c.venue_id === venueId && (!opts.status || opts.status.includes(c.status)) && (!opts.since || c.created_at >= opts.since))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(0, opts.limit ?? 100)
      .map(clone);
  }
  async getComment(id: string) {
    const c = this.comments.get(id);
    return c ? clone(c) : null;
  }
  async findComment(venueId: string, commentId: string) {
    const c = [...this.comments.values()].find((x) => x.venue_id === venueId && x.comment_id === commentId);
    return c ? clone(c) : null;
  }
  async updateComment(id: string, patch: SocialCommentPatch) {
    const c = this.comments.get(id);
    if (!c) throw new Error(`comment ${id} not found`);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (c as unknown as Record<string, unknown>)[k] = v;
  }
  async purgeComments(before: string) {
    let n = 0;
    for (const [id, c] of this.comments) {
      if (c.created_at < before) {
        this.comments.delete(id);
        n++;
      }
    }
    return n;
  }
  async countCommentActions(venueId: string, fromIso: string, toIso: string) {
    return [...this.comments.values()].filter((c) => c.venue_id === venueId && (c.status === "replied" || c.status === "hidden" || c.status === "deleted") && c.replied_at !== null && c.replied_at >= fromIso && c.replied_at < toIso).length;
  }
```

- [ ] **Step 5: Supabase store.** In `src/store/supabase.ts`:
  - imports: `COMMENT_LIMIT_DEFAULT` from `../domain/limits`; `type CommentMode` from `../domain/types`; `type CommentStatus, type NewSocialComment, type SocialComment, type SocialCommentPatch` from `./types`.
  - `toVenue`: replace the Task 1 stub with

```ts
    // Comment replies (2026-10-15). Missing before schema.sql is applied: the defaults.
    comment_mode: (r.comment_mode as CommentMode) ?? "each",
    comment_digest_hour: r.comment_digest_hour === null || r.comment_digest_hour === undefined ? 9 : num(r.comment_digest_hour),
    comment_limit: r.comment_limit === undefined ? COMMENT_LIMIT_DEFAULT : r.comment_limit === null ? null : num(r.comment_limit),
    last_comment_digest_at: isoOrNull(r.last_comment_digest_at),
```

  - `toChangeSet`: replace the stub with `proposal_refs: (r.proposal_refs as Record<string, string> | null) ?? null,`.
  - `createChangeSet`: the insert object gets `proposal_refs: head.proposal_refs ?? null` (keep `...head` first so the explicit value wins).
  - `countAppliedChangeSets`: `.not("source", "in", "(undo,auto,comment)")`.
  - Add the mapper after `toSync`:

```ts
// --- Comment replies (appended 2026-10-15) ---
export function toComment(r: Row): SocialComment {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    network: r.network as SocialComment["network"],
    post_ref: str(r.post_ref),
    comment_id: str(r.comment_id),
    parent_id: strOrNull(r.parent_id),
    author_id: str(r.author_id),
    author_name: str(r.author_name),
    text: str(r.text),
    created_at: iso(r.created_at),
    seen_at: iso(r.seen_at),
    status: (r.status as CommentStatus) ?? "new",
    change_set_id: strOrNull(r.change_set_id),
    reply_id: strOrNull(r.reply_id),
    replied_at: isoOrNull(r.replied_at),
    post_caption: str(r.post_caption),
    post_permalink: strOrNull(r.post_permalink),
    draft_text: strOrNull(r.draft_text),
    draft_kind: strOrNull(r.draft_kind),
    deferred: Boolean(r.deferred),
  };
}
```

  - Append inside the class:

```ts
  // --- Comment replies (appended 2026-10-15) ---
  async upsertComments(venueId: string, rows: NewSocialComment[]) {
    if (rows.length === 0 || badVenue(venueId)) return [];
    // ON CONFLICT (comment_id) DO NOTHING; RETURNING gives only the rows that were inserted.
    const { data, error } = await this.db
      .from("social_comments")
      .upsert(rows.map((r) => ({ venue_id: venueId, ...r, post_permalink: r.post_permalink ?? null })), { onConflict: "comment_id", ignoreDuplicates: true })
      .select("*");
    if (error) throw new Error(`upsertComments: ${error.message}`);
    return (data ?? []).map(toComment).sort((a, b) => rows.findIndex((r) => r.comment_id === a.comment_id) - rows.findIndex((r) => r.comment_id === b.comment_id));
  }
  async listComments(venueId: string, opts: { status?: CommentStatus[]; limit?: number; since?: string } = {}) {
    if (badVenue(venueId)) return [];
    let q = this.db.from("social_comments").select("*").eq("venue_id", venueId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(opts.limit ?? 100);
    if (opts.status) q = q.in("status", opts.status);
    if (opts.since) q = q.gte("created_at", opts.since);
    return (await must(q, "listComments")).map(toComment);
  }
  async getComment(id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.db.from("social_comments").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`getComment: ${error.message}`);
    return data ? toComment(data) : null;
  }
  async findComment(venueId: string, commentId: string) {
    if (badVenue(venueId)) return null;
    const { data, error } = await this.db.from("social_comments").select("*").eq("venue_id", venueId).eq("comment_id", commentId).maybeSingle();
    if (error) throw new Error(`findComment: ${error.message}`);
    return data ? toComment(data) : null;
  }
  async updateComment(id: string, patch: SocialCommentPatch) {
    const clean: Row = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) {
      if (!(await this.getComment(id))) throw new Error(`updateComment ${id}: not found`);
      return;
    }
    await mustRows(this.db.from("social_comments").update(clean).eq("id", id).select("id"), `updateComment ${id}`);
  }
  async purgeComments(before: string) {
    const { data, error } = await this.db.from("social_comments").delete().lt("created_at", before).select("id");
    if (error) throw new Error(`purgeComments: ${error.message}`);
    return (data ?? []).length;
  }
  async countCommentActions(venueId: string, fromIso: string, toIso: string) {
    if (badVenue(venueId)) return 0;
    const { count, error } = await this.db
      .from("social_comments")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", venueId)
      .in("status", ["replied", "hidden", "deleted"])
      .gte("replied_at", fromIso)
      .lt("replied_at", toIso);
    if (error) throw new Error(`countCommentActions: ${error.message}`);
    return count ?? 0;
  }
```

- [ ] **Step 6: Public feed.** In `src/server/site.ts`:

```ts
/** The venue as the public feed sends it: no deploy record (provider ids, build errors), no wizard draft, no Instagram import list, no own-site URL, no change limit, no comment settings. */
export type PublicVenue = Omit<Venue, "deploy" | "wizard_draft" | "instagram_import" | "site_url" | "change_limit" | "comment_mode" | "comment_digest_hour" | "comment_limit" | "last_comment_digest_at">;
```

and in `publicSiteState` destructure `comment_mode, comment_digest_hour, comment_limit, last_comment_digest_at` too, with `void` lines (`// how the owner hears about comments is the owner's business`).

- [ ] **Step 7: SQL.** In `supabase/schema.sql` after the `venues_change_limit_check` lines add:

```sql
-- Comment replies (2026-10-15): how the owner hears about comments under the venue's posts and the monthly cap on comment
-- actions. Owner-only (policies.sql grants columns one by one, so these never reach the anon key).
alter table public.venues add column if not exists comment_mode text not null default 'each';
alter table public.venues drop constraint if exists venues_comment_mode_check;
alter table public.venues add constraint venues_comment_mode_check check (comment_mode in ('each', 'digest', 'off'));
alter table public.venues add column if not exists comment_digest_hour integer not null default 9;
alter table public.venues drop constraint if exists venues_comment_digest_hour_check;
alter table public.venues add constraint venues_comment_digest_hour_check check (comment_digest_hour between 0 and 23);
alter table public.venues add column if not exists comment_limit integer default 300;
alter table public.venues drop constraint if exists venues_comment_limit_check;
alter table public.venues add constraint venues_comment_limit_check check (comment_limit is null or comment_limit >= 0);
alter table public.venues add column if not exists last_comment_digest_at timestamptz;
```

After the `change_sets_source_check` block from Task 1 add:

```sql
-- One proposal message per owner chat for comment sets: { "<chat_ref>": "<message_ref>" }.
alter table public.change_sets add column if not exists proposal_refs jsonb;
```

In `supabase/policies.sql` line 22 extend the comment: `… site_url, change_limit, comment_mode, comment_digest_hour, comment_limit and last_comment_digest_at are never readable with the anon key …` (the grant list itself is unchanged). In `supabase/schema-integrations.sql` append:

```sql
-- Comment replies (2026-10-15): customer comments under posts Site Manager published. Customer content: the tick purges rows
-- older than 30 days. RLS on, no anon access (policies-integrations.sql). Apply only this file live: npm run db:apply -- schema-integrations.sql
create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  network text not null check (network in ('facebook', 'instagram')),
  post_ref text not null,
  comment_id text not null unique,
  parent_id text,
  author_id text not null default '',
  author_name text not null default '',
  text text not null default '',
  created_at timestamptz not null,
  seen_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'proposed', 'replied', 'ignored', 'expired', 'own', 'nested', 'hidden', 'deleted')),
  change_set_id uuid references public.change_sets(id) on delete set null,
  reply_id text,
  replied_at timestamptz,
  post_caption text not null default '',
  post_permalink text,
  draft_text text,
  draft_kind text,
  deferred boolean not null default false
);
create index if not exists social_comments_venue_status_idx on public.social_comments (venue_id, status);
create index if not exists social_comments_created_idx on public.social_comments (created_at);
```

`supabase/policies-integrations.sql` becomes:

```sql
-- Destinations, their sync queue and customer comments are server-only: RLS on, no policies, no grants for anon/authenticated.
alter table public.venue_destinations enable row level security;
alter table public.destination_syncs enable row level security;
alter table public.social_comments enable row level security;
revoke all on public.venue_destinations, public.destination_syncs, public.social_comments from anon, authenticated;
notify pgrst, 'reload schema';
```

In `scripts/check-rls.mts` change the last loop to `for (const t of ["venue_destinations", "destination_syncs", "social_comments"])`.

- [ ] **Step 8: Run the contract, feed and mapper tests, then the full suite and typecheck**

```
npx vitest run test/store-memory.test.ts test/site-server.test.ts test/supabase-mappers.test.ts test/policies-grants.test.ts test/comment-preview.test.ts
npx vitest run
npm run typecheck
```

Expected: all green. (The live Supabase contract runs later with `SUPABASE_CONTRACT=1` after `npm run db:apply -- schema.sql` and `npm run db:apply -- schema-integrations.sql policies-integrations.sql`; note that in the commit message, do not run it now.)

- [ ] **Step 9: Commit**

```
git add src/store/types.ts src/store/memory.ts src/store/supabase.ts src/server/site.ts supabase/schema.sql supabase/schema-integrations.sql supabase/policies.sql supabase/policies-integrations.sql scripts/check-rls.mts test/store-contract.ts test/site-server.test.ts test/supabase-mappers.test.ts test/policies-grants.test.ts
git commit -m "Comments: social_comments table and store methods, venue comment settings, change_sets.proposal_refs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: Graph readers and writers for comments, FakeMeta routes

**Files:**
- Create: `src/social/comments-graph.ts`
- Modify: `test/fake-meta.ts` (new `comments` map, `addFacebookComment`, `addInstagramComment`, routes inside `facebook()` and `instagram()`)
- Test: `test/comments-graph.test.ts`

**Interfaces:**

Consumes: `GraphClient`, `MetaApiError` from `src/destinations/meta-graph.ts`; `metaTime` from `src/destinations/facebook.ts`; `CommentNetwork`, `ModerateAction` from `src/domain/types.ts`.

Produces (in `src/social/comments-graph.ts`):

```ts
export const COMMENTS_PER_CALL = 50;
export interface IncomingComment { network: CommentNetwork; post_ref: string; comment_id: string; parent_id: string | null; author_id: string; author_name: string; text: string; created_at: string }
export function fetchInstagramComments(client: GraphClient, mediaId: string): Promise<IncomingComment[]>;          // top-level + their replies (parent_id set), newest first as Meta sends them
export function fetchFacebookComments(client: GraphClient, postId: string, since?: string): Promise<IncomingComment[]>; // filter=toplevel, order=reverse_chronological, since as unix seconds
export function replyInstagram(client: GraphClient, commentId: string, message: string): Promise<string>;  // POST /{comment}/replies → new comment id
export function replyFacebook(client: GraphClient, commentId: string, message: string): Promise<string>;   // POST /{comment}/comments → new comment id
export function moderateInstagram(client: GraphClient, commentId: string, action: ModerateAction): Promise<void>; // POST /{comment} {hide}, DELETE /{comment}
export function moderateFacebook(client: GraphClient, commentId: string, action: ModerateAction): Promise<void>;  // POST /{comment} {is_hidden}, DELETE /{comment}
export function deleteReply(client: GraphClient, replyId: string): Promise<void>;                            // DELETE /{reply}; "not found" counts as done
```

Produces (in `test/fake-meta.ts`):

```ts
export interface FakeComment { id: string; network: "facebook" | "instagram"; post_ref: string; owner_id: string; parent_id: string | null; from_id: string; from_name: string; text: string; created_time: string; hidden: boolean; deleted: boolean }
comments = new Map<string, FakeComment>();
addFacebookComment(postId: string, o: { message: string; from_id?: string; from_name?: string; parent_id?: string; created?: Date }): FakeComment;
addInstagramComment(mediaId: string, o: { text: string; from_id?: string; username?: string; parent_id?: string; created?: Date }): FakeComment;
```

- [ ] **Step 1: Write the failing test** `test/comments-graph.test.ts`:

```ts
// test/comments-graph.test.ts — reading and writing comments on both networks: real payload shapes, then the fake Meta server.
import { describe, expect, it } from "vitest";
import { FB_GRAPH, GraphClient, IG_GRAPH, MetaApiError } from "@/src/destinations/meta-graph";
import { COMMENTS_PER_CALL, deleteReply, fetchFacebookComments, fetchInstagramComments, moderateFacebook, moderateInstagram, replyFacebook, replyInstagram } from "@/src/social/comments-graph";
import { FakeMeta } from "./fake-meta";

/** Answers every call with `body`; records the requests. */
function scripted(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

// Shapes as Meta returns them (verified 2026-10-14/15): Instagram with Instagram Login, Facebook Page token.
const IG_PAYLOAD = {
  data: [
    { id: "17890000000000001", text: "Имате ли безглутенови?", timestamp: "2026-10-15T08:00:00+0000", username: "maria.k", from: { id: "1784000000000001", username: "maria.k" },
      replies: { data: [{ id: "17890000000000002", text: "Да, всеки ден!", timestamp: "2026-10-15T08:30:00+0000", username: "agala.cafe", from: { id: "9999", username: "agala.cafe" }, parent_id: "17890000000000001" }] } },
    { id: "17890000000000003", text: "🔥🔥", timestamp: "2026-10-15T07:00:00+0000", username: "ivan", from: { id: "1784000000000002", username: "ivan" } },
    { id: "17890000000000004", text: "no time" },
  ],
  paging: { cursors: { before: "QVFI", after: "QVFJ" } },
};
const FB_PAYLOAD = {
  data: [
    { id: "123_456", message: "Great place!", from: { id: "77", name: "Ivan Petrov" }, created_time: "2026-10-15T08:00:00+0000" },
    { id: "123_457", message: "private author", created_time: "2026-10-15T07:59:00+0000" },
  ],
  paging: { cursors: { before: "x", after: "y" } },
};

describe("fetchInstagramComments", () => {
  it("asks /{media}/comments with the fields and the 50 limit, flattens replies with parent_id, skips rows without a time", async () => {
    const { f, calls } = scripted(IG_PAYLOAD);
    const out = await fetchInstagramComments(new GraphClient(IG_GRAPH, "IGTOKEN", f), "17950000000000009");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${IG_GRAPH}/17950000000000009/comments?fields=${encodeURIComponent("id,text,timestamp,username,from,parent_id,replies{id,text,timestamp,username,from}")}&limit=${COMMENTS_PER_CALL}`);
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer IGTOKEN");
    expect(calls[0].url).not.toContain("IGTOKEN");
    expect(out).toEqual([
      { network: "instagram", post_ref: "17950000000000009", comment_id: "17890000000000001", parent_id: null, author_id: "1784000000000001", author_name: "maria.k", text: "Имате ли безглутенови?", created_at: "2026-10-15T08:00:00.000Z" },
      { network: "instagram", post_ref: "17950000000000009", comment_id: "17890000000000002", parent_id: "17890000000000001", author_id: "9999", author_name: "agala.cafe", text: "Да, всеки ден!", created_at: "2026-10-15T08:30:00.000Z" },
      { network: "instagram", post_ref: "17950000000000009", comment_id: "17890000000000003", parent_id: null, author_id: "1784000000000002", author_name: "ivan", text: "🔥🔥", created_at: "2026-10-15T07:00:00.000Z" },
    ]);
    expect(COMMENTS_PER_CALL).toBe(50);
  });
  it("returns [] for an empty or missing data array", async () => {
    expect(await fetchInstagramComments(new GraphClient(IG_GRAPH, "t", scripted({ data: [] }).f), "1")).toEqual([]);
    expect(await fetchInstagramComments(new GraphClient(IG_GRAPH, "t", scripted({}).f), "1")).toEqual([]);
  });
  it("passes Meta errors through as MetaApiError", async () => {
    const { f } = scripted({ error: { message: "Invalid OAuth access token.", code: 190 } }, 400);
    await expect(fetchInstagramComments(new GraphClient(IG_GRAPH, "t", f), "1")).rejects.toMatchObject({ name: "MetaApiError", code: "sm_meta_token" });
  });
});

describe("fetchFacebookComments", () => {
  it("asks for top-level comments newest first, with since as unix seconds, and tolerates a missing from", async () => {
    const { f, calls } = scripted(FB_PAYLOAD);
    const out = await fetchFacebookComments(new GraphClient(FB_GRAPH, "PAGETOKEN", f), "123", "2026-10-01T00:00:00.000Z");
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v25.0/123/comments");
    expect(url.searchParams.get("filter")).toBe("toplevel");
    expect(url.searchParams.get("order")).toBe("reverse_chronological");
    expect(url.searchParams.get("fields")).toBe("id,message,from,created_time,parent");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("since")).toBe(String(Math.floor(Date.parse("2026-10-01T00:00:00.000Z") / 1000)));
    expect(out).toEqual([
      { network: "facebook", post_ref: "123", comment_id: "123_456", parent_id: null, author_id: "77", author_name: "Ivan Petrov", text: "Great place!", created_at: "2026-10-15T08:00:00.000Z" },
      { network: "facebook", post_ref: "123", comment_id: "123_457", parent_id: null, author_id: "", author_name: "", text: "private author", created_at: "2026-10-15T07:59:00.000Z" },
    ]);
  });
  it("sends no since when none is given", async () => {
    const { f, calls } = scripted({ data: [] });
    await fetchFacebookComments(new GraphClient(FB_GRAPH, "t", f), "123");
    expect(new URL(calls[0].url).searchParams.has("since")).toBe(false);
  });
});

describe("replies and moderation against the fake Meta server", () => {
  function setup() {
    const meta = new FakeMeta();
    const page = meta.addPage("Кафе Агала");
    const ig = meta.addInstagramUser("agala.cafe");
    const fb = new GraphClient(FB_GRAPH, page.access_token, meta.fetch);
    const igc = new GraphClient(IG_GRAPH, ig.token, meta.fetch);
    return { meta, page, ig, fb, igc };
  }
  async function fbPost(meta: FakeMeta, page: { id: string; access_token: string }) {
    const r = (await (await meta.fetch(`${FB_GRAPH}/${page.id}/photos`, { method: "POST", headers: { authorization: `Bearer ${page.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://m.example/a.jpg", published: true }) })).json()) as { post_id: string };
    return r.post_id;
  }
  async function igMedia(meta: FakeMeta, ig: { user_id: string; token: string }) {
    const h = { authorization: `Bearer ${ig.token}`, "content-type": "application/json" };
    const c = (await (await meta.fetch(`${IG_GRAPH}/${ig.user_id}/media`, { method: "POST", headers: h, body: JSON.stringify({ image_url: "https://m.example/a.jpg" }) })).json()) as { id: string };
    const m = (await (await meta.fetch(`${IG_GRAPH}/${ig.user_id}/media_publish`, { method: "POST", headers: h, body: JSON.stringify({ creation_id: c.id }) })).json()) as { id: string };
    return m.id;
  }

  it("lists the comments the fake holds, replies as the Page / account and deletes the reply", async () => {
    const { meta, page, ig, fb, igc } = setup();
    const postId = await fbPost(meta, page);
    const mediaId = await igMedia(meta, ig);
    const c1 = meta.addFacebookComment(postId, { message: "Great place!", from_id: "77", from_name: "Ivan Petrov" });
    meta.addFacebookComment(postId, { message: "nested", parent_id: c1.id });
    const c2 = meta.addInstagramComment(mediaId, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k" });
    const fbList = await fetchFacebookComments(fb, postId);
    expect(fbList.map((c) => [c.comment_id, c.parent_id, c.author_name])).toEqual([[c1.id, null, "Ivan Petrov"]]); // toplevel only
    const igList = await fetchInstagramComments(igc, mediaId);
    expect(igList.map((c) => [c.comment_id, c.parent_id])).toEqual([[c2.id, null]]);

    const fbReply = await replyFacebook(fb, c1.id, "Thank you!");
    expect(meta.comments.get(fbReply)).toMatchObject({ parent_id: c1.id, from_id: page.id, from_name: page.name, text: "Thank you!", post_ref: postId });
    const igReply = await replyInstagram(igc, c2.id, "Да, всеки ден!");
    expect(meta.comments.get(igReply)).toMatchObject({ parent_id: c2.id, from_id: ig.user_id, from_name: ig.username, text: "Да, всеки ден!" });
    expect((await fetchInstagramComments(igc, mediaId)).map((c) => c.comment_id)).toEqual([c2.id, igReply]); // the reply rides under its parent

    await deleteReply(fb, fbReply);
    expect(meta.comments.get(fbReply)?.deleted).toBe(true);
    await deleteReply(fb, fbReply); // already gone: no throw
    await deleteReply(igc, igReply);
    expect(meta.comments.get(igReply)?.deleted).toBe(true);
  });

  it("hides, un-hides and deletes on both networks", async () => {
    const { meta, page, ig, fb, igc } = setup();
    const c1 = meta.addFacebookComment(await fbPost(meta, page), { message: "spam" });
    const c2 = meta.addInstagramComment(await igMedia(meta, ig), { text: "spam" });
    await moderateFacebook(fb, c1.id, "hide");
    expect(meta.comments.get(c1.id)?.hidden).toBe(true);
    await moderateFacebook(fb, c1.id, "unhide");
    expect(meta.comments.get(c1.id)?.hidden).toBe(false);
    await moderateInstagram(igc, c2.id, "hide");
    expect(meta.comments.get(c2.id)?.hidden).toBe(true);
    await moderateInstagram(igc, c2.id, "unhide");
    expect(meta.comments.get(c2.id)?.hidden).toBe(false);
    await moderateFacebook(fb, c1.id, "delete");
    await moderateInstagram(igc, c2.id, "delete");
    expect(meta.comments.get(c1.id)?.deleted).toBe(true);
    expect(meta.comments.get(c2.id)?.deleted).toBe(true);
    const fbBody = meta.calls.filter((c) => c.path === `/${c1.id}` && c.method === "POST").map((c) => c.body);
    expect(fbBody).toEqual([{ is_hidden: true }, { is_hidden: false }]);
    const igBody = meta.calls.filter((c) => c.path === `/${c2.id}` && c.method === "POST").map((c) => c.body);
    expect(igBody).toEqual([{ hide: true }, { hide: false }]);
  });

  it("a reply to a deleted comment is a not-found error (no retry); a wrong token is sm_meta_token", async () => {
    const { meta, page, ig, fb, igc } = setup();
    const postId = await fbPost(meta, page);
    const c1 = meta.addFacebookComment(postId, { message: "bye" });
    meta.comments.get(c1.id)!.deleted = true;
    const e = await replyFacebook(fb, c1.id, "x").catch((x) => x);
    expect(e).toBeInstanceOf(MetaApiError);
    expect((e as MetaApiError).notFound).toBe(true);
    expect((e as MetaApiError).retryable).toBe(false);
    const c2 = meta.addInstagramComment(await igMedia(meta, ig), { text: "hi" });
    meta.revoke(ig.token);
    await expect(replyInstagram(igc, c2.id, "x")).rejects.toMatchObject({ code: "sm_meta_token" });
    const other = meta.addPage("Other");
    const c3 = meta.addFacebookComment(postId, { message: "still here" });
    await expect(replyFacebook(new GraphClient(FB_GRAPH, other.access_token, meta.fetch), c3.id, "x")).rejects.toMatchObject({ code: "sm_meta_token" });
  });

  it("a reply without an id in the answer is a retryable sm_reply_unknown", async () => {
    const { f } = scripted({ success: true });
    await expect(replyInstagram(new GraphClient(IG_GRAPH, "t", f), "1", "x")).rejects.toMatchObject({ code: "sm_reply_unknown", retryable: true });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run test/comments-graph.test.ts
```

Expected: cannot resolve `@/src/social/comments-graph`.

- [ ] **Step 3: Create `src/social/comments-graph.ts`**

```ts
// src/social/comments-graph.ts
// Server-only. Reads and writes customer comments under the venue's posts through GraphClient (bearer token, never in a URL):
// Instagram API with Instagram Login (graph.instagram.com) and the Facebook Page token (graph.facebook.com), both v25.0.
// Facts verified 2026-10-14/15: Instagram lists at most 50 comments per call, newest first, no time filter, replies ride under
// their parent (`replies` edge); Facebook takes filter=toplevel, order=reverse_chronological and since (unix seconds).
// Instagram can reply to top-level comments only; both return the new comment id; DELETE /{id} removes our own reply.
import { metaTime } from "../destinations/facebook";
import { GraphClient, MetaApiError } from "../destinations/meta-graph";
import type { CommentNetwork, ModerateAction } from "../domain/types";

export const COMMENTS_PER_CALL = 50;
const IG_FIELDS = encodeURIComponent("id,text,timestamp,username,from,parent_id,replies{id,text,timestamp,username,from}");
const FB_FIELDS = encodeURIComponent("id,message,from,created_time,parent");

/** One comment as both networks are normalised to: Meta ids as strings, the author's platform id and display name, ISO time. */
export interface IncomingComment {
  network: CommentNetwork;
  post_ref: string;
  comment_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  text: string;
  created_at: string;
}

type Raw = Record<string, unknown>;
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object") : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const enc = (id: string) => encodeURIComponent(id);
/** Meta's "+0000" timestamps → ISO; null when unreadable (such a row is skipped: the 30-day rules need a time). */
function isoOf(raw: unknown): string | null {
  const ms = metaTime(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function igComment(raw: Raw, mediaId: string, parentId: string | null): IncomingComment | null {
  const id = str(raw.id);
  const created_at = isoOf(raw.timestamp);
  if (!id || !created_at) return null;
  const from = (raw.from ?? {}) as Raw;
  return { network: "instagram", post_ref: mediaId, comment_id: id, parent_id: parentId ?? (str(raw.parent_id) || null), author_id: str(from.id), author_name: str(from.username) || str(raw.username), text: str(raw.text), created_at };
}

/** Top-level comments of one Instagram media and their replies (parent_id set), as Meta orders them (newest first). */
export async function fetchInstagramComments(client: GraphClient, mediaId: string): Promise<IncomingComment[]> {
  const r = await client.get<{ data?: unknown }>(`/${enc(mediaId)}/comments?fields=${IG_FIELDS}&limit=${COMMENTS_PER_CALL}`);
  const out: IncomingComment[] = [];
  for (const raw of rows(r.data)) {
    const top = igComment(raw, mediaId, null);
    if (!top) continue;
    out.push(top);
    for (const rep of rows((raw.replies as Raw | undefined)?.data)) {
      const nested = igComment(rep, mediaId, top.comment_id);
      if (nested) out.push(nested);
    }
  }
  return out;
}

/** Top-level comments of one Facebook post, newest first; `since` (ISO) limits to comments created at or after it. */
export async function fetchFacebookComments(client: GraphClient, postId: string, since?: string): Promise<IncomingComment[]> {
  const sinceParam = since ? `&since=${Math.floor(Date.parse(since) / 1000)}` : "";
  const r = await client.get<{ data?: unknown }>(`/${enc(postId)}/comments?filter=toplevel&order=reverse_chronological&fields=${FB_FIELDS}&limit=${COMMENTS_PER_CALL}${sinceParam}`);
  const out: IncomingComment[] = [];
  for (const raw of rows(r.data)) {
    const id = str(raw.id);
    const created_at = isoOf(raw.created_time);
    if (!id || !created_at) continue;
    const from = (raw.from ?? {}) as Raw;
    const parent = (raw.parent ?? null) as Raw | null;
    out.push({ network: "facebook", post_ref: postId, comment_id: id, parent_id: parent ? str(parent.id) || null : null, author_id: str(from.id), author_name: str(from.name), text: str(raw.message), created_at });
  }
  return out;
}

function idOf(r: { id?: unknown }, what: string): string {
  if (typeof r.id === "string" && r.id) return r.id;
  if (typeof r.id === "number") return String(r.id);
  throw new MetaApiError(0, "sm_reply_unknown", `${what} did not confirm the reply.`, { retry: true });
}

/** POST /{ig-comment-id}/replies → the new comment's id. Top-level comments only (Instagram refuses a reply to a reply). */
export async function replyInstagram(client: GraphClient, commentId: string, message: string): Promise<string> {
  return idOf(await client.post<{ id?: unknown }>(`/${enc(commentId)}/replies`, { message }), "Instagram");
}

/** POST /{comment-id}/comments with the Page token → the new comment's id. */
export async function replyFacebook(client: GraphClient, commentId: string, message: string): Promise<string> {
  return idOf(await client.post<{ id?: unknown }>(`/${enc(commentId)}/comments`, { message }), "Facebook");
}

/** hide/unhide: POST /{ig-comment-id} { hide }; delete: DELETE /{ig-comment-id}. */
export async function moderateInstagram(client: GraphClient, commentId: string, action: ModerateAction): Promise<void> {
  if (action === "delete") await client.delete(`/${enc(commentId)}`);
  else await client.post(`/${enc(commentId)}`, { hide: action === "hide" });
}

/** hide/unhide: POST /{comment-id} { is_hidden }; delete: DELETE /{comment-id}. */
export async function moderateFacebook(client: GraphClient, commentId: string, action: ModerateAction): Promise<void> {
  if (action === "delete") await client.delete(`/${enc(commentId)}`);
  else await client.post(`/${enc(commentId)}`, { is_hidden: action === "hide" });
}

/** DELETE /{reply-id} on either host; a reply that is already gone counts as deleted. */
export async function deleteReply(client: GraphClient, replyId: string): Promise<void> {
  try {
    await client.delete(`/${enc(replyId)}`);
  } catch (e) {
    if (!(e instanceof MetaApiError && e.notFound)) throw e;
  }
}
```

- [ ] **Step 4: Extend `test/fake-meta.ts`.** Add the interface after `FakeCall`:

```ts
/** A comment under a Facebook post or Instagram media (comment replies, 2026-10-15). owner_id = the Page id / Instagram user id whose token may act on it. */
export interface FakeComment { id: string; network: "facebook" | "instagram"; post_ref: string; owner_id: string; parent_id: string | null; from_id: string; from_name: string; text: string; created_time: string; hidden: boolean; deleted: boolean }
```

Add the field and helpers in the class (after `igMedia`):

```ts
  comments = new Map<string, FakeComment>();
  addFacebookComment(postId: string, o: { message: string; from_id?: string; from_name?: string; parent_id?: string; created?: Date }): FakeComment {
    const post = this.posts.get(postId);
    if (!post) throw new Error(`no post ${postId}`);
    const c: FakeComment = { id: `${postId}_${num()}`, network: "facebook", post_ref: postId, owner_id: post.page_id, parent_id: o.parent_id ?? null, from_id: o.from_id ?? num(), from_name: o.from_name ?? "Customer", text: o.message, created_time: this.stampAt(o.created), hidden: false, deleted: false };
    this.comments.set(c.id, c);
    return c;
  }
  addInstagramComment(mediaId: string, o: { text: string; from_id?: string; username?: string; parent_id?: string; created?: Date }): FakeComment {
    const m = this.igMedia.get(mediaId);
    if (!m) throw new Error(`no media ${mediaId}`);
    const c: FakeComment = { id: `178${num()}`, network: "instagram", post_ref: mediaId, owner_id: m.user_id, parent_id: o.parent_id ?? null, from_id: o.from_id ?? num(), from_name: o.username ?? "customer", text: o.text, created_time: this.stampAt(o.created), hidden: false, deleted: false };
    this.comments.set(c.id, c);
    return c;
  }
```

Replace `stamp()` with:

```ts
  /** Meta's timestamp format: 2026-10-11T09:00:00+0000. */
  private stamp(): string {
    return this.stampAt();
  }
  private stampAt(d: Date = this.now()): string {
    return d.toISOString().replace(/\.\d{3}Z$/, "+0000");
  }
```

Add a shared helper inside the class:

```ts
  /** Facebook: `{ id, message, from, created_time, parent }`; Instagram: `{ id, text, timestamp, username, from, replies }`. Deleted comments are never listed. */
  private commentJson(c: FakeComment, withReplies: boolean): Json {
    if (c.network === "facebook") return { id: c.id, message: c.text, from: { id: c.from_id, name: c.from_name }, created_time: c.created_time, ...(c.parent_id ? { parent: { id: c.parent_id } } : {}) };
    const replies = withReplies ? [...this.comments.values()].filter((r) => r.parent_id === c.id && !r.deleted) : [];
    return { id: c.id, text: c.text, timestamp: c.created_time, username: c.from_name, from: { id: c.from_id, username: c.from_name }, ...(c.parent_id ? { parent_id: c.parent_id } : {}), ...(replies.length ? { replies: { data: replies.map((r) => this.commentJson(r, false)) } } : {}) };
  }
  private listComments(network: "facebook" | "instagram", postRef: string, q: URLSearchParams): Json {
    const since = q.get("since") ? Number(q.get("since")) * 1000 : null;
    const all = [...this.comments.values()].filter((c) => c.network === network && c.post_ref === postRef && !c.deleted);
    const top = q.get("filter") === "toplevel" || network === "instagram" ? all.filter((c) => c.parent_id === null) : all;
    const rows = top.filter((c) => since === null || Date.parse(c.created_time.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) >= since).sort((a, b) => b.created_time.localeCompare(a.created_time)).slice(0, Number(q.get("limit") ?? 25));
    return { data: rows.map((c) => this.commentJson(c, true)) };
  }
```

In `facebook()`, right after the `/me/accounts` branch and the `const parts = …` line, insert (before the existing `parts.length === 2 && method === "POST"` branch):

```ts
    // Comments (comment replies, 2026-10-15): GET /{post}/comments, POST /{comment}/comments, POST /{comment} {is_hidden}, DELETE /{comment}.
    if (parts.length === 2 && parts[1] === "comments") {
      const post = this.posts.get(parts[0]);
      const parent = this.comments.get(parts[0]);
      const ownerId = post?.page_id ?? parent?.owner_id;
      if ((!post || post.deleted) && (!parent || parent.deleted || parent.network !== "facebook")) return graphError(400, 100, "Unsupported request. Object does not exist.", { error_subcode: 33 });
      const page = this.pageForToken(token);
      if (!page || page.id !== ownerId) return graphError(400, 190, "Invalid OAuth access token.");
      if (method === "GET") return Response.json(this.listComments("facebook", post ? post.post_id : (parent as FakeComment).id, q));
      if (method === "POST" && parent) {
        const c: FakeComment = { id: `${parent.post_ref}_${num()}`, network: "facebook", post_ref: parent.post_ref, owner_id: page.id, parent_id: parent.id, from_id: page.id, from_name: page.name, text: String(body?.message ?? ""), created_time: this.stamp(), hidden: false, deleted: false };
        this.comments.set(c.id, c);
        return Response.json({ id: c.id });
      }
      return graphError(400, 100, "Unsupported request");
    }
    if (parts.length === 1 && this.comments.has(parts[0]) && this.comments.get(parts[0])!.network === "facebook") {
      const c = this.comments.get(parts[0])!;
      if (c.deleted) return graphError(400, 100, "Unsupported request. Object does not exist.", { error_subcode: 33 });
      if (this.pageForToken(token)?.id !== c.owner_id) return graphError(400, 190, "Invalid OAuth access token.");
      if (method === "GET") return Response.json({ id: c.id, message: c.text, is_hidden: c.hidden });
      if (method === "POST" && typeof body?.is_hidden === "boolean") {
        c.hidden = body.is_hidden;
        return Response.json({ success: true });
      }
      if (method === "DELETE") {
        c.deleted = true;
        return Response.json({ success: true });
      }
      return graphError(400, 100, "Unsupported request");
    }
```

In `instagram()`, after `const parts = …` and before the existing `method === "POST" && parts.length === 2 && parts[0] === user.user_id` branch, insert:

```ts
    // Comments (comment replies, 2026-10-15): GET /{media}/comments, POST /{comment}/replies, POST /{comment} {hide}, DELETE /{comment}.
    if (parts.length === 2 && parts[1] === "comments" && method === "GET") {
      const m = this.igMedia.get(parts[0]);
      if (!m) return graphError(400, 100, "Unsupported get request. Object does not exist.", { error_subcode: 33 });
      if (m.user_id !== user.user_id) return graphError(400, 190, "Invalid OAuth access token.");
      return Response.json(this.listComments("instagram", m.id, q));
    }
    const ic = parts.length >= 1 ? this.comments.get(parts[0]) : undefined;
    if (ic && ic.network === "instagram") {
      if (ic.deleted) return graphError(400, 100, "Unsupported request. Object does not exist.", { error_subcode: 33 });
      if (ic.owner_id !== user.user_id) return graphError(400, 190, "Invalid OAuth access token.");
      if (parts.length === 2 && parts[1] === "replies" && method === "POST") {
        if (ic.parent_id !== null) return graphError(400, 100, "Instagram cannot reply to a reply.");
        const c: FakeComment = { id: `178${num()}`, network: "instagram", post_ref: ic.post_ref, owner_id: user.user_id, parent_id: ic.id, from_id: user.user_id, from_name: user.username, text: String(body?.message ?? ""), created_time: this.stamp(), hidden: false, deleted: false };
        this.comments.set(c.id, c);
        return Response.json({ id: c.id });
      }
      if (parts.length === 1 && method === "GET") return Response.json({ id: ic.id, text: ic.text, hidden: ic.hidden });
      if (parts.length === 1 && method === "POST" && typeof body?.hide === "boolean") {
        ic.hidden = body.hide;
        return Response.json({ success: true });
      }
      if (parts.length === 1 && method === "DELETE") {
        ic.deleted = true;
        return Response.json({ success: true });
      }
      return graphError(400, 100, "Unsupported request");
    }
```

Update the file's header comment with the new routes. Also add `comments` to nothing else: `allTokens()` is unchanged.

- [ ] **Step 5: Run the tests**

```
npx vitest run test/comments-graph.test.ts test/destinations-social.test.ts test/destinations-social-retry.test.ts test/social-connect.test.ts test/agent-social-tool.test.ts
```

Expected: all green (the existing social tests prove the new routes did not shadow the old ones: a Facebook post id and a comment id never collide because comment ids are only ever handed out by `addFacebookComment`/replies).

- [ ] **Step 6: Commit**

```
git add src/social/comments-graph.ts test/fake-meta.ts test/comments-graph.test.ts
git commit -m "Comments: Graph readers/writers for comments on both networks, FakeMeta comment routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: Poller — published targets, 15-minute cadence, filtering, purge, tick step 9

**Files:**
- Modify: `src/destinations/social-common.ts` (append `PublishedTarget`, `publishedTargets`)
- Modify: `src/destinations/instagram.ts` (export `freshInstagramToken`; place it after `freshToken`)
- Create: `src/social/comments-poll.ts`
- Modify: `src/tick.ts` (`TickReport.comments_found`, step 9 inside `if (d.sync)`)
- Create: `test/comments-helpers.ts` (shared by every later comments test)
- Test: `test/comments-poll.test.ts`

**Interfaces:**

Consumes: `SyncDeps` from `src/destinations/sync.ts`; `GraphClient`, `FB_GRAPH`, `IG_GRAPH`, `MetaApiError` from `src/destinations/meta-graph.ts`; `decryptSecrets` from `src/destinations/secrets.ts`; `formatSyncError` from `src/destinations/wp-errors.ts`; `fetchFacebookComments`, `fetchInstagramComments`, `IncomingComment` from `src/social/comments-graph.ts`; `publishedIn`, `SocialNetwork` from `src/destinations/social-common.ts`; `Store`, `DestinationWithSecrets`, `NewSocialComment`, `SocialComment` from `src/store/types.ts`.

Produces:

```ts
// src/destinations/social-common.ts
export interface PublishedTarget { network: SocialNetwork; target: SocialTarget; post_ref: string; change_set_id: string; caption: string; permalink: string | null; published_at: string }
export function publishedTargets(store: Pick<Store, "listSyncs" | "getChangeSet">, venueId: string, sinceIso: string): Promise<PublishedTarget[]>; // feed posts only, one per post_ref, newest first
// src/destinations/instagram.ts
export function freshInstagramToken(d: SyncDeps, dest: DestinationWithSecrets, now: Date): Promise<string>;
// src/social/comments-poll.ts
export const COMMENT_POLL_EVERY_MS = 15 * 60_000;
export const COMMENT_POST_WINDOW_MS = 14 * 24 * 3_600_000;
export const COMMENT_RETENTION_MS = 30 * 24 * 3_600_000;
export interface PollReport { polled: CommentNetwork[]; inserted: SocialComment[]; errors: { network: CommentNetwork; code: string }[] }
export function pollVenueComments(d: SyncDeps, venue: Venue, now: Date): Promise<PollReport>; // never throws
export function purgeOldComments(store: Pick<Store, "purgeComments">, now: Date): Promise<number>;
// src/tick.ts
// TickReport gains: comments_found?: number
```

- [ ] **Step 1: Shared test helper** `test/comments-helpers.ts`:

```ts
// test/comments-helpers.ts — a demo venue with Facebook and Instagram connected to the fake Meta server, the store hook wired,
// and a published post on both networks (so sync rows hold Meta's post/media ids). Shared by the comments tests.
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import type { SyncDeps } from "@/src/destinations/sync";
import type { Change, SocialTarget } from "@/src/domain/types";
import type { Store } from "@/src/store/types";
import { FakeMeta } from "./fake-meta";
import { FakeMessenger, makeDemo, type Demo } from "./helpers";

export const KEY = parseSecretKey("ab".repeat(32));
export const T0 = new Date("2026-10-15T09:00:00.000Z"); // Thu 15 Oct 2026, 12:00 Sofia
export const at = (ms: number) => new Date(T0.getTime() + ms);
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const IMAGE = "https://media.example/v1/m-1.jpg";

export interface Connected extends Demo {
  /** The store with the destination hook (applyChangeSet pushes). */
  store: Store & Demo["store"];
  raw: Demo["store"];
  meta: FakeMeta;
  page: ReturnType<FakeMeta["addPage"]>;
  ig: ReturnType<FakeMeta["addInstagramUser"]>;
  d: SyncDeps;
  logs: string[];
  messenger: FakeMessenger;
  /** Publishes one social_post to the given targets at `now` and returns the Meta ids. */
  publishPost: (targets: SocialTarget[], caption?: string, now?: Date) => Promise<{ cs: { id: string }; fbPostId: string | null; igMediaId: string | null }>;
}

export async function connectedVenue(opts: { facebook?: boolean; instagram?: boolean; now?: () => Date } = {}): Promise<Connected> {
  const demo = await makeDemo();
  const meta = new FakeMeta();
  const page = meta.addPage("Кафе Агала");
  const ig = meta.addInstagramUser("agala.cafe");
  // One clock for the fake Meta server, the store hook and the memory store's created_at: publishPost(now) moves it for the apply.
  const clock = { now: opts.now ?? (() => T0) };
  const nowFn = () => clock.now();
  meta.now = nowFn;
  let tick = 0;
  demo.store.clock = () => new Date(nowFn().getTime() + tick++).toISOString();
  if (opts.facebook !== false) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "facebook", config: { page_id: page.id, page_name: page.name, connected_at: T0.toISOString(), comments: true }, secrets: encryptSecrets({ page_token: page.access_token }, KEY) });
  if (opts.instagram !== false) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "instagram", config: { ig_user_id: ig.user_id, username: ig.username, connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString(), comments: true }, secrets: encryptSecrets({ token: ig.token }, KEY) });
  const logs: string[] = [];
  const d: SyncDeps = { store: demo.store, secretKey: KEY, fetch: meta.fetch, log: (s: string) => logs.push(s), sleep: async () => undefined };
  const store = withDestinationSync(demo.store, d, nowFn) as Connected["store"];
  const messenger = new FakeMessenger();
  const publishPost: Connected["publishPost"] = async (targets, caption = "Днешното предложение: тиквена супа", now = nowFn()) => {
    const change: Change = { position: 0, op: "social_post", entity: "social_post", entity_id: "m-1", before: null, after: { media_id: "m-1", image_url: IMAGE, caption, targets } };
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_ref: "tg:1001", summary_bg: "Публикация", summary_en: "Post", preview_bg: "p", preview_en: "p", source: "photo", status: "proposed", changes: [change] });
    const before = { fb: new Set(meta.posts.keys()), ig: new Set(meta.igMedia.keys()) };
    const prev = clock.now;
    clock.now = () => now;
    try {
      if ((await store.applyChangeSet(cs.id, now.toISOString())) !== "applied") throw new Error("publish failed");
    } finally {
      clock.now = prev;
    }
    const fbPostId = [...meta.posts.values()].find((p) => p.kind === "photo" && !before.fb.has(p.post_id))?.post_id ?? null;
    const igMediaId = [...meta.igMedia.values()].find((m) => m.media_type === "IMAGE" && !before.ig.has(m.id))?.id ?? null;
    return { cs, fbPostId, igMediaId };
  };
  return { ...demo, store, raw: demo.store, meta, page, ig, d, logs, messenger, publishPost };
}
```

- [ ] **Step 2: Write the failing test** `test/comments-poll.test.ts`:

```ts
// test/comments-poll.test.ts — polling comments of the posts Site Manager published: cadence, filtering, errors, purge, tick step 9.
import { describe, expect, it } from "vitest";
import { publishedTargets } from "@/src/destinations/social-common";
import { COMMENT_POLL_EVERY_MS, COMMENT_POST_WINDOW_MS, COMMENT_RETENTION_MS, pollVenueComments, purgeOldComments } from "@/src/social/comments-poll";
import { runTick } from "@/src/tick";
import { at, connectedVenue, DAY, HOUR, MIN, T0 } from "./comments-helpers";

describe("publishedTargets", () => {
  it("lists feed posts (not stories) of the last 14 days with the caption, one per Meta id, newest first", async () => {
    const v = await connectedVenue();
    const a = await v.publishPost(["facebook_post", "facebook_story", "instagram_post", "instagram_story"], "Първа", at(-20 * DAY));
    const b = await v.publishPost(["facebook_post"], "Втора", at(-2 * DAY));
    const c = await v.publishPost(["instagram_post"], "Трета", at(-1 * HOUR));
    const targets = await publishedTargets(v.store, v.venue.id, at(-COMMENT_POST_WINDOW_MS).toISOString());
    expect(targets.map((t) => [t.network, t.post_ref, t.caption, t.change_set_id])).toEqual([
      ["instagram", c.igMediaId, "Трета", c.cs.id],
      ["facebook", b.fbPostId, "Втора", b.cs.id],
    ]);
    expect(targets.every((t) => t.target.endsWith("_post") && t.permalink?.startsWith("https://"))).toBe(true);
    void a;
    expect(await publishedTargets(v.store, v.venue.id, at(-30 * DAY).toISOString())).toHaveLength(4);
  });
});

describe("pollVenueComments", () => {
  it("stores new, own and nested comments with the post caption on both networks and marks last_comment_poll_at", async () => {
    const v = await connectedVenue();
    const { fbPostId, igMediaId } = await v.publishPost(["facebook_post", "instagram_post"], "Днешното предложение");
    const fb1 = v.meta.addFacebookComment(fbPostId!, { message: "Great place!", from_id: "77", from_name: "Ivan Petrov", created: at(-10 * MIN) });
    v.meta.addFacebookComment(fbPostId!, { message: "Thanks!", from_id: v.page.id, from_name: v.page.name, created: at(-9 * MIN), parent_id: fb1.id });
    const own = v.meta.addFacebookComment(fbPostId!, { message: "Елате!", from_id: v.page.id, from_name: v.page.name, created: at(-8 * MIN) });
    const ig1 = v.meta.addInstagramComment(igMediaId!, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-5 * MIN) });
    const nested = v.meta.addInstagramComment(igMediaId!, { text: "и аз питам", from_id: "1785", username: "pesho", parent_id: ig1.id, created: at(-4 * MIN) });
    v.meta.addInstagramComment(igMediaId!, { text: "ancient", from_id: "1", username: "old", created: at(-31 * DAY) });
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.polled).toEqual(["instagram", "facebook"]);
    expect(r.errors).toEqual([]);
    expect(r.inserted.map((c) => [c.network, c.comment_id, c.status, c.author_name, c.post_caption])).toEqual([
      ["instagram", ig1.id, "new", "maria.k", "Днешното предложение"],
      ["instagram", nested.id, "nested", "pesho", "Днешното предложение"],
      ["facebook", own.id, "own", v.page.name, "Днешното предложение"],
      ["facebook", fb1.id, "new", "Ivan Petrov", "Днешното предложение"],
    ]); // Facebook lists newest first; the nested reply is filtered out by filter=toplevel
    const stored = await v.store.listComments(v.venue.id);
    expect(stored).toHaveLength(4);
    expect(stored.find((c) => c.comment_id === ig1.id)).toMatchObject({ post_ref: igMediaId, seen_at: T0.toISOString(), created_at: at(-5 * MIN).toISOString(), post_permalink: expect.stringMatching(/^https:\/\/www\.instagram\.com\//), deferred: false });
    for (const kind of ["facebook", "instagram"] as const) expect((await v.store.getDestination(v.venue.id, kind))?.config.last_comment_poll_at).toBe(T0.toISOString());
    expect(v.logs.join("\n")).not.toContain("Great place!");
    expect(v.logs.join("\n")).not.toContain(v.page.access_token);
  });

  it("a second poll inside the window makes no call; after 15 minutes it polls again and stores nothing twice", async () => {
    const v = await connectedVenue({ facebook: false });
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "first", created: at(-MIN) });
    expect((await pollVenueComments(v.d, v.venue, T0)).inserted).toHaveLength(1);
    const calls = v.meta.calls.length;
    const again = await pollVenueComments(v.d, v.venue, at(5 * MIN));
    expect(again.polled).toEqual([]);
    expect(v.meta.calls.length).toBe(calls);
    v.meta.addInstagramComment(igMediaId!, { text: "second", created: at(10 * MIN) });
    const later = await pollVenueComments(v.d, v.venue, at(COMMENT_POLL_EVERY_MS));
    expect(later.polled).toEqual(["instagram"]);
    expect(later.inserted.map((c) => c.text)).toEqual(["second"]);
    expect(await v.store.listComments(v.venue.id)).toHaveLength(2);
    expect(COMMENT_POLL_EVERY_MS).toBe(15 * 60_000);
  });

  it("reads only posts of the last 14 days, passes since to Facebook on a repeat poll, and skips a post that no longer exists", async () => {
    const v = await connectedVenue({ instagram: false });
    const old = await v.publishPost(["facebook_post"], "old", at(-15 * DAY));
    v.meta.addFacebookComment(old.fbPostId!, { message: "on an old post", created: at(-MIN) });
    const fresh = await v.publishPost(["facebook_post"], "fresh", at(-DAY));
    const gone = await v.publishPost(["facebook_post"], "gone", at(-2 * HOUR));
    v.meta.posts.get(gone.fbPostId!)!.deleted = true;
    v.meta.addFacebookComment(fresh.fbPostId!, { message: "hello", created: at(-MIN) });
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.inserted.map((c) => c.text)).toEqual(["hello"]);
    expect(r.errors).toEqual([]);
    expect(v.meta.calls.some((c) => c.path === `/${old.fbPostId}/comments`)).toBe(false); // outside the 14-day window
    expect(v.meta.calls.some((c) => c.path === `/${gone.fbPostId}/comments`)).toBe(true); // asked once, "does not exist", skipped silently
    expect(v.logs.some((l) => l.includes(gone.fbPostId!))).toBe(false);
    expect(new URL(v.meta.calls.find((c) => c.path === `/${fresh.fbPostId}/comments`)!.url).searchParams.has("since")).toBe(false);
    await pollVenueComments(v.d, v.venue, at(COMMENT_POLL_EVERY_MS));
    const second = v.meta.calls.filter((c) => c.path === `/${fresh.fbPostId}/comments`).at(-1)!;
    expect(new URL(second.url).searchParams.get("since")).toBe(String(Math.floor((T0.getTime() - HOUR) / 1000)));
  });

  it("a revoked token marks the destination error (and it is skipped afterwards); a transient failure is retried on the next tick", async () => {
    const v = await connectedVenue();
    const { igMediaId, fbPostId } = await v.publishPost(["instagram_post", "facebook_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "hi", created: at(-MIN) });
    v.meta.addFacebookComment(fbPostId!, { message: "hi", created: at(-MIN) });
    v.meta.revoke(v.ig.token);
    v.meta.failOn = (c) => (c.host === "graph.facebook.com" && c.path.endsWith("/comments") ? { status: 500, code: 2, message: "Service temporarily unavailable", transient: true } : null);
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.errors).toEqual([{ network: "instagram", code: "sm_meta_token" }, { network: "facebook", code: "meta_2" }]);
    expect(r.inserted).toEqual([]);
    expect(await v.store.getDestination(v.venue.id, "instagram")).toMatchObject({ status: "error", last_error: expect.stringMatching(/^sm_meta_token/) });
    expect((await v.store.getDestination(v.venue.id, "facebook"))?.status).toBe("connected");
    expect((await v.store.getDestination(v.venue.id, "facebook"))?.config.last_comment_poll_at).toBeUndefined();
    expect(v.logs.some((l) => /\[comments\] instagram poll for venue .* failed: sm_meta_token/.test(l))).toBe(true);
    v.meta.failOn = null;
    const next = await pollVenueComments(v.d, v.venue, at(MIN));
    expect(next.polled).toEqual(["facebook"]); // instagram is in error until the owner reconnects
    expect(next.inserted.map((c) => c.network)).toEqual(["facebook"]);
  });

  it("refreshes a stale Instagram token before reading", async () => {
    const v = await connectedVenue({ facebook: false });
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    const dest = (await v.store.getDestination(v.venue.id, "instagram"))!;
    await v.store.updateDestination(dest.id, { config: { ...dest.config, token_refreshed_at: at(-40 * DAY).toISOString() } });
    v.meta.addInstagramComment(igMediaId!, { text: "hi", created: at(-MIN) });
    const r = await pollVenueComments(v.d, v.venue, T0);
    expect(r.inserted).toHaveLength(1);
    expect(v.meta.calls.some((c) => c.path === "/refresh_access_token")).toBe(true);
    expect((await v.store.getDestination(v.venue.id, "instagram"))?.config.token_refreshed_at).toBe(T0.toISOString());
  });

  it("purges comments older than 30 days", async () => {
    const v = await connectedVenue();
    await v.store.upsertComments(v.venue.id, [
      { network: "facebook", post_ref: "p", comment_id: "k1", parent_id: null, author_id: "", author_name: "", text: "old", created_at: at(-COMMENT_RETENTION_MS - MIN).toISOString(), seen_at: T0.toISOString(), status: "replied", post_caption: "" },
      { network: "facebook", post_ref: "p", comment_id: "k2", parent_id: null, author_id: "", author_name: "", text: "fresh", created_at: at(-COMMENT_RETENTION_MS + MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "" },
    ]);
    expect(await purgeOldComments(v.store, T0)).toBe(1);
    expect((await v.store.listComments(v.venue.id)).map((c) => c.text)).toEqual(["fresh"]);
  });

  it("tick step 9 polls every live venue (one venue on a scoped tick) and reports comments_found", async () => {
    const v = await connectedVenue();
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "hi", created: at(-MIN) });
    const r = await runTick({ store: v.store, messenger: v.messenger, now: T0, sync: v.d, venueId: v.venue.id });
    expect(r.comments_found).toBe(1);
    const none = await runTick({ store: v.store, messenger: v.messenger, now: at(MIN), sync: v.d });
    expect(none.comments_found).toBe(0);
    const off = await runTick({ store: v.store, messenger: v.messenger, now: at(2 * MIN) });
    expect(off.comments_found).toBeUndefined(); // no sync deps: no polling
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```
npx vitest run test/comments-poll.test.ts
```

Expected: cannot resolve `@/src/social/comments-poll`; `publishedTargets` is not exported.

- [ ] **Step 4: `publishedTargets`.** Append to `src/destinations/social-common.ts` (add `import type { Store } from "../store/types";`):

```ts
/** A feed post Site Manager published, as the comment poller needs it (comment replies, 2026-10-15). */
export interface PublishedTarget {
  network: SocialNetwork;
  target: SocialTarget;
  /** Meta's post id (Facebook) or media id (Instagram). */
  post_ref: string;
  change_set_id: string;
  caption: string;
  permalink: string | null;
  /** When the sync row finished (ISO). */
  published_at: string;
}

/**
 * Feed posts (never stories: they take no comments) with a Meta id, from the venue's done sync rows finished at or after
 * `sinceIso`, newest first, one entry per post id. The caption comes from the set's social_post row.
 */
export async function publishedTargets(store: Pick<Store, "listSyncs" | "getChangeSet">, venueId: string, sinceIso: string): Promise<PublishedTarget[]> {
  const rows = (await store.listSyncs({ venueId, status: ["done"] })).filter((s) => (s.payload.kind === "facebook" || s.payload.kind === "instagram") && s.updated_at >= sinceIso);
  const seen = new Set<string>();
  const out: PublishedTarget[] = [];
  for (const s of rows.reverse()) {
    const network = s.payload.kind as SocialNetwork;
    const published = publishedIn([s.result]).filter((p) => p.id !== null && p.target === `${network}_post`);
    if (published.length === 0) continue;
    let captions = new Map<string, string>();
    try {
      const cs = await store.getChangeSet(s.change_set_id);
      captions = new Map(cs.changes.filter((c) => c.entity === "social_post" && c.after).map((c) => [c.entity_id, typeof c.after?.caption === "string" ? c.after.caption : ""]));
    } catch {
      // the set is gone (venue content cleared): the post is still readable, without its caption
    }
    for (const p of published) {
      if (seen.has(p.id as string)) continue;
      seen.add(p.id as string);
      out.push({ network, target: p.target, post_ref: p.id as string, change_set_id: s.change_set_id, caption: captions.get(p.media_id) ?? "", permalink: p.permalink, published_at: s.updated_at });
    }
  }
  return out;
}
```

- [ ] **Step 5: `freshInstagramToken`.** In `src/destinations/instagram.ts` add after `freshToken` (imports of `DestinationWithSecrets` from `../store/types` as a type):

```ts
/** The Instagram token for a read outside a push (the comment poller): refreshed and stored when older than 30 days, else as stored. */
export async function freshInstagramToken(d: SyncDeps, dest: DestinationWithSecrets, now: Date): Promise<string> {
  if (!d.secretKey) throw new Error("DESTINATION_SECRET_KEY is not set");
  const secrets = decryptSecrets(dest.secrets, d.secretKey);
  const token = secrets.token ?? "";
  if (!token || tokenAge(dest.config, now) !== "stale") return token;
  try {
    const next = await refreshToken(d.fetch ?? fetch, token);
    if (!next) return token;
    await d.store.upsertDestination({ venue_id: dest.venue_id, kind: "instagram", config: { ...dest.config, token_refreshed_at: now.toISOString() }, secrets: encryptSecrets({ ...secrets, token: next }, d.secretKey), status: dest.status });
    return next;
  } catch {
    return token; // the read itself reports a token that really stopped working (190)
  }
}
```

- [ ] **Step 6: Create `src/social/comments-poll.ts`**

```ts
// src/social/comments-poll.ts
// Server-only. Reads the comments under the posts Site Manager published in the last 14 days (destination_syncs results),
// stores the ones not seen before (social_comments) and marks the venue's own comments and nested replies so they are never
// proposed. Per venue at most every 15 minutes (last_comment_poll_at in the destination config); v1 polls, webhooks come in
// phase 2 (docs/CHANNELS.md). Logs carry venue ids, counts and error codes only: never comment text, never tokens.
import { FB_GRAPH, GraphClient, IG_GRAPH, MetaApiError } from "../destinations/meta-graph";
import { freshInstagramToken } from "../destinations/instagram";
import { decryptSecrets } from "../destinations/secrets";
import { publishedTargets, type PublishedTarget } from "../destinations/social-common";
import type { SyncDeps } from "../destinations/sync";
import { formatSyncError } from "../destinations/wp-errors";
import type { CommentNetwork, Venue } from "../domain/types";
import type { DestinationWithSecrets, NewSocialComment, SocialComment, Store } from "../store/types";
import { fetchFacebookComments, fetchInstagramComments, type IncomingComment } from "./comments-graph";

export const COMMENT_POLL_EVERY_MS = 15 * 60_000;
export const COMMENT_POST_WINDOW_MS = 14 * 24 * 3_600_000;
export const COMMENT_RETENTION_MS = 30 * 24 * 3_600_000;
/** Facebook `since` on a repeat poll: the last poll minus this margin (the unique comment_id makes the overlap harmless). */
const SINCE_MARGIN_MS = 3_600_000;
const NETWORKS: readonly CommentNetwork[] = ["instagram", "facebook"];
const CONNECTION_CODES = new Set(["sm_meta_token", "sm_meta_permission"]);

export interface PollReport {
  polled: CommentNetwork[];
  inserted: SocialComment[];
  errors: { network: CommentNetwork; code: string }[];
}

const log = (d: SyncDeps, s: string) => (d.log ?? ((x: string) => console.log(x)))(s);

function isDue(dest: DestinationWithSecrets, now: Date): boolean {
  const last = Date.parse(String(dest.config.last_comment_poll_at ?? ""));
  return !Number.isFinite(last) || now.getTime() - last >= COMMENT_POLL_EVERY_MS;
}

function toRow(c: IncomingComment, t: PublishedTarget, ownId: string, now: Date): NewSocialComment {
  const status = c.parent_id !== null ? "nested" : c.author_id !== "" && c.author_id === ownId ? "own" : "new";
  return { network: c.network, post_ref: c.post_ref, comment_id: c.comment_id, parent_id: c.parent_id, author_id: c.author_id, author_name: c.author_name, text: c.text, created_at: c.created_at, seen_at: now.toISOString(), status, post_caption: t.caption, post_permalink: t.permalink };
}

async function readNetwork(d: SyncDeps, dest: DestinationWithSecrets, network: CommentNetwork, targets: PublishedTarget[], now: Date): Promise<NewSocialComment[]> {
  const key = d.secretKey as Buffer;
  const token = network === "instagram" ? await freshInstagramToken(d, dest, now) : decryptSecrets(dest.secrets, key).page_token ?? "";
  const ownId = String(network === "instagram" ? dest.config.ig_user_id ?? "" : dest.config.page_id ?? "");
  if (!token || !ownId) throw new MetaApiError(0, "sm_social_not_connected", `${network} is not connected.`, { retry: false });
  const client = new GraphClient(network === "instagram" ? IG_GRAPH : FB_GRAPH, token, d.fetch ?? fetch);
  const last = Date.parse(String(dest.config.last_comment_poll_at ?? ""));
  const since = Number.isFinite(last) ? new Date(last - SINCE_MARGIN_MS).toISOString() : undefined;
  const oldest = now.getTime() - COMMENT_RETENTION_MS;
  const rows: NewSocialComment[] = [];
  for (const t of targets) {
    let comments: IncomingComment[];
    try {
      comments = network === "instagram" ? await fetchInstagramComments(client, t.post_ref) : await fetchFacebookComments(client, t.post_ref, since);
    } catch (e) {
      if (e instanceof MetaApiError && e.notFound) continue; // the post was deleted (an undo, or by hand): nothing to read
      if (e instanceof MetaApiError && CONNECTION_CODES.has(e.code)) throw e;
      log(d, `[comments] ${network} read of post ${t.post_ref} for venue ${dest.venue_id} failed: ${e instanceof MetaApiError ? e.code : e instanceof Error ? e.name : "error"}`);
      if (e instanceof MetaApiError && !e.retryable) continue;
      throw e;
    }
    for (const c of comments) if (Date.parse(c.created_at) >= oldest) rows.push(toRow(c, t, ownId, now));
  }
  return rows;
}

/**
 * One venue's poll: each connected network at most every 15 min. A token/permission error marks the destination `error`
 * (the owner reconnects); any other error is logged and the network is tried again on the next tick (no last_comment_poll_at).
 * Never throws.
 */
export async function pollVenueComments(d: SyncDeps, venue: Venue, now: Date): Promise<PollReport> {
  const report: PollReport = { polled: [], inserted: [], errors: [] };
  if (!d.secretKey) return report;
  let targets: PublishedTarget[] | null = null;
  for (const network of NETWORKS) {
    let dest: DestinationWithSecrets | null;
    try {
      dest = await d.store.getDestination(venue.id, network);
    } catch (e) {
      log(d, `[comments] ${network} destination read for venue ${venue.id} failed: ${e instanceof Error ? e.name : "error"}`);
      continue;
    }
    if (!dest || dest.status !== "connected" || !isDue(dest, now)) continue;
    try {
      targets ??= await publishedTargets(d.store, venue.id, new Date(now.getTime() - COMMENT_POST_WINDOW_MS).toISOString());
      const mine = targets.filter((t) => t.network === network);
      const rows = mine.length ? await readNetwork(d, dest, network, mine, now) : [];
      const inserted = await d.store.upsertComments(venue.id, rows);
      report.inserted.push(...inserted);
      report.polled.push(network);
      await d.store.updateDestination(dest.id, { config: { ...dest.config, last_comment_poll_at: now.toISOString() } });
      if (inserted.length) log(d, `[comments] ${network} poll for venue ${venue.id}: ${inserted.length} new of ${rows.length} read`);
    } catch (e) {
      const code = e instanceof MetaApiError ? e.code : "error";
      report.errors.push({ network, code });
      log(d, `[comments] ${network} poll for venue ${venue.id} failed: ${code}`);
      if (e instanceof MetaApiError && CONNECTION_CODES.has(e.code)) {
        await d.store.updateDestination(dest.id, { status: "error", last_error: formatSyncError(e.code, e.message), config: { ...dest.config, last_comment_poll_at: now.toISOString() } }).catch(() => undefined);
      }
    }
  }
  return report;
}

/** Customer content is kept for 30 days at most (Meta policy): deletes older rows of every venue. Returns how many. */
export function purgeOldComments(store: Pick<Store, "purgeComments">, now: Date): Promise<number> {
  return store.purgeComments(new Date(now.getTime() - COMMENT_RETENTION_MS).toISOString());
}
```

- [ ] **Step 7: Tick step 9.** In `src/tick.ts` add `import { pollVenueComments, purgeOldComments } from "./social/comments-poll";`, add to `TickReport`:

```ts
  /** New customer comments stored this tick (comment replies, 2026-10-15); absent without sync deps. */
  comments_found?: number;
```

and inside `if (d.sync) { … }` after step 8:

```ts
    // 9. Customer comments under the venue's posts (comment replies, 2026-10-15): read every 15 min per venue, keep 30 days.
    try {
      report.comments_found = 0;
      const venues = d.venueId ? [await d.store.getVenue(d.venueId)] : await d.store.listVenues({ status: "live" });
      for (const venue of venues) {
        const r = await pollVenueComments(d.sync, venue, d.now);
        report.comments_found += r.inserted.length;
      }
      if (!d.venueId) await purgeOldComments(d.store, d.now);
    } catch (e) {
      console.error("[tick] comment poll failed:", e instanceof Error ? e.message : e);
    }
```

- [ ] **Step 8: Run the tests**

```
npx vitest run test/comments-poll.test.ts test/tick.test.ts test/destinations-social.test.ts test/server-tick.test.ts
npm run typecheck
```

Expected: green. (`test/tick.test.ts` runs ticks without `sync`, so step 9 is skipped there; the tick tests that pass `sync` with a `FakeWordPress` have no social destinations and poll nothing.)

- [ ] **Step 9: Commit**

```
git add src/destinations/social-common.ts src/destinations/instagram.ts src/social/comments-poll.ts src/tick.ts test/comments-helpers.ts test/comments-poll.test.ts
git commit -m "Comments: poller reads comments of the last 14 days' posts every 15 min, stores and purges them; tick step 9

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: Draft — one small-model call with validation and a neutral fallback

**Files:**
- Create: `src/social/comments-draft.ts`
- Modify: `src/config.ts` (`Config.commentDraftModel`, `loadConfig`), `.env.example` (after `META_LOGIN_CONFIG_ID`)
- Test: `test/comments-draft.test.ts`, `test/config.test.ts` (the "reads every key with defaults" expectation)

**Interfaces:**

Consumes: `Anthropic` (type and `beta.messages.create`); `detectLang`, `weekdayLabel`, `formatPrice` from `src/domain/format.ts`; `WEEKDAYS`, `Lang`, `Venue`, `SiteState` from `src/domain/types.ts`; `allergenName` from `src/domain/allergens.ts`.

Produces (in `src/social/comments-draft.ts`):

```ts
export type DraftKind = "question" | "praise" | "complaint" | "spam" | "abuse" | "other";
export const DRAFT_KINDS: readonly DraftKind[];
export const REPLY_MAX = 500;
export interface DraftMenuItem { name: string; price_eur: number; allergens: number[] }
export interface DraftContext {
  venue: Pick<Venue, "name" | "tagline_bg" | "tagline_en" | "about_bg" | "about_en" | "phone" | "hours" | "default_lang">;
  menu: DraftMenuItem[];
  postCaption: string;
  comment: { author_name: string; text: string };
}
export interface ReplyDraft { reply: string; kind: DraftKind; fallback: boolean }
export type DraftFn = (ctx: DraftContext) => Promise<ReplyDraft>;
export function commentLang(text: string, fallback: Lang): Lang;                 // Cyrillic → bg, Latin letters → en, else fallback
export function fallbackReply(venue: Pick<Venue, "phone">, lang: Lang): string;
export function parseDraft(text: string): { reply: string; kind: DraftKind } | null; // the first {...} JSON object in the text; null when unusable
export function draftSystemPrompt(ctx: DraftContext, lang: Lang): string;
export function draftContextOf(site: SiteState, comment: { author_name: string; text: string; post_caption: string }): DraftContext;
export function draftReply(client: Anthropic | null, cfg: { model: string }, ctx: DraftContext): Promise<ReplyDraft>; // never throws
// src/config.ts: Config.commentDraftModel: string (COMMENT_DRAFT_MODEL, default "claude-haiku-5-5")
```

- [ ] **Step 1: Write the failing tests.** `test/comments-draft.test.ts`:

```ts
// test/comments-draft.test.ts — the reply draft: prompt contents, the model call shape, JSON parsing, validation, fallback.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { commentLang, draftContextOf, draftReply, draftSystemPrompt, DRAFT_KINDS, fallbackReply, parseDraft, REPLY_MAX, type DraftContext } from "@/src/social/comments-draft";
import { makeDemo } from "./helpers";

type Reply = { stop_reason: string; content: unknown[] } | Error;
/** Records the request params and answers with the scripted message (or throws). */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); if (reply instanceof Error) throw reply; return reply; } } } };
  return { client: client as unknown as Anthropic, calls };
}
const text = (t: string): Reply => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

async function ctx(comment = "Имате ли безглутенови?", author = "Мария", caption = "Днешното предложение: тиквена супа"): Promise<DraftContext> {
  const { store, venue } = await makeDemo();
  return draftContextOf(await store.getSite(venue.id), { author_name: author, text: comment, post_caption: caption });
}

describe("commentLang and fallbackReply", () => {
  it("answers Cyrillic in Bulgarian, Latin in English, emoji-only in the venue's language", () => {
    expect(commentLang("Имате ли безглутенови?", "en")).toBe("bg");
    expect(commentLang("Do you have gluten-free?", "bg")).toBe("en");
    expect(commentLang("🔥🔥", "bg")).toBe("bg");
    expect(commentLang("🔥🔥", "en")).toBe("en");
  });
  it("names the venue's phone when there is one", () => {
    expect(fallbackReply({ phone: "+359 2 000 0000" }, "bg")).toBe("Благодарим! Пишете ни на +359 2 000 0000 за подробности.");
    expect(fallbackReply({ phone: "+359 2 000 0000" }, "en")).toBe("Thank you! Write to us at +359 2 000 0000 for details.");
    expect(fallbackReply({ phone: "" }, "bg")).toBe("Благодарим! Пишете ни за подробности.");
    expect(fallbackReply({ phone: "" }, "en")).toBe("Thank you! Write to us for details.");
  });
});

describe("parseDraft", () => {
  it("reads the JSON object out of plain or fenced text and validates it", () => {
    expect(parseDraft('{"reply": "Да, имаме.", "kind": "question"}')).toEqual({ reply: "Да, имаме.", kind: "question" });
    expect(parseDraft('Here you go:\n```json\n{"reply":"Thanks!","kind":"praise"}\n```')).toEqual({ reply: "Thanks!", kind: "praise" });
    expect(parseDraft('{"reply": "  spaced  ", "kind": "weird"}')).toEqual({ reply: "spaced", kind: "other" });
    expect(parseDraft('{"reply": "", "kind": "spam"}')).toEqual({ reply: "", kind: "spam" }); // spam/abuse need no reply
    expect(parseDraft('{"reply": "", "kind": "question"}')).toBeNull();
    expect(parseDraft(`{"reply": "${"x".repeat(REPLY_MAX + 1)}", "kind": "other"}`)).toBeNull();
    expect(parseDraft("no json here")).toBeNull();
    expect(parseDraft('{"kind": "praise"}')).toBeNull();
    expect(parseDraft("[1,2]")).toBeNull();
    expect(DRAFT_KINDS).toEqual(["question", "praise", "complaint", "spam", "abuse", "other"]);
  });
});

describe("draftSystemPrompt", () => {
  it("carries the venue facts, the menu with prices and allergens, the hours, the caption and the rules", async () => {
    const c = await ctx();
    const p = draftSystemPrompt(c, "bg");
    expect(p).toContain("Кафене „Ъгъла“");
    expect(p).toContain(c.venue.tagline_bg);
    expect(p).toContain(c.venue.about_bg);
    expect(p).toContain("Капучино: 2,90 €");
    expect(p).toMatch(/алергени: 7/);
    expect(p).toContain("пон 08:00–18:00");
    expect(p).toContain("нед: затворено");
    expect(p).toContain("Днешното предложение: тиквена супа");
    expect(p).toContain("+359 2 000 0000");
    for (const rule of ["Bulgarian", "1–2 sentences", "never invent", "apolog", "never argue", "assistant", "emoji", '"kind"', "spam", "abuse"]) expect(p).toContain(rule);
    expect(draftSystemPrompt(c, "en")).toContain("€2.90"); // menu names stay in the venue's default language
  });
});

describe("draftReply", () => {
  it("calls the small model once with low effort and ~1000 tokens, and returns the parsed reply", async () => {
    const { client, calls } = fakeClient(text('{"reply": "Да, имаме безглутенов хляб всеки ден.", "kind": "question"}'));
    const r = await draftReply(client, { model: "claude-haiku-5-5" }, await ctx());
    expect(r).toEqual({ reply: "Да, имаме безглутенов хляб всеки ден.", kind: "question", fallback: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1000, output_config: { effort: "low" } });
    expect(calls[0]).not.toHaveProperty("thinking");
    expect(calls[0]).not.toHaveProperty("tools");
    const messages = calls[0].messages as { role: string; content: { type: string; text: string }[] }[];
    expect(messages[0].content[0].text).toContain("Имате ли безглутенови?");
    expect(messages[0].content[0].text).toContain("Мария");
    expect(String(calls[0].system)).toContain("Answer in Bulgarian");
  });
  it("tells the model the comment's language", async () => {
    const { client, calls } = fakeClient(text('{"reply": "Yes, we do!", "kind": "question"}'));
    await draftReply(client, { model: "m" }, await ctx("Do you have oat milk?", "Jane"));
    expect(String(calls[0].system)).toContain("Answer in English");
  });
  it("falls back to the neutral line when the call fails, is refused, is empty or invalid, or there is no client", async () => {
    const c = await ctx();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fallback = { reply: "Благодарим! Пишете ни на +359 2 000 0000 за подробности.", kind: "other", fallback: true };
    expect(await draftReply(fakeClient(new Error("boom Имате ли безглутенови?")).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(fakeClient({ stop_reason: "refusal", content: [] }).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(fakeClient(text("I cannot help with that.")).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(fakeClient(text('{"reply": "", "kind": "question"}')).client, { model: "m" }, c)).toEqual(fallback);
    expect(await draftReply(null, { model: "m" }, c)).toEqual(fallback);
    const en = await draftReply(null, { model: "m" }, await ctx("Do you deliver?", "Jane"));
    expect(en.reply).toBe("Thank you! Write to us at +359 2 000 0000 for details.");
    expect(errors.mock.calls.flat().join(" ")).not.toContain("безглутенови");
    errors.mockRestore();
  });
  it("keeps a spam verdict with an empty reply", async () => {
    const r = await draftReply(fakeClient(text('{"reply": "", "kind": "spam"}')).client, { model: "m" }, await ctx("Buy followers at spam.example", "bot"));
    expect(r).toEqual({ reply: "", kind: "spam", fallback: false });
  });
});
```

In `test/config.test.ts` add `commentDraftModel: "claude-haiku-5-5"` to the `toMatchObject` of "reads every key with defaults" and a new case:

```ts
  it("reads COMMENT_DRAFT_MODEL", () => {
    expect(loadConfig({ ...full, COMMENT_DRAFT_MODEL: "claude-sonnet-5-5" }).commentDraftModel).toBe("claude-sonnet-5-5");
  });
```

- [ ] **Step 2: Run and watch them fail**

```
npx vitest run test/comments-draft.test.ts test/config.test.ts
```

Expected: cannot resolve `@/src/social/comments-draft`; `commentDraftModel` is `undefined`.

- [ ] **Step 3: Config.** In `src/config.ts` add to `Config` after `agentEffort`:

```ts
  /** Small model for comment reply drafts (COMMENT_DRAFT_MODEL); one short call per comment. */
  commentDraftModel: string;
```

and in `loadConfig`'s return after `agentEffort: effort,`: `commentDraftModel: optional("COMMENT_DRAFT_MODEL") ?? "claude-haiku-5-5",`. In `.env.example` append after the `META_LOGIN_CONFIG_ID=` block:

```
# Replies to customer comments (dashboard → "Comments"; docs/superpowers/specs/2026-10-15-comment-replies-design.md). The small
# model that drafts each reply from the venue's facts and menu; one short call per comment. Default claude-haiku-5-5.
COMMENT_DRAFT_MODEL=
```

- [ ] **Step 4: Create `src/social/comments-draft.ts`**

```ts
// src/social/comments-draft.ts
// One small-model call that drafts a reply to a customer comment from the venue's own facts (name, tagline, about, hours,
// phone, the menu with prices and allergens, the post's caption). The owner always sees and approves the draft before it is
// posted. Never throws: any failure gives the neutral fallback line. Never logs comment text or model output.
import type Anthropic from "@anthropic-ai/sdk";
import { allergenName } from "../domain/allergens";
import { detectLang, formatPrice, itemName, tr, weekdayLabel } from "../domain/format";
import { WEEKDAYS, type Lang, type SiteState, type Venue } from "../domain/types";

export type DraftKind = "question" | "praise" | "complaint" | "spam" | "abuse" | "other";
export const DRAFT_KINDS: readonly DraftKind[] = ["question", "praise", "complaint", "spam", "abuse", "other"];
/** A reply longer than this is not a comment reply any more. */
export const REPLY_MAX = 500;
const MAX_TOKENS = 1000;
const MENU_MAX_ITEMS = 80;

export interface DraftMenuItem {
  name: string;
  price_eur: number;
  allergens: number[];
}
export interface DraftContext {
  venue: Pick<Venue, "name" | "tagline_bg" | "tagline_en" | "about_bg" | "about_en" | "phone" | "hours" | "default_lang">;
  menu: DraftMenuItem[];
  postCaption: string;
  comment: { author_name: string; text: string };
}
export interface ReplyDraft {
  reply: string;
  kind: DraftKind;
  /** True when the neutral line stands in for a failed or invalid draft. */
  fallback: boolean;
}
export type DraftFn = (ctx: DraftContext) => Promise<ReplyDraft>;

/** The language to answer in: the comment's (Cyrillic → Bulgarian, Latin letters → English), else the venue's. */
export function commentLang(text: string, fallback: Lang): Lang {
  const cyrillic = detectLang(text);
  if (cyrillic) return cyrillic;
  return /\p{Script=Latin}/u.test(text) ? "en" : fallback;
}

export function fallbackReply(venue: Pick<Venue, "phone">, lang: Lang): string {
  const phone = venue.phone.trim();
  if (lang === "bg") return phone ? `Благодарим! Пишете ни на ${phone} за подробности.` : "Благодарим! Пишете ни за подробности.";
  return phone ? `Thank you! Write to us at ${phone} for details.` : "Thank you! Write to us for details.";
}

/** The first {...} object in the model's text; null unless it holds a usable reply (non-empty ≤ REPLY_MAX, or empty for spam/abuse). */
export function parseDraft(text: string): { reply: string; kind: DraftKind } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as { reply?: unknown; kind?: unknown };
  if (typeof o.reply !== "string") return null;
  const reply = o.reply.trim();
  const kind: DraftKind = typeof o.kind === "string" && (DRAFT_KINDS as readonly string[]).includes(o.kind) ? (o.kind as DraftKind) : "other";
  if (Array.from(reply).length > REPLY_MAX) return null;
  if (reply === "" && kind !== "spam" && kind !== "abuse") return null;
  return { reply, kind };
}

/** What the model needs from the site state, in the venue's default language for names. */
export function draftContextOf(site: SiteState, comment: { author_name: string; text: string; post_caption: string }): DraftContext {
  const { venue } = site;
  const lang = venue.default_lang;
  const menu = site.items.filter((i) => i.active).slice(0, MENU_MAX_ITEMS).map((i) => ({ name: itemName(i, lang), price_eur: i.price_eur, allergens: i.allergens }));
  return {
    venue: { name: venue.name, tagline_bg: venue.tagline_bg, tagline_en: venue.tagline_en, about_bg: venue.about_bg, about_en: venue.about_en, phone: venue.phone, hours: venue.hours, default_lang: venue.default_lang },
    menu,
    postCaption: comment.post_caption,
    comment: { author_name: comment.author_name, text: comment.text },
  };
}

function hoursLines(ctx: DraftContext, lang: Lang): string {
  return WEEKDAYS.map((d) => {
    const h = ctx.venue.hours[d];
    return `${weekdayLabel(d, lang)}${h ? ` ${h.open}–${h.close}` : `: ${tr(lang, "затворено", "closed")}`}`;
  }).join(", ");
}

export function draftSystemPrompt(ctx: DraftContext, lang: Lang): string {
  const v = ctx.venue;
  const language = lang === "bg" ? "Bulgarian" : "English";
  const menu = ctx.menu.map((m) => `- ${m.name}: ${formatPrice(m.price_eur, lang)}${m.allergens.length ? ` (${tr(lang, "алергени", "allergens")}: ${m.allergens.map((a) => `${a} ${allergenName(a, lang)}`).join(", ")})` : ""}`).join("\n");
  return `You write short replies to customer comments under the social media posts of a café or restaurant, as the venue itself. The owner reads and approves every reply before it is posted.

Venue: ${v.name}
Tagline: ${lang === "bg" ? v.tagline_bg : v.tagline_en}
About: ${lang === "bg" ? v.about_bg : v.about_en}
Phone: ${v.phone || "(none)"}
Opening hours: ${hoursLines(ctx, lang)}
Menu (name: price):
${menu || "(no menu)"}

The post the comment is under: ${ctx.postCaption.trim() ? `"${ctx.postCaption.trim()}"` : "(no caption)"}

Rules:
- Answer in ${language} (Bulgarian is the default for this venue's customers): the comment's language.
- 1–2 sentences, warm and natural; no emojis unless the comment itself has them.
- For price, allergen or availability questions use the menu above; never invent facts, prices, ingredients or hours. If the menu does not say, invite the customer to write or call.
- A complaint gets an apology and an invitation to write to the venue${v.phone ? ` (${v.phone})` : ""}; never argue, never say who is at fault.
- Never mention being an assistant, a bot or AI; you are the venue.
- Classify the comment: "question", "praise", "complaint", "spam" (ads, links, selling followers, unrelated offers), "abuse" (insults, threats, hate) or "other". For "spam" and "abuse" leave the reply empty: the venue hides those instead of answering.

Answer with one JSON object and nothing else: {"reply": "<the reply>", "kind": "<question|praise|complaint|spam|abuse|other>"}`;
}

const errorSummary = (e: unknown) => (e instanceof Error ? e.name : "error");

/** One draft; the neutral fallback line (kind "other") when the call fails, is refused, or returns nothing usable. */
export async function draftReply(client: Anthropic | null, cfg: { model: string }, ctx: DraftContext): Promise<ReplyDraft> {
  const lang = commentLang(ctx.comment.text, ctx.venue.default_lang);
  const fallback: ReplyDraft = { reply: fallbackReply(ctx.venue, lang), kind: "other", fallback: true };
  if (!client) return fallback;
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: draftSystemPrompt(ctx, lang),
      messages: [{ role: "user", content: [{ type: "text", text: `Comment by ${ctx.comment.author_name || "a customer"}:\n${ctx.comment.text}` }] }],
    });
  } catch (e) {
    console.error("[comments] draft call failed:", errorSummary(e));
    return fallback;
  }
  if (res.stop_reason === "refusal") return fallback;
  const text = res.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("\n");
  const parsed = parseDraft(text);
  if (!parsed) {
    console.error("[comments] draft unusable:", res.stop_reason ?? "no text");
    return fallback;
  }
  return { ...parsed, fallback: false };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

```
npx vitest run test/comments-draft.test.ts test/config.test.ts
npm run typecheck
```

Expected: green. (If the SDK's `BetaMessageCreateParams` type refuses `fallbacks`/`betas` together with `output_config`, copy exactly the parameter set `src/wizard/texts.ts` passes; it compiles today.)

- [ ] **Step 6: Commit**

```
git add src/social/comments-draft.ts src/config.ts .env.example test/comments-draft.test.ts test/config.test.ts
git commit -m "Comments: draftReply with a small model, validation and a neutral fallback; COMMENT_DRAFT_MODEL

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: Propose — comment sets to every owner, first tap wins, limit, TTL, `ensureNoPending`

**Files:**
- Create: `src/social/comments-propose.ts`
- Modify: `src/bot/copy.ts` (BG + EN: `commentLimitReached`, `decidedByOther`, `alreadyDecided`, `expiredAfter`)
- Modify: `src/bot/approvals.ts` (`handleDecision`)
- Modify: `src/agent/tools.ts` (`ensureNoPending`, lines ~158-168)
- Modify: `src/tick.ts` (`TickDeps.comments`, `TickReport.comments_proposed`, step 1 TTL + conclusions, step 9 proposing)
- Modify: `src/server/deps.ts` (`ServerDeps.comments`, `handleRun`), `src/server/tick.ts` (passes `comments`)
- Test: `test/comments-propose.test.ts`

**Interfaces:**

Consumes: `DraftFn`, `DraftKind`, `draftContextOf` from `src/social/comments-draft.ts`; `excerpt` from `src/domain/comment-preview.ts`; `renderPreview`; `monthWindow` from `src/domain/limits.ts`; `localDate` from `src/time.ts`; `PROACTIVE_WINDOW_MS` from `src/channels/router.ts`; `channelOf`, `isMetaChannel` from `src/channels/ref.ts`; `CHANNEL_NAMES` from `src/bot/members.ts`; `copy` from `src/bot/copy.ts`; `Messenger`; store types.

Produces (in `src/social/comments-propose.ts`):

```ts
export const COMMENT_PROPOSAL_TTL_MS = 24 * 3_600_000;
export function proposalTtlMs(source: ChangeSource): number;      // comment → 24 h, else 2 h
export function proposalTtlHours(source: ChangeSource): number;   // 24 | 2
export interface ProposeDeps { store: Store; messenger: Messenger; now: () => Date; draft: DraftFn; log?: (s: string) => void }
export interface CommentSetItem { comment: SocialComment; reply_text: string | null; moderate: ModerateAction | null; kind?: DraftKind }
export interface CommentSetResult { set: ChangeSet | null; sent: string[]; deferred: boolean; limited: boolean }
export interface CommentLimitState { used: number; limit: number | null; reached: boolean; resets_on: string }
export function commentChanges(items: CommentSetItem[]): Change[];
export function commentProposalText(items: CommentSetItem[], lang: Lang, o?: { batch?: boolean }): string;
export function commentSetSummary(items: CommentSetItem[]): { summary_bg: string; summary_en: string };
export function commentLimitState(store: Pick<Store, "countCommentActions">, venue: Pick<Venue, "id" | "tz" | "comment_limit">, now: Date): Promise<CommentLimitState>;
export function reachableOwners(store: Pick<Store, "listMembers">, venueId: string, now: Date): Promise<{ reachable: Member[]; deferred: Member[] }>;
export type CommentSetDeps = Pick<ProposeDeps, "store" | "messenger" | "now" | "log">;
export function createCommentSet(d: CommentSetDeps, venue: Venue, items: CommentSetItem[], o?: { chatRef?: string | null; batch?: boolean; silent?: boolean }): Promise<CommentSetResult>; // silent: no proposal messages (the dashboard applies at once)
export function proposeForComments(d: ProposeDeps, venue: Venue, comments: SocialComment[], o: { mode: "each" | "batch" }): Promise<{ sets: ChangeSet[]; deferred: number; limited: boolean }>;
export function commentsOfSet(store: Pick<Store, "listComments">, cs: Pick<ChangeSet, "id" | "venue_id">): Promise<SocialComment[]>;
export function cancelCommentSet(d: CommentSetDeps, cs: ChangeSet, mark: { bg: string; en: string }, o?: { except?: string; status?: CommentStatus }): Promise<void>;
// src/tick.ts: TickDeps.comments?: { draft: DraftFn } | null; TickReport.comments_proposed?: number
// src/server/deps.ts: ServerDeps.comments: { draft: DraftFn } | null
```

- [ ] **Step 1: Write the failing test** `test/comments-propose.test.ts`:

```ts
// test/comments-propose.test.ts — comment proposals: text, every owner, first tap wins, deferred Meta owners, the comment limit,
// the 24 h TTL, ensureNoPending both ways, cancel, and tick step 9 proposing in "each" mode.
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { copy } from "@/src/bot/copy";
import { planChanges } from "@/src/domain/changes";
import type { SocialComment } from "@/src/store/types";
import type { DraftContext, ReplyDraft } from "@/src/social/comments-draft";
import { cancelCommentSet, COMMENT_PROPOSAL_TTL_MS, commentLimitState, commentProposalText, commentsOfSet, createCommentSet, proposalTtlHours, proposeForComments, type CommentSetItem, type ProposeDeps } from "@/src/social/comments-propose";
import { runTick } from "@/src/tick";
import { at, connectedVenue, DAY, HOUR, MIN, T0 } from "./comments-helpers";
import { call } from "./tool-call";

/** A draft function that answers from a table by comment text (default: a thank-you), recording its calls. */
function scriptedDraft(table: Record<string, ReplyDraft> = {}) {
  const calls: DraftContext[] = [];
  const draft = async (ctx: DraftContext): Promise<ReplyDraft> => {
    calls.push(ctx);
    return table[ctx.comment.text] ?? { reply: `Благодарим, ${ctx.comment.author_name}!`, kind: "praise", fallback: false };
  };
  return { draft, calls };
}

async function setup(table: Record<string, ReplyDraft> = {}, members: { chat_ref: string; lang: "bg" | "en"; last_seen_at?: string | null }[] = []) {
  const v = await connectedVenue();
  for (const m of members) await v.store.upsertMember({ venue_id: v.venue.id, chat_ref: m.chat_ref, role: "owner", lang: m.lang, last_seen_at: m.last_seen_at ?? null });
  const { draft, calls } = scriptedDraft(table);
  const d: ProposeDeps = { store: v.store, messenger: v.messenger, now: () => T0, draft, log: (s) => v.logs.push(s) };
  const base = { network: "instagram" as const, post_ref: "media-1", parent_id: null, author_id: "u1", seen_at: T0.toISOString(), status: "new" as const, post_caption: "Днешното предложение: тиквена супа" };
  const add = async (comment_id: string, text: string, author_name = "Мария", extra: Partial<SocialComment> = {}) =>
    (await v.store.upsertComments(v.venue.id, [{ ...base, comment_id, text, author_name, created_at: at(-10 * MIN).toISOString(), ...extra }]))[0];
  const freshVenue = () => v.store.getVenue(v.venue.id);
  return { ...v, sync: v.d, d, calls, add, freshVenue };
}
const item = (comment: SocialComment, reply_text: string | null, moderate: CommentSetItem["moderate"] = null): CommentSetItem => ({ comment, reply_text, moderate });

describe("commentProposalText", () => {
  it("one reply: the comment, the network, the post excerpt and the draft, then the question", async () => {
    const { add } = await setup();
    const c = await add("c1", "Имате ли безглутенови?");
    expect(commentProposalText([item(c, "Да, имаме безглутенов хляб всеки ден.")], "bg")).toBe(
      "💬 Нов коментар под поста „Днешното предложение: тиквена супа“ (Instagram) от Мария: „Имате ли безглутенови?“\n\nПредложен отговор:\n„Да, имаме безглутенов хляб всеки ден.“\n\nДа отговоря ли?",
    );
    expect(commentProposalText([item(c, "Yes, every day.")], "en")).toBe(
      "💬 New comment under the post “Днешното предложение: тиквена супа” (Instagram) by Мария: “Имате ли безглутенови?”\n\nSuggested reply:\n“Yes, every day.”\n\nReply?",
    );
  });
  it("a moderation: says why and asks to hide (or delete, not undoable)", async () => {
    const { add } = await setup();
    const c = await add("c2", "Buy followers at spam.example", "bot", { network: "facebook" });
    expect(commentProposalText([item(c, null, "hide")], "bg")).toBe("⚠️ Коментар под поста „Днешното предложение: тиквена супа“ (Facebook) от bot: „Buy followers at spam.example“\n\nТози коментар изглежда спам или обиден. Предлагам да го скрием.\n\nДа го скрия ли?");
    expect(commentProposalText([item(c, null, "hide")], "en")).toBe("⚠️ Comment under the post “Днешното предложение: тиквена супа” (Facebook) by bot: “Buy followers at spam.example”\n\nThis comment looks like spam or abuse. I suggest hiding it.\n\nHide it?");
    expect(commentProposalText([item(c, null, "delete")], "bg")).toContain("Предлагам да го изтрием (не може да се отмени).\n\nДа го изтрия ли?");
  });
  it("a batch: counts comments and posts, numbers the items, explains the buttons", async () => {
    const { add } = await setup();
    const a = await add("c3", "Страхотно!", "Иван");
    const b = await add("c4", "Кога отваряте?", "Петя", { post_ref: "media-2", post_caption: "Нова торта" });
    const s = await add("c5", "spam", "bot", { post_ref: "media-2", post_caption: "Нова торта" });
    const text = commentProposalText([item(a, "Благодарим, Иване!"), item(b, "Отваряме в 8:00."), item(s, null, "hide")], "bg", { batch: true });
    expect(text).toBe([
      "💬 3 нови коментара под 2 поста",
      "",
      "1. Иван (Instagram) под „Днешното предложение: тиквена супа“: „Страхотно!“",
      "   → „Благодарим, Иване!“",
      "2. Петя (Instagram) под „Нова торта“: „Кога отваряте?“",
      "   → „Отваряме в 8:00.“",
      "3. bot (Instagram) под „Нова торта“: „spam“",
      "   → скриване (спам или обиден)",
      "",
      "✅ отговаря на всички · ✏️ кажете кое да променя · ❌ отказва всички",
    ].join("\n"));
    expect(commentProposalText([item(a, "Thanks!")], "en", { batch: true })).toMatch(/^💬 1 new comment under 1 post\n/);
    expect(commentProposalText([item(a, "x")], "bg", { batch: true })).toMatch(/^💬 1 нов коментар под 1 пост\n/);
    expect(commentProposalText([item(a, "x"), item(b, "y")], "en", { batch: true })).toMatch(/^💬 2 new comments under 2 posts\n/);
  });
});

describe("createCommentSet", () => {
  it("creates one comment set with a row per item, sends the buttons to every owner and stores every message ref", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Имате ли безглутенови?");
    const r = await createCommentSet(d, await freshVenue(), [item(c, "Да, имаме.")]);
    expect(r.limited).toBe(false);
    expect(r.deferred).toBe(false);
    expect(r.sent.sort()).toEqual(["fb:900", "tg:1001"]);
    const cs = r.set!;
    expect(cs).toMatchObject({ source: "comment", status: "proposed", chat_ref: "tg:1001", summary_bg: "Отговор на коментар от Мария", summary_en: "Reply to Мария's comment", apply_at: null });
    expect(cs.changes).toEqual([{ position: 0, op: "social_reply", entity: "social_reply", entity_id: "c1", before: null, after: { network: "instagram", comment_id: "c1", post_ref: "media-1", author_name: "Мария", comment_text: "Имате ли безглутенови?", reply_text: "Да, имаме.", permalink: null } }]);
    expect(cs.preview_bg).toBe("• Отговор на коментар от Мария (Instagram): „Имате ли безглутенови?“ → „Да, имаме.“");
    const proposals = messenger.sent.filter((m) => m.setId === cs.id);
    expect(proposals.map((m) => [m.chatRef, m.lang])).toEqual([["tg:1001", "bg"], ["fb:900", "en"]]);
    expect(proposals[0].text).toContain("Предложен отговор");
    expect(proposals[1].text).toContain("Suggested reply");
    const stored = await store.getChangeSet(cs.id);
    expect(stored.message_ref).toBe(proposals[0].messageRef);
    expect(stored.proposal_refs).toEqual({ "tg:1001": proposals[0].messageRef, "fb:900": proposals[1].messageRef });
    expect(await store.getComment(c.id)).toMatchObject({ status: "proposed", change_set_id: cs.id, draft_text: "Да, имаме.", deferred: false });
  });
  it("skips a Meta owner outside the 23-hour window, never a Telegram owner; holds the comment when nobody is reachable", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "wa:359888000111", lang: "bg", last_seen_at: at(-24 * HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const r = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect(r.sent).toEqual(["tg:1001"]);
    expect(r.set?.proposal_refs).toEqual({ "tg:1001": messenger.sent[0].messageRef });
    await store.removeMember((await freshVenue()).id, "tg:1001");
    const c2 = await add("c2", "Пак супер!");
    const held = await createCommentSet(d, await freshVenue(), [item(c2, "Благодарим!")]);
    expect(held).toEqual({ set: null, sent: [], deferred: true, limited: false });
    expect(await store.getComment(c2.id)).toMatchObject({ status: "new", deferred: true, change_set_id: null });
    expect(messenger.sent).toHaveLength(1);
  });
  it("refuses when the month's comment limit is reached and says nothing itself", async () => {
    const { d, add, store, freshVenue, messenger } = await setup();
    await store.updateVenue((await freshVenue()).id, { comment_limit: 2 });
    for (const id of ["r1", "r2"]) {
      const c = await add(id, "x");
      await store.updateComment(c.id, { status: "replied", reply_id: `${id}-reply`, replied_at: at(-DAY).toISOString() });
    }
    expect(await commentLimitState(store, await freshVenue(), T0)).toEqual({ used: 2, limit: 2, reached: true, resets_on: "2026-11-01" });
    const c = await add("c3", "Супер!");
    expect(await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")])).toEqual({ set: null, sent: [], deferred: false, limited: true });
    expect(messenger.sent).toHaveLength(0);
    expect(await store.getComment(c.id)).toMatchObject({ status: "new" });
    await store.updateVenue((await freshVenue()).id, { comment_limit: null });
    expect((await commentLimitState(store, await freshVenue(), T0)).reached).toBe(false);
  });
});

describe("proposeForComments", () => {
  it("each: drafts every new comment with the venue facts and makes one set per comment; spam becomes a hide proposal", async () => {
    const { d, add, calls, store, messenger, freshVenue } = await setup({ "Buy followers": { reply: "", kind: "spam", fallback: false } });
    const a = await add("c1", "Имате ли безглутенови?");
    const s = await add("c2", "Buy followers", "bot");
    const r = await proposeForComments(d, await freshVenue(), [a, s], { mode: "each" });
    expect(r.sets).toHaveLength(2);
    expect(r.deferred).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0].venue.name).toBe("Кафене „Ъгъла“");
    expect(calls[0].menu.some((m) => m.name === "Капучино" && m.price_eur === 2.9)).toBe(true);
    expect(calls[0].postCaption).toBe("Днешното предложение: тиквена супа");
    expect(r.sets[1].changes[0]).toMatchObject({ entity: "social_moderate", entity_id: "c2", after: { action: "hide", network: "instagram", author_name: "bot" } });
    expect(r.sets[1].summary_bg).toBe("Скриване на коментар от bot");
    expect(messenger.sent.map((m) => m.text.slice(0, 2))).toEqual(["💬", "⚠️"]);
    expect(await store.getComment(s.id)).toMatchObject({ status: "proposed", draft_kind: "spam", draft_text: null });
    expect(await store.getComment(a.id)).toMatchObject({ status: "proposed", draft_kind: "praise", draft_text: "Благодарим, Мария!" });
  });
  it("batch: one set with every row, one message per owner; a reached limit sends the limit line instead", async () => {
    const { d, add, store, messenger, freshVenue } = await setup();
    const a = await add("c1", "Страхотно!", "Иван");
    const b = await add("c2", "Кога отваряте?", "Петя");
    const r = await proposeForComments(d, await freshVenue(), [a, b], { mode: "batch" });
    expect(r.sets).toHaveLength(1);
    expect(r.sets[0].changes.map((c) => c.entity_id)).toEqual(["c1", "c2"]);
    expect(r.sets[0].summary_bg).toBe("Отговори на 2 коментара");
    expect(messenger.sent[0].text).toMatch(/^💬 2 нови коментара под 1 пост\n/);
    await store.updateVenue((await freshVenue()).id, { comment_limit: 0 });
    const c = await add("c3", "Още един");
    const limited = await proposeForComments(d, await freshVenue(), [c], { mode: "batch" });
    expect(limited).toEqual({ sets: [], deferred: 0, limited: true });
    expect(messenger.sent.at(-1)?.text).toBe("Лимитът от 0 отговора на коментари за този месец е достигнат (0/0). Нови отговори от 1 ноември.");
  });
  it("reuses a stored draft for a held comment instead of calling the model again, and skips own/nested rows", async () => {
    const { d, add, calls, freshVenue } = await setup();
    const held = await add("c1", "Супер!", "Иван", { status: "new" });
    await d.store.updateComment(held.id, { draft_text: "Благодарим!", draft_kind: "praise", deferred: true });
    const own = await add("c2", "Елате!", "agala.cafe", { status: "own" });
    const nested = await add("c3", "и аз", "pesho", { parent_id: "c1", status: "nested" });
    const r = await proposeForComments(d, await freshVenue(), [await d.store.getComment(held.id) as SocialComment, own, nested], { mode: "each" });
    expect(calls).toHaveLength(0);
    expect(r.sets).toHaveLength(1);
    expect(r.sets[0].changes[0].after).toMatchObject({ reply_text: "Благодарим!" });
  });
});

describe("handleDecision on a comment set", () => {
  it("two owners: the first tap applies, the second owner's message is concluded and a later tap answers already decided", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    const first = await handleDecision({ store, messenger, now: () => T0 }, "fb:900", "apply", set!.id);
    expect(first.toast).toBe("✅ Applied");
    expect((await store.getChangeSet(set!.id)).status).toBe("applied");
    expect(messenger.concluded).toHaveLength(1);
    expect(messenger.concluded[0]).toMatchObject({ chatRef: "tg:1001", messageRef: set!.proposal_refs?.["tg:1001"], short: "✅ Решено от друг собственик (Messenger)", proactive: true });
    expect(messenger.concluded[0].full).toBe(`${set!.preview_bg}\n\n✅ Решено от друг собственик (Messenger)`);
    const late = await handleDecision({ store, messenger, now: () => at(MIN) }, "tg:1001", "apply", set!.id);
    expect(late).toEqual({ edit: { full: `${set!.preview_bg}\n\nВече решено.`, short: "Вече решено." }, toast: "Вече решено." });
    expect(messenger.concluded).toHaveLength(1);
  });
  it("a staff member or a stranger still cannot decide; ❌ ignores the comments and concludes the other owner", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:1002", "cancel", set!.id)).toast).toBe(copy("en").notYours);
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:4242", "cancel", set!.id)).toast).toBe(copy("bg").notYours);
    const r = await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "cancel", set!.id);
    expect(r.toast).toBe("❌ Отказано");
    expect(await store.getComment(c.id)).toMatchObject({ status: "ignored" });
    expect(messenger.concluded.at(-1)).toMatchObject({ chatRef: "fb:900", short: "❌ Cancelled by another owner (Telegram)" });
  });
  it("✏️ sets correction_for for the tapping owner's chat only and leaves the other owner's buttons", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    const r = await handleDecision({ store, messenger, now: () => T0 }, "fb:900", "change", set!.id);
    expect(r).toEqual({ reply: copy("en").changePrompt, toast: "✏️" });
    expect((await store.getConversation((await freshVenue()).id, "fb:900"))?.correction_for).toBe(set!.id);
    expect((await store.getConversation((await freshVenue()).id, "tg:1001"))?.correction_for ?? null).toBeNull();
    expect(messenger.concluded).toHaveLength(0);
    expect((await store.getChangeSet(set!.id)).status).toBe("proposed");
  });
  it("a plain text set is still only its own chat's, and an expired one says the TTL", async () => {
    const { store, messenger, freshVenue, items } = await setup();
    const v = await freshVenue();
    const site = await store.getSite(v.id);
    const cs = await store.createChangeSet({ venue_id: v.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3 }], { newId: () => "n", now: T0.toISOString() }) });
    await store.upsertMember({ venue_id: v.id, chat_ref: "tg:7", role: "owner", lang: "bg" });
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:7", "apply", cs.id)).toast).toBe(copy("bg").notYours);
    await store.expireChangeSet(cs.id, T0.toISOString());
    expect((await handleDecision({ store, messenger, now: () => T0 }, "tg:1001", "apply", cs.id)).toast).toBe("Изтекло: не беше потвърдено в рамките на 2 часа.");
    expect(proposalTtlHours("text")).toBe(2);
    expect(proposalTtlHours("comment")).toBe(24);
  });
});

describe("ensureNoPending and comment sets", () => {
  async function agent(v: Awaited<ReturnType<typeof setup>>) {
    const member = (await v.store.findMember("tg:1001"))!;
    const deps: AgentDeps = { store: v.store, venueId: v.venue.id, chatRef: "tg:1001", member, messenger: v.messenger, now: () => T0, baseUrl: "https://site.example" };
    return makeTools(deps);
  }
  it("a pending comment proposal does not block a menu proposal, and a pending menu proposal does not block a comment set", async () => {
    const v = await setup();
    const c = await v.add("c1", "Супер!");
    const { set } = await createCommentSet(v.d, await v.freshVenue(), [item(c, "Благодарим!")]);
    const tools = await agent(v);
    const r = await call(tools, "propose_changes", { summary_bg: "Капучино 3 €", summary_en: "Cappuccino €3", changes: [{ op: "set_price", item_id: v.items.Cappuccino.id, price_eur: 3 }] });
    expect(r.status).toBe("proposed");
    expect((await v.store.getChangeSet(set!.id)).status).toBe("proposed");
    const c2 = await v.add("c2", "Пак супер!");
    const again = await createCommentSet(v.d, await v.freshVenue(), [item(c2, "Благодарим!")]);
    expect(again.set?.status).toBe("proposed");
    expect((await v.store.listChangeSets(v.venue.id, { status: ["proposed"] })).map((x) => x.source).sort()).toEqual(["comment", "comment", "text"]);
  });
});

describe("cancelCommentSet", () => {
  it("cancels the set, concludes every owner's message except the given chat, and resets the comments", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    expect((await commentsOfSet(store, set!)).map((x) => x.id)).toEqual([c.id]);
    await cancelCommentSet({ store, messenger, now: () => T0 }, set!, { bg: "✏️ Заменено с ново предложение.", en: "✏️ Replaced by a new proposal." }, { except: "tg:1001" });
    expect((await store.getChangeSet(set!.id)).status).toBe("cancelled");
    expect(messenger.concluded.map((x) => [x.chatRef, x.short])).toEqual([["fb:900", "✏️ Replaced by a new proposal."]]);
    expect(await store.getComment(c.id)).toMatchObject({ status: "new", change_set_id: null, deferred: false });
  });
});

describe("tick: TTL and proposing", () => {
  it("expires a comment set after 24 h (not 2 h), concludes every owner and marks the comments expired", async () => {
    const { d, add, store, messenger, freshVenue } = await setup({}, [{ chat_ref: "fb:900", lang: "en", last_seen_at: at(-HOUR).toISOString() }]);
    const c = await add("c1", "Супер!");
    const { set } = await createCommentSet(d, await freshVenue(), [item(c, "Благодарим!")]);
    const early = await runTick({ store, messenger, now: at(3 * HOUR) });
    expect(early.expired).toEqual([]);
    const late = await runTick({ store, messenger, now: at(COMMENT_PROPOSAL_TTL_MS + MIN) });
    expect(late.expired).toEqual([set!.id]);
    expect(messenger.concluded.map((x) => [x.chatRef, x.short, x.proactive])).toEqual([
      ["tg:1001", "⌛ Изтекло: предложението не беше потвърдено в рамките на 24 часа.", true],
      ["fb:900", "⌛ Expired: the proposal was not confirmed within 24 hours.", true],
    ]);
    expect(await store.getComment(c.id)).toMatchObject({ status: "expired" });
  });
  it("step 9 proposes new comments in each mode, not in digest or off, and retries a held comment once the owner writes", async () => {
    const v = await setup();
    const { igMediaId } = await v.publishPost(["instagram_post"]);
    v.meta.addInstagramComment(igMediaId!, { text: "Супер!", from_id: "1784", username: "maria.k", created: at(-MIN) });
    const tick = (now: Date, venueId?: string) => runTick({ store: v.store, messenger: v.messenger, now, sync: v.sync, comments: { draft: v.d.draft }, venueId });
    const r = await tick(T0);
    expect(r.comments_found).toBe(1);
    expect(r.comments_proposed).toBe(1);
    expect(v.messenger.sent.filter((m) => m.setId)).toHaveLength(1);
    await v.store.updateVenue(v.venue.id, { comment_mode: "digest" });
    v.meta.addInstagramComment(igMediaId!, { text: "Още!", created: at(14 * MIN) });
    const digest = await tick(at(15 * MIN));
    expect(digest.comments_found).toBe(1);
    expect(digest.comments_proposed).toBe(0);
    await v.store.updateVenue(v.venue.id, { comment_mode: "off" });
    expect((await tick(at(30 * MIN))).comments_proposed).toBe(0);
    // A held comment: the only owner is on WhatsApp outside the window; the per-venue tick after the owner's message sends it.
    await v.store.updateVenue(v.venue.id, { comment_mode: "each" });
    await v.store.removeMember(v.venue.id, "tg:1001");
    await v.store.upsertMember({ venue_id: v.venue.id, chat_ref: "wa:359888000111", role: "owner", lang: "bg", last_seen_at: at(-2 * DAY).toISOString() });
    const held = await tick(at(45 * MIN));
    expect(held.comments_proposed).toBe(0);
    expect((await v.store.listComments(v.venue.id, { status: ["new"] })).every((c) => c.deferred)).toBe(true);
    await v.store.touchMember("wa:359888000111", at(50 * MIN).toISOString());
    const resent = await tick(at(50 * MIN), v.venue.id);
    expect(resent.comments_proposed).toBe(1); // "Още!"; the first comment's set is still proposed to the removed owner
    expect(v.messenger.sent.filter((m) => m.setId && m.chatRef === "wa:359888000111")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```
npx vitest run test/comments-propose.test.ts
```

Expected: cannot resolve `@/src/social/comments-propose`.

- [ ] **Step 3: Copy.** In `src/bot/copy.ts` add to `BG` after `changesThisMonth`:

```ts
  /** Comment replies (2026-10-15): the separate cap on replies and moderations. */
  commentLimitReached: (limit: number, used: number, resetsOn: string) => `Лимитът от ${limit} отговора на коментари за този месец е достигнат (${used}/${limit}). Нови отговори от ${dayMonth(resetsOn, MONTHS_BG)}.`,
  /** Another owner tapped first on a comment proposal; `channel` is a CHANNEL_NAMES value. */
  decidedByOther: (decision: "apply" | "cancel", channel: string) => (decision === "apply" ? `✅ Решено от друг собственик (${channel})` : `❌ Отказано от друг собственик (${channel})`),
  alreadyDecided: "Вече решено.",
  expiredAfter: (hours: number) => `Изтекло: не беше потвърдено в рамките на ${hours} часа.`,
```

and to `EN`:

```ts
  commentLimitReached: (limit, used, resetsOn) => `This month's limit of ${limit} comment replies is reached (${used}/${limit}). New replies from ${dayMonth(resetsOn, MONTHS_EN)}.`,
  decidedByOther: (decision, channel) => (decision === "apply" ? `✅ Decided by another owner (${channel})` : `❌ Cancelled by another owner (${channel})`),
  alreadyDecided: "Already decided.",
  expiredAfter: (hours) => `Expired: not confirmed within ${hours} hours.`,
```

- [ ] **Step 4: Create `src/social/comments-propose.ts`**

```ts
// src/social/comments-propose.ts
// Turns customer comments into change sets with source "comment": one social_reply or social_moderate row per comment, sent
// with the ✅/✏️/❌ buttons to every owner of the venue (first tap wins, src/bot/approvals.ts). Meta-channel owners outside the
// 23-hour window are skipped; when nobody can be reached the comment is held (deferred) for the next tick. A comment set never
// counts toward the monthly change limit; the venue's comment_limit caps replies and moderations instead.
import { CHANNEL_NAMES } from "../bot/members";
import { copy } from "../bot/copy";
import type { Messenger } from "../bot/messenger";
import { channelOf, isMetaChannel } from "../channels/ref";
import { PROACTIVE_WINDOW_MS } from "../channels/router";
import { excerpt } from "../domain/comment-preview";
import { tr } from "../domain/format";
import { monthWindow } from "../domain/limits";
import { renderPreview } from "../domain/preview";
import type { Change, ChangeSet, ChangeSource, Lang, Member, ModerateAction, SocialModerateRow, SocialReplyRow, Venue } from "../domain/types";
import type { CommentStatus, SocialComment, Store } from "../store/types";
import { localDate } from "../time";
import { draftContextOf, type DraftFn, type DraftKind } from "./comments-draft";

const HOUR = 3_600_000;
export const COMMENT_PROPOSAL_TTL_MS = 24 * HOUR;
const DEFAULT_TTL_MS = 2 * HOUR;
/** A comment proposal waits a day for the owner (spec); every other proposal keeps the 2 hours of src/tick.ts. */
export function proposalTtlMs(source: ChangeSource): number {
  return source === "comment" ? COMMENT_PROPOSAL_TTL_MS : DEFAULT_TTL_MS;
}
export function proposalTtlHours(source: ChangeSource): number {
  return proposalTtlMs(source) / HOUR;
}

export interface ProposeDeps {
  store: Store;
  messenger: Messenger;
  now: () => Date;
  draft: DraftFn;
  log?: (s: string) => void;
}
/** Exactly one of reply_text / moderate is set. */
export interface CommentSetItem {
  comment: SocialComment;
  reply_text: string | null;
  moderate: ModerateAction | null;
  kind?: DraftKind;
}
/** What createCommentSet and cancelCommentSet need: no drafting. */
export type CommentSetDeps = Pick<ProposeDeps, "store" | "messenger" | "now" | "log">;
export interface CommentSetResult {
  set: ChangeSet | null;
  /** Chat refs that got the buttons. */
  sent: string[];
  /** True when no owner could be reached: the comments are held for the next tick. */
  deferred: boolean;
  /** True when the venue's comment_limit is reached: nothing was created. */
  limited: boolean;
}
export interface CommentLimitState {
  used: number;
  limit: number | null;
  reached: boolean;
  /** YYYY-MM-DD in the venue's zone: the 1st of next month. */
  resets_on: string;
}

const NAME: Record<string, string> = { facebook: "Facebook", instagram: "Instagram" };
const log = (d: Pick<ProposeDeps, "log">, s: string) => (d.log ?? ((x: string) => console.log(x)))(s);

export function commentChanges(items: CommentSetItem[]): Change[] {
  return items.map((it, position): Change => {
    const c = it.comment;
    if (it.moderate) {
      const row: SocialModerateRow = { network: c.network, comment_id: c.comment_id, author_name: c.author_name, comment_text: c.text, action: it.moderate };
      return { position, op: "social_moderate", entity: "social_moderate", entity_id: c.comment_id, before: null, after: row as unknown as Change["after"] };
    }
    const row: SocialReplyRow & { permalink: string | null } = { network: c.network, comment_id: c.comment_id, post_ref: c.post_ref, author_name: c.author_name, comment_text: c.text, reply_text: it.reply_text ?? "", permalink: c.post_permalink };
    return { position, op: "social_reply", entity: "social_reply", entity_id: c.comment_id, before: null, after: row as unknown as Change["after"] };
  });
}

const q = (s: string, lang: Lang) => (lang === "bg" ? `„${s}“` : `“${s}”`);
const author = (c: SocialComment, lang: Lang) => c.author_name || tr(lang, "клиент", "a customer");
const captionOf = (c: SocialComment, lang: Lang) => (c.post_caption.trim() ? excerpt(c.post_caption) : tr(lang, "(без текст)", "(no caption)"));

function bgCount(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** The message with the buttons: one comment with its draft, one moderation, or a numbered batch. */
export function commentProposalText(items: CommentSetItem[], lang: Lang, o: { batch?: boolean } = {}): string {
  const bg = lang === "bg";
  if (!o.batch && items.length === 1) {
    const it = items[0];
    const c = it.comment;
    const where = bg ? `под поста ${q(captionOf(c, lang), lang)} (${NAME[c.network]}) от ${author(c, lang)}: ${q(c.text, lang)}` : `under the post ${q(captionOf(c, lang), lang)} (${NAME[c.network]}) by ${author(c, lang)}: ${q(c.text, lang)}`;
    if (it.moderate) {
      const why = bg ? "Този коментар изглежда спам или обиден." : "This comment looks like spam or abuse.";
      const what = it.moderate === "delete"
        ? (bg ? "Предлагам да го изтрием (не може да се отмени).\n\nДа го изтрия ли?" : "I suggest deleting it (this cannot be undone).\n\nDelete it?")
        : (bg ? "Предлагам да го скрием.\n\nДа го скрия ли?" : "I suggest hiding it.\n\nHide it?");
      return `⚠️ ${bg ? "Коментар" : "Comment"} ${where}\n\n${why} ${what}`;
    }
    return `💬 ${bg ? "Нов коментар" : "New comment"} ${where}\n\n${bg ? "Предложен отговор" : "Suggested reply"}:\n${q(it.reply_text ?? "", lang)}\n\n${bg ? "Да отговоря ли?" : "Reply?"}`;
  }
  const posts = new Set(items.map((it) => it.comment.post_ref)).size;
  const head = bg
    ? `💬 ${bgCount(items.length, "нов коментар", "нови коментара")} под ${bgCount(posts, "пост", "поста")}`
    : `💬 ${items.length} new ${items.length === 1 ? "comment" : "comments"} under ${posts} ${posts === 1 ? "post" : "posts"}`;
  const lines = items.flatMap((it, i) => {
    const c = it.comment;
    const first = `${i + 1}. ${author(c, lang)} (${NAME[c.network]}) ${bg ? "под" : "under"} ${q(captionOf(c, lang), lang)}: ${q(c.text, lang)}`;
    const second = it.moderate
      ? `   → ${it.moderate === "delete" ? tr(lang, "изтриване (спам или обиден)", "deletion (spam or abuse)") : tr(lang, "скриване (спам или обиден)", "hiding (spam or abuse)")}`
      : `   → ${q(it.reply_text ?? "", lang)}`;
    return [first, second];
  });
  const foot = bg ? "✅ отговаря на всички · ✏️ кажете кое да променя · ❌ отказва всички" : "✅ replies to all · ✏️ tell me which to change · ❌ cancels all";
  return [head, "", ...lines, "", foot].join("\n");
}

export function commentSetSummary(items: CommentSetItem[]): { summary_bg: string; summary_en: string } {
  if (items.length === 1) {
    const it = items[0];
    const name = it.comment.author_name || "клиент";
    const nameEn = it.comment.author_name || "a customer";
    if (it.moderate === "delete") return { summary_bg: `Изтриване на коментар от ${name}`, summary_en: `Delete a comment by ${nameEn}` };
    if (it.moderate) return { summary_bg: `Скриване на коментар от ${name}`, summary_en: `Hide a comment by ${nameEn}` };
    return { summary_bg: `Отговор на коментар от ${name}`, summary_en: `Reply to ${nameEn}'s comment` };
  }
  return { summary_bg: `Отговори на ${bgCount(items.length, "коментар", "коментара")}`, summary_en: `Replies to ${items.length} comments` };
}

/** The venue's comment actions this calendar month (in its zone) against comment_limit (null = unlimited). */
export async function commentLimitState(store: Pick<Store, "countCommentActions">, venue: Pick<Venue, "id" | "tz" | "comment_limit">, now: Date): Promise<CommentLimitState> {
  const w = monthWindow(now, venue.tz);
  const used = await store.countCommentActions(venue.id, w.from, w.to);
  const limit = venue.comment_limit;
  return { used, limit, reached: limit !== null && used >= limit, resets_on: localDate(new Date(w.to), venue.tz) };
}

/** Owners who may be messaged now: every Telegram owner; a Meta-channel owner only within 23 h of their last message. */
export async function reachableOwners(store: Pick<Store, "listMembers">, venueId: string, now: Date): Promise<{ reachable: Member[]; deferred: Member[] }> {
  const owners = (await store.listMembers(venueId)).filter((m) => m.role === "owner");
  const ok = (m: Member) => !isMetaChannel(channelOf(m.chat_ref)) || (m.last_seen_at !== null && now.getTime() - Date.parse(m.last_seen_at) <= PROACTIVE_WINDOW_MS);
  return { reachable: owners.filter(ok), deferred: owners.filter((m) => !ok(m)) };
}

/** The comments a set was made for (by change_set_id). */
export async function commentsOfSet(store: Pick<Store, "listComments">, cs: Pick<ChangeSet, "id" | "venue_id">): Promise<SocialComment[]> {
  return (await store.listComments(cs.venue_id, { limit: 500 })).filter((c) => c.change_set_id === cs.id);
}

/**
 * One change set for the items, sent to every reachable owner (`o.chatRef`, when given and reachable, becomes the primary
 * chat: the owner who asked). Returns without a set when the comment limit is reached or no owner can be reached (then the
 * comments are marked deferred and stay `new`). `o.silent` (the dashboard) sends no message: the caller applies the set itself.
 */
export async function createCommentSet(d: CommentSetDeps, venue: Venue, items: CommentSetItem[], o: { chatRef?: string | null; batch?: boolean; silent?: boolean } = {}): Promise<CommentSetResult> {
  const now = d.now();
  if ((await commentLimitState(d.store, venue, now)).reached) return { set: null, sent: [], deferred: false, limited: true };
  const { reachable } = o.silent ? { reachable: [] as Member[] } : await reachableOwners(d.store, venue.id, now);
  if (!o.silent && reachable.length === 0) {
    for (const it of items) await d.store.updateComment(it.comment.id, { deferred: true });
    return { set: null, sent: [], deferred: true, limited: false };
  }
  const primary = reachable.find((m) => m.chat_ref === o.chatRef) ?? reachable[0] ?? null;
  const ordered = primary ? [primary, ...reachable.filter((m) => m !== primary)] : [];
  const changes = commentChanges(items);
  const site = await d.store.getSite(venue.id);
  const cs = await d.store.createChangeSet({
    venue_id: venue.id, chat_ref: primary?.chat_ref ?? null, ...commentSetSummary(items),
    preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz),
    source: "comment", status: "proposed", changes,
  });
  const refs: Record<string, string> = {};
  for (const m of ordered) {
    const ref = await d.messenger.sendProposal(m.chat_ref, commentProposalText(items, m.lang, { batch: o.batch }), cs.id, m.lang);
    if (ref !== null) refs[m.chat_ref] = ref;
  }
  await d.store.updateChangeSet(cs.id, { message_ref: primary ? refs[primary.chat_ref] ?? null : null, proposal_refs: refs });
  for (const it of items) await d.store.updateComment(it.comment.id, { status: "proposed", change_set_id: cs.id, draft_text: it.reply_text, draft_kind: it.kind ?? it.comment.draft_kind ?? null, deferred: false });
  log(d, `[comments] set ${cs.id} for venue ${venue.id}: ${items.length} row(s), sent to ${Object.keys(refs).length} owner(s)`);
  return { set: await d.store.getChangeSet(cs.id), sent: Object.keys(refs), deferred: false, limited: false };
}

/**
 * Drafts a reply for every new top-level comment (a stored draft is reused: a held comment is not drafted twice) and proposes:
 * `each` makes one set per comment, `batch` one set for all (the digest and "answer the unanswered comments"). Spam or abuse
 * becomes a hide proposal. When the comment limit is reached a batch tells the reachable owners once; `each` only logs.
 */
export async function proposeForComments(d: ProposeDeps, venue: Venue, comments: SocialComment[], o: { mode: "each" | "batch" }): Promise<{ sets: ChangeSet[]; deferred: number; limited: boolean }> {
  const fresh = comments.filter((c) => c.status === "new" && c.parent_id === null);
  if (fresh.length === 0) return { sets: [], deferred: 0, limited: false };
  const now = d.now();
  const limit = await commentLimitState(d.store, venue, now);
  if (limit.reached) {
    if (o.mode === "batch") {
      const { reachable } = await reachableOwners(d.store, venue.id, now);
      for (const m of reachable) await d.messenger.send(m.chat_ref, copy(m.lang).commentLimitReached(limit.limit ?? limit.used, limit.used, limit.resets_on), { proactive: true });
    }
    log(d, `[comments] venue ${venue.id}: comment limit reached (${limit.used}/${limit.limit}), ${fresh.length} comment(s) not proposed`);
    return { sets: [], deferred: 0, limited: true };
  }
  const site = await d.store.getSite(venue.id);
  const items: CommentSetItem[] = [];
  for (const c of fresh) {
    let kind = (c.draft_kind ?? null) as DraftKind | null;
    let reply = c.draft_text;
    if (kind === null) {
      const r = await d.draft(draftContextOf(site, { author_name: c.author_name, text: c.text, post_caption: c.post_caption }));
      kind = r.kind;
      reply = r.reply;
      await d.store.updateComment(c.id, { draft_text: kind === "spam" || kind === "abuse" ? null : reply, draft_kind: kind });
    }
    const moderate = kind === "spam" || kind === "abuse";
    items.push({ comment: c, reply_text: moderate ? null : reply ?? "", moderate: moderate ? "hide" : null, kind });
  }
  const sets: ChangeSet[] = [];
  let deferred = 0;
  let limited = false;
  const groups = o.mode === "each" ? items.map((it) => [it]) : [items];
  for (const group of groups) {
    const r = await createCommentSet(d, venue, group, { batch: o.mode === "batch" });
    if (r.set) sets.push(r.set);
    if (r.deferred) deferred += group.length;
    if (r.limited) limited = true;
  }
  return { sets, deferred, limited };
}

/** Cancels a comment set (status cancelled), concludes every owner's proposal message but `except`, and puts its comments back to `status` (default new). */
export async function cancelCommentSet(d: CommentSetDeps, cs: ChangeSet, mark: { bg: string; en: string }, o: { except?: string; status?: CommentStatus } = {}): Promise<void> {
  await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: d.now().toISOString() });
  for (const [chatRef, messageRef] of Object.entries(cs.proposal_refs ?? (cs.chat_ref ? { [cs.chat_ref]: cs.message_ref ?? "" } : {}))) {
    if (chatRef === o.except) continue;
    const lang = (await d.store.findMember(chatRef))?.lang ?? "bg";
    const line = lang === "bg" ? mark.bg : mark.en;
    await d.messenger.conclude(chatRef, messageRef || null, `${lang === "bg" ? cs.preview_bg : cs.preview_en}\n\n${line}`, line, { proactive: true });
  }
  for (const c of await commentsOfSet(d.store, cs)) await d.store.updateComment(c.id, { status: o.status ?? "new", change_set_id: null, deferred: false });
}

/** For src/bot/approvals.ts: the line other owners see once one of them decided. */
export function decidedLine(lang: Lang, decision: "apply" | "cancel", byChatRef: string): string {
  return copy(lang).decidedByOther(decision, CHANNEL_NAMES[channelOf(byChatRef)]);
}
```

- [ ] **Step 5: `handleDecision`.** Rewrite the top of `src/bot/approvals.ts`'s `handleDecision` and the two decision branches:

```ts
import { cancelCommentSet, decidedLine, proposalTtlHours } from "../social/comments-propose";
```

```ts
/** Answer the callback first (the caller does), then run this, then conclude the proposal with `edit`. A `comment` set may be decided by any owner of the venue; the others are told. */
export async function handleDecision(d: DecisionDeps, chatRef: string, decision: Decision, setId: string): Promise<DecisionResult> {
  const member = await d.store.findMember(chatRef);
  const lang: Lang = member?.lang ?? "bg";
  const c = copy(lang);
  let cs;
  try {
    cs = await d.store.getChangeSet(setId);
  } catch {
    return { toast: c.notYours };
  }
  const isComment = cs.source === "comment";
  const anyOwner = isComment && member?.role === "owner";
  if (!member || member.venue_id !== cs.venue_id || (cs.chat_ref !== chatRef && !anyOwner)) return { toast: c.notYours };
  const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
  const venue = await d.store.getVenue(cs.venue_id);
  const now = d.now();

  if (cs.status !== "proposed") {
    const line = isComment ? c.alreadyDecided : cs.status === "expired" ? c.expiredAfter(proposalTtlHours(cs.source)) : c.status[cs.status];
    return { edit: { full: `${preview}\n\n${line}`, short: line }, toast: line };
  }
  /** Comment sets: the other owners' proposal messages lose their buttons once one owner decided. */
  const tellOthers = async (what: "apply" | "cancel") => {
    if (!isComment) return;
    for (const [other, messageRef] of Object.entries(cs.proposal_refs ?? {})) {
      if (other === chatRef) continue;
      const l = (await d.store.findMember(other))?.lang ?? "bg";
      const line = decidedLine(l, what, chatRef);
      await d.messenger.conclude(other, messageRef, `${l === "bg" ? cs.preview_bg : cs.preview_en}\n\n${line}`, line, { proactive: true });
    }
  };

  if (decision === "change") {
    await setCorrection(d.store, cs.venue_id, chatRef, cs.id, now);
    return { reply: c.changePrompt, toast: "✏️" };
  }
  if (decision === "cancel") {
    if (isComment) await cancelCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, cs, { bg: decidedLine("bg", "cancel", chatRef), en: decidedLine("en", "cancel", chatRef) }, { except: chatRef, status: "ignored" });
    else await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: now.toISOString() });
    return { edit: { full: `${preview}\n\n${c.cancelled}`, short: c.cancelled }, toast: c.cancelled };
  }
```

(`cancelCommentSet` already concludes the other owners, so `tellOthers("cancel")` is not needed there.) Keep the schedule branch as it is; after the `applyChangeSet` call and its `limited`/`skipped` handling, before computing `lines`, add `await tellOthers("apply");`. Note `cancelCommentSet` marks the set `cancelled`, which is what the ❌ branch stored before; the comments become `ignored`.

- [ ] **Step 6: `ensureNoPending` ignores comment sets.** In `src/agent/tools.ts` change the filter inside `ensureNoPending`:

```ts
    // Comment proposals (source "comment") never block a menu change and are never blocked by one.
    const earlier = (await d.store.listChangeSets(d.venueId, { status: ["proposed"], limit: 50 })).filter((cs) => cs.chat_ref === d.chatRef && cs.source !== "comment" && !turnSets.has(cs.id));
```

- [ ] **Step 7: Tick.** In `src/tick.ts`:
  - imports: `import { COMMENT_PROPOSAL_TTL_MS, commentsOfSet, proposalTtlHours, proposeForComments } from "./social/comments-propose";` and `import type { DraftFn } from "./social/comments-draft";` and `COMMENT_POST_WINDOW_MS` from `./social/comments-poll`.
  - `TickDeps`: add `/** Comment reply drafting (src/social/comments-draft.ts); null/undefined = comments are polled but never proposed. */ comments?: { draft: DraftFn } | null;`
  - `TickReport`: add `/** Comment sets proposed this tick (mode "each"). */ comments_proposed?: number;`
  - Step 1 becomes:

```ts
  // 1. Stale proposals (before applying, so an old proposal cannot be applied by a late tap). 2 h; comment sets 24 h.
  const cutoff = new Date(d.now.getTime() - PROPOSAL_TTL_MS).toISOString();
  for (const cs of await d.store.listProposedBefore(cutoff, d.venueId)) {
    if (cs.source === "comment" && Date.parse(cs.created_at) > d.now.getTime() - COMMENT_PROPOSAL_TTL_MS) continue;
    // Conditional: a tap that confirmed the set between the list and this write wins.
    if ((await d.store.expireChangeSet(cs.id, now)) !== "expired") continue;
    report.expired.push(cs.id);
    if (d.messenger) {
      const hours = proposalTtlHours(cs.source);
      const targets: [string, string | null][] = cs.source === "comment" ? Object.entries(cs.proposal_refs ?? {}) : cs.chat_ref !== null ? [[cs.chat_ref, cs.message_ref]] : [];
      for (const [chatRef, messageRef] of targets) {
        const { lang } = await langFor(d.store, cs.venue_id, chatRef);
        const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
        const line = tr(lang, `⌛ Изтекло: предложението не беше потвърдено в рамките на ${hours} часа.`, `⌛ Expired: the proposal was not confirmed within ${hours} hours.`);
        await d.messenger.conclude(chatRef, messageRef, `${preview}\n\n${line}`, line, { proactive: true });
      }
    }
    if (cs.source === "comment") for (const c of await commentsOfSet(d.store, cs)) await d.store.updateComment(c.id, { status: "expired" });
  }
```

  - Step 9 (replacing Task 4's loop body):

```ts
    // 9. Customer comments under the venue's posts (comment replies, 2026-10-15): read every 15 min per venue, propose in
    //    mode "each" (digest venues wait for step 10, "off" venues only show them on the dashboard), keep 30 days.
    try {
      report.comments_found = 0;
      report.comments_proposed = 0;
      const venues = d.venueId ? [await d.store.getVenue(d.venueId)] : await d.store.listVenues({ status: "live" });
      for (const venue of venues) {
        const r = await pollVenueComments(d.sync, venue, d.now);
        report.comments_found += r.inserted.length;
        if (!d.comments || !d.messenger || venue.comment_mode !== "each") continue;
        const fresh = (await d.store.listComments(venue.id, { status: ["new"], since: new Date(d.now.getTime() - COMMENT_POST_WINDOW_MS).toISOString() })).filter((c) => c.parent_id === null);
        if (fresh.length === 0) continue;
        const p = await proposeForComments({ store: d.store, messenger: d.messenger, now: () => d.now, draft: d.comments.draft, log: d.sync.log }, venue, fresh, { mode: "each" });
        report.comments_proposed += p.sets.length;
      }
      if (!d.venueId) await purgeOldComments(d.store, d.now);
    } catch (e) {
      console.error("[tick] comment poll failed:", e instanceof Error ? e.message : e);
    }
```

- [ ] **Step 8: Server wiring.** In `src/server/deps.ts`: import `draftReply, type DraftFn` from `../social/comments-draft`; add to `ServerDeps`: `/** Comment reply drafting for the tick; null when integrations are off. */ comments: { draft: DraftFn } | null;`; in `makeServerDeps` after `sync`: `const comments = sync ? { draft: (ctx: Parameters<DraftFn>[0]) => draftReply(anthropic, { model: config.commentDraftModel }, ctx) } : null;`; in `handleRun` pass `comments` to `runTick`; return `comments` in the object. In `src/server/tick.ts` add `comments?: { draft: DraftFn } | null` to the `deps` parameter type and pass `comments: deps.comments ?? null` to `runTick` (import the `DraftFn` type from `../social/comments-draft`).

- [ ] **Step 9: Run the tests, then everything**

```
npx vitest run test/comments-propose.test.ts test/approvals.test.ts test/change-limit.test.ts test/inbound.test.ts test/tick.test.ts test/tools-core.test.ts test/server-deps.test.ts
npx vitest run
npm run typecheck
```

Expected: green. `test/approvals.test.ts` "applies and edits the message" still gets `Вече е приложено.` for a text set on a second tap (only comment sets answer "Вече решено.").

- [ ] **Step 10: Commit**

```
git add src/social/comments-propose.ts src/bot/copy.ts src/bot/approvals.ts src/agent/tools.ts src/tick.ts src/server/deps.ts src/server/tick.ts test/comments-propose.test.ts
git commit -m "Comments: proposals to every owner (first tap wins), deferred Meta owners, comment limit, 24 h TTL, tick proposes in each mode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: Adapters — push replies and moderation, undo, not-found, lines, comment status hook

**Files:**
- Modify: `src/destinations/social-common.ts` (`commentNetworkOf`, `relevantFor`, `CommentResult`, `emptyCommentResult`, `commentResultIn`)
- Create: `src/destinations/comment-push.ts`
- Modify: `src/destinations/facebook.ts` (`push`: split post rows from comment rows), `src/destinations/instagram.ts` (`push`: same)
- Modify: `src/destinations/social-lines.ts` (`socialSyncLine`: comment results), `src/destinations/social-errors.ts` (`sm_reply_unknown`)
- Create: `src/social/comments-status.ts`
- Modify: `src/destinations/sync.ts` (`runSync`: call `afterSocialPush` after a social push)
- Test: `test/comments-adapters.test.ts`

**Interfaces:**

Consumes: `replyInstagram`, `replyFacebook`, `moderateInstagram`, `moderateFacebook`, `deleteReply` from `src/social/comments-graph.ts`; `PushContext`, `PushResult`; `MetaApiError`, `GraphClient`; `ModerateAction`, `Change`.

Produces:

```ts
// src/destinations/social-common.ts
export function commentNetworkOf(c: Change): SocialNetwork | null;   // social_reply / social_moderate rows: their network, else null
export interface CommentResult { replied: { comment_id: string; reply_id: string }[]; moderated: { comment_id: string; action: ModerateAction }[]; deleted_replies: { comment_id: string; reply_id: string }[]; gone: string[]; kept: string[] }
export function emptyCommentResult(): CommentResult;
export function commentResultIn(results: readonly (Record<string, unknown> | null | undefined)[]): CommentResult; // merged, unique per comment_id
export function hasCommentResult(r: CommentResult): boolean;
// src/destinations/comment-push.ts
export function pushCommentChanges(ctx: PushContext, network: SocialNetwork, client: GraphClient, acc: CommentResult, save: () => Promise<void>): Promise<void>; // mutates acc; throws MetaApiError on a failure that must stop
// src/social/comments-status.ts
export function afterSocialPush(store: Pick<Store, "findComment" | "updateComment">, sync: Pick<DestinationSync, "venue_id">, result: Record<string, unknown> | null, nowIso: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test** `test/comments-adapters.test.ts`:

```ts
// test/comments-adapters.test.ts — ✅ on a comment set posts the reply / hides the comment through the Facebook and Instagram
// adapters, idempotently; undo deletes the reply / un-hides; a gone comment is not retried; the comment rows follow the result.
import { describe, expect, it } from "vitest";
import { facebookAdapter } from "@/src/destinations/facebook";
import { instagramAdapter } from "@/src/destinations/instagram";
import { commentNetworkOf, commentResultIn } from "@/src/destinations/social-common";
import { runPendingSyncs, syncLines } from "@/src/destinations/sync";
import { invertChanges } from "@/src/domain/changes";
import { renderPreview } from "@/src/domain/preview";
import type { Change } from "@/src/domain/types";
import { commentChanges, type CommentSetItem } from "@/src/social/comments-propose";
import type { SocialComment } from "@/src/store/types";
import { at, connectedVenue, MIN, T0 } from "./comments-helpers";

async function withComments() {
  const v = await connectedVenue();
  const { fbPostId, igMediaId } = await v.publishPost(["facebook_post", "instagram_post"]);
  const fb = v.meta.addFacebookComment(fbPostId!, { message: "Great place!", from_id: "77", from_name: "Ivan Petrov", created: at(-10 * MIN) });
  const ig = v.meta.addInstagramComment(igMediaId!, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-5 * MIN) });
  const ig2 = v.meta.addInstagramComment(igMediaId!, { text: "Кога отваряте?", from_id: "1785", username: "pesho", created: at(-4 * MIN) });
  const rows = await v.store.upsertComments(v.venue.id, [
    { network: "facebook", post_ref: fbPostId!, comment_id: fb.id, parent_id: null, author_id: "77", author_name: "Ivan Petrov", text: "Great place!", created_at: at(-10 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: ig.id, parent_id: null, author_id: "1784", author_name: "maria.k", text: "Имате ли безглутенови?", created_at: at(-5 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: ig2.id, parent_id: null, author_id: "1785", author_name: "pesho", text: "Кога отваряте?", created_at: at(-4 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
  ]);
  const byId = Object.fromEntries(rows.map((r) => [r.comment_id, r])) as Record<string, SocialComment>;
  /** A proposed comment set with the given rows (as createCommentSet would store it), comments marked proposed. */
  const set = async (items: CommentSetItem[], extra: { undoes_id?: string; source?: "comment" | "undo"; changes?: Change[] } = {}) => {
    const changes = extra.changes ?? commentChanges(items);
    const site = await v.store.getSite(v.venue.id);
    const cs = await v.store.createChangeSet({ venue_id: v.venue.id, chat_ref: "tg:1001", summary_bg: "Отговор", summary_en: "Reply", preview_bg: renderPreview(site, changes, "bg", v.venue.tz), preview_en: renderPreview(site, changes, "en", v.venue.tz), source: extra.source ?? "comment", status: "proposed", changes, undoes_id: extra.undoes_id ?? null });
    for (const it of items) await v.store.updateComment(it.comment.id, { status: "proposed", change_set_id: cs.id, draft_text: it.reply_text });
    return cs;
  };
  const reply = (c: SocialComment, text: string): CommentSetItem => ({ comment: c, reply_text: text, moderate: null });
  const moderate = (c: SocialComment, action: "hide" | "delete"): CommentSetItem => ({ comment: c, reply_text: null, moderate: action });
  const apply = (id: string, now = T0) => v.store.applyChangeSet(id, now.toISOString());
  const comment = (c: SocialComment) => v.store.getComment(c.id);
  const replies = (parentId: string) => [...v.meta.comments.values()].filter((c) => c.parent_id === parentId && !c.deleted);
  // fbRow/igRow/igRow2 are the stored comments; t.page and t.igRow stay the fake Page and Instagram user.
  return { ...v, fbRow: byId[fb.id], igRow: byId[ig.id], igRow2: byId[ig2.id], set, reply, moderate, apply, comment, replies };
}

describe("relevant()", () => {
  it("keeps social_reply and social_moderate rows of its own network, next to social_post rows", async () => {
    const t = await withComments();
    const changes = commentChanges([t.reply(t.fbRow, "Thanks!"), t.reply(t.igRow, "Да!"), t.moderate(t.igRow2, "hide")]);
    expect(facebookAdapter.relevant(changes).map((c) => c.entity_id)).toEqual([t.fbRow.comment_id]);
    expect(instagramAdapter.relevant(changes).map((c) => c.entity_id)).toEqual([t.igRow.comment_id, t.igRow2.comment_id]);
    const [undo] = invertChanges([changes[1]]);
    expect(instagramAdapter.relevant([undo])).toHaveLength(1);
    expect(facebookAdapter.relevant([undo])).toEqual([]);
    expect(commentNetworkOf(changes[0])).toBe("facebook");
    expect(commentNetworkOf({ position: 0, op: "social_post", entity: "social_post", entity_id: "m", before: null, after: { targets: ["facebook_post"] } })).toBeNull();
  });
});

describe("✅ on a comment set", () => {
  it("posts the replies on both networks, stores reply ids, marks the comments replied and says so in both languages", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.fbRow, "Thank you, Ivan!"), t.reply(t.igRow, "Да, всеки ден!")]);
    expect(await t.apply(cs.id)).toBe("applied");
    expect(t.replies(t.fbRow.comment_id).map((r) => [r.text, r.from_id])).toEqual([["Thank you, Ivan!", t.page.id]]);
    expect(t.replies(t.igRow.comment_id).map((r) => [r.text, r.from_id])).toEqual([["Да, всеки ден!", t.ig.user_id]]);
    const rows = await t.store.listSyncs({ changeSetId: cs.id });
    expect(rows.map((r) => [r.payload.kind, r.status])).toEqual([["facebook", "done"], ["instagram", "done"]]);
    const fbResult = commentResultIn([rows[0].result]);
    expect(fbResult.replied).toEqual([{ comment_id: t.fbRow.comment_id, reply_id: t.replies(t.fbRow.comment_id)[0].id }]);
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "replied", reply_id: t.replies(t.fbRow.comment_id)[0].id, replied_at: T0.toISOString() });
    expect(await t.comment(t.igRow)).toMatchObject({ status: "replied", reply_id: t.replies(t.igRow.comment_id)[0].id });
    expect(await syncLines(t.store, cs.id, "bg")).toEqual(["Facebook: отговорът е публикуван ✅", "Instagram: отговорът е публикуван ✅"]);
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Facebook: reply published ✅", "Instagram: reply published ✅"]);
  });

  it("a retry after a transient failure in a batch sends only the rows that did not go out", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!"), t.reply(t.igRow2, "В 8:00.")]);
    t.meta.failOn = (c) => (c.path === `/${t.igRow2.comment_id}/replies` ? { status: 500, code: 2, message: "temporarily unavailable", transient: true } : null);
    await t.apply(cs.id);
    const [row] = await t.store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(commentResultIn([row.result]).replied).toEqual([{ comment_id: t.igRow.comment_id, reply_id: expect.any(String) }]);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "replied" });
    expect(await t.comment(t.igRow2)).toMatchObject({ status: "proposed" });
    expect((await syncLines(t.store, cs.id, "bg"))[0]).toBe("Instagram: не успях да публикувам, ще опитам пак");
    t.meta.failOn = null;
    await runPendingSyncs(t.d, { venueId: t.venue.id, now: at(2 * MIN) });
    expect((await t.store.getSync(row.id)).status).toBe("done");
    expect(t.replies(t.igRow.comment_id)).toHaveLength(1); // not posted twice
    expect(t.replies(t.igRow2.comment_id)).toHaveLength(1);
    expect(await t.comment(t.igRow2)).toMatchObject({ status: "replied", replied_at: at(2 * MIN).toISOString() });
    expect(await syncLines(t.store, cs.id, "bg")).toEqual(["Instagram: 2 отговора са публикувани ✅"]);
  });

  it("a reply to a comment that no longer exists is not retried, marks the comment expired and says so", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!"), t.reply(t.igRow2, "В 8:00.")]);
    t.meta.comments.get(t.igRow.comment_id)!.deleted = true;
    await t.apply(cs.id);
    const [row] = await t.store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "done", attempts: 1 });
    expect(commentResultIn([row.result])).toMatchObject({ gone: [t.igRow.comment_id], replied: [{ comment_id: t.igRow2.comment_id }] });
    expect(await t.comment(t.igRow)).toMatchObject({ status: "expired", reply_id: null });
    expect(await t.comment(t.igRow2)).toMatchObject({ status: "replied" });
    expect(await syncLines(t.store, cs.id, "bg")).toEqual(["Instagram: отговорът е публикуван ✅; коментарът вече не съществува"]);
    expect(await syncLines(t.store, cs.id, "en")).toEqual(["Instagram: reply published ✅; the comment no longer exists"]);
    const only = await t.set([t.reply(t.fbRow, "Thanks!")]);
    t.meta.comments.get(t.fbRow.comment_id)!.deleted = true;
    await t.apply(only.id);
    expect(await syncLines(t.store, only.id, "bg")).toEqual(["Facebook: коментарът вече не съществува"]);
    expect(t.meta.calls.filter((c) => c.path === `/${t.fbRow.comment_id}/comments` && c.method === "POST")).toHaveLength(1);
  });

  it("a revoked Instagram token fails the reply without retry, marks the destination and leaves the comment proposed", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!")]);
    t.meta.revoke(t.ig.token);
    await t.apply(cs.id);
    const [row] = await t.store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/^sm_meta_token/) });
    expect((await t.store.getDestination(t.venue.id, "instagram"))?.status).toBe("error");
    expect(await t.comment(t.igRow)).toMatchObject({ status: "proposed", reply_id: null });
    expect(t.replies(t.igRow.comment_id)).toHaveLength(0);
    expect((await syncLines(t.store, cs.id, "bg"))[0]).toBe("Instagram: грешка: връзката вече не е валидна; свържете отново от таблото");
    expect(t.logs.join("\n")).not.toContain("Да!");
  });
});

describe("moderation and undo", () => {
  it("hides, then undo un-hides (comment back to ignored); delete is final and its undo only says so", async () => {
    const t = await withComments();
    const hide = await t.set([t.moderate(t.fbRow, "hide")]);
    await t.apply(hide.id);
    expect(t.meta.comments.get(t.fbRow.comment_id)?.hidden).toBe(true);
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "hidden", replied_at: T0.toISOString() });
    expect(await syncLines(t.store, hide.id, "bg")).toEqual(["Facebook: коментарът е скрит ✅"]);
    const undoHide = await t.set([], { source: "undo", undoes_id: hide.id, changes: invertChanges(hide.changes) });
    await t.apply(undoHide.id, at(MIN));
    expect(t.meta.comments.get(t.fbRow.comment_id)?.hidden).toBe(false);
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "ignored" });
    expect(await syncLines(t.store, undoHide.id, "bg")).toEqual(["Facebook: коментарът е показан отново ✅"]);
    expect(await syncLines(t.store, undoHide.id, "en")).toEqual(["Facebook: comment shown again ✅"]);
    const del = await t.set([t.moderate(t.igRow, "delete")]);
    await t.apply(del.id, at(2 * MIN));
    expect(t.meta.comments.get(t.igRow.comment_id)?.deleted).toBe(true);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "deleted" });
    expect(await syncLines(t.store, del.id, "bg")).toEqual(["Instagram: коментарът е изтрит ✅"]);
    const undoDel = await t.set([], { source: "undo", undoes_id: del.id, changes: invertChanges(del.changes) });
    const callsBefore = t.meta.calls.length;
    await t.apply(undoDel.id, at(3 * MIN));
    expect(t.meta.calls.length).toBe(callsBefore); // nothing to call
    expect(await syncLines(t.store, undoDel.id, "bg")).toEqual(["Instagram: изтритият коментар не може да бъде върнат"]);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "deleted" });
  });

  it("undo of a reply deletes our reply on Meta and puts the comment back to ignored", async () => {
    const t = await withComments();
    const cs = await t.set([t.reply(t.igRow, "Да!"), t.reply(t.fbRow, "Thanks!")]);
    await t.apply(cs.id);
    const igReplyId = t.replies(t.igRow.comment_id)[0].id;
    const undo = await t.set([], { source: "undo", undoes_id: cs.id, changes: invertChanges(cs.changes) });
    await t.apply(undo.id, at(MIN));
    expect(t.meta.comments.get(igReplyId)?.deleted).toBe(true);
    expect(t.replies(t.fbRow.comment_id)).toHaveLength(0);
    expect(await t.comment(t.igRow)).toMatchObject({ status: "ignored", reply_id: null });
    expect(await t.comment(t.fbRow)).toMatchObject({ status: "ignored", reply_id: null });
    expect(await syncLines(t.store, undo.id, "bg")).toEqual(["Facebook: отговорът е изтрит ✅", "Instagram: отговорът е изтрит ✅"]);
    const rows = await t.store.listSyncs({ changeSetId: undo.id });
    expect(commentResultIn([rows[1].result]).deleted_replies).toEqual([{ comment_id: t.igRow.comment_id, reply_id: igReplyId }]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```
npx vitest run test/comments-adapters.test.ts
```

Expected: `commentNetworkOf` / `commentResultIn` are not exported; `relevant()` returns `[]` for comment rows.

- [ ] **Step 3: `social-common.ts` additions.** Change `relevantFor` and append:

```ts
/** The network of a social_reply / social_moderate row (from `after`, or `before` for an undo row); null for every other row. */
export function commentNetworkOf(c: Change): SocialNetwork | null {
  if (c.entity !== "social_reply" && c.entity !== "social_moderate") return null;
  const n = (c.after ?? c.before ?? {}).network;
  return n === "facebook" || n === "instagram" ? n : null;
}

/** social_post rows with at least one target on `network`, and comment rows of `network`, in position order. */
export function relevantFor(network: SocialNetwork) {
  return (changes: Change[]) => changes.filter((c) => networkTargets(c, network).length > 0 || commentNetworkOf(c) === network).sort((a, b) => a.position - b.position);
}

// --- Comment replies (2026-10-15): what a push stores for social_reply / social_moderate rows ---
export interface CommentResult {
  replied: { comment_id: string; reply_id: string }[];
  moderated: { comment_id: string; action: ModerateAction }[];
  /** Undo of a reply: our reply deleted (reply_id "" when the original result had none). */
  deleted_replies: { comment_id: string; reply_id: string }[];
  /** Comments Meta no longer has: nothing was posted, never retried. */
  gone: string[];
  /** Undo of a delete: nothing can be done. */
  kept: string[];
}
export function emptyCommentResult(): CommentResult {
  return { replied: [], moderated: [], deleted_replies: [], gone: [], kept: [] };
}
export function hasCommentResult(r: CommentResult): boolean {
  return r.replied.length + r.moderated.length + r.deleted_replies.length + r.gone.length + r.kept.length > 0;
}
const ACTIONS = new Set(["hide", "unhide", "delete"]);
/** Merges the comment parts of the given sync results (oldest first), one entry per comment id and list. */
export function commentResultIn(results: readonly (Record<string, unknown> | null | undefined)[]): CommentResult {
  const out = emptyCommentResult();
  const seen = { replied: new Set<string>(), moderated: new Set<string>(), deleted_replies: new Set<string>(), gone: new Set<string>(), kept: new Set<string>() };
  for (const r of results) {
    for (const x of Array.isArray(r?.replied) ? r.replied : []) {
      const o = x as { comment_id?: unknown; reply_id?: unknown };
      if (typeof o.comment_id === "string" && typeof o.reply_id === "string" && !seen.replied.has(o.comment_id)) { seen.replied.add(o.comment_id); out.replied.push({ comment_id: o.comment_id, reply_id: o.reply_id }); }
    }
    for (const x of Array.isArray(r?.moderated) ? r.moderated : []) {
      const o = x as { comment_id?: unknown; action?: unknown };
      if (typeof o.comment_id === "string" && typeof o.action === "string" && ACTIONS.has(o.action) && !seen.moderated.has(o.comment_id)) { seen.moderated.add(o.comment_id); out.moderated.push({ comment_id: o.comment_id, action: o.action as ModerateAction }); }
    }
    for (const x of Array.isArray(r?.deleted_replies) ? r.deleted_replies : []) {
      const o = x as { comment_id?: unknown; reply_id?: unknown };
      if (typeof o.comment_id === "string" && !seen.deleted_replies.has(o.comment_id)) { seen.deleted_replies.add(o.comment_id); out.deleted_replies.push({ comment_id: o.comment_id, reply_id: typeof o.reply_id === "string" ? o.reply_id : "" }); }
    }
    for (const id of Array.isArray(r?.gone) ? r.gone : []) if (typeof id === "string" && !seen.gone.has(id)) { seen.gone.add(id); out.gone.push(id); }
    for (const id of Array.isArray(r?.kept) ? r.kept : []) if (typeof id === "string" && !seen.kept.has(id)) { seen.kept.add(id); out.kept.push(id); }
  }
  return out;
}
```

(import `ModerateAction` from `../domain/types`.)

- [ ] **Step 4: Create `src/destinations/comment-push.ts`**

```ts
// src/destinations/comment-push.ts
// The reply / moderation / undo loop both social adapters run over their social_reply and social_moderate rows. Idempotent
// through the accumulated result (`acc`, pre-filled from earlier attempts): a comment already replied to, moderated or gone
// is skipped. A comment Meta no longer has is recorded in `gone` and the loop goes on (a batch must not lose its other rows);
// every other error stops the push and is classified by the caller (socialFailure).
import type { ModerateAction } from "../domain/types";
import { deleteReply, moderateFacebook, moderateInstagram, replyFacebook, replyInstagram } from "../social/comments-graph";
import { MetaApiError, type GraphClient } from "./meta-graph";
import { commentNetworkOf, commentResultIn, type CommentResult, type SocialNetwork } from "./social-common";
import type { PushContext } from "./types";

const UNDO_ACTION: Record<ModerateAction, ModerateAction | null> = { hide: "unhide", unhide: "hide", delete: null };

export async function pushCommentChanges(ctx: PushContext, network: SocialNetwork, client: GraphClient, acc: CommentResult, save: () => Promise<void>): Promise<void> {
  const done = {
    replied: new Set(acc.replied.map((x) => x.comment_id)),
    moderated: new Set(acc.moderated.map((x) => x.comment_id)),
    deletedReplies: new Set(acc.deleted_replies.map((x) => x.comment_id)),
    gone: new Set(acc.gone),
    kept: new Set(acc.kept),
  };
  let original: CommentResult | null = null;
  const originalResult = async () => (original ??= ctx.changeSet.undoes_id && ctx.resultsOf ? commentResultIn(await ctx.resultsOf(ctx.changeSet.undoes_id)) : commentResultIn([]));
  for (const c of ctx.changes) {
    if (commentNetworkOf(c) !== network) continue;
    const id = c.entity_id;
    if (done.gone.has(id)) continue;
    if (c.entity === "social_reply") {
      if (c.after) {
        if (done.replied.has(id)) continue;
        try {
          const text = typeof c.after.reply_text === "string" ? c.after.reply_text : "";
          const replyId = network === "instagram" ? await replyInstagram(client, id, text) : await replyFacebook(client, id, text);
          acc.replied.push({ comment_id: id, reply_id: replyId });
          done.replied.add(id);
        } catch (e) {
          if (!(e instanceof MetaApiError && e.notFound)) throw e;
          acc.gone.push(id);
          done.gone.add(id);
        }
        await save();
        continue;
      }
      // Undo of a reply: delete the reply the original push made (none recorded: nothing to delete).
      if (done.deletedReplies.has(id)) continue;
      const replyId = (await originalResult()).replied.find((x) => x.comment_id === id)?.reply_id ?? "";
      if (replyId) await deleteReply(client, replyId);
      acc.deleted_replies.push({ comment_id: id, reply_id: replyId });
      done.deletedReplies.add(id);
      await save();
      continue;
    }
    // social_moderate: the action to perform now (an undo row inverts it; a delete cannot be undone).
    const stored = (c.after ?? c.before ?? {}).action;
    const action: ModerateAction | null = c.after ? (stored as ModerateAction) : UNDO_ACTION[stored as ModerateAction] ?? null;
    if (action === null) {
      if (!done.kept.has(id)) {
        acc.kept.push(id);
        done.kept.add(id);
        await save();
      }
      continue;
    }
    if (done.moderated.has(id)) continue;
    try {
      if (network === "instagram") await moderateInstagram(client, id, action);
      else await moderateFacebook(client, id, action);
      acc.moderated.push({ comment_id: id, action });
      done.moderated.add(id);
    } catch (e) {
      if (!(e instanceof MetaApiError && e.notFound)) throw e;
      if (action === "delete") {
        acc.moderated.push({ comment_id: id, action }); // already gone: deleting it is done
        done.moderated.add(id);
      } else {
        acc.gone.push(id);
        done.gone.add(id);
      }
    }
    await save();
  }
}
```

- [ ] **Step 5: Facebook adapter.** In `src/destinations/facebook.ts` import `pushCommentChanges` from `./comment-push` and `commentNetworkOf, commentResultIn` from `./social-common`. In `push`, after `const fb = new GraphClient(...)`:

```ts
    const posts = ctx.changes.filter((c) => c.entity === "social_post");
    const comments = ctx.changes.filter((c) => commentNetworkOf(c) === "facebook");
    const acc = commentResultIn(ctx.prior ?? []);
```

Change `current` to `const current = () => ({ ...(posts.length ? { published: [...entries.values()] } : {}), ...(comments.length ? acc : {}) });` and `save` stays `ctx.checkpoint?.(current())`. Make the existing `for (const c of ctx.changes)` loop iterate `posts` instead. After that loop (still inside the `try`) add `if (comments.length) await pushCommentChanges(ctx, "facebook", fb, acc, save);`. The success return becomes:

```ts
      const postResult = posts.length ? (undo ? { undo: true, deleted, stories } : { published: [...entries.values()] }) : {};
      return { ok: true, result: { ...postResult, ...(comments.length ? acc : {}) }, line: LINES.ok };
```

and the catch's partial becomes `{ ...(posts.length ? (undo ? { undo: true, deleted, stories } : { published: [...entries.values()] }) : {}), ...(comments.length ? acc : {}) }`.

- [ ] **Step 6: Instagram adapter.** In `src/destinations/instagram.ts` import `pushCommentChanges` and `commentNetworkOf, commentResultIn`. In `push`, after the `igId` check:

```ts
    const posts = ctx.changes.filter((c) => c.entity === "social_post");
    const comments = ctx.changes.filter((c) => commentNetworkOf(c) === "instagram");
    const acc = commentResultIn(ctx.prior ?? []);
```

Change `current` to `() => ({ ...(posts.length ? { published: [...entries.values()] } : {}), ...(comments.length ? acc : {}) })`. Change the manual-delete condition to `if (comments.length === 0 && posts.every((c) => c.after === null))` and its loop to iterate `posts`. Make the publishing loop `for (const c of posts)`. After it add `if (comments.length) await pushCommentChanges(ctx, "instagram", ig, acc, () => ctx.checkpoint?.(current()) ?? Promise.resolve());`. The success return `{ ok: true, result: current(), line: LINES.ok }` and the catch `socialFailure(e, LINES, current())` stay as they are.

- [ ] **Step 7: Lines and error text.** In `src/destinations/social-lines.ts` import `commentResultIn, hasCommentResult` and add, inside `socialSyncLine` right after `if (status !== "done") { … }`:

```ts
  const cr = commentResultIn([r]);
  if (hasCommentResult(cr)) {
    const parts: string[] = [];
    const n = (k: number, one: string, many: string) => (k === 1 ? one : many.replace("{n}", String(k)));
    if (cr.replied.length) parts.push(bg ? n(cr.replied.length, "отговорът е публикуван ✅", "{n} отговора са публикувани ✅") : n(cr.replied.length, "reply published ✅", "{n} replies published ✅"));
    for (const action of ["hide", "unhide", "delete"] as const) {
      const k = cr.moderated.filter((m) => m.action === action).length;
      if (!k) continue;
      if (action === "hide") parts.push(bg ? n(k, "коментарът е скрит ✅", "{n} коментара са скрити ✅") : n(k, "comment hidden ✅", "{n} comments hidden ✅"));
      else if (action === "unhide") parts.push(bg ? n(k, "коментарът е показан отново ✅", "{n} коментара са показани отново ✅") : n(k, "comment shown again ✅", "{n} comments shown again ✅"));
      else parts.push(bg ? n(k, "коментарът е изтрит ✅", "{n} коментара са изтрити ✅") : n(k, "comment deleted ✅", "{n} comments deleted ✅"));
    }
    if (cr.deleted_replies.length) parts.push(bg ? n(cr.deleted_replies.length, "отговорът е изтрит ✅", "{n} отговора са изтрити ✅") : n(cr.deleted_replies.length, "reply deleted ✅", "{n} replies deleted ✅"));
    if (cr.gone.length) parts.push(bg ? n(cr.gone.length, "коментарът вече не съществува", "{n} коментара вече не съществуват") : n(cr.gone.length, "the comment no longer exists", "{n} comments no longer exist"));
    if (cr.kept.length) parts.push(bg ? "изтритият коментар не може да бъде върнат" : "a deleted comment cannot be restored");
    return `${name}: ${parts.join("; ")}`;
  }
```

In `src/destinations/social-errors.ts` add to `KNOWN`: `sm_reply_unknown: { bg: "Meta не потвърди отговора", en: "Meta did not confirm the reply" },`.

- [ ] **Step 8: Status hook.** Create `src/social/comments-status.ts`:

```ts
// src/social/comments-status.ts
// After a social push: the social_comments rows follow what the adapters stored (replied / moderated / deleted_replies / gone).
import { commentResultIn } from "../destinations/social-common";
import type { DestinationSync, SocialCommentPatch, Store } from "../store/types";

export async function afterSocialPush(store: Pick<Store, "findComment" | "updateComment">, sync: Pick<DestinationSync, "venue_id">, result: Record<string, unknown> | null, nowIso: string): Promise<void> {
  const r = commentResultIn([result]);
  const mark = async (commentId: string, patch: SocialCommentPatch, skipIf?: (c: { status: string; reply_id: string | null }) => boolean) => {
    const c = await store.findComment(sync.venue_id, commentId);
    if (!c || skipIf?.(c)) return;
    await store.updateComment(c.id, patch);
  };
  for (const x of r.replied) await mark(x.comment_id, { status: "replied", reply_id: x.reply_id, replied_at: nowIso }, (c) => c.status === "replied" && c.reply_id === x.reply_id);
  for (const x of r.moderated) {
    if (x.action === "hide") await mark(x.comment_id, { status: "hidden", replied_at: nowIso }, (c) => c.status === "hidden");
    else if (x.action === "unhide") await mark(x.comment_id, { status: "ignored" }, (c) => c.status !== "hidden");
    else await mark(x.comment_id, { status: "deleted", replied_at: nowIso }, (c) => c.status === "deleted");
  }
  for (const x of r.deleted_replies) await mark(x.comment_id, { status: "ignored", reply_id: null }, (c) => c.status !== "replied");
  for (const id of r.gone) await mark(id, { status: "expired" }, (c) => c.status === "expired" || c.status === "deleted");
}
```

In `src/destinations/sync.ts` import `afterSocialPush` from `../social/comments-status` and, in `runSync`, define `const social = dest.kind === "facebook" || dest.kind === "instagram";` before `if (result.ok)` (move the existing `const social` line up). In the success branch after `updateSync(... "done" ...)` add:

```ts
    if (social) await afterSocialPush(d.store, sync, result.result, now.toISOString()).catch((e) => log(`[comments] status update after push ${sync.id} failed: ${e instanceof Error ? e.message : String(e)}`));
```

and in the failure branch after `updateSync(... pending/failed ...)`:

```ts
  if (social && result.partial) await afterSocialPush(d.store, sync, result.partial, now.toISOString()).catch((e) => log(`[comments] status update after push ${sync.id} failed: ${e instanceof Error ? e.message : String(e)}`));
```

- [ ] **Step 9: Run the tests, then the suite**

```
npx vitest run test/comments-adapters.test.ts test/destinations-social.test.ts test/destinations-social-retry.test.ts test/agent-social-tool.test.ts test/comments-propose.test.ts
npx vitest run
npm run typecheck
```

Expected: green; the existing social tests keep passing because a set holds either post rows or comment rows and the post paths are unchanged.

- [ ] **Step 10: Commit**

```
git add src/destinations/social-common.ts src/destinations/comment-push.ts src/destinations/facebook.ts src/destinations/instagram.ts src/destinations/social-lines.ts src/destinations/social-errors.ts src/destinations/sync.ts src/social/comments-status.ts test/comments-adapters.test.ts
git commit -m "Comments: adapters post replies and moderate, undo deletes/un-hides, gone comments not retried, status hook and lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: Digest and modes — daily batch at the venue's hour, `set_comment_mode` agent tool

**Files:**
- Create: `src/social/comments-digest.ts`
- Create: `src/agent/comment-tools.ts` (this task: `set_comment_mode` only; Task 9 adds `list_comments` and `reply_to_comments` to the same file)
- Modify: `src/agent/tools.ts` (`makeTools` registers `commentTools(d, kit)` after `socialTools`)
- Modify: `src/tick.ts` (`TickReport.digests`, step 10)
- Test: `test/comments-digest.test.ts`

**Interfaces:**

Consumes: `localDate`, `localTime` from `src/time.ts`; `proposeForComments`, `ProposeDeps` from `src/social/comments-propose.ts`; `COMMENT_POST_WINDOW_MS` from `src/social/comments-poll.ts`; `planChanges`; `proposalText`, `AgentDeps`, `ToolKit` from `src/agent/tools.ts`.

Produces:

```ts
// src/social/comments-digest.ts
export function digestDue(venue: Pick<Venue, "comment_mode" | "comment_digest_hour" | "last_comment_digest_at" | "tz">, now: Date): boolean;
export function runCommentDigests(d: ProposeDeps, o: { venueId?: string; now: Date }): Promise<{ sent: string[]; skipped: string[] }>; // venue ids; never throws
// src/agent/comment-tools.ts
export const SetCommentModeSchema: z.ZodObject<{ mode: z.ZodEnum<...>; digest_hour: z.ZodOptional<z.ZodNumber> }>;
export function commentTools(d: AgentDeps, k: ToolKit): ReturnType<typeof betaZodTool>[]; // [] unless d.social has a connected network
// src/tick.ts: TickReport.digests?: string[]
```

- [ ] **Step 1: Write the failing test** `test/comments-digest.test.ts`:

```ts
// test/comments-digest.test.ts — the daily digest at the venue's local hour (across DST), and the set_comment_mode tool.
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import type { DraftContext, ReplyDraft } from "@/src/social/comments-draft";
import { digestDue, runCommentDigests } from "@/src/social/comments-digest";
import type { ProposeDeps } from "@/src/social/comments-propose";
import { runTick } from "@/src/tick";
import { connectedVenue, HOUR, MIN } from "./comments-helpers";
import { call } from "./tool-call";

const draft = async (ctx: DraftContext): Promise<ReplyDraft> => ({ reply: `Благодарим, ${ctx.comment.author_name}!`, kind: "praise", fallback: false });
const Z = (s: string) => new Date(s);

async function digestVenue() {
  const v = await connectedVenue();
  await v.store.updateVenue(v.venue.id, { comment_mode: "digest", comment_digest_hour: 9 });
  let n = 0;
  const addNew = async (created: Date, text = "Супер!") => (await v.store.upsertComments(v.venue.id, [{ network: "instagram", post_ref: "m", comment_id: `d${++n}`, parent_id: null, author_id: "u", author_name: "Иван", text, created_at: created.toISOString(), seen_at: created.toISOString(), status: "new", post_caption: "Пост" }]))[0];
  const deps = (now: Date): ProposeDeps => ({ store: v.store, messenger: v.messenger, now: () => now, draft, log: (s) => v.logs.push(s) });
  return { ...v, addNew, deps, venue: () => v.store.getVenue(v.venue.id), venueId: v.venue.id };
}

describe("digestDue", () => {
  const base = { comment_mode: "digest" as const, comment_digest_hour: 9, last_comment_digest_at: null, tz: "Europe/Sofia" };
  it("is due from the venue's local hour on, once per local day, only in digest mode", () => {
    expect(digestDue(base, Z("2026-10-15T05:59:00.000Z"))).toBe(false); // 08:59 EEST
    expect(digestDue(base, Z("2026-10-15T06:00:00.000Z"))).toBe(true); // 09:00
    expect(digestDue(base, Z("2026-10-15T20:00:00.000Z"))).toBe(true); // 23:00, still today
    expect(digestDue({ ...base, last_comment_digest_at: "2026-10-15T06:00:00.000Z" }, Z("2026-10-15T20:00:00.000Z"))).toBe(false);
    expect(digestDue({ ...base, last_comment_digest_at: "2026-10-15T06:00:00.000Z" }, Z("2026-10-16T06:00:00.000Z"))).toBe(true);
    expect(digestDue({ ...base, comment_mode: "each" }, Z("2026-10-15T06:00:00.000Z"))).toBe(false);
    expect(digestDue({ ...base, comment_mode: "off" }, Z("2026-10-15T06:00:00.000Z"))).toBe(false);
    expect(digestDue({ ...base, comment_digest_hour: 0 }, Z("2026-10-14T21:00:00.000Z"))).toBe(true); // 00:00 local on the 15th
  });
});

describe("runCommentDigests", () => {
  it("sends the digest once a day at the venue's local hour across the DST change", async () => {
    const v = await digestVenue();
    // 24 Oct 2026: EEST (UTC+3), 09:00 local = 06:00Z. 25 Oct: clocks go back at 04:00 → EET (UTC+2), 09:00 local = 07:00Z.
    await v.addNew(Z("2026-10-24T05:00:00.000Z"));
    expect(await runCommentDigests(v.deps(Z("2026-10-24T05:59:00.000Z")), { now: Z("2026-10-24T05:59:00.000Z") })).toEqual({ sent: [], skipped: [v.venueId] });
    expect(await runCommentDigests(v.deps(Z("2026-10-24T06:00:00.000Z")), { now: Z("2026-10-24T06:00:00.000Z") })).toEqual({ sent: [v.venueId], skipped: [] });
    expect(v.messenger.sent.filter((m) => m.setId)).toHaveLength(1);
    expect(v.messenger.sent[0].text).toMatch(/^💬 1 нов коментар под 1 пост\n/);
    expect((await v.venue()).last_comment_digest_at).toBe("2026-10-24T06:00:00.000Z");
    await v.addNew(Z("2026-10-24T20:00:00.000Z"));
    for (const t of ["2026-10-24T06:05:00.000Z", "2026-10-25T06:00:00.000Z", "2026-10-25T06:59:00.000Z"]) {
      expect((await runCommentDigests(v.deps(Z(t)), { now: Z(t) })).sent).toEqual([]); // same local day / 08:00 and 08:59 EET
    }
    expect((await runCommentDigests(v.deps(Z("2026-10-25T07:00:00.000Z")), { now: Z("2026-10-25T07:00:00.000Z") })).sent).toEqual([v.venueId]);
    expect(v.messenger.sent.filter((m) => m.setId)).toHaveLength(2);
    expect((await runCommentDigests(v.deps(Z("2026-10-25T07:05:00.000Z")), { now: Z("2026-10-25T07:05:00.000Z") })).sent).toEqual([]);
  });
  it("sends nothing on a day without new comments but still marks the day; puts every new comment of the last 14 days in one set", async () => {
    const v = await digestVenue();
    const now = Z("2026-10-15T07:00:00.000Z");
    expect(await runCommentDigests(v.deps(now), { now })).toEqual({ sent: [], skipped: [v.venueId] });
    expect((await v.venue()).last_comment_digest_at).toBe(now.toISOString());
    expect(v.messenger.sent).toHaveLength(0);
    const next = Z("2026-10-16T07:00:00.000Z");
    const a = await v.addNew(Z("2026-10-15T08:00:00.000Z"), "Страхотно");
    const b = await v.addNew(Z("2026-10-16T06:00:00.000Z"), "Кога отваряте?");
    await v.addNew(Z("2026-09-20T06:00:00.000Z"), "too old");
    expect((await runCommentDigests(v.deps(next), { now: next })).sent).toEqual([v.venueId]);
    const set = (await v.store.listChangeSets(v.venueId, { status: ["proposed"] }))[0];
    expect(set.changes.map((c) => c.entity_id).sort()).toEqual([a.comment_id, b.comment_id].sort());
    expect(set.summary_bg).toBe("Отговори на 2 коментара");
  });
  it("leaves the day unmarked when nobody could be reached (the batch waits for the owner's next message)", async () => {
    const v = await digestVenue();
    await v.store.removeMember(v.venueId, "tg:1001");
    await v.store.upsertMember({ venue_id: v.venueId, chat_ref: "fb:900", role: "owner", lang: "bg", last_seen_at: "2026-10-10T00:00:00.000Z" });
    const now = Z("2026-10-15T07:00:00.000Z");
    await v.addNew(Z("2026-10-15T06:00:00.000Z"));
    expect(await runCommentDigests(v.deps(now), { now })).toEqual({ sent: [], skipped: [v.venueId] });
    expect((await v.venue()).last_comment_digest_at).toBeNull();
    await v.store.touchMember("fb:900", now.toISOString());
    const later = Z("2026-10-15T07:10:00.000Z");
    expect((await runCommentDigests(v.deps(later), { venueId: v.venueId, now: later })).sent).toEqual([v.venueId]);
  });
  it("tick step 10 runs the digests when comment deps are wired", async () => {
    const v = await digestVenue();
    await v.addNew(Z("2026-10-15T06:00:00.000Z"));
    const r = await runTick({ store: v.store, messenger: v.messenger, now: Z("2026-10-15T07:00:00.000Z"), sync: v.d, comments: { draft } });
    expect(r.digests).toEqual([v.venueId]);
    expect(r.comments_proposed).toBe(0); // digest mode: step 9 proposes nothing
  });
});

describe("set_comment_mode tool", () => {
  async function agent(v: Awaited<ReturnType<typeof connectedVenue>>, chatRef = "tg:1001", over: Partial<AgentDeps> = {}) {
    const member = (await v.store.findMember(chatRef))!;
    const deps: AgentDeps = { store: v.store, venueId: v.venue.id, chatRef, member, messenger: v.messenger, now: () => Z("2026-10-15T09:00:00.000Z"), baseUrl: "https://site.example", social: { facebook: true, instagram: true }, ...over };
    return { deps, tools: makeTools(deps) };
  }
  it("is registered only with a connected network and proposes a venue change the owner approves", async () => {
    const v = await connectedVenue();
    const none = await agent(v, "tg:1001", { social: { facebook: false, instagram: false } });
    expect(none.tools.map((t) => t.name)).not.toContain("set_comment_mode");
    const { tools } = await agent(v);
    const r = await call(tools, "set_comment_mode", { mode: "digest", digest_hour: 10 });
    expect(r).toMatchObject({ status: "proposed", preview: "• Известия за коментари: при всеки → веднъж дневно в 10:00" });
    const proposal = v.messenger.sent.find((m) => m.setId === r.change_set_id)!;
    expect(proposal.chatRef).toBe("tg:1001");
    expect(proposal.text).toContain("Известия за коментари");
    const cs = await v.store.getChangeSet(String(r.change_set_id));
    expect(cs).toMatchObject({ source: "comment", chat_ref: "tg:1001", proposal_refs: { "tg:1001": proposal.messageRef } });
    await handleDecision({ store: v.store, messenger: v.messenger, now: () => Z("2026-10-15T09:01:00.000Z") }, "tg:1001", "apply", cs.id);
    expect(await v.store.getVenue(v.venue.id)).toMatchObject({ comment_mode: "digest", comment_digest_hour: 10 });
  });
  it("is exempt from the monthly change limit, owner-only, and validates the hour", async () => {
    const v = await connectedVenue();
    await v.store.setChangeLimit(v.venue.id, 0);
    const { tools } = await agent(v);
    const r = await call(tools, "set_comment_mode", { mode: "off" });
    expect(r.status).toBe("proposed");
    await handleDecision({ store: v.store, messenger: v.messenger, now: () => Z("2026-10-15T09:01:00.000Z") }, "tg:1001", "apply", String(r.change_set_id));
    expect((await v.store.getVenue(v.venue.id)).comment_mode).toBe("off");
    expect(await call(tools, "set_comment_mode", { mode: "digest", digest_hour: 24 })).toMatchObject({ error: expect.stringMatching(/digest_hour/) });
    const staff = await agent(v, "tg:1002");
    expect(await call(staff.tools, "set_comment_mode", { mode: "each" })).toMatchObject({ error: expect.stringMatching(/owner/) });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```
npx vitest run test/comments-digest.test.ts
```

Expected: cannot resolve `@/src/social/comments-digest`; `set_comment_mode` is not a tool.

- [ ] **Step 3: Create `src/social/comments-digest.ts`**

```ts
// src/social/comments-digest.ts
// Venues in "digest" mode get one batch proposal a day with every new comment, at comment_digest_hour in the venue's zone.
// "Once a day" is a local date (last_comment_digest_at read in the venue's zone), so the DST change neither doubles nor skips
// a digest. A day without comments is marked too (nothing is sent). When no owner can be reached the day stays unmarked and
// the next tick tries again (the per-venue tick after the owner's next message sends it).
import type { Venue } from "../domain/types";
import { localDate, localTime } from "../time";
import { COMMENT_POST_WINDOW_MS } from "./comments-poll";
import { proposeForComments, type ProposeDeps } from "./comments-propose";

export function digestDue(venue: Pick<Venue, "comment_mode" | "comment_digest_hour" | "last_comment_digest_at" | "tz">, now: Date): boolean {
  if (venue.comment_mode !== "digest") return false;
  const today = localDate(now, venue.tz);
  if (venue.last_comment_digest_at && localDate(new Date(venue.last_comment_digest_at), venue.tz) === today) return false;
  return Number(localTime(now, venue.tz).slice(0, 2)) >= venue.comment_digest_hour;
}

const log = (d: ProposeDeps, s: string) => (d.log ?? ((x: string) => console.log(x)))(s);

export async function runCommentDigests(d: ProposeDeps, o: { venueId?: string; now: Date }): Promise<{ sent: string[]; skipped: string[] }> {
  const out = { sent: [] as string[], skipped: [] as string[] };
  let venues: Venue[];
  try {
    venues = o.venueId ? [await d.store.getVenue(o.venueId)] : await d.store.listVenues({ status: "live" });
  } catch (e) {
    log(d, `[comments] digest venue list failed: ${e instanceof Error ? e.name : "error"}`);
    return out;
  }
  for (const venue of venues) {
    if (!digestDue(venue, o.now)) {
      if (venue.comment_mode === "digest") out.skipped.push(venue.id);
      continue;
    }
    try {
      const fresh = (await d.store.listComments(venue.id, { status: ["new"], since: new Date(o.now.getTime() - COMMENT_POST_WINDOW_MS).toISOString() })).filter((c) => c.parent_id === null);
      if (fresh.length > 0) {
        const r = await proposeForComments(d, venue, fresh, { mode: "batch" });
        if (r.sets.length === 0 && r.deferred > 0) {
          out.skipped.push(venue.id); // nobody reachable: try again next tick
          continue;
        }
        if (r.sets.length > 0) out.sent.push(venue.id);
        else out.skipped.push(venue.id); // the limit line went out instead
      } else out.skipped.push(venue.id);
      await d.store.updateVenue(venue.id, { last_comment_digest_at: o.now.toISOString() });
    } catch (e) {
      log(d, `[comments] digest for venue ${venue.id} failed: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Tick step 10.** In `src/tick.ts` import `runCommentDigests` from `./social/comments-digest`; add to `TickReport`: `/** Venue ids that got their daily comment digest this tick. */ digests?: string[];`; after step 9 (still inside `if (d.sync)`):

```ts
    // 10. Daily comment digests (venues in "digest" mode) at their local hour.
    if (d.comments && d.messenger) {
      try {
        const r = await runCommentDigests({ store: d.store, messenger: d.messenger, now: () => d.now, draft: d.comments.draft, log: d.sync.log }, { venueId: d.venueId, now: d.now });
        report.digests = r.sent;
      } catch (e) {
        console.error("[tick] comment digests failed:", e instanceof Error ? e.message : e);
      }
    }
```

- [ ] **Step 5: Create `src/agent/comment-tools.ts`** (the `set_comment_mode` tool; Task 9 appends two more to the same `commentTools` array):

```ts
// src/agent/comment-tools.ts
// Agent tools for customer comments under the venue's Facebook/Instagram posts: how the owner is notified (set_comment_mode),
// what is waiting (list_comments) and replying (reply_to_comments). Registered only when a network is connected; every write
// is a change set with source "comment" that the owner approves with the buttons. Nothing is posted by the agent itself.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { planChanges } from "../domain/changes";
import { COMMENT_MODES, type CommentMode } from "../domain/types";
import { proposalText, type AgentDeps, type ToolKit } from "./tools";

export const SetCommentModeSchema = z.object({
  mode: z.enum(COMMENT_MODES as [CommentMode, ...CommentMode[]]).describe('"each" = a proposal for every new comment within 15 minutes; "digest" = one batch a day at digest_hour; "off" = comments only on the dashboard, no messages. "спри известията за коментари" → off; "веднъж дневно в 10" → digest with digest_hour 10; "уведомявай ме за всеки коментар" → each.'),
  // Range checked by validateChange (src/domain/changes.ts), so an out-of-range hour comes back as a tool error the model can fix.
  digest_hour: z.number().int().optional().describe("Local hour (0–23, the venue's time zone) for the daily digest; keeps the current hour when omitted. Only meaningful with mode digest."),
});

export function commentTools(d: AgentDeps, k: ToolKit) {
  const social = d.social;
  if (!social || (!social.facebook && !social.instagram)) return [];
  const requireOwner = (what: string) => {
    if (d.member.role !== "owner") throw new Error(`${what} is only the owner's decision; tell the owner to send this.`);
  };

  const setMode = betaZodTool({
    name: "set_comment_mode",
    description: "Change how the owner hears about new customer comments under the venue's Facebook/Instagram posts: each (one proposal per comment), digest (one batch a day at digest_hour, venue time) or off (dashboard only). Proposed with the buttons like any change; never counts toward the monthly change limit.",
    inputSchema: SetCommentModeSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner("set_comment_mode");
        const s = await k.site();
        const changes = planChanges(s, [{ op: "set_comment_mode", mode: input.mode, ...(input.digest_hour !== undefined ? { digest_hour: input.digest_hour } : {}) }], k.ctx());
        const p = k.previews(s, changes);
        const label = { each: { bg: "при всеки коментар", en: "each comment" }, digest: { bg: `веднъж дневно в ${String(input.digest_hour ?? s.venue.comment_digest_hour).padStart(2, "0")}:00`, en: `once a day at ${String(input.digest_hour ?? s.venue.comment_digest_hour).padStart(2, "0")}:00` }, off: { bg: "изключени", en: "off" } }[input.mode];
        // Source "comment": outside the monthly change limit, never blocked by a pending menu proposal (spec: notification modes).
        const cs = await d.store.createChangeSet({ venue_id: d.venueId, chat_ref: d.chatRef, summary_bg: `Известия за коментари: ${label.bg}`, summary_en: `Comment notifications: ${label.en}`, ...p, source: "comment", status: "proposed", changes });
        const messageRef = await d.messenger.sendProposal(d.chatRef, proposalText(k.mine(p), k.lang, null, s.venue.tz), cs.id, k.lang);
        await d.store.updateChangeSet(cs.id, { message_ref: messageRef, proposal_refs: messageRef !== null ? { [d.chatRef]: messageRef } : {} });
        return { change_set_id: cs.id, status: "proposed", preview: k.mine(p), next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
      }),
  });

  return [setMode];
}
```

In `src/agent/tools.ts` add `import { commentTools } from "./comment-tools";` and change the return of `makeTools` to `[..., ...socialTools(d, kit), ...commentTools(d, kit), ...visualTools(d, kit)]`.

- [ ] **Step 6: Run the tests and the suite**

```
npx vitest run test/comments-digest.test.ts test/comments-propose.test.ts test/tick.test.ts test/agent-social-tool.test.ts
npx vitest run
npm run typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```
git add src/social/comments-digest.ts src/agent/comment-tools.ts src/agent/tools.ts src/tick.ts test/comments-digest.test.ts
git commit -m "Comments: daily digest at the venue's local hour (DST-safe), set_comment_mode tool, tick step 10

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: Agent tools — `list_comments`, `reply_to_comments`, prompt rule 14, the ✏️ context

**Files:**
- Modify: `src/agent/comment-tools.ts` (append `ListCommentsSchema`, `ReplyToCommentsSchema`, the two tools)
- Modify: `src/agent/prompt.ts` (rule 14 before the "Replying:" paragraph; `UserMessageContext.correctionComments`; `userMessage`)
- Modify: `src/agent/run.ts` (loads the corrected comment set's rows)
- Test: `test/agent-comment-tools.test.ts`

**Interfaces:**

Consumes: `createCommentSet`, `cancelCommentSet`, `commentsOfSet`, `commentLimitState`, `CommentSetItem` from `src/social/comments-propose.ts`; `copy`; `SocialComment`, `CommentStatus`.

Produces:

```ts
// src/agent/comment-tools.ts
export const ListCommentsSchema: z.ZodObject<{ status: z.ZodOptional<z.ZodEnum<...>>; days: z.ZodDefault<z.ZodNumber> }>;
export const ReplyItemSchema = z.object({ comment_id: z.string(), reply_text: z.string().optional(), action: z.enum(["hide", "delete"]).optional() });
export const ReplyToCommentsSchema = z.object({ summary_bg: z.string().optional(), summary_en: z.string().optional(), replies: z.array(ReplyItemSchema).min(1).max(20) });
// src/agent/prompt.ts
export interface CorrectionComment { id: string; network: string; author: string; text: string; draft: string | null; action: "hide" | "delete" | null }
// UserMessageContext gains correctionComments?: CorrectionComment[]
```

- [ ] **Step 1: Write the failing test** `test/agent-comment-tools.test.ts`:

```ts
// test/agent-comment-tools.test.ts — list_comments, reply_to_comments (single, batch, replacing a pending set, moderation), the prompt rule and the ✏️ context.
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, userMessage } from "@/src/agent/prompt";
import { runTurn } from "@/src/agent/run";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import type Anthropic from "@anthropic-ai/sdk";
import type { DraftContext, ReplyDraft } from "@/src/social/comments-draft";
import { createCommentSet, type ProposeDeps } from "@/src/social/comments-propose";
import type { SocialComment } from "@/src/store/types";
import { at, connectedVenue, MIN, T0 } from "./comments-helpers";
import { call } from "./tool-call";

const draft = async (ctx: DraftContext): Promise<ReplyDraft> => ({ reply: `Благодарим, ${ctx.comment.author_name}!`, kind: "praise", fallback: false });

async function setup() {
  const v = await connectedVenue();
  const { igMediaId, fbPostId } = await v.publishPost(["instagram_post", "facebook_post"]);
  const ig1 = v.meta.addInstagramComment(igMediaId!, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-10 * MIN) });
  const ig2 = v.meta.addInstagramComment(igMediaId!, { text: "Кога отваряте?", from_id: "1785", username: "pesho", created: at(-8 * MIN) });
  const fb1 = v.meta.addFacebookComment(fbPostId!, { message: "Buy followers at spam.example", from_id: "1", from_name: "bot", created: at(-6 * MIN) });
  const rows = await v.store.upsertComments(v.venue.id, [
    { network: "instagram", post_ref: igMediaId!, comment_id: ig1.id, parent_id: null, author_id: "1784", author_name: "maria.k", text: "Имате ли безглутенови?", created_at: at(-10 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: ig2.id, parent_id: null, author_id: "1785", author_name: "pesho", text: "Кога отваряте?", created_at: at(-8 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "facebook", post_ref: fbPostId!, comment_id: fb1.id, parent_id: null, author_id: "1", author_name: "bot", text: "Buy followers at spam.example", created_at: at(-6 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: "own-1", parent_id: null, author_id: v.ig.user_id, author_name: "agala.cafe", text: "Елате!", created_at: at(-5 * MIN).toISOString(), seen_at: T0.toISOString(), status: "own", post_caption: "Днешното предложение" },
  ]);
  const [maria, pesho, spam] = rows;
  await v.store.updateComment(maria.id, { draft_text: "Да, имаме.", draft_kind: "question" });
  await v.store.updateComment(pesho.id, { draft_text: "В 8:00.", draft_kind: "question" });
  await v.store.updateComment(spam.id, { draft_kind: "spam" });
  const member = (await v.store.findMember("tg:1001"))!;
  const deps: AgentDeps = { store: v.store, venueId: v.venue.id, chatRef: "tg:1001", member, messenger: v.messenger, now: () => T0, baseUrl: "https://site.example", social: { facebook: true, instagram: true } };
  const pd: ProposeDeps = { store: v.store, messenger: v.messenger, now: () => T0, draft };
  const replies = (parentId: string) => [...v.meta.comments.values()].filter((c) => c.parent_id === parentId && !c.deleted);
  return { ...v, maria, pesho, spam, deps, pd, replies, tools: makeTools(deps), fresh: (c: SocialComment) => v.store.getComment(c.id) };
}

describe("list_comments", () => {
  it("lists unanswered top-level comments by default with ids, network, author, text, caption, status and kind", async () => {
    const { tools, maria, pesho, spam } = await setup();
    const r = await call(tools, "list_comments", {});
    expect(r.comments).toEqual([
      { id: spam.id, network: "facebook", author: "bot", text: "Buy followers at spam.example", post_caption: "Днешното предложение", created_at: at(-6 * MIN).toISOString(), status: "new", kind: "spam", draft: null },
      { id: pesho.id, network: "instagram", author: "pesho", text: "Кога отваряте?", post_caption: "Днешното предложение", created_at: at(-8 * MIN).toISOString(), status: "new", kind: "question", draft: "В 8:00." },
      { id: maria.id, network: "instagram", author: "maria.k", text: "Имате ли безглутенови?", post_caption: "Днешното предложение", created_at: at(-10 * MIN).toISOString(), status: "new", kind: "question", draft: "Да, имаме." },
    ]);
    expect(r.count).toBe(3);
    expect((await call(tools, "list_comments", { status: "replied" })).comments).toEqual([]);
    expect((await call(tools, "list_comments", { days: 1 })).count).toBe(3);
  });
});

describe("reply_to_comments", () => {
  it("one reply: proposes a comment set with the owner's text, sends the buttons, ✅ posts it", async () => {
    const t = await setup();
    const r = await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "Да, имаме безглутенов хляб от вторник." }] });
    expect(r).toMatchObject({ status: "proposed", rows: 1, preview: "• Отговор на коментар от maria.k (Instagram): „Имате ли безглутенови?“ → „Да, имаме безглутенов хляб от вторник.“" });
    const cs = await t.store.getChangeSet(String(r.change_set_id));
    expect(cs).toMatchObject({ source: "comment", chat_ref: "tg:1001", summary_bg: "Отговор на коментар от maria.k" });
    expect(t.messenger.sent.find((m) => m.setId === cs.id)?.text).toContain("Предложен отговор:\n„Да, имаме безглутенов хляб от вторник.“");
    expect(await t.fresh(t.maria)).toMatchObject({ status: "proposed", change_set_id: cs.id, draft_text: "Да, имаме безглутенов хляб от вторник." });
    await handleDecision({ store: t.store, messenger: t.messenger, now: () => T0 }, "tg:1001", "apply", cs.id);
    expect(t.replies(t.maria.comment_id).map((x) => x.text)).toEqual(["Да, имаме безглутенов хляб от вторник."]);
    expect(await t.fresh(t.maria)).toMatchObject({ status: "replied" });
  });
  it("replaces a pending comment set that covers any of the same comments, concluding its other messages", async () => {
    const t = await setup();
    await t.store.upsertMember({ venue_id: t.venue.id, chat_ref: "fb:900", role: "owner", lang: "en", last_seen_at: T0.toISOString() });
    const pending = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }, { comment: t.pesho, reply_text: "В 8:00.", moderate: null }], { batch: true });
    const r = await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "Да, от вторник." }, { comment_id: t.pesho.id, reply_text: "В 8:00." }] });
    expect(r.status).toBe("proposed");
    expect((await t.store.getChangeSet(pending.set!.id)).status).toBe("cancelled");
    expect(t.messenger.concluded.map((c) => [c.chatRef, c.short])).toEqual([["fb:900", "✏️ Replaced by a new proposal."]]); // not the asking chat
    expect(await t.fresh(t.maria)).toMatchObject({ status: "proposed", change_set_id: r.change_set_id });
    expect(await t.fresh(t.pesho)).toMatchObject({ status: "proposed", change_set_id: r.change_set_id });
    expect((await t.store.getChangeSet(String(r.change_set_id))).proposal_refs).toEqual(expect.objectContaining({ "tg:1001": expect.any(String), "fb:900": expect.any(String) }));
  });
  it("moderation: hide or delete through action; a reply and an action together are refused", async () => {
    const t = await setup();
    const r = await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.spam.id, action: "delete" }] });
    expect(r).toMatchObject({ status: "proposed", preview: expect.stringContaining("• Изтрива коментар от bot (Facebook)") });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.spam.id, action: "hide", reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/either reply_text or action/) });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.spam.id }] })).toMatchObject({ error: expect.stringMatching(/either reply_text or action/) });
  });
  it("refuses unknown, own, already answered comments, staff, and the comment limit", async () => {
    const t = await setup();
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: "nope", reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/not found/) });
    const own = (await t.store.listComments(t.venue.id, { status: ["own"] }))[0];
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: own.id, reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/venue's own/) });
    await t.store.updateComment(t.pesho.id, { status: "replied", reply_id: "r", replied_at: T0.toISOString() });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.pesho.id, reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/already answered/) });
    const staff = makeTools({ ...t.deps, chatRef: "tg:1002", member: (await t.store.findMember("tg:1002"))! });
    expect(await call(staff, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "x" }] })).toMatchObject({ error: expect.stringMatching(/owner/) });
    await t.store.updateVenue(t.venue.id, { comment_limit: 0 });
    expect(await call(t.tools, "reply_to_comments", { replies: [{ comment_id: t.maria.id, reply_text: "x" }] })).toMatchObject({ error: expect.stringContaining("Лимитът от 0 отговора на коментари") });
  });
});

describe("prompt and ✏️ context", () => {
  it("rule 14 names the tools and the rules", () => {
    for (const s of ["14. Comments", "reply_to_comments", "list_comments", "set_comment_mode", "never post", "спри известията за коментари", "отговори на всички неотговорени коментари", "изтрий го"]) expect(SYSTEM_PROMPT).toContain(s);
  });
  it("userMessage lists the corrected comment set's comments and drafts", () => {
    const text = userMessage({ venueName: "V", slug: "v", nowText: "now", lang: "bg", role: "owner", memory: "", correctionFor: "cs-1", text: "Мария: имаме безглутенови от вторник; останалите са ок", source: "text",
      correctionComments: [{ id: "c-1", network: "instagram", author: "Мария", text: "Имате ли безглутенови?", draft: "Да, имаме.", action: null }, { id: "c-2", network: "facebook", author: "bot", text: "spam", draft: null, action: "hide" }] });
    expect(text).toContain("proposal cs-1");
    expect(text).toContain("- id c-1 (instagram) Мария: „Имате ли безглутенови?“ → draft: „Да, имаме.“");
    expect(text).toContain("- id c-2 (facebook) bot: „spam“ → action: hide");
    expect(text).toContain("reply_to_comments with every comment");
  });
  it("runTurn passes the corrected comment set to the model", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    await handleDecision({ store: t.store, messenger: t.messenger, now: () => T0 }, "tg:1001", "change", set!.id);
    const seen: string[] = [];
    const client = { beta: { messages: { toolRunner: async (p: { messages: { content: { type: string; text?: string }[] }[] }) => { seen.push(p.messages[0].content.find((b) => b.type === "text")?.text ?? ""); return { stop_reason: "end_turn", content: [{ type: "text", text: "Готово." }] }; } } } } as unknown as Anthropic;
    await runTurn(t.deps, { text: "имаме от вторник", source: "text" }, { model: "m", effort: "low" }, client);
    expect(seen[0]).toContain(`- id ${t.maria.id} (instagram) maria.k: „Имате ли безглутенови?“ → draft: „Да, имаме.“`);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```
npx vitest run test/agent-comment-tools.test.ts
```

Expected: `no tool list_comments`.

- [ ] **Step 3: The two tools.** In `src/agent/comment-tools.ts` add imports `copy` from `../bot/copy`, `cancelCommentSet, commentLimitState, commentsOfSet, createCommentSet, type CommentSetItem` from `../social/comments-propose`, `tr` from `../domain/format`, `type SocialComment, type CommentStatus` from `../store/types`, and the schemas after `SetCommentModeSchema`:

```ts
const LISTABLE = ["new", "proposed", "replied", "ignored", "expired", "hidden", "deleted"] as const;
export const ListCommentsSchema = z.object({
  status: z.enum(LISTABLE).optional().describe('Default "new": unanswered comments. "proposed": waiting for the owner\'s tap. "replied", "ignored", "hidden", "deleted", "expired": history.'),
  days: z.number().int().min(1).max(30).default(14).describe("How far back, in days (default 14)."),
});
export const ReplyItemSchema = z.object({
  comment_id: z.string().min(1).describe("The id from list_comments"),
  reply_text: z.string().max(500).optional().describe("The reply, exactly as it will be posted (1–2 sentences, the comment's language). Omit when action is set."),
  action: z.enum(["hide", "delete"]).optional().describe('Moderation instead of a reply: "hide" for spam or abuse, "delete" when the owner says "изтрий го" / "delete it" (cannot be undone).'),
});
export const ReplyToCommentsSchema = z.object({
  summary_bg: z.string().min(1).optional().describe("Optional one-line summary in Bulgarian (default: built from the comments)"),
  summary_en: z.string().min(1).optional().describe("The same in English"),
  replies: z.array(ReplyItemSchema).min(1).max(20).describe("One entry per comment, 1–20. For a digest the owner corrected, send every comment again: the unchanged drafts and the changed one."),
});
```

Inside `commentTools` after `setMode`:

```ts
  const list = betaZodTool({
    name: "list_comments",
    description: "Customer comments under the venue's Facebook/Instagram posts: id, network, author, text, the post's caption, status, the detected kind (question, praise, complaint, spam, abuse, other) and the drafted reply. Default: unanswered comments of the last 14 days, newest first. Call it before replying when the owner names a comment by author or content.",
    inputSchema: ListCommentsSchema,
    run: (input) =>
      k.attempt(async () => {
        const since = new Date(d.now().getTime() - input.days * 24 * 3_600_000).toISOString();
        const rows = (await d.store.listComments(d.venueId, { status: [input.status ?? "new"], since, limit: 100 })).filter((c) => c.parent_id === null);
        return {
          count: rows.length,
          comments: rows.map((c) => ({ id: c.id, network: c.network, author: c.author_name, text: c.text, post_caption: c.post_caption, created_at: c.created_at, status: c.status, kind: c.draft_kind, draft: c.draft_text })),
          note: input.status === undefined || input.status === "new" ? "Reply with reply_to_comments (one call for several comments). Nothing is posted before the owner's ✅." : undefined,
        };
      }),
  });

  const ANSWERABLE: readonly CommentStatus[] = ["new", "proposed", "expired", "ignored", "hidden"];
  const reply = betaZodTool({
    name: "reply_to_comments",
    description: "Propose replies to customer comments (or hide/delete spam): one change set with one row per comment, sent to the owner with ✅ Apply / ✏️ Change / ❌ Cancel. Replaces a pending comment proposal that covers any of the same comments. Nothing is posted before ✅.",
    inputSchema: ReplyToCommentsSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner("reply_to_comments");
        const venue = await d.store.getVenue(d.venueId);
        const limit = await commentLimitState(d.store, venue, d.now());
        if (limit.reached) {
          const line = copy(k.lang).commentLimitReached(limit.limit ?? limit.used, limit.used, limit.resets_on);
          throw new Error(`Comment limit reached (${limit.used}/${limit.limit} this month): nothing was proposed. Do not retry; reply to the owner with exactly this line: "${line}"`);
        }
        const items: CommentSetItem[] = [];
        for (const r of input.replies) {
          const text = r.reply_text?.trim() ?? "";
          if ((text === "") === (r.action === undefined)) throw new Error(`Comment ${r.comment_id}: give either reply_text or action, not both and not neither.`);
          const c = await d.store.getComment(r.comment_id);
          if (!c || c.venue_id !== d.venueId) throw new Error(`comment_id "${r.comment_id}" not found; use an id from list_comments.`);
          if (c.status === "own") throw new Error(`Comment ${r.comment_id} is the venue's own comment; it needs no reply.`);
          if (c.status === "nested") throw new Error(`Comment ${r.comment_id} is a reply to a reply; replies to replies are not supported yet.`);
          if (c.status === "replied") throw new Error(`Comment ${r.comment_id} is already answered; undo the reply first if the owner wants a different one.`);
          if (c.status === "deleted") throw new Error(`Comment ${r.comment_id} was deleted.`);
          if (!ANSWERABLE.includes(c.status)) throw new Error(`Comment ${r.comment_id} is "${c.status}".`);
          if (c.status === "hidden" && r.action === "hide") throw new Error(`Comment ${r.comment_id} is already hidden.`);
          items.push({ comment: c, reply_text: r.action ? null : text, moderate: r.action ?? null, kind: (c.draft_kind ?? undefined) as CommentSetItem["kind"] });
        }
        // A pending comment set that holds any of these comments is replaced (the ✏️ path and "answer again").
        const pendingIds = new Set(items.map((it) => it.comment.change_set_id).filter((id): id is string => !!id));
        if (d.correctionFor) pendingIds.add(d.correctionFor);
        for (const id of pendingIds) {
          const cs = await d.store.getChangeSet(id).catch(() => null);
          if (cs && cs.venue_id === d.venueId && cs.source === "comment" && cs.status === "proposed") {
            await cancelCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, cs, { bg: "✏️ Заменено с ново предложение.", en: "✏️ Replaced by a new proposal." }, { except: d.chatRef });
            for (const it of items) if (it.comment.change_set_id === cs.id) it.comment = (await d.store.getComment(it.comment.id)) ?? it.comment;
          }
        }
        const r = await createCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, venue, items, { chatRef: d.chatRef, batch: items.length > 1 });
        if (r.limited) throw new Error("Comment limit reached: nothing was proposed. Do not retry.");
        if (!r.set) throw new Error("No owner could be messaged right now; ask the owner to write again.");
        const summary = { ...(input.summary_bg ? { summary_bg: input.summary_bg } : {}), ...(input.summary_en ? { summary_en: input.summary_en } : {}) };
        if (Object.keys(summary).length) await d.store.updateChangeSet(r.set.id, summary as never);
        return { change_set_id: r.set.id, status: "proposed", rows: items.length, preview: k.lang === "bg" ? r.set.preview_bg : r.set.preview_en, next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
      }),
  });

  return [setMode, list, reply];
```

`ChangeSetPatch` does not carry summaries; add `"summary_bg" | "summary_en"` to its `Pick` in `src/store/types.ts` (both stores write patch keys generically) and drop the `as never`.

- [ ] **Step 4: Prompt rule 14 and the ✏️ context.** In `src/agent/prompt.ts` insert before the line starting `Replying:`:

```
14. Comments on Facebook and Instagram: when list_comments and reply_to_comments exist, customers' comments under the venue's posts are collected. Comments are answered only through reply_to_comments (never with propose_changes, never in your reply text); the owner approves with the buttons and you never post without a proposal. When the owner refers to a comment by author or content ("отговори на коментара на Мария, че имаме безглутенови", "answer Ivan"), call list_comments first and pick it by author name or text. "отговори на всички неотговорени коментари" / "answer the unanswered comments" means every unanswered comment in one reply_to_comments call; "отговори само на въпросите" / "only the questions" keeps the ones whose kind is question. "Колко коментара чакат?" / "how many comments are waiting?" means list_comments and a one-line answer. Write each reply as the venue: in the comment's language, 1–2 sentences, warm, no emojis unless the comment has them, facts and prices only from get_menu and get_site, never invented; a complaint gets an apology and an invitation to write to the venue; never argue; never mention being an assistant. Spam or abuse: propose action "hide"; "изтрий го" / "delete it" means action "delete" (cannot be undone); "отговори му" on a spam proposal means a reply instead. A pending comment proposal never blocks other proposals and is not blocked by them. When the owner tapped ✏️ on a comment proposal, the message lists its comments and drafts: call reply_to_comments with every comment again, keeping the drafts the owner did not mention and changing only what they asked. Notifications: "спри известията за коментари" / "stop comment notifications" → set_comment_mode off; "известия за коментари веднъж дневно в 10" / "once a day at 10" → digest with digest_hour 10; "уведомявай ме за всеки коментар" / "tell me about every comment" → each.
```

Add to the file:

```ts
/** One row of the comment set the owner is correcting with ✏️ (src/agent/run.ts fills it from the set's comments). */
export interface CorrectionComment {
  id: string;
  network: string;
  author: string;
  text: string;
  draft: string | null;
  action: "hide" | "delete" | null;
}
```

add `correctionComments?: CorrectionComment[];` to `UserMessageContext`, and in `userMessage` right after the `correctionFor` line:

```ts
  if (c.correctionFor && c.correctionComments?.length) {
    parts.push(
      "That proposal is a comment reply set. Its comments (use these ids) and the previous drafts:",
      ...c.correctionComments.map((x) => `- id ${x.id} (${x.network}) ${x.author}: „${x.text}“ → ${x.action ? `action: ${x.action}` : `draft: „${x.draft ?? ""}“`}`),
      "Call reply_to_comments with every comment again: keep the drafts the owner does not mention, change only what they ask.",
    );
  }
```

In `src/agent/run.ts` import `commentsOfSet` from `../social/comments-propose` and `type CorrectionComment` from `./prompt`; after `const memory = await loadMemory(...)` add:

```ts
  // ✏️ on a comment set: the model sees the comments and the previous drafts, so the owner can type only what changes.
  let correctionComments: CorrectionComment[] | undefined;
  if (memory.correctionFor) {
    const cs = await deps.store.getChangeSet(memory.correctionFor).catch(() => null);
    if (cs && cs.source === "comment" && cs.venue_id === deps.venueId) {
      const rows = await commentsOfSet(deps.store, cs);
      correctionComments = cs.changes.map((ch) => {
        const row = ch.after ?? {};
        const stored = rows.find((r) => r.comment_id === ch.entity_id);
        return { id: stored?.id ?? ch.entity_id, network: String(row.network ?? ""), author: String(row.author_name ?? ""), text: String(row.comment_text ?? ""), draft: typeof row.reply_text === "string" ? row.reply_text : null, action: row.action === "hide" || row.action === "delete" ? row.action : null };
      });
    }
  }
```

and pass `correctionComments` into `userMessage({...})`.

- [ ] **Step 5: Run the tests and the suite**

```
npx vitest run test/agent-comment-tools.test.ts test/agent-social-tool.test.ts test/run.test.ts test/tools-core.test.ts
npx vitest run
npm run typecheck
```

Expected: green. `test/agent-social-tool.test.ts` has a check that every tool's input schema uses only the allowed keywords (`toolSchemaViolations`); `ListCommentsSchema`'s `.min/.max/.default` compile to `minimum`/`maximum`/`default`, which that check lists as violations only for strict tools; comment tools are not strict (same as `ListSchema`), so no change is needed.

- [ ] **Step 6: Commit**

```
git add src/agent/comment-tools.ts src/agent/prompt.ts src/agent/run.ts src/store/types.ts test/agent-comment-tools.test.ts
git commit -m "Comments: list_comments and reply_to_comments tools, prompt rule 14, ✏️ context with the previous drafts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: Dashboard — "Коментари" card, overview, actions

**Files:**
- Create: `src/server/admin-comments.ts`
- Modify: `src/server/admin.ts` (`AdminOverview.comments`, `adminOverview` fills it)
- Modify: `app/api/admin/[slug]/route.ts` (three new actions)
- Create: `app/admin/[slug]/components/CommentsCard.tsx`
- Modify: `app/admin/[slug]/components/AdminPanel.tsx` (render after `SocialCard`)
- Modify: `src/i18n/dicts.ts` (keys in `en` and `bg`)
- Test: `test/admin-comments.test.tsx`

**Interfaces:**

Consumes: `createCommentSet`, `cancelCommentSet`, `commentLimitState`, `CommentSetItem` from `src/social/comments-propose.ts`; `planChanges`; `renderPreview`; `AdminDeps`; `Post` from `useAdminOverview`.

Produces (in `src/server/admin-comments.ts`):

```ts
export interface CommentView { id: string; network: CommentNetwork; author_name: string; text: string; post_caption: string; post_permalink: string | null; created_at: string; status: CommentStatus; draft_text: string | null; draft_kind: string | null; change_set_id: string | null; reply_text: string | null; replied_at: string | null }
export interface CommentsOverview { mode: CommentMode; digest_hour: number; limit: { used: number; limit: number | null }; needs_reconnect: { facebook: boolean; instagram: boolean }; pending: CommentView[]; answered: CommentView[] }
export function commentsOverview(store: Store, venue: Venue, now: Date): Promise<CommentsOverview>;
export type AdminCommentAction = { action: "reply_comment"; comment_id: string; reply_text: string } | { action: "ignore_comment"; comment_id: string } | { action: "set_comment_mode"; mode: CommentMode; digest_hour?: number };
export function parseAdminCommentAction(body: unknown): AdminCommentAction | null;
export function adminCommentAction(d: AdminDeps, venue: Venue, a: AdminCommentAction): Promise<{ ok: boolean; status?: string; change_set_id?: string; error?: string }>;
// src/server/admin.ts: AdminOverview.comments?: CommentsOverview
```

- [ ] **Step 1: Write the failing test** `test/admin-comments.test.tsx`:

```tsx
// test/admin-comments.test.tsx — the dashboard "Коментари" card: overview, actions (reply / ignore / mode), render in BG and EN.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommentsCard } from "@/app/admin/[slug]/components/CommentsCard";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { adminOverview } from "@/src/server/admin";
import { adminCommentAction, commentsOverview, parseAdminCommentAction, type CommentsOverview } from "@/src/server/admin-comments";
import { createCommentSet, type ProposeDeps } from "@/src/social/comments-propose";
import { at, connectedVenue, MIN, T0 } from "./comments-helpers";

async function setup() {
  const v = await connectedVenue();
  const { igMediaId } = await v.publishPost(["instagram_post"]);
  const ig1 = v.meta.addInstagramComment(igMediaId!, { text: "Имате ли безглутенови?", from_id: "1784", username: "maria.k", created: at(-10 * MIN) });
  const ig2 = v.meta.addInstagramComment(igMediaId!, { text: "Супер!", from_id: "1785", username: "pesho", created: at(-8 * MIN) });
  const rows = await v.store.upsertComments(v.venue.id, [
    { network: "instagram", post_ref: igMediaId!, comment_id: ig1.id, parent_id: null, author_id: "1784", author_name: "maria.k", text: "Имате ли безглутенови?", created_at: at(-10 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение", post_permalink: "https://www.instagram.com/p/C1/" },
    { network: "instagram", post_ref: igMediaId!, comment_id: ig2.id, parent_id: null, author_id: "1785", author_name: "pesho", text: "Супер!", created_at: at(-8 * MIN).toISOString(), seen_at: T0.toISOString(), status: "new", post_caption: "Днешното предложение" },
    { network: "instagram", post_ref: igMediaId!, comment_id: "old-1", parent_id: null, author_id: "1", author_name: "ivan", text: "Отлично", created_at: at(-2 * 24 * 60 * MIN).toISOString(), seen_at: T0.toISOString(), status: "replied", post_caption: "Стар пост" },
  ]);
  await v.store.updateComment(rows[0].id, { draft_text: "Да, имаме.", draft_kind: "question" });
  await v.store.updateComment(rows[2].id, { draft_text: "Благодарим!", reply_id: "r1", replied_at: at(-24 * 60 * MIN).toISOString() });
  const d = { store: v.store, messenger: v.messenger, now: () => T0, baseUrl: "https://site.example" };
  const pd: ProposeDeps = { store: v.store, messenger: v.messenger, now: () => T0, draft: async () => ({ reply: "x", kind: "other", fallback: false }) };
  const replies = (parentId: string) => [...v.meta.comments.values()].filter((c) => c.parent_id === parentId && !c.deleted);
  return { ...v, maria: rows[0], pesho: rows[1], old: rows[2], d, pd, replies };
}

describe("commentsOverview", () => {
  it("shows the mode, the limit, pending (new + proposed) with drafts, the last answered, and which network must reconnect", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.pesho, reply_text: "Благодарим!", moderate: null }]);
    const fb = (await t.store.getDestination(t.venue.id, "facebook"))!;
    await t.store.updateDestination(fb.id, { config: { ...fb.config, comments: false } });
    const o = await commentsOverview(t.store, await t.store.getVenue(t.venue.id), T0);
    expect(o).toMatchObject({ mode: "each", digest_hour: 9, limit: { used: 1, limit: 300 }, needs_reconnect: { facebook: true, instagram: false } });
    expect(o.pending.map((c) => [c.author_name, c.status, c.draft_text, c.change_set_id])).toEqual([["pesho", "proposed", "Благодарим!", set!.id], ["maria.k", "new", "Да, имаме.", null]]);
    expect(o.pending[1].post_permalink).toBe("https://www.instagram.com/p/C1/");
    expect(o.answered.map((c) => [c.author_name, c.status, c.reply_text])).toEqual([["ivan", "replied", "Благодарим!"]]);
    const full = await adminOverview(t.store, await t.store.getVenue(t.venue.id), T0, "https://site.example");
    expect(full.comments?.pending).toHaveLength(2);
    expect(JSON.stringify(full)).not.toContain(t.ig.token);
  });
});

describe("adminCommentAction", () => {
  it("parses the three bodies and rejects the rest", () => {
    expect(parseAdminCommentAction({ action: "reply_comment", comment_id: "c", reply_text: "t" })).toEqual({ action: "reply_comment", comment_id: "c", reply_text: "t" });
    expect(parseAdminCommentAction({ action: "ignore_comment", comment_id: "c" })).toEqual({ action: "ignore_comment", comment_id: "c" });
    expect(parseAdminCommentAction({ action: "set_comment_mode", mode: "digest", digest_hour: 10 })).toEqual({ action: "set_comment_mode", mode: "digest", digest_hour: 10 });
    expect(parseAdminCommentAction({ action: "set_comment_mode", mode: "weekly" })).toBeNull();
    expect(parseAdminCommentAction({ action: "reply_comment", comment_id: "c", reply_text: "" })).toBeNull();
    expect(parseAdminCommentAction({ action: "apply" })).toBeNull();
  });
  it("reply_comment posts the reply at once, replaces a pending proposal and tells the owners", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    const r = await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "Да, от вторник." });
    expect(r).toMatchObject({ ok: true, status: "applied" });
    expect((await t.store.getChangeSet(set!.id)).status).toBe("cancelled");
    expect(t.messenger.concluded.map((c) => c.short)).toEqual(["✅ Отговорено от таблото."]);
    const applied = await t.store.getChangeSet(String(r.change_set_id));
    expect(applied).toMatchObject({ source: "comment", status: "applied", chat_ref: null });
    expect(t.replies(t.maria.comment_id).map((x) => x.text)).toEqual(["Да, от вторник."]);
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "replied", draft_text: "Да, от вторник." });
    expect(t.messenger.sent.at(-1)).toMatchObject({ chatRef: "tg:1001", text: "✅ Отговорено от таблото на maria.k: „Да, от вторник.“\nInstagram: отговорът е публикуван ✅", proactive: true });
    expect(await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "again" })).toMatchObject({ ok: false, error: expect.stringMatching(/already answered/) });
    expect(await adminCommentAction(t.d, t.venue, { action: "reply_comment", comment_id: "nope", reply_text: "x" })).toMatchObject({ ok: false, error: "Comment not found." });
  });
  it("refuses past the comment limit", async () => {
    const t = await setup();
    await t.store.updateVenue(t.venue.id, { comment_limit: 1 });
    const venue = await t.store.getVenue(t.venue.id);
    expect(await adminCommentAction(t.d, venue, { action: "reply_comment", comment_id: t.maria.id, reply_text: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/limit/i) });
    expect(t.replies(t.maria.comment_id)).toHaveLength(0);
  });
  it("ignore_comment cancels a pending proposal (concluding the chat) or just marks the comment", async () => {
    const t = await setup();
    const { set } = await createCommentSet(t.pd, t.venue, [{ comment: t.maria, reply_text: "Да, имаме.", moderate: null }]);
    expect(await adminCommentAction(t.d, t.venue, { action: "ignore_comment", comment_id: t.maria.id })).toMatchObject({ ok: true, status: "ignored" });
    expect((await t.store.getChangeSet(set!.id)).status).toBe("cancelled");
    expect(t.messenger.concluded.at(-1)?.short).toBe("❌ Отказано от таблото.");
    expect(await t.store.getComment(t.maria.id)).toMatchObject({ status: "ignored" });
    expect(await adminCommentAction(t.d, t.venue, { action: "ignore_comment", comment_id: t.pesho.id })).toMatchObject({ ok: true, status: "ignored" });
    expect(await t.store.getComment(t.pesho.id)).toMatchObject({ status: "ignored" });
  });
  it("set_comment_mode applies at once through a comment set (outside the change limit) and is logged", async () => {
    const t = await setup();
    await t.store.setChangeLimit(t.venue.id, 0);
    const r = await adminCommentAction(t.d, await t.store.getVenue(t.venue.id), { action: "set_comment_mode", mode: "digest", digest_hour: 11 });
    expect(r).toMatchObject({ ok: true, status: "applied" });
    expect(await t.store.getVenue(t.venue.id)).toMatchObject({ comment_mode: "digest", comment_digest_hour: 11 });
    expect(await t.store.getChangeSet(String(r.change_set_id))).toMatchObject({ source: "comment", status: "applied", summary_bg: "Известия за коментари: веднъж дневно в 11:00" });
  });
});

describe("CommentsCard", () => {
  const overview: CommentsOverview = {
    mode: "each", digest_hour: 9, limit: { used: 12, limit: 300 }, needs_reconnect: { facebook: true, instagram: false },
    pending: [{ id: "c1", network: "instagram", author_name: "maria.k", text: "Имате ли безглутенови?", post_caption: "Днешното предложение", post_permalink: "https://www.instagram.com/p/C1/", created_at: T0.toISOString(), status: "new", draft_text: "Да, имаме.", draft_kind: "question", change_set_id: null, reply_text: null, replied_at: null },
      { id: "c2", network: "facebook", author_name: "bot", text: "Buy followers", post_caption: "", post_permalink: null, created_at: T0.toISOString(), status: "proposed", draft_text: null, draft_kind: "spam", change_set_id: "cs-1", reply_text: null, replied_at: null }],
    answered: [{ id: "c3", network: "instagram", author_name: "ivan", text: "Отлично", post_caption: "Стар пост", post_permalink: null, created_at: T0.toISOString(), status: "replied", draft_text: "Благодарим!", draft_kind: "praise", change_set_id: "cs-0", reply_text: "Благодарим!", replied_at: T0.toISOString() }],
  };
  const post = async () => ({ ok: true, data: null });
  const render = (lang: "bg" | "en", o: CommentsOverview | null) => renderToStaticMarkup(<LangProvider defaultLang={lang}><CommentsCard overview={o} post={post} tz="Europe/Sofia" /></LangProvider>);
  it("renders pending comments with an editable draft, Reply and Ignore, the mode toggle, the reconnect line and the limit, in Bulgarian first", () => {
    const html = render("bg", overview);
    expect(html).toContain('id="comments"');
    expect(html).toContain(DICTS.bg["admin.comments.title"]);
    expect(html).toContain("maria.k");
    expect(html).toContain("Имате ли безглутенови?");
    expect(html).toContain("Да, имаме.");
    expect(html).toContain(DICTS.bg["admin.comments.reply"]);
    expect(html).toContain(DICTS.bg["admin.comments.ignore"]);
    expect(html).toContain(DICTS.bg["admin.comments.spam"]);
    expect(html).toContain(DICTS.bg["admin.comments.mode.each"]);
    expect(html).toContain(DICTS.bg["admin.comments.mode.digest"]);
    expect(html).toContain(DICTS.bg["admin.comments.mode.off"]);
    expect(html).toContain(DICTS.bg["admin.comments.reconnect"].replace("{network}", "Facebook"));
    expect(html).not.toContain(DICTS.bg["admin.comments.reconnect"].replace("{network}", "Instagram"));
    expect(html).toContain("12/300");
    expect(html).toContain("Благодарим!");
    expect(html).toContain(DICTS.bg["admin.comments.status.replied"]);
    expect(html).toContain('href="https://www.instagram.com/p/C1/"');
  });
  it("renders in English and shows the empty state without a connected network", () => {
    const en = render("en", overview);
    expect(en).toContain(DICTS.en["admin.comments.title"]);
    expect(en).toContain(DICTS.en["admin.comments.reply"]);
    expect(en).toContain(DICTS.en["admin.comments.reconnect"].replace("{network}", "Facebook"));
    const empty = render("bg", { ...overview, pending: [], answered: [], needs_reconnect: { facebook: false, instagram: false } });
    expect(empty).toContain(DICTS.bg["admin.comments.nonePending"]);
    expect(empty).toContain(DICTS.bg["admin.comments.noneAnswered"]);
    expect(render("bg", null)).not.toContain('id="comments"');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```
npx vitest run test/admin-comments.test.tsx
```

Expected: cannot resolve `@/src/server/admin-comments` and the card.

- [ ] **Step 3: Create `src/server/admin-comments.ts`**

```ts
// src/server/admin-comments.ts
// The dashboard's "Comments" card: what is waiting and what was answered, and the owner's actions. The owner's key is the
// authority, so "reply" posts at once (a comment set applied immediately, pushed through the store hook) and the chats are told.
import { copy } from "../bot/copy";
import { syncLines } from "../destinations/sync";
import { planChanges } from "../domain/changes";
import { renderPreview } from "../domain/preview";
import { COMMENT_MODES, type CommentMode, type CommentNetwork, type Venue } from "../domain/types";
import { cancelCommentSet, commentLimitState, createCommentSet, reachableOwners, type CommentSetItem } from "../social/comments-propose";
import type { CommentStatus, SocialComment, Store } from "../store/types";
import type { AdminDeps } from "./admin";

export interface CommentView {
  id: string;
  network: CommentNetwork;
  author_name: string;
  text: string;
  post_caption: string;
  post_permalink: string | null;
  created_at: string;
  status: CommentStatus;
  draft_text: string | null;
  draft_kind: string | null;
  change_set_id: string | null;
  /** The reply as posted (replied rows only). */
  reply_text: string | null;
  replied_at: string | null;
}
export interface CommentsOverview {
  mode: CommentMode;
  digest_hour: number;
  limit: { used: number; limit: number | null };
  /** A connected network whose token predates the comment scopes: the card asks to connect again. */
  needs_reconnect: { facebook: boolean; instagram: boolean };
  pending: CommentView[];
  answered: CommentView[];
}
const PENDING: CommentStatus[] = ["new", "proposed"];
const ANSWERED: CommentStatus[] = ["replied", "ignored", "expired", "hidden", "deleted"];
const ANSWERED_MAX = 20;

function view(c: SocialComment): CommentView {
  return { id: c.id, network: c.network, author_name: c.author_name, text: c.text, post_caption: c.post_caption, post_permalink: c.post_permalink, created_at: c.created_at, status: c.status, draft_text: c.draft_text, draft_kind: c.draft_kind, change_set_id: c.change_set_id, reply_text: c.status === "replied" ? c.draft_text : null, replied_at: c.replied_at };
}

/** Never includes secrets: comment rows and destination display fields only. */
export async function commentsOverview(store: Store, venue: Venue, now: Date): Promise<CommentsOverview> {
  const [pending, answered, limit, fb, ig] = await Promise.all([
    store.listComments(venue.id, { status: PENDING, limit: 100 }),
    store.listComments(venue.id, { status: ANSWERED, limit: ANSWERED_MAX }),
    commentLimitState(store, venue, now),
    store.getDestination(venue.id, "facebook"),
    store.getDestination(venue.id, "instagram"),
  ]);
  const stale = (d: typeof fb) => !!d && d.status !== "disconnected" && d.config.comments !== true;
  return {
    mode: venue.comment_mode,
    digest_hour: venue.comment_digest_hour,
    limit: { used: limit.used, limit: limit.limit },
    needs_reconnect: { facebook: stale(fb), instagram: stale(ig) },
    pending: pending.filter((c) => c.parent_id === null).map(view),
    answered: answered.map(view),
  };
}

export type AdminCommentAction =
  | { action: "reply_comment"; comment_id: string; reply_text: string }
  | { action: "ignore_comment"; comment_id: string }
  | { action: "set_comment_mode"; mode: CommentMode; digest_hour?: number };

export function parseAdminCommentAction(body: unknown): AdminCommentAction | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.action === "reply_comment" && typeof b.comment_id === "string" && typeof b.reply_text === "string" && b.reply_text.trim() !== "" && Array.from(b.reply_text).length <= 500) return { action: "reply_comment", comment_id: b.comment_id, reply_text: b.reply_text.trim() };
  if (b.action === "ignore_comment" && typeof b.comment_id === "string") return { action: "ignore_comment", comment_id: b.comment_id };
  if (b.action === "set_comment_mode" && typeof b.mode === "string" && (COMMENT_MODES as readonly string[]).includes(b.mode)) {
    const h = b.digest_hour;
    if (h !== undefined && !(typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23)) return null;
    return { action: "set_comment_mode", mode: b.mode as CommentMode, ...(typeof h === "number" ? { digest_hour: h } : {}) };
  }
  return null;
}

async function pendingSetOf(store: Store, c: SocialComment) {
  if (!c.change_set_id) return null;
  const cs = await store.getChangeSet(c.change_set_id).catch(() => null);
  return cs && cs.source === "comment" && cs.status === "proposed" ? cs : null;
}

export async function adminCommentAction(d: AdminDeps, venue: Venue, a: AdminCommentAction): Promise<{ ok: boolean; status?: string; change_set_id?: string; error?: string }> {
  const now = d.now();
  const nowIso = now.toISOString();
  if (a.action === "set_comment_mode") {
    const site = await d.store.getSite(venue.id);
    let changes;
    try {
      changes = planChanges(site, [{ op: "set_comment_mode", mode: a.mode, ...(a.digest_hour !== undefined ? { digest_hour: a.digest_hour } : {}) }], { newId: () => crypto.randomUUID(), now: nowIso });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const hour = String(a.digest_hour ?? site.venue.comment_digest_hour).padStart(2, "0");
    const label = { each: { bg: "при всеки коментар", en: "each comment" }, digest: { bg: `веднъж дневно в ${hour}:00`, en: `once a day at ${hour}:00` }, off: { bg: "изключени", en: "off" } }[a.mode];
    const cs = await d.store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: `Известия за коментари: ${label.bg}`, summary_en: `Comment notifications: ${label.en}`, preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz), source: "comment", status: "proposed", changes });
    const r = await d.store.applyChangeSet(cs.id, nowIso);
    return r === "applied" ? { ok: true, status: "applied", change_set_id: cs.id } : { ok: false, error: `Change set is "${r}".` };
  }
  const c = await d.store.getComment(a.comment_id);
  if (!c || c.venue_id !== venue.id) return { ok: false, error: "Comment not found." };
  if (a.action === "ignore_comment") {
    const pending = await pendingSetOf(d.store, c);
    if (pending) await cancelCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, pending, { bg: "❌ Отказано от таблото.", en: "❌ Cancelled from the dashboard." }, { status: "ignored" });
    else await d.store.updateComment(c.id, { status: "ignored" });
    return { ok: true, status: "ignored" };
  }
  if (c.status === "replied") return { ok: false, error: "Comment already answered." };
  if (c.status === "own" || c.status === "nested" || c.status === "deleted") return { ok: false, error: `Comment is "${c.status}".` };
  const limit = await commentLimitState(d.store, venue, now);
  if (limit.reached) return { ok: false, error: copy("en").commentLimitReached(limit.limit ?? limit.used, limit.used, limit.resets_on) };
  const pending = await pendingSetOf(d.store, c);
  if (pending) await cancelCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, pending, { bg: "✅ Отговорено от таблото.", en: "✅ Answered from the dashboard." });
  const item: CommentSetItem = { comment: (await d.store.getComment(c.id)) ?? c, reply_text: a.reply_text, moderate: null, kind: (c.draft_kind ?? undefined) as CommentSetItem["kind"] };
  const made = await createCommentSet({ store: d.store, messenger: d.messenger, now: d.now }, venue, [item], { silent: true });
  if (!made.set) return { ok: false, error: made.limited ? "Comment limit reached." : "Could not create the reply." };
  const r = await d.store.applyChangeSet(made.set.id, nowIso);
  if (r !== "applied") return { ok: false, status: r, change_set_id: made.set.id, error: `Change set is "${r}".` };
  // Like other dashboard decisions: the owners' chats hear about it (within Meta's window).
  const { reachable } = await reachableOwners(d.store, venue.id, now);
  for (const m of reachable) {
    const lines = await syncLines(d.store, made.set.id, m.lang);
    const head = m.lang === "bg" ? `✅ Отговорено от таблото на ${c.author_name || "клиент"}: „${a.reply_text}“` : `✅ Answered from the dashboard to ${c.author_name || "a customer"}: “${a.reply_text}”`;
    await d.messenger.send(m.chat_ref, [head, ...lines].join("\n"), { proactive: true });
  }
  return { ok: true, status: "applied", change_set_id: made.set.id };
}
```

In `src/server/admin.ts` add `import { commentsOverview, type CommentsOverview } from "./admin-comments";`, the field `/** "Comments" card (comment replies, 2026-10-15). */ comments?: CommentsOverview;` to `AdminOverview`, and `comments: await commentsOverview(store, venue, now),` in `adminOverview`'s returned object (after `changes_this_month`). (`admin-comments.ts` imports the `AdminDeps` type from `admin.ts` and `admin.ts` imports a function from `admin-comments.ts`: a type-only import on one side, so no runtime cycle.)

- [ ] **Step 4: Route.** In `app/api/admin/[slug]/route.ts` import `adminCommentAction, parseAdminCommentAction` from `@/src/server/admin-comments` and add before the `actions` check:

```ts
  if (body.action === "reply_comment" || body.action === "ignore_comment" || body.action === "set_comment_mode") {
    const a = parseAdminCommentAction(body);
    if (!a) return Response.json({ error: "bad request" }, { status: 400 });
    const r = await adminCommentAction({ store: deps.store, messenger: deps.messenger, now: () => new Date(), baseUrl: deps.config.publicBaseUrl }, venue, a);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
```

- [ ] **Step 5: Dictionary keys.** Append to `en` (before the closing `};`):

```ts
  // Comment replies (appended 2026-10-15)
  "admin.comments.title": "Comments",
  "admin.comments.intro": "Customers' comments under the posts the bot published. Each gets a drafted reply: edit it here and press Reply, or Ignore. Nothing is posted without you.",
  "admin.comments.modeLabel": "Notifications in the chat",
  "admin.comments.mode.each": "every comment",
  "admin.comments.mode.digest": "once a day",
  "admin.comments.mode.off": "off",
  "admin.comments.digestHour": "at {hour}:00",
  "admin.comments.reconnect": "Connect {network} again so the bot can read comments.",
  "admin.comments.limit": "Replies this month: {used}/{limit}",
  "admin.comments.pending": "Waiting",
  "admin.comments.nonePending": "No comments waiting.",
  "admin.comments.answered": "Answered",
  "admin.comments.noneAnswered": "Nothing answered yet.",
  "admin.comments.reply": "Reply",
  "admin.comments.ignore": "Ignore",
  "admin.comments.replyPlaceholder": "Write the reply…",
  "admin.comments.spam": "Looks like spam or abuse: ignore it here, or hide it from the chat.",
  "admin.comments.openPost": "Open the post",
  "admin.comments.status.new": "new",
  "admin.comments.status.proposed": "in the chat",
  "admin.comments.status.replied": "replied",
  "admin.comments.status.ignored": "ignored",
  "admin.comments.status.expired": "expired",
  "admin.comments.status.hidden": "hidden",
  "admin.comments.status.deleted": "deleted",
```

and to `bg`:

```ts
  // Comment replies (appended 2026-10-15)
  "admin.comments.title": "Коментари",
  "admin.comments.intro": "Коментарите на клиенти под публикациите, които ботът е пуснал. Всеки получава предложен отговор: редактирайте го тук и натиснете „Отговори“, или „Пропусни“. Нищо не се публикува без вас.",
  "admin.comments.modeLabel": "Известия в чата",
  "admin.comments.mode.each": "при всеки коментар",
  "admin.comments.mode.digest": "веднъж дневно",
  "admin.comments.mode.off": "изключени",
  "admin.comments.digestHour": "в {hour}:00",
  "admin.comments.reconnect": "Свържете отново {network}, за да четем коментарите.",
  "admin.comments.limit": "Отговори този месец: {used}/{limit}",
  "admin.comments.pending": "Чакащи",
  "admin.comments.nonePending": "Няма чакащи коментари.",
  "admin.comments.answered": "Отговорени",
  "admin.comments.noneAnswered": "Още няма отговорени.",
  "admin.comments.reply": "Отговори",
  "admin.comments.ignore": "Пропусни",
  "admin.comments.replyPlaceholder": "Напишете отговора…",
  "admin.comments.spam": "Изглежда спам или обиден: пропуснете го тук или го скрийте от чата.",
  "admin.comments.openPost": "Отвори поста",
  "admin.comments.status.new": "нов",
  "admin.comments.status.proposed": "в чата",
  "admin.comments.status.replied": "отговорено",
  "admin.comments.status.ignored": "пропуснат",
  "admin.comments.status.expired": "изтекъл",
  "admin.comments.status.hidden": "скрит",
  "admin.comments.status.deleted": "изтрит",
```

- [ ] **Step 6: The card.** Create `app/admin/[slug]/components/CommentsCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";
import type { CommentsOverview, CommentView } from "@/src/server/admin-comments";
import type { CommentMode } from "@/src/domain/types";
import { formatDateTime } from "@/src/time";
import { Chip, Section } from "./bits";
import type { Post } from "./useAdminOverview";

const NAME = { facebook: "Facebook", instagram: "Instagram" } as const;
const MODES: CommentMode[] = ["each", "digest", "off"];
const TONE: Record<CommentView["status"], "plain" | "good" | "warn"> = { new: "warn", proposed: "warn", replied: "good", ignored: "plain", expired: "plain", hidden: "plain", deleted: "plain", own: "plain", nested: "plain" };

/** Customers' comments under the bot's posts: pending ones with an editable draft (Reply / Ignore), the last answered, the notification mode. */
export function CommentsCard({ overview, post, tz }: { overview: CommentsOverview | null; post: Post; tz: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!overview) return null;
  const o = overview;

  async function run(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setFailed(null);
    const r = await post(body);
    if (!r.ok) setFailed(key);
    setBusy(null);
  }
  const draftOf = (c: CommentView) => drafts[c.id] ?? c.draft_text ?? "";
  const statusKey = (s: CommentView["status"]) => `admin.comments.status.${s}` as MessageKey;

  const row = (c: CommentView, pending: boolean) => (
    <li key={c.id} className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 [overflow-wrap:anywhere] font-semibold">{c.author_name || "—"} · {NAME[c.network]}</span>
        <span className="flex items-center gap-2 text-sm text-ink-soft">
          <span suppressHydrationWarning>{formatDateTime(c.created_at, lang, tz)}</span>
          <Chip tone={TONE[c.status]}>{t(statusKey(c.status))}</Chip>
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-ink">{c.text}</p>
      {(c.post_caption || c.post_permalink) && (
        <p className="mt-1 text-sm text-ink-soft">
          {c.post_caption && <span className="[overflow-wrap:anywhere]">„{c.post_caption}“ </span>}
          {c.post_permalink && (
            <a href={c.post_permalink} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-2 hover:text-accent">
              {t("admin.comments.openPost")}<span className="sr-only"> {t("admin.newTab")}</span>
            </a>
          )}
        </p>
      )}
      {pending ? (
        <div className="mt-3">
          {(c.draft_kind === "spam" || c.draft_kind === "abuse") && <p className="mb-2 text-sm font-semibold text-amber">{t("admin.comments.spam")}</p>}
          <textarea value={draftOf(c)} onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })} rows={2} maxLength={500} placeholder={t("admin.comments.replyPlaceholder")} aria-label={t("admin.comments.reply")}
            className="w-full rounded-2xl bg-paper-deep px-4 py-3 text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-2 focus:ring-accent" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy !== null || draftOf(c).trim() === ""} aria-busy={busy === `reply:${c.id}`} onClick={() => void run(`reply:${c.id}`, { action: "reply_comment", comment_id: c.id, reply_text: draftOf(c).trim() })}
              className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60">
              {busy === `reply:${c.id}` ? t("admin.busy") : t("admin.comments.reply")}
            </button>
            <button type="button" disabled={busy !== null} aria-busy={busy === `ignore:${c.id}`} onClick={() => void run(`ignore:${c.id}`, { action: "ignore_comment", comment_id: c.id })}
              className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5 disabled:opacity-60">
              {busy === `ignore:${c.id}` ? t("admin.busy") : t("admin.comments.ignore")}
            </button>
          </div>
          {(failed === `reply:${c.id}` || failed === `ignore:${c.id}`) && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{t("admin.failed")}</p>}
        </div>
      ) : (
        c.reply_text && <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-ink">→ {c.reply_text}</p>
      )}
    </li>
  );

  return (
    <Section id="comments" title={t("admin.comments.title")}>
      <div className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
        <p className="max-w-prose text-ink-soft">{t("admin.comments.intro")}</p>
        {(["facebook", "instagram"] as const).filter((k) => o.needs_reconnect[k]).map((k) => (
          <p key={k} role="status" className="mt-3 rounded-2xl bg-amber-soft px-4 py-3 text-sm font-semibold text-ink">{t("admin.comments.reconnect", { network: NAME[k] })}</p>
        ))}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.comments.modeLabel")}</span>
          {MODES.map((m) => (
            <button key={m} type="button" disabled={busy !== null} aria-pressed={o.mode === m} onClick={() => void run(`mode:${m}`, { action: "set_comment_mode", mode: m, digest_hour: o.digest_hour })}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold transition disabled:opacity-60 ${o.mode === m ? "bg-accent text-white" : "text-ink ring-1 ring-ink/25 hover:bg-ink/5"}`}>
              {t(`admin.comments.mode.${m}` as MessageKey)}
            </button>
          ))}
          {o.mode === "digest" && (
            <label className="text-sm text-ink-soft">
              {t("admin.comments.digestHour", { hour: String(o.digest_hour).padStart(2, "0") })}
              <select value={o.digest_hour} disabled={busy !== null} aria-label={t("admin.comments.digestHour", { hour: String(o.digest_hour).padStart(2, "0") })} onChange={(e) => void run("mode:hour", { action: "set_comment_mode", mode: "digest", digest_hour: Number(e.target.value) })} className="ml-2 rounded-full bg-paper-deep px-3 py-2 ring-1 ring-ink/10">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </label>
          )}
          {o.limit.limit !== null && <span className="ml-auto text-sm text-ink-soft">{t("admin.comments.limit", { used: String(o.limit.used), limit: String(o.limit.limit) })}</span>}
        </div>
        {failed?.startsWith("mode:") && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{t("admin.failed")}</p>}

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.comments.pending")}</h3>
        {o.pending.length === 0 ? <p className="mt-2 text-sm text-ink-soft">{t("admin.comments.nonePending")}</p> : <ul className="mt-2 divide-y divide-ink/10">{o.pending.map((c) => row(c, true))}</ul>}
        <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.comments.answered")}</h3>
        {o.answered.length === 0 ? <p className="mt-2 text-sm text-ink-soft">{t("admin.comments.noneAnswered")}</p> : <ul className="mt-2 divide-y divide-ink/10">{o.answered.map((c) => row(c, false))}</ul>}
      </div>
    </Section>
  );
}
```

(`useLang`'s `t(key, vars)` substitutes `{name}` placeholders, as `admin.social.since` shows; `Post` is exported from `useAdminOverview.ts`.) In `AdminPanel.tsx` import `CommentsCard` and render `<CommentsCard overview={o.comments ?? null} post={post} tz={tz} />` right after `<SocialCard … />`.

- [ ] **Step 7: Run the tests and the suite**

```
npx vitest run test/admin-comments.test.tsx test/admin-social.test.tsx test/i18n.test.ts test/admin-server.test.ts
npx vitest run
npm run typecheck
npm run lint
```

Expected: green; `test/i18n.test.ts` proves BG/EN key parity.

- [ ] **Step 8: Commit**

```
git add src/server/admin-comments.ts src/server/admin.ts app/api/admin/[slug]/route.ts app/admin/[slug]/components/CommentsCard.tsx app/admin/[slug]/components/AdminPanel.tsx src/i18n/dicts.ts test/admin-comments.test.tsx
git commit -m "Comments: dashboard card with editable drafts, Reply/Ignore, mode toggle; admin overview and actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: Scopes and capability flag, README, live check, phase-2 note

**Files:**
- Modify: `src/server/social-connect.ts` (`FB_SCOPES`, `IG_PUBLISH_SCOPES`, `storeFacebook`, the Instagram callback's config)
- Modify: `test/social-connect.test.ts` (lines 78, 89, 121, 215)
- Create: `test/comments-connect.test.ts`
- Create: `scripts/social-comments-live-check.mts`; Modify: `package.json` (`"social:comments:live"` script)
- Modify: `README.md` (new section after "Posting to Facebook and Instagram"; "Known gaps" bullet), `docs/CHANNELS.md` (new section before "Offline: no Meta account needed"), `.env.example` (the `META_LOGIN_CONFIG_ID` comment)

**Interfaces:**

```ts
// src/server/social-connect.ts
export const FB_SCOPES = "pages_manage_posts,pages_read_engagement,pages_show_list,pages_read_user_content,pages_manage_engagement";
export const IG_PUBLISH_SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments";
/** Set on the destination config at connect time; a connection without it predates the comment scopes (dashboard: "connect again"). */
export const COMMENTS_CAPABILITY = "comments";
```

- [ ] **Step 1: Write the failing tests.** In `test/social-connect.test.ts` change line 78 to `expect(FB_SCOPES).toBe("pages_manage_posts,pages_read_engagement,pages_show_list,pages_read_user_content,pages_manage_engagement");`, line 89 to `expect(IG_PUBLISH_SCOPES).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments");`, line 121's `config:` object to include `comments: true`, and line 215's `config:` object to include `comments: true`. Create `test/comments-connect.test.ts`:

```ts
// test/comments-connect.test.ts — the comment scopes and the capability flag a connection stores; the dashboard's reconnect line follows it.
import { describe, expect, it } from "vitest";
import { commentsOverview } from "@/src/server/admin-comments";
import { COMMENTS_CAPABILITY, FB_SCOPES, IG_PUBLISH_SCOPES } from "@/src/server/social-connect";
import { connectedVenue, T0 } from "./comments-helpers";

describe("comment scopes", () => {
  it("ask Meta for reading and replying to comments on both networks", () => {
    expect(FB_SCOPES.split(",")).toEqual(expect.arrayContaining(["pages_read_user_content", "pages_manage_engagement"]));
    expect(IG_PUBLISH_SCOPES.split(",")).toContain("instagram_business_manage_comments");
    expect(COMMENTS_CAPABILITY).toBe("comments");
  });
  it("a connection made before the comment scopes shows the reconnect line until it is connected again", async () => {
    const v = await connectedVenue();
    const ig = (await v.store.getDestination(v.venue.id, "instagram"))!;
    const { comments: _c, ...older } = ig.config;
    void _c;
    await v.store.upsertDestination({ venue_id: v.venue.id, kind: "instagram", config: older, secrets: ig.secrets });
    expect((await commentsOverview(v.store, await v.store.getVenue(v.venue.id), T0)).needs_reconnect).toEqual({ facebook: false, instagram: true });
    await v.store.upsertDestination({ venue_id: v.venue.id, kind: "instagram", config: { ...older, [COMMENTS_CAPABILITY]: true }, secrets: ig.secrets });
    expect((await commentsOverview(v.store, await v.store.getVenue(v.venue.id), T0)).needs_reconnect).toEqual({ facebook: false, instagram: false });
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```
npx vitest run test/comments-connect.test.ts test/social-connect.test.ts
```

Expected: the scope strings differ; `COMMENTS_CAPABILITY` is not exported; the stored configs lack `comments: true`.

- [ ] **Step 3: Scopes and flag.** In `src/server/social-connect.ts`:

```ts
export const FB_SCOPES = "pages_manage_posts,pages_read_engagement,pages_show_list,pages_read_user_content,pages_manage_engagement";
export const IG_PUBLISH_SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments";
/** Destination config flag set at connect time (comment replies, 2026-10-15): the token carries the comment scopes. */
export const COMMENTS_CAPABILITY = "comments";
```

In `storeFacebook` the config becomes `{ page_id: page.id, page_name: page.name, connected_at: d.now().toISOString(), [COMMENTS_CAPABILITY]: true }`; in `handleInstagramPublishCallback` add `[COMMENTS_CAPABILITY]: true` to the stored config. Update the file's header comment: "Scopes now include reading and replying to comments; existing connections reconnect once (the dashboard says so)."

- [ ] **Step 4: Live check script.** Create `scripts/social-comments-live-check.mts` and add `"social:comments:live": "tsx scripts/social-comments-live-check.mts"` to `package.json` scripts:

```ts
// scripts/social-comments-live-check.mts
// Against a REAL Instagram professional account: lists the comments under the account's latest post through our own reader
// (src/social/comments-graph.ts), replies to one chosen by id through our writer, then deletes the reply. The same code path
// as production minus the poll and the proposal (Meta's API cannot post a comment as another user, so the comment itself is
// written by hand in the Instagram app first). Needs IG_TEST_TOKEN (Instagram Login user token with
// instagram_business_manage_comments) in the env file. Never prints the token.
// Run: npx tsx --env-file=<.env.local> scripts/social-comments-live-check.mts [--comment <ig-comment-id>] [--reply "…"] [--keep]
import { GraphClient, IG_GRAPH, metaFetch } from "../src/destinations/meta-graph";
import { deleteReply, fetchInstagramComments, replyInstagram } from "../src/social/comments-graph";

const args = process.argv.slice(2);
let commentId = "";
let reply = "Благодарим! (тест от Site Manager)";
let keep = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--comment" && args[i + 1]) commentId = args[++i];
  else if (args[i] === "--reply" && args[i + 1]) reply = args[++i];
  else if (args[i] === "--keep") keep = true;
}
const token = process.env.IG_TEST_TOKEN ?? "";
if (!token) throw new Error("IG_TEST_TOKEN is missing");

async function main() {
  const client = new GraphClient(IG_GRAPH, token, fetch);
  const me = await client.get<{ user_id?: string; username?: string }>("/me?fields=user_id,username");
  if (!me.user_id) throw new Error("token check failed: no user_id");
  console.log(`== Instagram account @${me.username}`);
  const media = await metaFetch<{ data?: { id: string; caption?: string; permalink?: string }[] }>(fetch, `${IG_GRAPH}/${me.user_id}/media?fields=id,caption,permalink&limit=1`, { headers: { authorization: `Bearer ${token}` } });
  const latest = media.data?.[0];
  if (!latest) throw new Error("the account has no posts");
  console.log(`== latest post ${latest.id} ${latest.permalink ?? ""}\n   "${(latest.caption ?? "").slice(0, 80)}"`);
  const comments = await fetchInstagramComments(client, latest.id);
  console.log(`== ${comments.length} comment(s)`);
  for (const c of comments) console.log(`   ${c.parent_id ? "  ↳ " : ""}${c.comment_id} ${c.author_name}: ${c.text.slice(0, 80)} (${c.created_at})`);
  const target = commentId ? comments.find((c) => c.comment_id === commentId) : comments.find((c) => c.parent_id === null && c.author_id !== me.user_id);
  if (!target) {
    console.log(commentId ? `comment ${commentId} is not under the latest post` : "no top-level customer comment to reply to; write one in the Instagram app and run again with --comment <id>");
    process.exitCode = 1;
    return;
  }
  console.log(`== reply to ${target.comment_id} (${target.author_name}): "${reply}"`);
  const replyId = await replyInstagram(client, target.comment_id, reply);
  console.log(`   posted reply ${replyId}`);
  const after = await fetchInstagramComments(client, latest.id);
  const seen = after.find((c) => c.comment_id === replyId);
  console.log(`   reader sees it under its parent: ${seen ? `yes (parent ${seen.parent_id})` : "NO"}`);
  if (!keep) {
    await deleteReply(client, replyId);
    console.log("   reply deleted");
  }
  console.log(seen ? "\nSOCIAL COMMENTS LIVE CHECK OK" : "\nSOCIAL COMMENTS LIVE CHECK FAILED");
  if (!seen) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
```

- [ ] **Step 5: README and docs.** In `README.md` after the "Posting to Facebook and Instagram" section add:

```
## Replying to comments

When a customer comments under a post the bot published (Facebook Page or Instagram), every owner gets the comment with a drafted reply and the usual ✅ / ✏️ / ❌ buttons; the first tap wins. ✅ posts the reply as the venue, ✏️ lets the owner reword it ("Мария: имаме безглутенови от вторник"), ❌ ignores it. Spam or abuse gets a "hide" proposal instead (✅ hides it; "изтрий го" deletes it, which cannot be undone; there is no API to report it to Meta). Nothing is ever posted without an owner's tap. Modes per venue (`set_comment_mode` from the chat: "спри известията за коментари", "известия за коментари веднъж дневно в 10", "уведомявай ме за всеки коментар"; or the dashboard toggle): `each` (default: one proposal per comment within 15 minutes), `digest` (one batch a day at `comment_digest_hour`, venue time), `off` (dashboard only). In every mode the owner can ask "отговори на всички неотговорени коментари" / "answer the unanswered comments" (one batch proposal), "отговори само на въпросите", or "колко коментара чакат?". The dashboard's "Коментари" card shows pending comments with an editable draft (Reply posts at once, Ignore), the last 20 answered, the mode and the monthly count.

How it works: the tick polls (per venue at most every 15 minutes) the comments of the feed posts published in the last 14 days (`destination_syncs` results hold the Meta ids; Instagram `GET /{media}/comments`, Facebook `GET /{post}/comments?filter=toplevel`), stores new ones in `social_comments` (the venue's own comments and replies-to-replies are stored but never proposed), drafts a reply with one small-model call (`COMMENT_DRAFT_MODEL`, default `claude-haiku-5-5`: the venue's name, tagline, about, hours, phone, menu with prices and allergens, and the post's caption; the comment's language; 1–2 sentences; never invented facts; a neutral fallback line when the call fails) and creates a change set with source `comment` and one `social_reply` (or `social_moderate`) row per comment. After ✅ the Facebook/Instagram adapters post the reply (`POST /{comment}/comments`, `POST /{ig-comment}/replies`) through the same sync queue as posts; undo deletes the reply (`DELETE /{reply}`) or un-hides. A comment deleted by its author is skipped without retry ("Коментарът вече не съществува"). Comment sets never count toward the monthly change limit; a separate `comment_limit` (default 300 replies and moderations a month, `venues.comment_limit`, null = unlimited) applies. They expire after 24 hours (not 2), never block a pending menu proposal and are never blocked by one. Owners on Messenger, Instagram or WhatsApp get a proposal only within 23 hours of their last message; otherwise the comment waits for their next message or the dashboard (Telegram owners are never deferred). Comment text is customer content: rows are purged after 30 days, and logs carry only ids, counts and error codes.

Setup: apply `npm run db:apply -- schema.sql` (venue columns, `change_sets.proposal_refs`, the `comment` source) and `npm run db:apply -- schema-integrations.sql policies-integrations.sql` (the `social_comments` table and its RLS), then `npm run check:rls`. The logins now ask for `pages_read_user_content` + `pages_manage_engagement` (Facebook) and `instagram_business_manage_comments` (Instagram): **existing connections must be connected again once** (the card says "Свържете отново …" until then); with Facebook Login for Business add the two permissions to the configuration behind `META_LOGIN_CONFIG_ID`. While the app is in development mode only testers' comments are readable. Live check: `IG_TEST_TOKEN=… npm run social:comments:live -- --comment <id>` lists the comments under the account's latest post, replies to one and deletes the reply. Not built yet (phase 2, after App Review): Meta webhooks for comments, see docs/CHANNELS.md.
```

Add to "Known gaps": `- Comment replies are polled (every 15 minutes per venue), not pushed: Meta delivers comment webhooks only to a Live app with Advanced Access (docs/CHANNELS.md, "Comment webhooks"). Replies to replies are not proposed; Facebook Page mentions and live videos are out of scope.`

In `docs/CHANNELS.md` add before "## Offline: no Meta account needed":

```
## Comment webhooks (phase 2, not built)

Comment replies (docs/superpowers/specs/2026-10-15-comment-replies-design.md) poll Meta every 15 minutes per venue, because the `instagram` object's `comments` field and the `page` object's `feed` field are delivered only to a Live app with Advanced Access and Business Verification, and the Pages/accounts venues connect by OAuth are not subscribed to this app's webhooks. Once App Review grants `instagram_business_manage_comments`, `pages_read_user_content` and `pages_manage_engagement` with Advanced Access:

1. At connect time subscribe the venue: Instagram `POST /me/subscribed_apps?subscribed_fields=comments` with the user token (`src/server/social-connect.ts`, after the `/me` check); Facebook `POST /{page-id}/subscribed_apps?subscribed_fields=feed` with the Page token (needs `pages_manage_metadata` in `FB_SCOPES`).
2. `npm run meta:setup` registers the `instagram` → `comments` and `page` → `feed` webhook fields next to the messaging ones.
3. Extend `parseMetaWebhook` (`src/channels/meta/parse.ts`): `entry[].changes[]` with `field: "comments"` (Instagram: `value.id`, `value.text`, `value.from`, `value.media.id`, `value.parent_id`) or `field: "feed"` with `value.item === "comment"` and `value.verb === "add"` (Facebook: `value.comment_id`, `value.post_id`, `value.from`, `value.message`, `value.created_time`) become `IncomingComment`s (`src/social/comments-graph.ts`) routed to the same upsert + propose path (`src/social/comments-poll.ts` `pollVenueComments` → `src/social/comments-propose.ts` `proposeForComments`).
4. Polling stays as the fallback at a lower cadence: raise `COMMENT_POLL_EVERY_MS` to one hour for venues whose destinations carry a `webhook: true` flag.
```

In `.env.example` extend the `META_LOGIN_CONFIG_ID` comment: "… a 'User access token' configuration with pages_manage_posts, pages_read_engagement, pages_show_list, pages_read_user_content, pages_manage_engagement)".

- [ ] **Step 6: Run everything**

```
npx vitest run
npm run typecheck
npm run lint
npm run build
```

Expected: green; the build succeeds (the dashboard card and the new route branches compile; no server-only module is imported by a client component: `CommentsCard.tsx` imports types only from `src/server/admin-comments.ts`).

- [ ] **Step 7: Commit**

```
git add src/server/social-connect.ts test/social-connect.test.ts test/comments-connect.test.ts scripts/social-comments-live-check.mts package.json README.md docs/CHANNELS.md .env.example
git commit -m "Comments: comment scopes and capability flag, README section, live check script, phase-2 webhook note

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done when

- Every task's commit is on the branch, `npx vitest run`, `npm run typecheck`, `npm run lint` and `npm run build` are green.
- Live, once (not part of the tasks): `npm run db:apply -- schema.sql`, `npm run db:apply -- schema-integrations.sql policies-integrations.sql`, `npm run check:rls` (the new `social_comments` line passes), `SUPABASE_CONTRACT=1` store contract, reconnect the test Page and the Instagram account, `npm run social:comments:live -- --comment <id>`.
