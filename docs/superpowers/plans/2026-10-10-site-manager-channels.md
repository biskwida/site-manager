# Messenger, Instagram and WhatsApp channels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a venue owner use Site Manager from Messenger, Instagram DM or WhatsApp exactly as from Telegram: link with the invite code, change the site by text, voice or photo, approve with one tap.

**Architecture:** Owner identity becomes a prefixed string `chat_ref` (`tg:`, `fb:`, `ig:`, `wa:`). The Telegram-specific inbound logic moves into a channel-agnostic `handleInbound`; grammY becomes a translator into `InboundMessage`. Outbound goes through a `ChannelRouter` that dispatches by prefix to Telegram, Meta (Messenger + Instagram, one Page token) and WhatsApp adapters and enforces Meta's 24 h window for proactive messages. One webhook `/api/meta` receives all three Meta products. The Supabase schema change is additive so production (Telegram only) keeps working until merge.

**Tech Stack:** Next.js 16 App Router (`after()`), grammY 1.46, Graph API v25.0 via `fetch` (no SDK), Supabase, vitest 5, tsx scripts, Vercel preview deployment.

**Spec:** `docs/superpowers/specs/2026-10-10-site-manager-channels-design.md` (binding; its "Interface contracts" section wins on any naming question; one amendment is made in Task 5: `parseMetaWebhook` returns `InboundMessage[]` each carrying `eventId`, instead of a parallel `ids` array).

## Global Constraints

- Work in the worktree `/Users/tanyatopacharova/Projects/site-manager-channels`, branch `build/channels`. Never touch `~/Projects/site-manager` (another session works there).
- Commit with `git -c user.email="tanya.topacharova@gmail.com" -c user.name="Tanya Topacharova" commit …` and end every message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tokens, secrets, invite codes and admin keys never appear in logs, error messages, test output or chat. `.env.local` is read only by `npm run env:set` and the scripts' `--env-file-if-exists`.
- Graph API base: `https://graph.facebook.com/v25.0`, one constant `GRAPH` in `src/channels/meta/graph.ts`. Auth always `Authorization: Bearer <token>` header, never a query parameter.
- Copy stays BG + EN in `src/bot/copy.ts`; Meta button labels ≤ 20 characters.
- `chat_ref` grammar: `^(tg|fb|ig|wa):[A-Za-z0-9_.-]+$`. Legacy bigint columns are written only for `tg:` refs and only until the phase-2 migration.
- The Telegram owner experience does not change: same commands, same buttons, same message editing.
- After every task: `npm test`, `npm run typecheck`, `npm run lint` green before the commit.
- Memory store (`SITE_MANAGER_STORE=memory`) must keep running with no keys at all.

## Review Focus

Inputs the spec implies but no feature test exercises; each gets a test in the task named.

1. A Telegram group chat id is negative (`-100123`): `makeRef("tg", -100123)` must round-trip and `legacyTelegramId` must return the negative number (Task 1, `ref.test.ts`).
2. A Meta message id that happens to be all digits must not be written to the legacy `tg_message_id` column for a non-Telegram set: the mapper decides by channel, not by shape (Task 1, `supabase-mappers.test.ts`).
3. A proposal preview longer than Messenger's 640-char button-template limit must still reach the owner with buttons, as text + a short button message (Task 6, `meta-send.test.ts`).
4. A WhatsApp webhook that carries only `statuses` (delivery receipts) must produce no inbound message and no agent run (Task 5, `meta-parse.test.ts`).
5. A redelivered Meta webhook (same `mid`) must not start a second agent turn (Task 8, `meta-server.test.ts`).

---

### Task 1: `chat_ref` identity across domain, store, SQL and tests

**Files:**
- Create: `src/channels/ref.ts`, `test/ref.test.ts`, `supabase/migrations/2026-10-10-chat-ref.sql`
- Modify: `src/domain/types.ts:218-247`, `src/store/types.ts:57-71,104-111,119,143-144`, `src/store/memory.ts:18,107,163-191,206-240,321-327`, `src/store/supabase.ts:80-105,233-262,278-292,409-417`, `supabase/schema.sql:59-68,149-166,184-191`, `scripts/db-apply.mts`, `src/bot/messenger.ts`, `src/bot/bot.ts`, `src/bot/approvals.ts`, `src/bot/media.ts`, `src/agent/run.ts`, `src/agent/tools.ts`, `src/agent/memory.ts`, `src/tick.ts`, `src/server/admin.ts`, `src/server/deps.ts`, `scripts/smoke.mts`, `scripts/e2e-offline.mts`
- Test (modify): `test/helpers.ts`, `test/store-contract.ts`, `test/supabase-mappers.test.ts`, `test/bot.test.ts`, `test/bot-media.test.ts`, `test/approvals.test.ts`, `test/tick.test.ts`, `test/admin-server.test.ts`, `test/run.test.ts`, `test/tools-core.test.ts`, `test/tools-more.test.ts`, `test/server-deps.test.ts`, `test/server-telegram.test.ts`, `test/tg.ts`

**Interfaces:**
- Produces: `Channel`, `makeRef`, `parseRef`, `channelOf`, `isMetaChannel`, `legacyTelegramId` (ref.ts); `Member.chat_ref: string`, `Member.last_seen_at: string | null`; `ChangeSet.chat_ref: string | null`, `ChangeSet.message_ref: string | null`; `NewChangeSet.chat_ref`, `NewChangeSet.message_ref?`; `ChangeSetPatch` with `message_ref`; `Store.findMember(chatRef: string)`, `setMemberLang(venueId, chatRef, lang)`, `redeemInvite(code, chatRef, lang, now)`, `findProposed(venueId, chatRef)`, `getConversation/setConversation(venueId, chatRef, …)`, `touchMember(chatRef, nowIso)`; `Messenger.send(chatRef: string, text) → Promise<string | null>`, `sendProposal(chatRef, text, setId, lang) → Promise<string | null>`, `edit(chatRef, messageRef: string, text)`; `RunRequest.chatRef`, `AgentDeps.chatRef`, `DecisionDeps` unchanged, `handleDecision(d, chatRef: string, …)`.

- [ ] **Step 1: Write the failing ref tests**

```ts
// test/ref.test.ts
import { describe, expect, it } from "vitest";
import { channelOf, isMetaChannel, legacyTelegramId, makeRef, parseRef } from "@/src/channels/ref";

describe("chat_ref", () => {
  it("round-trips every channel, including negative Telegram group ids", () => {
    expect(makeRef("tg", 1001)).toBe("tg:1001");
    expect(makeRef("tg", -100123)).toBe("tg:-100123");
    expect(parseRef("tg:-100123")).toEqual({ channel: "tg", id: "-100123" });
    expect(parseRef("fb:1254477777772919")).toEqual({ channel: "fb", id: "1254477777772919" });
    expect(parseRef("wa:359888123456")).toEqual({ channel: "wa", id: "359888123456" });
    expect(channelOf("ig:178414")).toBe("ig");
  });
  it("rejects malformed refs and ids", () => {
    expect(() => parseRef("1001")).toThrow(/malformed chat_ref/);
    expect(() => parseRef("vb:1")).toThrow(/malformed chat_ref/);
    expect(() => parseRef("fb:")).toThrow(/malformed chat_ref/);
    expect(() => makeRef("fb", "a b")).toThrow(/bad channel id/);
  });
  it("knows which channels are Meta and which refs have a legacy Telegram id", () => {
    expect(isMetaChannel("tg")).toBe(false);
    expect(["fb", "ig", "wa"].every((c) => isMetaChannel(c as never))).toBe(true);
    expect(legacyTelegramId("tg:-100123")).toBe(-100123);
    expect(legacyTelegramId("fb:123456")).toBeNull();
    expect(legacyTelegramId(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/ref.test.ts`
Expected: FAIL, cannot resolve `@/src/channels/ref`.

- [ ] **Step 3: Implement `src/channels/ref.ts`**

```ts
// src/channels/ref.ts
// Owner identity across channels: "<channel>:<id>". The id is the platform's own (Telegram chat id, Messenger PSID, Instagram-scoped id, WhatsApp phone digits).
export type Channel = "tg" | "fb" | "ig" | "wa";

const ID = /^[A-Za-z0-9_.-]+$/;
const REF = /^(tg|fb|ig|wa):([A-Za-z0-9_.-]+)$/;

export function makeRef(channel: Channel, id: string | number): string {
  const s = String(id).trim();
  if (!ID.test(s)) throw new Error("bad channel id");
  return `${channel}:${s}`;
}
export function parseRef(ref: string): { channel: Channel; id: string } {
  const m = REF.exec(ref);
  if (!m) throw new Error(`malformed chat_ref: ${ref}`);
  return { channel: m[1] as Channel, id: m[2] };
}
export function channelOf(ref: string): Channel {
  return parseRef(ref).channel;
}
export function isMetaChannel(c: Channel): boolean {
  return c !== "tg";
}
/** The numeric Telegram id for the legacy bigint columns; null for every other channel. Remove with the phase-2 migration. */
export function legacyTelegramId(ref: string | null): number | null {
  if (ref === null) return null;
  const { channel, id } = parseRef(ref);
  return channel === "tg" ? Number(id) : null;
}
```

- [ ] **Step 4: Run the ref tests**

Run: `npx vitest run test/ref.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Change the domain types**

In `src/domain/types.ts` replace the `ChangeSet` fields `chat_id: number | null;` with `chat_ref: string | null;` and `tg_message_id: number | null;` with `/** The proposal message on the owner's channel (Telegram message id as text; Meta ids as given). */\n  message_ref: string | null;`. Replace the `Member` interface with:

```ts
export interface Member {
  venue_id: string;
  /** "<channel>:<id>", see src/channels/ref.ts. */
  chat_ref: string;
  role: Role;
  lang: Lang;
  /** Last inbound message from this member; Meta channels may only be messaged proactively within 24 h of it. */
  last_seen_at: string | null;
  created_at: string;
}
```

- [ ] **Step 6: Change the store interface**

In `src/store/types.ts`: `NewChangeSet.chat_id: number | null` → `chat_ref: string | null`; `tg_message_id?: number | null` → `message_ref?: string | null`; in `ChangeSetPatch` replace `"tg_message_id"` with `"message_ref"`. Replace the members block and the two conversation lines:

```ts
  // members and access (chatRef = "<channel>:<id>", src/channels/ref.ts)
  findMember(chatRef: string): Promise<Member | null>;
  listMembers(venueId: string): Promise<Member[]>;
  upsertMember(m: Omit<Member, "created_at" | "last_seen_at"> & { last_seen_at?: string | null }): Promise<Member>;
  setMemberLang(venueId: string, chatRef: string, lang: Lang): Promise<void>;
  /** Records an inbound message from the member; no-op for unknown refs. */
  touchMember(chatRef: string, nowIso: string): Promise<void>;
  createInvite(venueId: string, role: Role, expiresAt: string): Promise<string>;
  /** Links the chat and marks the code used; null when the code is unknown, used or expired. */
  redeemInvite(code: string, chatRef: string, lang: Lang, now: string): Promise<Member | null>;
```
and `findProposed(venueId: string, chatRef: string)`, `getConversation(venueId: string, chatRef: string)`, `setConversation(venueId: string, chatRef: string, c: Conversation)`.

- [ ] **Step 7: Memory store**

In `src/store/memory.ts`: `members = new Map<string, Member>();` (line 18). In `deleteVenue` (line 107) the loop variable is the key, unchanged. Replace the member methods (lines 163-191):

```ts
  async findMember(chatRef: string) {
    const m = this.members.get(chatRef);
    return m ? clone(m) : null;
  }
  async listMembers(venueId: string) {
    return [...this.members.values()].filter((m) => m.venue_id === venueId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(clone);
  }
  async upsertMember(m: Omit<Member, "created_at" | "last_seen_at"> & { last_seen_at?: string | null }) {
    const prev = this.members.get(m.chat_ref);
    const row: Member = { ...m, last_seen_at: m.last_seen_at ?? prev?.last_seen_at ?? null, created_at: prev?.created_at ?? this.clock() };
    this.members.set(m.chat_ref, row);
    return clone(row);
  }
  async setMemberLang(venueId: string, chatRef: string, lang: Lang) {
    const m = this.members.get(chatRef);
    if (!m || m.venue_id !== venueId) throw new Error(`member ${chatRef} not found`);
    m.lang = lang;
  }
  async touchMember(chatRef: string, nowIso: string) {
    const m = this.members.get(chatRef);
    if (m) m.last_seen_at = nowIso;
  }
```
`redeemInvite(code, chatRef: string, …)` passes `chat_ref: chatRef`. In `createChangeSet` (lines 206-224) write `chat_ref: cs.chat_ref` and `message_ref: cs.message_ref ?? null`; `findProposed(venueId, chatRef)` compares `x.chat_ref === chatRef`; `getConversation`/`setConversation` key stays `` `${venueId}:${chatRef}` ``.

- [ ] **Step 8: Supabase store with legacy dual-write**

Import `legacyTelegramId` from `../channels/ref`. Mappers:

```ts
export function toMember(r: Row): Member {
  return { venue_id: r.venue_id as string, chat_ref: str(r.chat_ref), role: r.role as Role, lang: (r.lang as Lang) ?? "bg", last_seen_at: isoOrNull(r.last_seen_at), created_at: iso(r.created_at) };
}
// in toChangeSet:
    chat_ref: strOrNull(r.chat_ref),
    …
    message_ref: strOrNull(r.message_ref),
```
Add after the mappers:
```ts
/** Legacy bigint columns, written only for Telegram refs so the production build (Telegram only) keeps working until the phase-2 migration. */
export function legacyColumns(chatRef: string | null, messageRef?: string | null): { chat_id: number | null; tg_message_id: number | null } {
  const chat_id = legacyTelegramId(chatRef);
  const tg_message_id = chat_id !== null && messageRef && /^-?\d+$/.test(messageRef) ? Number(messageRef) : null;
  return { chat_id, tg_message_id };
}
```
Member methods:
```ts
  async findMember(chatRef: string) {
    const { data, error } = await this.db.from("venue_members").select("*").eq("chat_ref", chatRef).maybeSingle();
    if (error) throw new Error(`findMember: ${error.message}`);
    return data ? toMember(data) : null;
  }
  async upsertMember(m: Omit<Member, "created_at" | "last_seen_at"> & { last_seen_at?: string | null }) {
    const { error } = await this.db.from("venue_members").delete().eq("chat_ref", m.chat_ref).neq("venue_id", m.venue_id);
    if (error) throw new Error(`upsertMember unlink: ${error.message}`);
    const row = { venue_id: m.venue_id, chat_ref: m.chat_ref, role: m.role, lang: m.lang, ...(m.last_seen_at !== undefined ? { last_seen_at: m.last_seen_at } : {}), tg_chat_id: legacyTelegramId(m.chat_ref) }; // legacy: remove in phase 2
    return toMember(await must(this.db.from("venue_members").upsert(row, { onConflict: "venue_id,chat_ref" }).select("*").single(), "upsertMember"));
  }
  async setMemberLang(venueId: string, chatRef: string, lang: Lang) {
    await mustRows(this.db.from("venue_members").update({ lang }).eq("venue_id", venueId).eq("chat_ref", chatRef).select("chat_ref"), "setMemberLang");
  }
  async touchMember(chatRef: string, nowIso: string) {
    const { error } = await this.db.from("venue_members").update({ last_seen_at: nowIso }).eq("chat_ref", chatRef);
    if (error) throw new Error(`touchMember: ${error.message}`);
  }
```
`redeemInvite` passes `chat_ref: chatRef`. `createChangeSet`:
```ts
    const { changes, message_ref, ...head } = cs;
    const row = await must<Row>(this.db.from("change_sets").insert({ ...head, apply_at: head.apply_at ?? null, undoes_id: head.undoes_id ?? null, message_ref: message_ref ?? null, ...legacyColumns(head.chat_ref, message_ref) }).select("*").single(), "createChangeSet");
```
`updateChangeSet`: when `patch.message_ref !== undefined`, read the set first (`const cur = await this.getChangeSet(id)`) and add `tg_message_id: legacyColumns(cur.chat_ref, patch.message_ref).tg_message_id` to the update (legacy, phase 2). `findProposed` → `.eq("chat_ref", chatRef)`. Conversations: select/upsert by `chat_ref`, upsert row gains `chat_id: legacyTelegramId(chatRef)` (legacy), `onConflict: "venue_id,chat_ref"`.

- [ ] **Step 9: SQL — migration file and fresh schema**

Create `supabase/migrations/2026-10-10-chat-ref.sql`:

```sql
-- Phase 1 of the channel identity change (see docs/superpowers/specs/2026-10-10-site-manager-channels-design.md).
-- Additive: production code that still uses the bigint columns keeps working. Idempotent.
alter table public.venue_members add column if not exists chat_ref text, add column if not exists last_seen_at timestamptz;
update public.venue_members set chat_ref = 'tg:' || tg_chat_id where chat_ref is null;
alter table public.venue_members alter column chat_ref set not null;
alter table public.venue_members alter column tg_chat_id drop not null;
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'venue_members_pkey' and conrelid = 'public.venue_members'::regclass
             and pg_get_constraintdef(oid) like '%tg_chat_id%') then
    alter table public.venue_members drop constraint venue_members_pkey;
    alter table public.venue_members add primary key (venue_id, chat_ref);
  end if;
end $$;
create unique index if not exists venue_members_chat_ref_key on public.venue_members (chat_ref);
create unique index if not exists venue_members_tg_chat_id_key on public.venue_members (venue_id, tg_chat_id);

alter table public.change_sets add column if not exists chat_ref text, add column if not exists message_ref text;
update public.change_sets set chat_ref = 'tg:' || chat_id where chat_id is not null and chat_ref is null;
update public.change_sets set message_ref = tg_message_id::text where tg_message_id is not null and message_ref is null;
create index if not exists change_sets_chat_ref_idx on public.change_sets (venue_id, chat_ref) where status = 'proposed';

alter table public.conversations add column if not exists chat_ref text;
update public.conversations set chat_ref = 'tg:' || chat_id where chat_ref is null;
alter table public.conversations alter column chat_ref set not null;
alter table public.conversations alter column chat_id drop not null;
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'conversations_pkey' and conrelid = 'public.conversations'::regclass
             and pg_get_constraintdef(oid) like '%chat_id%') then
    alter table public.conversations drop constraint conversations_pkey;
    alter table public.conversations add primary key (venue_id, chat_ref);
  end if;
end $$;
create unique index if not exists conversations_chat_id_key on public.conversations (venue_id, chat_id);
notify pgrst, 'reload schema';
```

In `supabase/schema.sql` rewrite the three tables for fresh databases (keep the legacy columns nullable, marked):

```sql
create table if not exists public.venue_members (
  venue_id uuid not null references public.venues(id) on delete cascade,
  chat_ref text not null,                 -- "<channel>:<id>", src/channels/ref.ts
  tg_chat_id bigint,                      -- legacy, tg: refs only; dropped by migrations/2026-10-11-drop-legacy-chat-ids.sql
  role text not null check (role in ('owner', 'staff')),
  lang text not null default 'bg' check (lang in ('bg', 'en')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (venue_id, chat_ref)
);
-- One venue per chat: the bot looks members up by chat_ref alone.
create unique index if not exists venue_members_chat_ref_key on public.venue_members (chat_ref);
create unique index if not exists venue_members_tg_chat_id_key on public.venue_members (venue_id, tg_chat_id);
```
Delete the old `tg_chat_id` unique index line that followed the table (check `sed -n 66,70p supabase/schema.sql` first). In `change_sets`: `chat_id bigint,` → `chat_ref text,\n  chat_id bigint,                          -- legacy, see venue_members`; `tg_message_id bigint,` → `message_ref text,\n  tg_message_id bigint,                    -- legacy`. In `conversations`: `chat_id bigint not null,` → `chat_ref text not null,\n  chat_id bigint,                          -- legacy`; `primary key (venue_id, chat_id)` → `primary key (venue_id, chat_ref)`; add `create unique index if not exists conversations_chat_id_key on public.conversations (venue_id, chat_id);` after the table.

`scripts/db-apply.mts`: accept an optional file list: `const files = process.argv.slice(2).length ? process.argv.slice(2) : ["schema.sql", "policies.sql"];` and resolve each with `new URL(\`../${file.startsWith("supabase/") ? file : "supabase/" + file}\`, import.meta.url)`. Update the header comment: `npm run db:apply -- supabase/migrations/2026-10-10-chat-ref.sql` applies one file.

- [ ] **Step 10: Messenger types and every caller (mechanical)**

`src/bot/messenger.ts`: interface becomes
```ts
export interface Messenger {
  /** Plain message; returns the message ref or null if sending failed (never throws). */
  send(chatRef: string, text: string): Promise<string | null>;
  /** Preview with ✅ / ✏️ / ❌ buttons. */
  sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null>;
  /** Replaces the text and removes the buttons; best-effort. */
  edit(chatRef: string, messageRef: string, text: string): Promise<void>;
}
```
`TelegramMessenger` converts: `const chat = Number(parseRef(chatRef).id)`; `sendMessage(chat, …)` returns `String(m.message_id)`; `edit` uses `Number(messageRef)`.

Rename everywhere else, same semantics:
- `src/bot/bot.ts`: `RunRequest.chatId: number` → `chatRef: string`; every `ctx.chat.id` / `ctx.chat?.id` used as identity becomes `makeRef("tg", ctx.chat.id)`; `member.tg_chat_id` → `member.chat_ref`; callback handler: `handleDecision(…, chatRef, …)`, `edit(chatRef, String(messageId), r.edit)`.
- `src/bot/media.ts`: `chatId: member.tg_chat_id` → `chatRef: member.chat_ref`.
- `src/bot/approvals.ts`: `handleDecision(d, chatRef: string, …)`, `cs.chat_ref !== chatRef`, `setCorrection(…, chatRef, …)`.
- `src/agent/tools.ts`: `AgentDeps.chatId: number` → `chatRef: string`; `d.chatId` → `d.chatRef`; `chat_id: d.chatId` → `chat_ref: d.chatRef`; `cs.chat_id !== null && cs.tg_message_id !== null` → `cs.chat_ref !== null && cs.message_ref !== null`; `updateChangeSet(cs.id, { tg_message_id: messageId })` → `{ message_ref: messageId }` (twice).
- `src/agent/run.ts`, `src/agent/memory.ts`: `chatId: number` → `chatRef: string` in signatures and calls.
- `src/tick.ts`: `langFor(store, venueId, chatRef: string | null)`; `cs.chat_id` → `cs.chat_ref`; `cs.tg_message_id` → `cs.message_ref`; `chat_id: null` → `chat_ref: null` in `writeAutoSet`.
- `src/server/admin.ts`: same substitutions in `editTelegram` and the undo branch.
- `src/server/deps.ts`: demo owner: `const ref = env.DEMO_OWNER_CHAT_REF?.trim() || (Number.isInteger(chat) && chat > 0 ? makeRef("tg", chat) : null); if (ref) await mem.upsertMember({ venue_id: venue.id, chat_ref: ref, role: "owner", lang: "bg" });`; `handleRun` passes `chatRef: r.chatRef`.
- `scripts/smoke.mts`: `--chat <telegram chat id>` keeps its CLI shape and converts with `makeRef("tg", chat)`; `chat_ref: "tg:1"` for dry mode; `chatRef: member.chat_ref`. `scripts/e2e-offline.mts`: `chat_ref: "tg:1"`, `chatRef: "tg:1"`; the console messenger signatures take `string`.

- [ ] **Step 11: Tests (mechanical) and the two Review Focus tests**

- `test/helpers.ts`: `chat_ref: "tg:1001"` / `"tg:1002"`; `FakeMessenger` fields `chatRef: string`, `messageRef: string` (`String(this.next++)`), `edits: { chatRef; messageRef; text }`.
- `test/tg.ts`: unchanged (Telegram ids stay numeric at the wire).
- In every test file listed above: `findMember(1001)` → `findMember("tg:1001")` (and 1002, 2000, 2001, 777, 10, 11, 12, 21, 22, 31, 32, 99 → `"tg:…"`); `chat_id: 1001` → `chat_ref: "tg:1001"`; `chat_id: null` → `chat_ref: null`; `tg_message_id: 42` → `message_ref: "42"` (7 → "7", 43 → "43"); `chatId: 1001` → `chatRef: "tg:1001"`; `messageId: 42` → `messageRef: "42"`; `tg_chat_id:` → `chat_ref:` with the `tg:` prefix; `handleDecision(d, 1001, …)` → `handleDecision(d, "tg:1001", …)`; `loadMemory(store, venue.id, 1001, T0)` → `"tg:1001"`; `getConversation(v.id, 10)` → `"tg:10"`; `server-deps.test.ts` → `findMember("tg:777")`; `makeTools({ …, chatId: 1002 })` → `chatRef: "tg:1002"`. The bot test "answers the callback first…" keeps `chat_id: 1001, message_id: 42` in the Telegram API payload assertions (wire values are numeric).
- `test/store-contract.ts` "links members through invites and tokens": add after the existing assertions
```ts
      expect((await s.findMember("tg:10"))?.last_seen_at).toBeNull();
      await s.touchMember("tg:10", LATER);
      expect((await s.findMember("tg:10"))?.last_seen_at).toBe(LATER);
      await s.touchMember("fb:nobody", LATER); // unknown ref: no throw
```
- `test/supabase-mappers.test.ts`: change the change-set row to `chat_ref: "tg:1001", chat_id: "1001", message_ref: "55", tg_message_id: "55"` and assert `cs.chat_ref === "tg:1001"`, `cs.message_ref === "55"`. Add:
```ts
  it("writes legacy bigint columns only for Telegram refs (Review Focus 2)", () => {
    expect(legacyColumns("tg:-100123", "55")).toEqual({ chat_id: -100123, tg_message_id: 55 });
    expect(legacyColumns("fb:123", "123456789")).toEqual({ chat_id: null, tg_message_id: null });
    expect(legacyColumns(null, null)).toEqual({ chat_id: null, tg_message_id: null });
    expect(toMember({ venue_id: "v", chat_ref: "fb:9", tg_chat_id: null, role: "owner", lang: "en", last_seen_at: "2026-10-09T09:00:00Z", created_at: "2026-10-09T09:00:00Z" })).toMatchObject({ chat_ref: "fb:9", last_seen_at: "2026-10-09T09:00:00.000Z" });
  });
```
(import `legacyColumns, toMember` from `@/src/store/supabase`).

- [ ] **Step 12: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green; grep check `grep -rn "tg_chat_id\|tg_message_id\|chat_id" src --include=*.ts | grep -v "legacy"` prints only the lines marked legacy in `src/store/supabase.ts`.

- [ ] **Step 13: Commit**

```bash
git add -A && git -c user.email="tanya.topacharova@gmail.com" -c user.name="Tanya Topacharova" commit -m "Identity: chat_ref with channel prefix; additive SQL migration; legacy dual-write for Telegram

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `Messenger` interface: `conclude`, `typing`, `proactive`

**Files:**
- Modify: `src/bot/messenger.ts`, `src/bot/approvals.ts:24-67`, `src/bot/bot.ts` (callback handler), `src/agent/tools.ts:118-122`, `src/tick.ts:44-48,62-66,84-88`, `src/server/admin.ts:46-51,75`, `scripts/smoke.mts`, `scripts/e2e-offline.mts`
- Test: `test/helpers.ts`, `test/approvals.test.ts`, `test/bot.test.ts`, `test/tick.test.ts`, `test/admin-server.test.ts`, `test/tools-core.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SendOpts { /** Started by us, not a reply: the router enforces Meta's 24 h window. */ proactive?: boolean }
export interface Messenger {
  send(chatRef: string, text: string, opts?: SendOpts): Promise<string | null>;
  sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null>;
  /** Telegram: edits the proposal message to `full` and removes the buttons. Meta channels: send `short` as a new message. Best-effort. */
  conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: SendOpts): Promise<void>;
  /** "typing…" indicator; `inReplyTo` is the inbound message ref (WhatsApp needs it). Best-effort. */
  typing(chatRef: string, inReplyTo?: string): Promise<void>;
}
export function proposalButtons(lang: Lang): { id: "apply" | "change" | "cancel"; label: string }[];
export interface DecisionResult { edit?: { full: string; short: string }; reply?: string; toast?: string }
```

- [ ] **Step 1: Update FakeMessenger and write the failing tests**

`test/helpers.ts`:
```ts
export class FakeMessenger implements Messenger {
  sent: { chatRef: string; text: string; setId?: string; lang?: Lang; messageRef: string; proactive?: boolean }[] = [];
  concluded: { chatRef: string; messageRef: string | null; full: string; short: string; proactive?: boolean }[] = [];
  typed: string[] = [];
  private next = 100;
  async send(chatRef: string, text: string, opts?: SendOpts) {
    const messageRef = String(this.next++);
    this.sent.push({ chatRef, text, messageRef, proactive: opts?.proactive });
    return messageRef;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang) {
    const messageRef = String(this.next++);
    this.sent.push({ chatRef, text, setId, lang, messageRef });
    return messageRef;
  }
  async conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: SendOpts) {
    this.concluded.push({ chatRef, messageRef, full, short, proactive: opts?.proactive });
  }
  async typing(chatRef: string) {
    this.typed.push(chatRef);
  }
  last() { return this.sent[this.sent.length - 1]; }
}
```
Test edits: `approvals.test.ts` expectations become `{ edit: { full: "• Капучино: 2,90 € → 3,20 €\n\n✅ Приложено", short: "✅ Приложено" }, toast: "✅ Приложено" }` (and the "already applied", scheduled, cancelled cases likewise, `r.edit?.full` for the scheduled one). `tick.test.ts`: `m.edits[0]` → `m.concluded[0]` equal to `{ chatRef: "tg:1001", messageRef: "42", full: "превю\n\n⌛ Изтекло: …", short: "⌛ Изтекло: предложението не беше потвърдено в рамките на 2 часа.", proactive: true }`; the applied and reminder sends assert `proactive: true`. `admin-server.test.ts`: `messenger.concluded[0]` matches `{ chatRef: "tg:1001", messageRef: "42", proactive: true }` and `.full` contains "✅". Add to `test/approvals.test.ts`:
```ts
describe("proposalButtons", () => {
  it("gives three labels under 20 characters in both languages", () => {
    for (const lang of ["bg", "en"] as const) {
      const b = proposalButtons(lang);
      expect(b.map((x) => x.id)).toEqual(["apply", "change", "cancel"]);
      for (const x of b) expect(x.label.length).toBeLessThanOrEqual(20);
    }
  });
});
```

- [ ] **Step 2: Run tests to see them fail**

Run: `npx vitest run test/approvals.test.ts test/tick.test.ts test/admin-server.test.ts`
Expected: FAIL on `conclude`/`proposalButtons` missing and shape mismatches.

- [ ] **Step 3: Implement**

`src/bot/messenger.ts`:
```ts
export function proposalButtons(lang: Lang): { id: "apply" | "change" | "cancel"; label: string }[] {
  const bg = lang === "bg";
  return [
    { id: "apply", label: bg ? "✅ Приложи" : "✅ Apply" },
    { id: "change", label: bg ? "✏️ Промени" : "✏️ Change" },
    { id: "cancel", label: bg ? "❌ Откажи" : "❌ Cancel" },
  ];
}
export function proposalKeyboard(setId: string, lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const b of proposalButtons(lang)) kb.text(b.label, `cs:${b.id}:${setId}`);
  return kb;
}
```
`TelegramMessenger.conclude(chatRef, messageRef, full)`: if `messageRef === null` → `send(chatRef, short)`, else `editMessageText(Number(id), Number(messageRef), full, { reply_markup: { inline_keyboard: [] } })` in try/catch. `typing(chatRef)`: `api.sendChatAction(Number(id), "typing")` in try/catch. Remove `edit`.

`approvals.ts`: `DecisionResult.edit?: { full: string; short: string }`; each `return { edit: X, toast: Y }` becomes `return { edit: { full: X, short: Y }, toast: Y }`.

`bot.ts` callback handler: `if (r.edit) await d.messenger.conclude(chatRef, messageId !== undefined ? String(messageId) : null, r.edit.full, r.edit.short);` (drop the `new TelegramMessenger(ctx.api)`; `d.messenger` routes to Telegram). Text handler: `await d.messenger.typing(chatRef)` replaces `ctx.replyWithChatAction("typing")` (also in media.ts and `/undo`).

`tools.ts` `cancelPending`: `if (cs.chat_ref !== null) await d.messenger.conclude(cs.chat_ref, cs.message_ref, \`${mine(cs)}\n\n${mark}\`, mark);`.

`tick.ts`: expired → `const line = tr(lang, "⌛ Изтекло: …", "⌛ Expired: …"); await d.messenger.conclude(cs.chat_ref, cs.message_ref, \`${preview}\n\n${line}\`, line, { proactive: true });` (drop the `message_ref !== null` guard); applied and reminder sends add `{ proactive: true }`.

`admin.ts` `editTelegram` → rename `concludeOnChannel`: `await d.messenger.conclude(cs.chat_ref, cs.message_ref, \`${preview}\n\n${line}\`, line, { proactive: true })` with the guard reduced to `cs.chat_ref === null`; the undo send gets `{ proactive: true }`.

`scripts/smoke.mts`, `scripts/e2e-offline.mts`: console messengers implement `conclude` (prints `✎ [ref#messageRef] short`) and `typing` (no-op).

- [ ] **Step 4: Run all tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: green. In `test/bot.test.ts` the "shows typing" assertion now reads `expect(deps.messenger).…` — replace with: set `deps.messenger = new TelegramMessenger(bot.api)` right after `createBot(deps)` in `setup()` (mirrors `deps.ts`), so `captureApi` still records `sendChatAction` and `editMessageText`; keep the existing assertions.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c user.email="tanya.topacharova@gmail.com" -c user.name="Tanya Topacharova" commit -m "Messenger: conclude/typing, proactive flag, shared proposal buttons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Channel-agnostic `handleInbound`; Telegram becomes a translator

**Files:**
- Create: `src/bot/inbound.ts`, `test/inbound.test.ts`
- Modify: `src/bot/bot.ts`, `src/bot/media.ts` (keep `downloadTelegramFile`, `imageMediaType`, `MAX_IMAGE_BYTES`; delete `registerMediaHandlers`), `src/bot/voice.ts`, `src/bot/copy.ts`, `src/server/deps.ts` (transcribe signature)
- Test: `test/voice.test.ts`, `test/bot.test.ts`, `test/bot-media.test.ts` (should pass unchanged except where noted)

**Interfaces:**
- Produces:
```ts
// src/bot/inbound.ts
export interface InboundMedia { download: () => Promise<{ bytes: Uint8Array; contentType: string; name?: string }> }
export interface InboundMessage {
  chatRef: string;
  kind: "text" | "voice" | "photo" | "button";
  text?: string;            // body, caption, or button data ("cs:apply:<id>")
  langHint?: Lang;          // Telegram language_code; absent on Meta
  media?: InboundMedia;
  messageRef?: string;      // the message a button belongs to / the inbound id (WhatsApp typing)
  referralCode?: string;    // m.me / ig.me ?ref=, wa.me ?text=
  eventId?: string;         // platform message id, for dedupe
}
export function normalizeCommand(text: string): string | null;   // "меню" → "/menu", "language en" → "/lang en", … else null
export async function handleInbound(d: BotDeps, m: InboundMessage): Promise<void>;
// src/bot/voice.ts
export type Transcriber = (bytes: Uint8Array, lang: Lang, contentType?: string) => Promise<string>;
// src/bot/copy.ts
copy(lang).noAccess(channel: Channel): string;  copy(lang).help(channel: Channel): string;
```
- `BotDeps` unchanged in shape except `transcribe: Transcriber | null`.

- [ ] **Step 1: Write the failing inbound tests**

```ts
// test/inbound.test.ts
import { describe, expect, it } from "vitest";
import type { BotDeps, RunRequest } from "@/src/bot/bot";
import { handleInbound, normalizeCommand } from "@/src/bot/inbound";
import { planChanges } from "@/src/domain/changes";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");
async function setup(over: Partial<BotDeps> = {}) {
  const demo = await makeDemo();
  const runs: RunRequest[] = [];
  const messenger = new FakeMessenger();
  const d: BotDeps = { token: "t", store: demo.store, messenger, baseUrl: "https://site.example", now: () => T0, startRun: (r) => runs.push(r), transcribe: null, download: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }), ...over };
  return { ...demo, runs, messenger, d };
}
const texts = (m: FakeMessenger) => m.sent.map((s) => s.text);

describe("normalizeCommand", () => {
  it("maps plain words to slash commands in both languages", () => {
    expect(normalizeCommand("меню")).toBe("/menu");
    expect(normalizeCommand("Menu")).toBe("/menu");
    expect(normalizeCommand("помощ")).toBe("/help");
    expect(normalizeCommand("language en")).toBe("/lang en");
    expect(normalizeCommand("език bg")).toBe("/lang bg");
    expect(normalizeCommand("отмени")).toBe("/undo");
    expect(normalizeCommand("/undo")).toBe("/undo");
    expect(normalizeCommand("Капучиното става 3,20")).toBeNull();
  });
});

describe("handleInbound", () => {
  it("links a Messenger user with a bare code and tells a stranger to send the code (no /start wording)", async () => {
    const { d, messenger, store, venue } = await setup();
    await handleInbound(d, { chatRef: "fb:500", kind: "text", text: "hello" });
    expect(texts(messenger)[0]).toBe("This bot manages one venue's website. Send the code you received from us.");
    await handleInbound(d, { chatRef: "fb:500", kind: "text", text: "Здравей" });
    expect(texts(messenger)[1]).toBe("Този бот управлява сайта на конкретно заведение. Изпратете кода, който получихте от нас.");
    const code = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "fb:500", kind: "text", text: ` ${code.toLowerCase()} ` });
    expect(texts(messenger)[2]).toMatch(/^Свързахте се като собственик/);
    expect(await store.findMember("fb:500")).toMatchObject({ role: "owner", lang: "bg", last_seen_at: T0.toISOString() });
  });
  it("links through a referral code and keeps Telegram's /start wording", async () => {
    const { d, messenger, store, venue } = await setup();
    await handleInbound(d, { chatRef: "tg:600", kind: "text", text: "/start", langHint: "en" });
    expect(texts(messenger)[0]).toMatch(/Send \/start <code>/);
    const code = await store.createInvite(venue.id, "staff", "2026-10-10T00:00:00.000Z");
    await handleInbound(d, { chatRef: "ig:700", kind: "text", text: "", referralCode: code });
    expect(texts(messenger)[1]).toMatch(/^Свързахте се като персонал/);
    expect(await store.findMember("ig:700")).toMatchObject({ role: "staff" });
  });
  it("runs text, honours word commands on Meta channels and shows typing", async () => {
    const { d, messenger, runs, store, venue } = await setup();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "wa:359888", role: "owner", lang: "bg" });
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "Баницата свърши", messageRef: "wamid.1" });
    expect(runs[0]).toMatchObject({ chatRef: "wa:359888", text: "Баницата свърши", source: "text" });
    expect(messenger.typed).toEqual(["wa:359888"]);
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "language en" });
    expect(texts(messenger).at(-1)).toBe("Language set to English.");
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "menu" });
    expect(texts(messenger).at(-1)).toMatch(/^Site: https:\/\/site.example\/agala/);
    await handleInbound(d, { chatRef: "wa:359888", kind: "text", text: "help" });
    expect(texts(messenger).at(-1)).not.toContain("/lang");
    expect(texts(messenger).at(-1)).toContain("language bg");
  });
  it("downloads a photo, stores it and starts a photo run; reports a failed download", async () => {
    const { d, runs, store, venue } = await setup();
    await handleInbound(d, { chatRef: "tg:1001", kind: "photo", text: "новата корица", media: { download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg", name: "a.jpg" }) } });
    expect(runs[0]).toMatchObject({ source: "photo", text: "новата корица", image: { media_type: "image/jpeg" } });
    expect((await store.getSite(venue.id)).media).toHaveLength(1);
    const bad = await setup();
    await handleInbound(bad.d, { chatRef: "tg:1001", kind: "photo", media: { download: async () => { throw new Error("download failed (HTTP 500)"); } } });
    expect(texts(bad.messenger)[0]).toBe("Не успях да изтегля снимката. Опитайте отново.");
    expect(bad.runs).toHaveLength(0);
  });
  it("transcribes voice with the media's content type", async () => {
    const seen: string[] = [];
    const { d, runs, messenger } = await setup({ transcribe: async (_b, _l, ct) => { seen.push(ct ?? ""); return "Капучиното става три и двайсет"; } });
    await handleInbound(d, { chatRef: "tg:1001", kind: "voice", media: { download: async () => ({ bytes: new Uint8Array([1]), contentType: "audio/mp4" }) } });
    expect(seen).toEqual(["audio/mp4"]);
    expect(runs[0]).toMatchObject({ source: "voice", text: "Капучиното става три и двайсет" });
    expect(texts(messenger)[0]).toBe("🎤 Чух: „Капучиното става три и двайсет“");
  });
  it("applies a button tap and concludes the proposal message", async () => {
    const { d, messenger, store, venue, items } = await setup();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", message_ref: "42", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
    await handleInbound(d, { chatRef: "tg:1001", kind: "button", text: `cs:apply:${cs.id}`, messageRef: "42" });
    expect(messenger.concluded[0]).toEqual({ chatRef: "tg:1001", messageRef: "42", full: "p\n\n✅ Приложено", short: "✅ Приложено", proactive: undefined });
    expect((await store.getChangeSet(cs.id)).status).toBe("applied");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run test/inbound.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Copy per channel**

In `src/bot/copy.ts` import `type { Channel } from "../channels/ref"`. BG: `noAccess: (ch: Channel) => ch === "tg" ? "Този бот управлява сайта на конкретно заведение. Изпратете /start <код> с кода, който получихте от нас." : "Този бот управлява сайта на конкретно заведение. Изпратете кода, който получихте от нас."`. `help: (ch: Channel) => \`${HELP_BG_BODY}\n\n${ch === "tg" ? "Команди: /menu – линкове към сайта, /lang bg|en – език, /undo – връща последната промяна." : "Думи-команди: „меню“ – линкове към сайта, „език bg“ / „език en“ – език, „отмени“ – връща последната промяна."}\``, where `HELP_BG_BODY` is the current help text up to and excluding the "Команди:" line. EN mirrors: "Send the code you received from us." and "Command words: “menu” – site links, “language bg” / “language en” – language, “undo” – reverts the last change." The `typeof BG` typing keeps both in sync.

- [ ] **Step 4: Transcriber content type**

`src/bot/voice.ts`:
```ts
export type Transcriber = (bytes: Uint8Array, lang: Lang, contentType?: string) => Promise<string>;
export function audioFileName(contentType = ""): { name: string; type: string } {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct === "audio/mp4" || ct === "audio/x-m4a" || ct === "audio/m4a") return { name: "voice.m4a", type: "audio/mp4" };
  if (ct === "audio/aac") return { name: "voice.aac", type: "audio/aac" };
  if (ct === "audio/mpeg" || ct === "audio/mp3") return { name: "voice.mp3", type: "audio/mpeg" };
  if (ct === "audio/amr") return { name: "voice.amr", type: "audio/amr" };
  return { name: "voice.ogg", type: "audio/ogg" };
}
```
and in the returned function: `const f = audioFileName(contentType); const file = await toFile(bytes, f.name, { type: f.type });`. Add to `test/voice.test.ts` a second test: with `contentType: "audio/mp4"` the file name is `voice.m4a`; with none it is `voice.ogg`.

- [ ] **Step 5: Implement `src/bot/inbound.ts`**

```ts
// src/bot/inbound.ts
// Channel-agnostic owner messages. Telegram (bot.ts) and the Meta webhook (server/meta.ts) both translate into InboundMessage and call handleInbound.
import type { ImageInput } from "../agent/run";
import { channelOf, type Channel } from "../channels/ref";
import { detectLang } from "../domain/format";
import type { Lang, Member } from "../domain/types";
import { handleDecision, parseCallback } from "./approvals";
import { adminUrl, publicUrl, type BotDeps } from "./bot";
import { copy } from "./copy";
import { imageMediaType, MAX_IMAGE_BYTES } from "./media";

export interface InboundMedia { download: () => Promise<{ bytes: Uint8Array; contentType: string; name?: string }> }
export interface InboundMessage { chatRef: string; kind: "text" | "voice" | "photo" | "button"; text?: string; langHint?: Lang; media?: InboundMedia; messageRef?: string; referralCode?: string; eventId?: string }

const CODE = /^[A-Z0-9-]{8,}$/;
const WORDS: [RegExp, string][] = [
  [/^(menu|меню)$/i, "/menu"], [/^(help|помощ)$/i, "/help"], [/^(undo|отмени|отмяна)$/i, "/undo"],
  [/^(language|език)\s+(bg|en)$/i, "/lang $2"],
];
export function normalizeCommand(text: string): string | null {
  const t = text.trim();
  if (t.startsWith("/")) return t;
  for (const [re, cmd] of WORDS) { const m = re.exec(t); if (m) return cmd.replace("$2", (m[2] ?? "").toLowerCase()); }
  return null;
}
/** "/start CODE" → CODE, "/start" → "", a bare code → itself, otherwise null. */
function startCode(text: string, isMember: boolean): string | null {
  const m = /^\/start(?:\s+(\S+))?\s*$/i.exec(text);
  if (m) return (m[1] ?? "").toUpperCase();
  const bare = text.trim().toUpperCase();
  return !isMember && CODE.test(bare) ? bare : null;
}

export async function handleInbound(d: BotDeps, m: InboundMessage): Promise<void> {
  const channel: Channel = channelOf(m.chatRef);
  const now = d.now();
  await d.store.touchMember(m.chatRef, now.toISOString());
  const member = await d.store.findMember(m.chatRef);
  const text = (m.text ?? "").trim();
  const uiLang: Lang = m.langHint ?? detectLang(text) ?? "bg";
  const say = (t: string) => d.messenger.send(m.chatRef, t);

  if (m.kind === "button") {
    const parsed = parseCallback(text);
    if (!parsed) return;
    const r = await handleDecision({ store: d.store, messenger: d.messenger, now: d.now }, m.chatRef, parsed.decision, parsed.setId);
    if (r.edit) await d.messenger.conclude(m.chatRef, m.messageRef ?? null, r.edit.full, r.edit.short);
    if (r.reply) await say(r.reply);
    return;
  }

  // Linking
  const code = m.referralCode?.trim().toUpperCase() ?? (m.kind === "text" ? startCode(text, member !== null) : null);
  if (code !== null) {
    if (member) { await welcomeBack(d, member); return; }
    if (!code) { await say(copy(uiLang).noAccess(channel)); return; }
    const linked = await d.store.redeemInvite(code, m.chatRef, uiLang, now.toISOString());
    if (!linked) { await say(copy(uiLang).badCode); return; }
    await d.store.touchMember(m.chatRef, now.toISOString());
    await welcome(d, linked);
    return;
  }
  if (!member) { await say(copy(uiLang).noAccess(channel)); return; }

  if (m.kind === "text") {
    const cmd = normalizeCommand(text);
    if (cmd) { await runCommand(d, member, channel, cmd); return; }
    const lang = detectLang(text) ?? member.lang;
    d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: { ...member, lang }, text, source: "text" });
    await d.messenger.typing(m.chatRef, m.messageRef);
    return;
  }
  if (m.kind === "photo") { await handlePhoto(d, member, m); return; }
  if (m.kind === "voice") { await handleVoice(d, member, m); return; }
}

async function welcome(d: BotDeps, member: Member) {
  const venue = await d.store.getVenue(member.venue_id);
  const c = copy(member.lang);
  if (member.role === "owner") await d.messenger.send(member.chat_ref, c.welcome(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)), publicUrl(d.baseUrl, venue.slug)));
  else await d.messenger.send(member.chat_ref, c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
}
async function welcomeBack(d: BotDeps, member: Member) {
  const venue = await d.store.getVenue(member.venue_id);
  const c = copy(member.lang);
  if (member.role === "owner") await d.messenger.send(member.chat_ref, c.welcomeBack(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id))));
  else await d.messenger.send(member.chat_ref, c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
}
async function runCommand(d: BotDeps, member: Member, channel: Channel, cmd: string) {
  const [name, arg = ""] = cmd.slice(1).split(/\s+/, 2);
  const c = copy(member.lang);
  switch (name.toLowerCase()) {
    case "lang": {
      const l = arg.toLowerCase();
      if (l !== "bg" && l !== "en") { await d.messenger.send(member.chat_ref, c.langUsage); return; }
      await d.store.setMemberLang(member.venue_id, member.chat_ref, l);
      await d.messenger.send(member.chat_ref, copy(l).langSet);
      return;
    }
    case "help": await d.messenger.send(member.chat_ref, c.help(channel)); return;
    case "menu": {
      const venue = await d.store.getVenue(member.venue_id);
      const admin = member.role === "owner" ? adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)) : null;
      await d.messenger.send(member.chat_ref, c.menu(publicUrl(d.baseUrl, venue.slug), admin));
      return;
    }
    case "undo":
      d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member, text: "Undo the last change.", source: "text" });
      await d.messenger.typing(member.chat_ref);
      return;
    default: return; // unknown command: silent, as before
  }
}
async function handlePhoto(d: BotDeps, member: Member, m: InboundMessage) {
  const caption = (m.text ?? "").trim();
  const lang = detectLang(caption) ?? member.lang;
  const c = copy(lang);
  let bytes: Uint8Array, media_type: ImageInput["media_type"] | null;
  try {
    const dl = await m.media!.download();
    if (dl.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`file too large (${dl.bytes.byteLength} bytes)`);
    bytes = dl.bytes;
    media_type = imageMediaType(dl.contentType, dl.name ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[bot] image download failed: ${msg}`);
    await d.messenger.send(member.chat_ref, /too large/.test(msg) ? c.photoTooBig : c.photoFailed);
    return;
  }
  if (!media_type) { await d.messenger.send(member.chat_ref, c.photoFailed); return; }
  const media = await d.store.saveMedia(member.venue_id, bytes, media_type);
  d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: { ...member, lang }, text: caption, source: "photo", image: { data: Buffer.from(bytes).toString("base64"), media_type }, mediaId: media.id });
  await d.messenger.typing(member.chat_ref, m.messageRef);
}
async function handleVoice(d: BotDeps, member: Member, m: InboundMessage) {
  const c = copy(member.lang);
  if (!d.transcribe) { await d.messenger.send(member.chat_ref, c.voiceUnavailable); return; }
  let text: string;
  try {
    const dl = await m.media!.download();
    text = (await d.transcribe(dl.bytes, member.lang, dl.contentType)).trim();
  } catch (e) {
    console.error(`[bot] voice failed: ${e instanceof Error ? e.message : String(e)}`);
    await d.messenger.send(member.chat_ref, c.voiceFailed);
    return;
  }
  if (!text) { await d.messenger.send(member.chat_ref, c.voiceFailed); return; }
  const lang = detectLang(text) ?? member.lang;
  d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: { ...member, lang }, text, source: "voice" });
  await d.messenger.send(member.chat_ref, copy(lang).heard(text));
}
```
Note `imageMediaType("image/jpeg", "")` returns `image/jpeg` (informative header wins). `MAX_IMAGE_BYTES` is checked here because Meta downloads do not go through `downloadTelegramFile`.

- [ ] **Step 6: Make `bot.ts` a translator**

Replace the body of `createBot` so every handler builds an `InboundMessage`:
```ts
export function createBot(d: BotDeps): Bot {
  const bot = new Bot(d.token, d.botInfo ? { botInfo: d.botInfo } : undefined);
  const ref = (ctx: Context) => makeRef("tg", ctx.chat!.id);
  const hint = (ctx: Context) => langFromCode(ctx.from?.language_code);
  const tgMedia = (ctx: Context, fileId: string): InboundMedia => ({
    download: async () => {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("no file_path");
      const dl = await d.download(file.file_path);
      return { ...dl, name: file.file_path };
    },
  });
  bot.on("message:text", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "text", text: ctx.message.text, langHint: hint(ctx), messageRef: String(ctx.message.message_id) }));
  bot.on("message:photo", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "photo", text: ctx.message.caption, langHint: hint(ctx), media: tgMedia(ctx, ctx.message.photo.at(-1)!.file_id) }));
  bot.on("message:document", (ctx) => ctx.message.document.mime_type?.startsWith("image/") ? handleInbound(d, { chatRef: ref(ctx), kind: "photo", text: ctx.message.caption, langHint: hint(ctx), media: tgMedia(ctx, ctx.message.document.file_id) }) : undefined);
  bot.on("message:voice", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "voice", langHint: hint(ctx), media: tgMedia(ctx, ctx.message.voice.file_id) }));
  bot.on("message:audio", (ctx) => handleInbound(d, { chatRef: ref(ctx), kind: "voice", langHint: hint(ctx), media: tgMedia(ctx, ctx.message.audio.file_id) }));
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined); // stop the spinner first
    if (!ctx.chat) return;
    await handleInbound(d, { chatRef: ref(ctx), kind: "button", text: ctx.callbackQuery.data, langHint: hint(ctx), messageRef: ctx.callbackQuery.message ? String(ctx.callbackQuery.message.message_id) : undefined });
  });
  bot.catch(async (err) => { … unchanged … });
  return bot;
}
```
Keep `RunRequest`, `BotDeps`, `INVITE_TTL_MS`, `adminUrl`, `publicUrl` exports; delete `requireMember` and the command handlers (now in inbound.ts). Telegram's `message:text` includes `/start …`: `handleInbound` parses it, so no `bot.command` registrations remain. Delete `registerMediaHandlers` from `media.ts`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: green. `test/bot.test.ts` and `test/bot-media.test.ts` pass unchanged (replies still go through `TelegramMessenger(bot.api)` captured by `captureApi`; `/start` from a Bot API update has the same text). If `bot.test.ts` "rejects unknown chats" fails on wording, the `langHint` for `/start` with `language_code: "en"` must be `"en"` — check `hint(ctx)`.

- [ ] **Step 8: Commit**

```bash
git add -A && git -c user.email="tanya.topacharova@gmail.com" -c user.name="Tanya Topacharova" commit -m "Bot: channel-agnostic handleInbound; Telegram as translator; copy per channel; transcriber content type

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Config keys, invite links, `.env.example`, `venue:create` output

**Files:**
- Create: `src/channels/links.ts`, `test/links.test.ts`
- Modify: `src/config.ts`, `.env.example`, `scripts/venue-create.mts:53-55`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `Config.metaAppSecret`, `metaVerifyToken`, `metaPageToken`, `whatsappToken`, `whatsappPhoneNumberId`, `messengerPageHandle`, `instagramUsername`, `whatsappNumber` (all `string | null`); `startLinks(cfg, code): { telegram?: string; messenger?: string; instagram?: string; whatsapp?: string }`.

- [ ] **Step 1: Failing tests**

Add to `test/config.test.ts`:
```ts
  it("reads the Meta channel keys and insists on the shared secrets", () => {
    expect(loadConfig(full)).toMatchObject({ metaAppSecret: null, metaVerifyToken: null, metaPageToken: null, whatsappToken: null, whatsappPhoneNumberId: null, messengerPageHandle: null, instagramUsername: null, whatsappNumber: null });
    const meta = { ...full, META_APP_SECRET: "sec", META_VERIFY_TOKEN: "ver", META_PAGE_TOKEN: "pt", WHATSAPP_TOKEN: "wt", WHATSAPP_PHONE_NUMBER_ID: "123", MESSENGER_PAGE_HANDLE: "sitemanagerbg", INSTAGRAM_USERNAME: "@sitemanager.bg", WHATSAPP_NUMBER: "+359 888 123 456" };
    expect(loadConfig(meta)).toMatchObject({ metaPageToken: "pt", whatsappPhoneNumberId: "123", instagramUsername: "sitemanager.bg", whatsappNumber: "359888123456" });
    expect(() => loadConfig({ ...full, META_PAGE_TOKEN: "pt" })).toThrow(/META_APP_SECRET and META_VERIFY_TOKEN/);
    expect(() => loadConfig({ ...full, META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", WHATSAPP_TOKEN: "wt" })).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
  });
```
`test/links.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { startLinks } from "@/src/channels/links";

describe("startLinks", () => {
  it("builds a deep link per configured channel and omits the rest", () => {
    expect(startLinks({ telegramBotUsername: "site_manager_bot", messengerPageHandle: "sitemanagerbg", instagramUsername: "sitemanager.bg", whatsappNumber: "359888123456" }, "ABCD2345")).toEqual({
      telegram: "https://t.me/site_manager_bot?start=ABCD2345",
      messenger: "https://m.me/sitemanagerbg?ref=ABCD2345",
      instagram: "https://ig.me/m/sitemanager.bg?ref=ABCD2345",
      whatsapp: "https://wa.me/359888123456?text=ABCD2345",
    });
    expect(startLinks({ telegramBotUsername: null, messengerPageHandle: null, instagramUsername: null, whatsappNumber: null }, "X")).toEqual({});
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/config.test.ts test/links.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/config.ts`: add the eight fields to `Config` with the doc comments from the spec table; in `loadConfig`:
```ts
  const metaPageToken = optional("META_PAGE_TOKEN");
  const whatsappToken = optional("WHATSAPP_TOKEN");
  const metaAppSecret = optional("META_APP_SECRET");
  const metaVerifyToken = optional("META_VERIFY_TOKEN");
  if ((metaPageToken || whatsappToken) && (!metaAppSecret || !metaVerifyToken)) throw new Error("META_APP_SECRET and META_VERIFY_TOKEN are required when META_PAGE_TOKEN or WHATSAPP_TOKEN is set");
  const whatsappPhoneNumberId = optional("WHATSAPP_PHONE_NUMBER_ID");
  if (whatsappToken && !whatsappPhoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is required with WHATSAPP_TOKEN");
```
and in the return: `metaAppSecret, metaVerifyToken, metaPageToken, whatsappToken, whatsappPhoneNumberId, messengerPageHandle: optional("MESSENGER_PAGE_HANDLE"), instagramUsername: optional("INSTAGRAM_USERNAME")?.replace(/^@/, "") ?? null, whatsappNumber: optional("WHATSAPP_NUMBER")?.replace(/\D/g, "") || null`.

`src/channels/links.ts`:
```ts
import type { Config } from "../config";
export type LinkConfig = Pick<Config, "telegramBotUsername" | "messengerPageHandle" | "instagramUsername" | "whatsappNumber">;
/** Deep links that open a chat with our bot and hand over the invite code (handleInbound reads it as text or referral). */
export function startLinks(cfg: LinkConfig, code: string): { telegram?: string; messenger?: string; instagram?: string; whatsapp?: string } {
  const c = encodeURIComponent(code);
  return {
    ...(cfg.telegramBotUsername ? { telegram: `https://t.me/${cfg.telegramBotUsername}?start=${c}` } : {}),
    ...(cfg.messengerPageHandle ? { messenger: `https://m.me/${cfg.messengerPageHandle}?ref=${c}` } : {}),
    ...(cfg.instagramUsername ? { instagram: `https://ig.me/m/${cfg.instagramUsername}?ref=${c}` } : {}),
    ...(cfg.whatsappNumber ? { whatsapp: `https://wa.me/${cfg.whatsappNumber}?text=${c}` } : {}),
  };
}
```
`scripts/venue-create.mts`: after the two code lines, print each link from `startLinks(deps.config, owner)` as `owner link (<channel>): <url>`.

`.env.example` append:
```
# Meta channels (Messenger, Instagram, WhatsApp): one Meta app, see docs/CHANNELS.md. A channel is enabled when its token is set.
# App secret: Meta app → App settings → Basic. Required with any Meta token.
META_APP_SECRET=
# Any random string you also paste into the app's Webhooks "Verify token" field; generate: openssl rand -hex 16
META_VERIFY_TOKEN=
# Page access token with pages_messaging + instagram_manage_messages (Meta app → Messenger → Instagram settings → Generate token). Serves Messenger and Instagram.
META_PAGE_TOKEN=
# WhatsApp Cloud API token (Meta app → WhatsApp → API Setup; a system-user token for a permanent one) and the phone number id shown there
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
# For invite deep links only: Page username (m.me/<handle>), Instagram username (ig.me/m/<user>), WhatsApp number with country code (wa.me/<digits>)
MESSENGER_PAGE_HANDLE=
INSTAGRAM_USERNAME=
WHATSAPP_NUMBER=
```

- [ ] **Step 4: Run** — `npm test && npm run typecheck && npm run lint` → green.

- [ ] **Step 5: Commit** — `git add -A && git -c … commit -m "Config: Meta channel keys; invite deep links per channel\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 5: Meta webhook parser

**Files:**
- Create: `src/channels/meta/graph.ts`, `src/channels/meta/parse.ts`, `test/meta-parse.test.ts`
- Modify: `docs/superpowers/specs/2026-10-10-site-manager-channels-design.md` (amend the `parseMetaWebhook` contract to return `InboundMessage[]` with `eventId`)

**Interfaces:**
- Produces:
```ts
// src/channels/meta/graph.ts
export const GRAPH = "https://graph.facebook.com/v25.0";
export type MediaFetch = (idOrUrl: string) => Promise<{ bytes: Uint8Array; contentType: string; name?: string }>;
// src/channels/meta/parse.ts
export function parseMetaWebhook(body: unknown, deps: { waDownload: MediaFetch; fetchUrl: MediaFetch }): InboundMessage[];
```
Each message has `eventId` set (platform `mid`/`id`, or `${sender}:${timestamp}` when absent).

- [ ] **Step 1: Failing tests with fixtures**

```ts
// test/meta-parse.test.ts
import { describe, expect, it } from "vitest";
import { parseMetaWebhook } from "@/src/channels/meta/parse";

const deps = { waDownload: async (id: string) => ({ bytes: new Uint8Array([1]), contentType: `wa:${id}` }), fetchUrl: async (url: string) => ({ bytes: new Uint8Array([2]), contentType: `url:${url}` }) };
const page = (messaging: unknown[], object = "page") => ({ object, entry: [{ id: "PAGE1", time: 1, messaging }] });
const wa = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "1555", phone_number_id: "PNID" }, ...value } }] }] });

describe("parseMetaWebhook: Messenger and Instagram", () => {
  it("maps text, image, audio, quick reply, postback, referral and skips echoes/reads", () => {
    const out = parseMetaWebhook(page([
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 1, message: { mid: "m1", text: "Капучиното става 3,20" } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 2, message: { mid: "m2", text: "корица", attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 3, message: { mid: "m3", attachments: [{ type: "audio", payload: { url: "https://cdn/v.mp4" } }] } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 4, message: { mid: "m4", text: "✅ Приложи", quick_reply: { payload: "cs:apply:abc" } } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 5, postback: { mid: "m5", title: "✅ Приложи", payload: "cs:apply:abc" } },
      { sender: { id: "501" }, recipient: { id: "PAGE1" }, timestamp: 6, postback: { mid: "m6", title: "Get Started", payload: "GET_STARTED", referral: { ref: "ABCD2345", source: "SHORTLINK", type: "OPEN_THREAD" } } },
      { sender: { id: "502" }, recipient: { id: "PAGE1" }, timestamp: 7, referral: { ref: "WXYZ6789", source: "SHORTLINK", type: "OPEN_THREAD" } },
      { sender: { id: "PAGE1" }, recipient: { id: "500" }, timestamp: 8, message: { mid: "m8", is_echo: true, text: "echo" } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 9, read: { watermark: 9 } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 10, message: { mid: "m10", attachments: [{ type: "video", payload: { url: "https://cdn/v.mp4" } }] } },
    ]), deps);
    expect(out.map((m) => [m.chatRef, m.kind, m.text ?? "", m.referralCode ?? "", m.eventId])).toEqual([
      ["fb:500", "text", "Капучиното става 3,20", "", "m1"],
      ["fb:500", "photo", "корица", "", "m2"],
      ["fb:500", "voice", "", "", "m3"],
      ["fb:500", "button", "cs:apply:abc", "", "m4"],
      ["fb:500", "button", "cs:apply:abc", "", "m5"],
      ["fb:501", "text", "", "ABCD2345", "m6"],
      ["fb:502", "text", "", "WXYZ6789", "502:7"],
    ]);
    expect(await out[1].media!.download()).toMatchObject({ contentType: "url:https://cdn/x.jpg" });
  });
  it("uses the ig: prefix for the instagram object", () => {
    const out = parseMetaWebhook(page([{ sender: { id: "178414" }, recipient: { id: "IG1" }, timestamp: 1, message: { mid: "i1", text: "hi" } }], "instagram"), deps);
    expect(out[0]).toMatchObject({ chatRef: "ig:178414", kind: "text", text: "hi", eventId: "i1" });
  });
});

describe("parseMetaWebhook: WhatsApp", () => {
  it("maps text, image, audio, button replies and skips statuses (Review Focus 4)", async () => {
    const out = parseMetaWebhook(wa({
      contacts: [{ profile: { name: "T" }, wa_id: "359888123456" }],
      messages: [
        { from: "359888123456", id: "wamid.1", timestamp: "1", type: "text", text: { body: "Баницата свърши" } },
        { from: "359888123456", id: "wamid.2", timestamp: "2", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", sha256: "x", caption: "дъската" } },
        { from: "359888123456", id: "wamid.3", timestamp: "3", type: "audio", audio: { id: "MEDIA2", mime_type: "audio/ogg; codecs=opus", voice: true } },
        { from: "359888123456", id: "wamid.4", timestamp: "4", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "cs:cancel:abc", title: "❌ Откажи" } } },
        { from: "359888123456", id: "wamid.5", timestamp: "5", type: "button", button: { payload: "cs:apply:abc", text: "✅ Приложи" } },
        { from: "359888123456", id: "wamid.6", timestamp: "6", type: "sticker", sticker: { id: "S" } },
      ],
    }), deps);
    expect(out.map((m) => [m.chatRef, m.kind, m.text ?? "", m.messageRef, m.eventId])).toEqual([
      ["wa:359888123456", "text", "Баницата свърши", "wamid.1", "wamid.1"],
      ["wa:359888123456", "photo", "дъската", "wamid.2", "wamid.2"],
      ["wa:359888123456", "voice", "", "wamid.3", "wamid.3"],
      ["wa:359888123456", "button", "cs:cancel:abc", "wamid.4", "wamid.4"],
      ["wa:359888123456", "button", "cs:apply:abc", "wamid.5", "wamid.5"],
    ]);
    expect(await out[2].media!.download()).toMatchObject({ contentType: "wa:MEDIA2" });
    expect(parseMetaWebhook(wa({ statuses: [{ id: "wamid.9", status: "delivered", timestamp: "9", recipient_id: "359888123456" }] }), deps)).toEqual([]);
  });
  it("never throws on unknown or malformed bodies", () => {
    expect(parseMetaWebhook({ object: "user", entry: [] }, deps)).toEqual([]);
    expect(parseMetaWebhook(null, deps)).toEqual([]);
    expect(parseMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: {} }] }] }, deps)).toEqual([]);
    expect(parseMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "1", id: "x", type: "text" }] } }] }] }, deps)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/meta-parse.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/channels/meta/graph.ts`: the two exports above.

`src/channels/meta/parse.ts`:
```ts
// src/channels/meta/parse.ts
// Meta webhook JSON (object = page | instagram | whatsapp_business_account) → InboundMessage[]. Never throws; unknown shapes are skipped with a one-line log of their keys.
import type { InboundMessage } from "../../bot/inbound";
import { makeRef, type Channel } from "../ref";
import type { MediaFetch } from "./graph";

type J = Record<string, unknown>;
const obj = (x: unknown): J | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as J) : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | null => (typeof x === "string" && x.length ? x : null);

export function parseMetaWebhook(body: unknown, deps: { waDownload: MediaFetch; fetchUrl: MediaFetch }): InboundMessage[] {
  const b = obj(body);
  if (!b) return [];
  const out: InboundMessage[] = [];
  if (b.object === "page" || b.object === "instagram") {
    const channel: Channel = b.object === "instagram" ? "ig" : "fb";
    for (const e of arr(b.entry)) for (const ev of arr(obj(e)?.messaging)) {
      try { const m = pageEvent(channel, obj(ev), deps.fetchUrl); if (m) out.push(m); } catch (err) { skip("page", ev, err); }
    }
  } else if (b.object === "whatsapp_business_account") {
    for (const e of arr(b.entry)) for (const ch of arr(obj(e)?.changes)) {
      const c = obj(ch);
      if (!c || c.field !== "messages") continue;
      for (const msg of arr(obj(c.value)?.messages)) {
        try { const m = waMessage(obj(msg), deps.waDownload); if (m) out.push(m); } catch (err) { skip("whatsapp", msg, err); }
      }
    }
  } else {
    console.log(`[meta] ignored webhook object ${String(b.object)}`);
  }
  return out;
}

function skip(kind: string, ev: unknown, err: unknown) {
  console.log(`[meta] skipped ${kind} event (${Object.keys(obj(ev) ?? {}).join(",")}): ${err instanceof Error ? err.message : err}`);
}

function pageEvent(channel: Channel, ev: J | null, fetchUrl: MediaFetch): InboundMessage | null {
  const sender = str(obj(ev?.sender)?.id);
  if (!ev || !sender) return null;
  const chatRef = makeRef(channel, sender);
  const ts = String(ev.timestamp ?? "");
  const msg = obj(ev.message);
  if (msg) {
    if (msg.is_echo === true) return null;
    const eventId = str(msg.mid) ?? `${sender}:${ts}`;
    const qr = str(obj(msg.quick_reply)?.payload);
    if (qr) return { chatRef, kind: "button", text: qr, messageRef: eventId, eventId };
    const att = arr(msg.attachments).map(obj).filter((a): a is J => a !== null);
    const text = str(msg.text) ?? "";
    const media = (a: J) => { const url = str(obj(a.payload)?.url); return url ? { download: () => fetchUrl(url) } : null; };
    const image = att.find((a) => a.type === "image");
    if (image) { const m = media(image); return m ? { chatRef, kind: "photo", text, media: m, messageRef: eventId, eventId } : null; }
    const audio = att.find((a) => a.type === "audio");
    if (audio) { const m = media(audio); return m ? { chatRef, kind: "voice", media: m, messageRef: eventId, eventId } : null; }
    if (att.length) { console.log(`[meta] unsupported attachment ${String(att[0].type)} from ${chatRef}`); return null; }
    if (!text) return null;
    return { chatRef, kind: "text", text, messageRef: eventId, eventId };
  }
  const pb = obj(ev.postback);
  if (pb) {
    const eventId = str(pb.mid) ?? `${sender}:${ts}`;
    const payload = str(pb.payload) ?? "";
    if (/^cs:/.test(payload)) return { chatRef, kind: "button", text: payload, messageRef: eventId, eventId };
    const ref = str(obj(pb.referral)?.ref);
    if (ref) return { chatRef, kind: "text", text: "", referralCode: ref, eventId };
    return null;
  }
  const ref = str(obj(ev.referral)?.ref);
  if (ref) return { chatRef, kind: "text", text: "", referralCode: ref, eventId: `${sender}:${ts}` };
  return null; // read, delivery, reaction, …
}

function waMessage(m: J | null, waDownload: MediaFetch): InboundMessage | null {
  const from = str(m?.from);
  const id = str(m?.id);
  if (!m || !from || !id) return null;
  const chatRef = makeRef("wa", from);
  const base = { chatRef, messageRef: id, eventId: id } as const;
  const media = (key: "image" | "audio") => { const mid = str(obj(m[key])?.id); return mid ? { download: () => waDownload(mid) } : null; };
  switch (m.type) {
    case "text": { const body = str(obj(m.text)?.body); return body ? { ...base, kind: "text", text: body } : null; }
    case "image": { const md = media("image"); return md ? { ...base, kind: "photo", text: str(obj(m.image)?.caption) ?? "", media: md } : null; }
    case "audio": { const md = media("audio"); return md ? { ...base, kind: "voice", media: md } : null; }
    case "interactive": { const bid = str(obj(obj(m.interactive)?.button_reply)?.id); return bid ? { ...base, kind: "button", text: bid } : null; }
    case "button": { const p = str(obj(m.button)?.payload); return p ? { ...base, kind: "button", text: p } : null; }
    default: console.log(`[meta] unsupported WhatsApp type ${String(m.type)} from ${chatRef}`); return null;
  }
}
```
Amend the spec's contract line to: `export function parseMetaWebhook(body: unknown, deps: { waDownload: MediaFetch; fetchUrl: MediaFetch }): InboundMessage[];  // each message carries eventId for dedupe`.

- [ ] **Step 4: Run** — `npx vitest run test/meta-parse.test.ts && npm run typecheck && npm run lint` → green.

- [ ] **Step 5: Commit** — `git add -A && git -c … commit -m "Meta: webhook parser for Messenger, Instagram and WhatsApp\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 6: `MetaMessenger` (Messenger + Instagram) and `WhatsAppMessenger`

**Files:**
- Create: `src/channels/meta/send.ts`, `src/channels/whatsapp/send.ts`, `src/channels/text.ts`, `test/meta-send.test.ts`, `test/whatsapp-send.test.ts`

**Interfaces:**
- Produces:
```ts
// src/channels/text.ts
export function splitText(text: string, max: number): string[];          // paragraph-first, then line, then hard cut; never an empty chunk
export function proposalParts(text: string, max: number): { lead: string | null; ask: string };  // lead = everything but the last paragraph when text > max
// src/channels/meta/send.ts
export class MetaMessenger implements Messenger { constructor(o: { pageToken: string; fetch?: typeof fetch }) }
// src/channels/whatsapp/send.ts
export class WhatsAppMessenger implements Messenger { constructor(o: { token: string; phoneNumberId: string; fetch?: typeof fetch }) }
// src/channels/meta/graph.ts (add)
export async function graphPost(fetchFn: typeof fetch, path: string, token: string, body: unknown, what: string): Promise<Record<string, unknown> | null>; // logs "[meta] <what> failed HTTP <status> code=<n> subcode=<n>" and returns null; never includes the token
```

- [ ] **Step 1: Failing tests**

```ts
// test/meta-send.test.ts
import { describe, expect, it } from "vitest";
import { MetaMessenger } from "@/src/channels/meta/send";
import { proposalParts, splitText } from "@/src/channels/text";

function fakeFetch(status = 200, body: unknown = { message_id: "m_1", recipient_id: "500" }) {
  const calls: { url: string; init: RequestInit; json: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, json: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

describe("splitText / proposalParts", () => {
  it("splits on paragraphs and never exceeds the limit", () => {
    const parts = splitText("a\n\nb\n\n" + "x".repeat(50), 20);
    expect(parts.every((p) => p.length <= 20 && p.length > 0)).toBe(true);
    expect(parts.join("")).toContain("a");
    expect(proposalParts("• A\n• B\n\nДа приложа ли?", 640)).toEqual({ lead: null, ask: "• A\n• B\n\nДа приложа ли?" });
    const long = "• " + "x".repeat(700) + "\n\nДа приложа ли?";
    expect(proposalParts(long, 640)).toEqual({ lead: "• " + "x".repeat(700), ask: "Да приложа ли?" });
  });
});

describe("MetaMessenger", () => {
  it("sends text with a bearer header and returns the message id", async () => {
    const { f, calls } = fakeFetch();
    const m = new MetaMessenger({ pageToken: "PT", fetch: f });
    expect(await m.send("fb:500", "Здравей")).toBe("m_1");
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/me/messages");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer PT");
    expect(calls[0].json).toEqual({ recipient: { id: "500" }, messaging_type: "RESPONSE", message: { text: "Здравей" } });
  });
  it("sends a proposal as a button template with three postbacks, Instagram included", async () => {
    const { f, calls } = fakeFetch();
    const m = new MetaMessenger({ pageToken: "PT", fetch: f });
    await m.sendProposal("ig:178414", "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?", "abc", "bg");
    expect(calls[0].json).toEqual({ recipient: { id: "178414" }, messaging_type: "RESPONSE", message: { attachment: { type: "template", payload: { template_type: "button", text: "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?", buttons: [
      { type: "postback", title: "✅ Приложи", payload: "cs:apply:abc" }, { type: "postback", title: "✏️ Промени", payload: "cs:change:abc" }, { type: "postback", title: "❌ Откажи", payload: "cs:cancel:abc" } ] } } } });
  });
  it("sends a long preview as text first, then a short button message (Review Focus 3)", async () => {
    const { f, calls } = fakeFetch();
    const m = new MetaMessenger({ pageToken: "PT", fetch: f });
    const ref = await m.sendProposal("fb:500", "• " + "x".repeat(700) + "\n\nДа приложа ли?", "abc", "bg");
    expect(calls).toHaveLength(2);
    expect(calls[0].json.message).toEqual({ text: "• " + "x".repeat(700) });
    expect((calls[1].json.message as { attachment: { payload: { text: string } } }).attachment.payload.text).toBe("Да приложа ли?");
    expect(ref).toBe("m_1");
  });
  it("concludes with the short line, shows typing, and returns null on errors without leaking the token", async () => {
    const { f, calls } = fakeFetch(400, { error: { message: "(#100) bad", code: 100, error_subcode: 2018001 } });
    const logs: string[] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const m = new MetaMessenger({ pageToken: "SECRET-PT", fetch: f });
      expect(await m.send("fb:500", "x")).toBeNull();
      await m.conclude("fb:500", "m_9", "full text", "✅ Приложено");
      await m.typing("fb:500");
    } finally { console.error = orig; }
    expect(calls[1].json.message).toEqual({ text: "✅ Приложено" });
    expect(calls[2].json).toEqual({ recipient: { id: "500" }, sender_action: "typing_on" });
    expect(logs.join("\n")).toMatch(/send failed HTTP 400 code=100 subcode=2018001/);
    expect(logs.join("\n")).not.toContain("SECRET-PT");
  });
});
```
```ts
// test/whatsapp-send.test.ts
import { describe, expect, it } from "vitest";
import { WhatsAppMessenger } from "@/src/channels/whatsapp/send";

function fakeFetch(status = 200, body: unknown = { messaging_product: "whatsapp", messages: [{ id: "wamid.out1" }] }) {
  const calls: { url: string; headers: Record<string, string>; json: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers as Record<string, string>) ?? {}, json: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { f, calls };
}

describe("WhatsAppMessenger", () => {
  it("sends text to the phone-number endpoint", async () => {
    const { f, calls } = fakeFetch();
    const m = new WhatsAppMessenger({ token: "WT", phoneNumberId: "PNID", fetch: f });
    expect(await m.send("wa:359888123456", "Готово")).toBe("wamid.out1");
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/PNID/messages");
    expect(calls[0].headers.authorization).toBe("Bearer WT");
    expect(calls[0].json).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "359888123456", type: "text", text: { body: "Готово", preview_url: false } });
  });
  it("sends a proposal as three reply buttons and splits long previews", async () => {
    const { f, calls } = fakeFetch();
    const m = new WhatsAppMessenger({ token: "WT", phoneNumberId: "PNID", fetch: f });
    await m.sendProposal("wa:359888123456", "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?", "abc", "en");
    expect(calls[0].json).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "359888123456", type: "interactive", interactive: { type: "button", body: { text: "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?" }, action: { buttons: [
      { type: "reply", reply: { id: "cs:apply:abc", title: "✅ Apply" } }, { type: "reply", reply: { id: "cs:change:abc", title: "✏️ Change" } }, { type: "reply", reply: { id: "cs:cancel:abc", title: "❌ Cancel" } } ] } } });
    await m.sendProposal("wa:359888123456", "• " + "x".repeat(1100) + "\n\nДа приложа ли?", "abc", "bg");
    expect(calls[1].json.type).toBe("text");
    expect((calls[2].json.interactive as { body: { text: string } }).body.text).toBe("Да приложа ли?");
  });
  it("typing marks the inbound message read with a typing indicator, and is skipped without one", async () => {
    const { f, calls } = fakeFetch();
    const m = new WhatsAppMessenger({ token: "WT", phoneNumberId: "PNID", fetch: f });
    await m.typing("wa:359888123456");
    expect(calls).toHaveLength(0);
    await m.typing("wa:359888123456", "wamid.in1");
    expect(calls[0].json).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.in1", typing_indicator: { type: "text" } });
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/meta-send.test.ts test/whatsapp-send.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/channels/text.ts`:
```ts
export function splitText(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
/** A proposal is "<preview>\n\n<question>"; when it does not fit, the preview goes first as plain text and only the question carries the buttons. */
export function proposalParts(text: string, max: number): { lead: string | null; ask: string } {
  if (text.length <= max) return { lead: null, ask: text };
  const i = text.lastIndexOf("\n\n");
  if (i <= 0) return { lead: text.slice(0, -max).trim() || null, ask: text.slice(-max).trim() };
  return { lead: text.slice(0, i).trim(), ask: text.slice(i + 2).trim() };
}
```
`src/channels/meta/graph.ts` add:
```ts
export async function graphPost(fetchFn: typeof fetch, path: string, token: string, body: unknown, what: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchFn(`${GRAPH}/${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error ?? {}) as Record<string, unknown>;
      console.error(`[meta] ${what} failed HTTP ${res.status} code=${err.code ?? "?"} subcode=${err.error_subcode ?? "?"}`);
      return null;
    }
    return json;
  } catch (e) {
    console.error(`[meta] ${what} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
```
`src/channels/meta/send.ts`:
```ts
import { proposalButtons, type Messenger, type SendOpts } from "../../bot/messenger";
import type { Lang } from "../../domain/types";
import { parseRef } from "../ref";
import { splitText, proposalParts } from "../text";
import { graphPost } from "./graph";

const TEXT_MAX = 2000;   // Messenger limit; Instagram allows 1000, so Instagram refs use 1000
const BUTTON_TEXT_MAX = 640;

export class MetaMessenger implements Messenger {
  private fetchFn: typeof fetch;
  constructor(private o: { pageToken: string; fetch?: typeof fetch }) { this.fetchFn = o.fetch ?? fetch; }
  private post(body: unknown, what: string) { return graphPost(this.fetchFn, "me/messages", this.o.pageToken, body, what); }
  private max(chatRef: string) { return parseRef(chatRef).channel === "ig" ? 1000 : TEXT_MAX; }

  async send(chatRef: string, text: string, _opts?: SendOpts): Promise<string | null> {
    const id = parseRef(chatRef).id;
    let last: string | null = null;
    for (const chunk of splitText(text, this.max(chatRef))) {
      const r = await this.post({ recipient: { id }, messaging_type: "RESPONSE", message: { text: chunk } }, "send");
      if (!r) return null;
      last = typeof r.message_id === "string" ? r.message_id : last;
    }
    return last;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null> {
    const id = parseRef(chatRef).id;
    const { lead, ask } = proposalParts(text, BUTTON_TEXT_MAX);
    if (lead && (await this.send(chatRef, lead)) === null) return null;
    const buttons = proposalButtons(lang).map((b) => ({ type: "postback", title: b.label, payload: `cs:${b.id}:${setId}` }));
    const r = await this.post({ recipient: { id }, messaging_type: "RESPONSE", message: { attachment: { type: "template", payload: { template_type: "button", text: ask, buttons } } } }, "sendProposal");
    return r && typeof r.message_id === "string" ? r.message_id : null;
  }
  async conclude(chatRef: string, _messageRef: string | null, _full: string, short: string, opts?: SendOpts): Promise<void> {
    await this.send(chatRef, short, opts);
  }
  async typing(chatRef: string): Promise<void> {
    await this.post({ recipient: { id: parseRef(chatRef).id }, sender_action: "typing_on" }, "typing");
  }
}
```
`src/channels/whatsapp/send.ts`:
```ts
import { proposalButtons, type Messenger, type SendOpts } from "../../bot/messenger";
import type { Lang } from "../../domain/types";
import { graphPost } from "../meta/graph";
import { parseRef } from "../ref";
import { proposalParts, splitText } from "../text";

const TEXT_MAX = 4096;
const BODY_MAX = 1024;

export class WhatsAppMessenger implements Messenger {
  private fetchFn: typeof fetch;
  constructor(private o: { token: string; phoneNumberId: string; fetch?: typeof fetch }) { this.fetchFn = o.fetch ?? fetch; }
  private post(body: Record<string, unknown>, what: string) {
    return graphPost(this.fetchFn, `${this.o.phoneNumberId}/messages`, this.o.token, { messaging_product: "whatsapp", ...body }, what);
  }
  private static id(r: Record<string, unknown> | null): string | null {
    const first = r && Array.isArray(r.messages) ? (r.messages[0] as Record<string, unknown> | undefined) : undefined;
    return first && typeof first.id === "string" ? first.id : null;
  }
  async send(chatRef: string, text: string, _opts?: SendOpts): Promise<string | null> {
    const to = parseRef(chatRef).id;
    let last: string | null = null;
    for (const chunk of splitText(text, TEXT_MAX)) {
      const r = await this.post({ recipient_type: "individual", to, type: "text", text: { body: chunk, preview_url: false } }, "send");
      if (!r) return null;
      last = WhatsAppMessenger.id(r) ?? last;
    }
    return last;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null> {
    const to = parseRef(chatRef).id;
    const { lead, ask } = proposalParts(text, BODY_MAX);
    if (lead && (await this.send(chatRef, lead)) === null) return null;
    const buttons = proposalButtons(lang).map((b) => ({ type: "reply", reply: { id: `cs:${b.id}:${setId}`, title: b.label.slice(0, 20) } }));
    return WhatsAppMessenger.id(await this.post({ recipient_type: "individual", to, type: "interactive", interactive: { type: "button", body: { text: ask }, action: { buttons } } }, "sendProposal"));
  }
  async conclude(chatRef: string, _messageRef: string | null, _full: string, short: string, opts?: SendOpts): Promise<void> {
    await this.send(chatRef, short, opts);
  }
  async typing(_chatRef: string, inReplyTo?: string): Promise<void> {
    if (!inReplyTo) return;
    await this.post({ status: "read", message_id: inReplyTo, typing_indicator: { type: "text" } }, "typing");
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run test/meta-send.test.ts test/whatsapp-send.test.ts && npm run typecheck && npm run lint` → green.

- [ ] **Step 5: Commit** — `git add -A && git -c … commit -m "Channels: Meta (Messenger+Instagram) and WhatsApp senders with buttons and splitting\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 7: `ChannelRouter` with the 24 h rule; server wiring; console adapter for offline mode

**Files:**
- Create: `src/channels/router.ts`, `src/channels/console.ts`, `test/router.test.ts`
- Modify: `src/server/deps.ts`, `scripts/smoke.mts`, `scripts/e2e-offline.mts` (use `ConsoleMessenger` from `src/channels/console.ts` instead of their local copies)
- Test: `test/server-deps.test.ts`

**Interfaces:**
- Produces:
```ts
export class ChannelRouter implements Messenger { constructor(o: { store: Store; now: () => Date; adapters: Partial<Record<Channel, Messenger>> }) }
export const PROACTIVE_WINDOW_MS = 23 * 3_600_000;
export class ConsoleMessenger implements Messenger { constructor(log?: (line: string) => void) }  // prints "→ [ref] text", "→ [ref] text  [✅ …][✏️ …][❌ …]", "✎ [ref#messageRef] short"; messageRef "c1", "c2", …
// ServerDeps gains: botDeps: BotDeps; waDownload: MediaFetch; fetchUrl: MediaFetch
```

- [ ] **Step 1: Failing router tests**

```ts
// test/router.test.ts
import { describe, expect, it } from "vitest";
import { ChannelRouter } from "@/src/channels/router";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("ChannelRouter", () => {
  it("dispatches by prefix and drops refs of unconfigured channels with one log line", async () => {
    const { store, venue } = await makeDemo();
    const tg = new FakeMessenger(); const fb = new FakeMessenger();
    const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const r = new ChannelRouter({ store, now: () => T0, adapters: { tg, fb, ig: fb } });
      expect(await r.send("tg:1001", "a")).toBe("100");
      expect(await r.send("ig:5", "b")).toBe("100");
      expect(await r.send("wa:359", "c")).toBeNull();
      expect(await r.send("wa:359", "d")).toBeNull();
      await r.conclude("fb:5", "m1", "full", "short");
      await r.typing("tg:1001", "7");
      expect(tg.sent.map((s) => s.text)).toEqual(["a"]);
      expect(fb.sent.map((s) => s.text)).toEqual(["b"]);
      expect(fb.concluded[0]).toMatchObject({ chatRef: "fb:5", short: "short" });
      expect(tg.typed).toEqual(["tg:1001"]);
      expect(logs.filter((l) => l.includes("no adapter for channel wa"))).toHaveLength(1);
    } finally { console.error = orig; }
    void venue;
  });
  it("sends proactive messages on Meta channels only within 23 h of the owner's last message", async () => {
    const { store, venue } = await makeDemo();
    const fb = new FakeMessenger(); const tg = new FakeMessenger();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:5", role: "owner", lang: "bg", last_seen_at: "2026-10-09T08:00:00.000Z" });
    const r = new ChannelRouter({ store, now: () => T0, adapters: { tg, fb } });
    expect(await r.send("fb:5", "reminder", { proactive: true })).toBe("100");
    await store.touchMember("fb:5", "2026-10-08T09:30:00.000Z"); // 23.5 h ago
    expect(await r.send("fb:5", "reminder2", { proactive: true })).toBeNull();
    await r.conclude("fb:5", null, "full", "expired", { proactive: true });
    expect(fb.sent.map((s) => s.text)).toEqual(["reminder"]);
    expect(fb.concluded).toEqual([]);
    expect(await r.send("fb:5", "reply", {})).toBe("101"); // not proactive: always sent
    expect(await r.send("tg:1001", "tg reminder", { proactive: true })).toBe("100"); // Telegram: no window
    expect(await r.send("fb:unknown", "x", { proactive: true })).toBeNull(); // no member: skipped
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/router.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/channels/router.ts`:
```ts
import type { Messenger, SendOpts } from "../bot/messenger";
import type { Lang } from "../domain/types";
import type { Store } from "../store/types";
import { channelOf, isMetaChannel, type Channel } from "./ref";

/** Meta's customer-service window is 24 h; one hour of margin. */
export const PROACTIVE_WINDOW_MS = 23 * 3_600_000;

export class ChannelRouter implements Messenger {
  private warned = new Set<Channel>();
  constructor(private o: { store: Store; now: () => Date; adapters: Partial<Record<Channel, Messenger>> }) {}
  private pick(chatRef: string): Messenger | null {
    const ch = channelOf(chatRef);
    const a = this.o.adapters[ch];
    if (!a && !this.warned.has(ch)) { this.warned.add(ch); console.error(`[router] no adapter for channel ${ch}; messages to it are dropped`); }
    return a ?? null;
  }
  private async allowed(chatRef: string, opts?: SendOpts): Promise<boolean> {
    if (!opts?.proactive || !isMetaChannel(channelOf(chatRef))) return true;
    const m = await this.o.store.findMember(chatRef);
    const seen = m?.last_seen_at ? Date.parse(m.last_seen_at) : Number.NEGATIVE_INFINITY;
    if (this.o.now().getTime() - seen <= PROACTIVE_WINDOW_MS) return true;
    console.log(`[router] skipped proactive ${chatRef}: outside 24h window`);
    return false;
  }
  async send(chatRef: string, text: string, opts?: SendOpts) {
    const a = this.pick(chatRef);
    if (!a || !(await this.allowed(chatRef, opts))) return null;
    return a.send(chatRef, text, opts);
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang) {
    return this.pick(chatRef)?.sendProposal(chatRef, text, setId, lang) ?? null;
  }
  async conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: SendOpts) {
    const a = this.pick(chatRef);
    if (a && (await this.allowed(chatRef, opts))) await a.conclude(chatRef, messageRef, full, short, opts);
  }
  async typing(chatRef: string, inReplyTo?: string) {
    await this.pick(chatRef)?.typing(chatRef, inReplyTo);
  }
}
```
`src/channels/console.ts`:
```ts
import { proposalButtons, type Messenger, type SendOpts } from "../bot/messenger";
import type { Lang } from "../domain/types";
/** Prints instead of sending: offline e2e, smoke --dry, and the Meta channels in memory mode when no tokens are set. */
export class ConsoleMessenger implements Messenger {
  private n = 0;
  constructor(private log: (line: string) => void = (l) => console.log(l)) {}
  async send(chatRef: string, text: string, _o?: SendOpts) { this.log(`→ [${chatRef}] ${text}`); return `c${++this.n}`; }
  async sendProposal(chatRef: string, text: string, _setId: string, lang: Lang) { this.log(`→ [${chatRef}] ${text}\n   ${proposalButtons(lang).map((b) => `[${b.label}]`).join(" ")}`); return `c${++this.n}`; }
  async conclude(chatRef: string, messageRef: string | null, _full: string, short: string) { this.log(`✎ [${chatRef}#${messageRef ?? "-"}] ${short}`); }
  async typing() {}
}
```
`src/server/deps.ts`: build adapters after `createBot`:
```ts
  const adapters: Partial<Record<Channel, Messenger>> = { tg: new TelegramMessenger(bot.api) };
  if (config.metaPageToken) adapters.fb = adapters.ig = new MetaMessenger({ pageToken: config.metaPageToken });
  if (config.whatsappToken && config.whatsappPhoneNumberId) adapters.wa = new WhatsAppMessenger({ token: config.whatsappToken, phoneNumberId: config.whatsappPhoneNumberId });
  if (isMemory) for (const ch of ["fb", "ig", "wa"] as const) adapters[ch] ??= new ConsoleMessenger(log);
  const messenger = new ChannelRouter({ store: s, now: () => new Date(), adapters });
  botDeps.messenger = messenger;
  const waDownload: MediaFetch = (mediaId) => downloadWhatsAppMedia(config.whatsappToken ?? "", mediaId);
  const fetchUrl: MediaFetch = (url) => downloadUrl(url);
```
with, in `src/channels/meta/graph.ts`:
```ts
export async function downloadUrl(url: string, fetchFn: typeof fetch = fetch, headers: Record<string, string> = {}): Promise<{ bytes: Uint8Array; contentType: string; name?: string }> {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error(`file too large (${bytes.byteLength} bytes)`);
  return { bytes, contentType: res.headers.get("content-type") ?? "application/octet-stream", name: new URL(url).pathname.split("/").pop() };
}
/** WhatsApp media: GET /{id} → { url }, then GET url with the bearer token (URL valid 5 minutes). */
export async function downloadWhatsAppMedia(token: string, mediaId: string, fetchFn: typeof fetch = fetch) {
  const meta = await fetchFn(`${GRAPH}/${mediaId}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!meta.ok) throw new Error(`media lookup failed (HTTP ${meta.status})`);
  const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
  if (!url) throw new Error("media lookup returned no url");
  const dl = await downloadUrl(url, fetchFn, { authorization: `Bearer ${token}` });
  return { ...dl, contentType: mime_type ?? dl.contentType };
}
```
`ServerDeps` gains `botDeps`, `waDownload`, `fetchUrl`; return them. Replace the three local console messenger classes in `scripts/smoke.mts` and `scripts/e2e-offline.mts` with `new ConsoleMessenger()`. Add to `test/server-deps.test.ts`: with `env: { SITE_MANAGER_STORE: "memory", DEMO_OWNER_CHAT_REF: "fb:4242" }`, `findMember("fb:4242")` is the owner and `await deps.messenger.send("fb:4242", "hi")` returns `"c1"` while the log contains `→ [fb:4242] hi`.

- [ ] **Step 4: Run** — `npm test && npm run typecheck && npm run lint && npm run e2e` → green.

- [ ] **Step 5: Commit** — `git add -A && git -c … commit -m "Channels: router with the 24h rule, console adapter, server wiring\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 8: `/api/meta` webhook: verify, signature, dedupe, deferred processing

**Files:**
- Create: `src/server/meta.ts`, `app/api/meta/route.ts`, `test/meta-server.test.ts`

**Interfaces:**
- Produces:
```ts
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean;
export interface MetaServerDeps { config: Pick<Config, "metaAppSecret" | "metaVerifyToken">; botDeps: BotDeps; handleRun: (r: RunRequest) => Promise<void>; defer: (fn: () => Promise<void>) => void; waDownload: MediaFetch; fetchUrl: MediaFetch }
export async function handleMetaRequest(req: Request, deps: MetaServerDeps): Promise<Response>;
export function resetDedupe(): void;  // tests only
```

- [ ] **Step 1: Failing tests**

```ts
// test/meta-server.test.ts
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { BotDeps, RunRequest } from "@/src/bot/bot";
import { handleMetaRequest, resetDedupe, verifySignature } from "@/src/server/meta";
import { FakeMessenger, makeDemo } from "./helpers";

const SECRET = "app-secret";
const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
const text = (mid: string, body: string, sender = "500") => JSON.stringify({ object: "page", entry: [{ id: "P", time: 1, messaging: [{ sender: { id: sender }, recipient: { id: "P" }, timestamp: 1, message: { mid, text: body } }] }] });

async function setup() {
  const demo = await makeDemo();
  await demo.store.upsertMember({ venue_id: demo.venue.id, chat_ref: "fb:500", role: "owner", lang: "bg" });
  const runs: RunRequest[] = []; const deferred: Promise<void>[] = [];
  const messenger = new FakeMessenger();
  const botDeps: BotDeps = { token: "t", store: demo.store, messenger, baseUrl: "http://x", now: () => new Date("2026-10-09T09:00:00.000Z"), startRun: () => { throw new Error("meta path must not use startRun"); }, transcribe: null, download: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
  const deps = { config: { metaAppSecret: SECRET, metaVerifyToken: "verify-me" }, botDeps, handleRun: async (r: RunRequest) => { runs.push(r); }, defer: (fn: () => Promise<void>) => { deferred.push(fn()); }, waDownload: async () => ({ bytes: new Uint8Array(), contentType: "" }), fetchUrl: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
  const post = (body: string, sig: string | null = sign(body)) => handleMetaRequest(new Request("http://localhost/api/meta", { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-hub-signature-256": sig } : {}) }, body }), deps);
  return { ...demo, runs, deferred, messenger, deps, post };
}

beforeEach(() => resetDedupe());

describe("handleMetaRequest", () => {
  it("answers the verification handshake only with the right token", async () => {
    const { deps } = await setup();
    const ok = await handleMetaRequest(new Request("http://x/api/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"), deps);
    expect(ok.status).toBe(200); expect(await ok.text()).toBe("12345");
    expect((await handleMetaRequest(new Request("http://x/api/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"), deps)).status).toBe(403);
    expect((await handleMetaRequest(new Request("http://x/api/meta?hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), { ...deps, config: { metaAppSecret: SECRET, metaVerifyToken: null } })).status).toBe(403);
  });
  it("rejects bad signatures, processes good ones after responding, and dedupes redeliveries (Review Focus 5)", async () => {
    const { post, runs, deferred } = await setup();
    const body = text("m1", "Капучиното става 3,20");
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, "sha256=deadbeef")).status).toBe(401);
    const ok = await post(body);
    expect(ok.status).toBe(200); expect(await ok.text()).toBe("EVENT_RECEIVED");
    await Promise.all(deferred);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ chatRef: "fb:500", text: "Капучиното става 3,20", source: "text" });
    await post(body); await Promise.all(deferred);
    expect(runs).toHaveLength(1);
    await post(text("m2", "второ")); await Promise.all(deferred);
    expect(runs).toHaveLength(2);
  });
  it("returns 400 on a non-JSON body and 401 when no secret is configured", async () => {
    const { deps } = await setup();
    const bad = new Request("http://x/api/meta", { method: "POST", headers: { "x-hub-signature-256": sign("nope") }, body: "nope" });
    expect((await handleMetaRequest(bad, deps)).status).toBe(400);
    const noSecret = new Request("http://x/api/meta", { method: "POST", headers: { "x-hub-signature-256": sign("{}") }, body: "{}" });
    expect((await handleMetaRequest(noSecret, { ...deps, config: { metaAppSecret: null, metaVerifyToken: "v" } })).status).toBe(401);
  });
  it("verifySignature is constant-time safe on length mismatch", () => {
    expect(verifySignature("abc", "sha256=00", SECRET)).toBe(false);
    expect(verifySignature("abc", null, SECRET)).toBe(false);
    expect(verifySignature("abc", sign("abc"), SECRET)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/meta-server.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/server/meta.ts`:
```ts
// src/server/meta.ts
// One webhook for Messenger, Instagram and WhatsApp. GET = Meta's verification handshake; POST = events, verified with X-Hub-Signature-256,
// acknowledged at once and processed in the deferred callback (Meta retries anything slower than ~20 s).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BotDeps, RunRequest } from "../bot/bot";
import { handleInbound } from "../bot/inbound";
import type { MediaFetch } from "../channels/meta/graph";
import { parseMetaWebhook } from "../channels/meta/parse";
import type { Config } from "../config";

export interface MetaServerDeps {
  config: Pick<Config, "metaAppSecret" | "metaVerifyToken">;
  botDeps: BotDeps;
  handleRun: (r: RunRequest) => Promise<void>;
  defer: (fn: () => Promise<void>) => void;
  waDownload: MediaFetch;
  fetchUrl: MediaFetch;
}

export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const DEDUPE_MAX = 500;
let seen = new Set<string>();
function isNew(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > DEDUPE_MAX) seen = new Set([...seen].slice(seen.size - DEDUPE_MAX));
  return true;
}
export function resetDedupe(): void { seen = new Set(); }

export async function handleMetaRequest(req: Request, deps: MetaServerDeps): Promise<Response> {
  if (req.method === "GET") {
    const u = new URL(req.url);
    const token = deps.config.metaVerifyToken;
    if (u.searchParams.get("hub.mode") === "subscribe" && token && u.searchParams.get("hub.verify_token") === token) {
      return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }
  const raw = await req.text();
  if (!deps.config.metaAppSecret || !verifySignature(raw, req.headers.get("x-hub-signature-256"), deps.config.metaAppSecret)) return new Response("unauthorized", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }
  const messages = parseMetaWebhook(body, { waDownload: deps.waDownload, fetchUrl: deps.fetchUrl }).filter((m) => !m.eventId || isNew(m.eventId));
  if (messages.length) {
    deps.defer(async () => {
      // The agent turn is awaited inside this same deferred callback, so nothing is left floating when the function instance is frozen.
      const runs: Promise<void>[] = [];
      const d: BotDeps = { ...deps.botDeps, startRun: (r) => { runs.push(deps.handleRun(r)); } };
      for (const m of messages) {
        try { await handleInbound(d, m); } catch (e) { console.error("[meta] inbound failed:", e instanceof Error ? e.message : e); }
      }
      await Promise.all(runs);
    });
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}
```
`app/api/meta/route.ts`:
```ts
// app/api/meta/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleMetaRequest } from "@/src/server/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleMetaRequest(req, { config: deps.config, botDeps: deps.botDeps, handleRun: deps.handleRun, defer: (fn) => after(fn), waDownload: deps.waDownload, fetchUrl: deps.fetchUrl });
}
export const GET = handle;
export const POST = handle;
```

- [ ] **Step 4: Run** — `npm test && npm run typecheck && npm run lint && npm run build` → green (build confirms the route compiles under Next 16).

- [ ] **Step 5: Commit** — `git add -A && git -c … commit -m "Meta webhook: /api/meta with verification, HMAC check, dedupe and deferred processing\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 9: Scripts `meta:setup`, `meta:sim`; offline e2e leg

**Files:**
- Create: `scripts/meta-setup.mts`, `scripts/meta-sim.mts`
- Modify: `package.json` (scripts), `scripts/e2e-offline.mts`

**Interfaces:**
- Consumes: `loadConfig`, `GRAPH`, `startLinks`, `verifySignature` (for the sim's signing the same way), `handleInbound` through the running `next dev` server.

- [ ] **Step 1: `scripts/meta-setup.mts`**

```ts
// scripts/meta-setup.mts
// npm run meta:setup — checks the Meta tokens, subscribes the Page to this app's webhook fields, prints the webhook URL and the enabled channels. Never prints a token.
import { GRAPH } from "../src/channels/meta/graph";
import { loadConfig } from "../src/config";

const cfg = loadConfig(process.env);
const get = async (path: string, token: string) => {
  const r = await fetch(`${GRAPH}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path.split("?")[0]} → HTTP ${r.status}: ${(j.error as { message?: string } | undefined)?.message ?? "unknown"}`);
  return j;
};
console.log(`webhook URL to paste into the Meta app (Messenger, Instagram and WhatsApp products): ${cfg.publicBaseUrl}/api/meta`);
console.log(`verify token: set (${cfg.metaVerifyToken ? "yes" : "NO — set META_VERIFY_TOKEN"})`);
if (cfg.metaPageToken) {
  const me = await get("me?fields=id,name,instagram_business_account{id,username}", cfg.metaPageToken);
  console.log(`Messenger: Page "${me.name}" (${me.id})`);
  const sub = await fetch(`${GRAPH}/${me.id}/subscribed_apps`, { method: "POST", headers: { authorization: `Bearer ${cfg.metaPageToken}`, "content-type": "application/json" }, body: JSON.stringify({ subscribed_fields: ["messages", "messaging_postbacks", "messaging_referrals"] }) });
  console.log(`Messenger: page subscribed to the app webhook → HTTP ${sub.status}`);
  const ig = me.instagram_business_account as { id: string; username: string } | undefined;
  console.log(ig ? `Instagram: @${ig.username} (${ig.id}) linked to the Page` : "Instagram: no professional account linked to this Page (link it in Page settings → Linked accounts)");
} else console.log("Messenger/Instagram: disabled (META_PAGE_TOKEN not set)");
if (cfg.whatsappToken && cfg.whatsappPhoneNumberId) {
  const n = await get(`${cfg.whatsappPhoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, cfg.whatsappToken);
  console.log(`WhatsApp: ${n.display_phone_number} (${n.verified_name ?? "test number"}), quality ${n.quality_rating ?? "n/a"}`);
} else console.log("WhatsApp: disabled (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set)");
```

- [ ] **Step 2: `scripts/meta-sim.mts`**

```ts
// scripts/meta-sim.mts
// Posts a signed fake Meta webhook to a local server, so the whole path runs offline against the memory store:
//   npm run dev:offline   (with META_APP_SECRET, META_VERIFY_TOKEN and DEMO_OWNER_CHAT_REF=fb:4242 in .env.local)
//   npm run meta:sim -- fb text "Капучиното става 3,20"      npm run meta:sim -- wa button cs:apply:<id>      npm run meta:sim -- ig text "menu"
// Replies appear in the dev server's terminal as "→ [fb:4242] …" (ConsoleMessenger). Options: --sender <id> (default 4242), --url (default http://localhost:3000/api/meta).
import { createHmac } from "node:crypto";

const [channel, kind, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const opt = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const sender = opt("sender", "4242");
const url = opt("url", "http://localhost:3000/api/meta");
const secret = process.env.META_APP_SECRET?.trim();
if (!secret || !["fb", "ig", "wa"].includes(channel) || !["text", "button"].includes(kind) || rest.length === 0) {
  console.error('Usage: npm run meta:sim -- fb|ig|wa text|button "<text or cs:apply:<id>>" [--sender 4242]  (META_APP_SECRET must be set)');
  process.exit(1);
}
const payload = rest.join(" ");
const mid = `sim-${Date.now()}`;
const body = channel === "wa"
  ? { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "1", phone_number_id: "PNID" }, contacts: [{ profile: { name: "Sim" }, wa_id: sender }],
      messages: [kind === "text" ? { from: sender, id: mid, timestamp: "1", type: "text", text: { body: payload } } : { from: sender, id: mid, timestamp: "1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: payload, title: "sim" } } }] } }] }] }
  : { object: channel === "ig" ? "instagram" : "page", entry: [{ id: "PAGE", time: 1, messaging: [kind === "text" ? { sender: { id: sender }, recipient: { id: "PAGE" }, timestamp: 1, message: { mid, text: payload } } : { sender: { id: sender }, recipient: { id: "PAGE" }, timestamp: 1, postback: { mid, title: "sim", payload } }] }] };
const raw = JSON.stringify(body);
const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
console.log(`${res.status} ${await res.text()}  (${channel}:${sender} ${kind} ${mid})`);
```
`package.json` scripts: `"meta:setup": "tsx --env-file-if-exists=.env.local scripts/meta-setup.mts"`, `"meta:sim": "tsx --env-file-if-exists=.env.local scripts/meta-sim.mts"`.

- [ ] **Step 3: e2e leg**

Append to `scripts/e2e-offline.mts`, after the existing legs (uses the same `store`, `venue`, `clock` and an `expect`-style helper the script already has; mirror its style for failures → `process.exit(1)`):
```ts
// Meta leg: a Messenger owner links with a bare code, proposes, taps apply; a proactive reminder is skipped after 25 h of silence.
import { handleInbound } from "../src/bot/inbound";
import { ChannelRouter } from "../src/channels/router";
const fbLog: string[] = [];
const router = new ChannelRouter({ store, now: clock, adapters: { fb: new ConsoleMessenger((l) => fbLog.push(l)) } });
const botDeps = { token: "t", store, messenger: router, baseUrl: "http://localhost:3000", now: clock, startRun: () => undefined, transcribe: null, download: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
const code = await store.createInvite(venue.id, "owner", new Date(clock().getTime() + 86_400_000).toISOString());
await handleInbound(botDeps, { chatRef: "fb:4242", kind: "text", text: code });
check(fbLog.at(-1)?.includes("Свързахте се като собственик") === true, "fb owner linked with a bare code");
const metaCs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "fb:4242", summary_bg: "Чай 2,20 €", summary_en: "Tea €2.20", preview_bg: "• Чай: 2,00 € → 2,20 €", preview_en: "• Tea", source: "text", status: "proposed", changes: [] });
await handleInbound(botDeps, { chatRef: "fb:4242", kind: "button", text: `cs:apply:${metaCs.id}` });
check((await store.getChangeSet(metaCs.id)).status === "applied" && fbLog.at(-1)?.includes("✅ Приложено") === true, "fb apply tap concluded");
check((await router.send("fb:4242", "reminder", { proactive: true })) !== null, "proactive inside the window is sent");
await store.touchMember("fb:4242", new Date(clock().getTime() - 25 * 3_600_000).toISOString());
check((await router.send("fb:4242", "reminder", { proactive: true })) === null, "proactive after 25 h is skipped");
```
(`check(cond, label)` — if the script has a different assertion helper, use that one; `clock` is the script's clock function.)

- [ ] **Step 4: Run** — `npm run e2e && npm run typecheck && npm run lint` → green; then a manual offline round trip: add `META_APP_SECRET`, `META_VERIFY_TOKEN` (any `openssl rand -hex 16` values) and `DEMO_OWNER_CHAT_REF=fb:4242` to `.env.local`, run `npm run dev:offline` in one terminal and `npm run meta:sim -- fb text "help"` in another; the dev terminal shows `→ [fb:4242] Tell me what to change…`/BG help with command words.

- [ ] **Step 5: Commit** — `git add -A && git -c … commit -m "Scripts: meta:setup, meta:sim; offline e2e leg for a Messenger owner\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 10: Docs, README, preview deployment, live test

**Files:**
- Create: `docs/CHANNELS.md`
- Modify: `README.md` (new section "Channels: Telegram, Messenger, Instagram, WhatsApp" after "Real mode"; env table rows; demo checklist line), `docs/superpowers/plans/2026-10-10-site-manager-templates.md` (one note under the done-page task: "render `startLinks(config, code)` next to the Telegram QR, see `src/channels/links.ts`")

- [ ] **Step 1: Write `docs/CHANNELS.md`** with the eight onboarding steps from the spec ("Onboarding guide"), each step naming the exact Meta UI path, which env key it yields and the `npm run env:set -- KEY` command, plus: the 24 h rule in owner-facing words, what Testers are and that the owner must accept the invitation, the App Review step and its ~20-day cycle, the WhatsApp test-number limits (5 recipients), and the Vercel preview flow:
```bash
cp ../site-manager/.vercel/project.json .vercel/project.json   # link the worktree to the same Vercel project (dir is git-ignored)
for k in $(grep -v '^#' .env.local | cut -d= -f1); do grep "^$k=" .env.local | cut -d= -f2- | vercel env add "$k" preview --force >/dev/null; done
vercel --yes            # preview deployment; prints the URL
vercel env add PUBLIC_BASE_URL preview --force   # paste the preview URL when prompted
vercel --yes            # redeploy so admin links use it
npm run meta:setup      # with PUBLIC_BASE_URL pointing at the preview
```
and the Bulgarian summary at the end (10 lines).

- [ ] **Step 2: README and templates-plan note** as listed in Files. README demo checklist gains: "Messenger/Instagram/WhatsApp: the owner's account is a Tester on the Meta app; send the code via the deep link from `venue:create`."

- [ ] **Step 3: Preview deployment** following the commands above. Confirm with `curl -s "<preview>/api/meta?hub.mode=subscribe&hub.verify_token=<META_VERIFY_TOKEN from .env.local via $(grep …)>&hub.challenge=ping"` → `ping`. Do not set the Telegram webhook to the preview.

- [ ] **Step 4: Live test** (needs the user's Meta assets; if they are not ready, record the exact blocking step in the SDD ledger and finish the rest): paste the webhook URL and verify token in the Meta app for Messenger, Instagram and WhatsApp; `npm run meta:setup`; `npm run venue:create -- --name "Тест Канали" --slug kanali-test`; from the owner's phone open the Messenger link, then Instagram, then WhatsApp (test-number recipient): each links, "Капучиното става 3,20" → three-button proposal → tap → "✅ Приложено" and the site at `/kanali-test` updates; one voice note and one photo per channel; dashboard undo while inside the window arrives on the channel. Record results in README "What is verified" / "What is not verified".

- [ ] **Step 5: Commit** — `git add -A && git -c … commit -m "Docs: channel onboarding guide, README channels section, preview deployment notes\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 11: Phase-2 migration (run after merge)

**Files:**
- Create: `supabase/migrations/2026-10-11-drop-legacy-chat-ids.sql`

- [ ] **Step 1: Write the file**

```sql
-- Phase 2 of the channel identity change. Run ONLY after main carries build/channels and production is redeployed.
-- Removes the bigint columns the Telegram-only build used. Idempotent.
drop index if exists public.venue_members_tg_chat_id_key;
alter table public.venue_members drop column if exists tg_chat_id;
alter table public.change_sets drop column if exists chat_id, drop column if exists tg_message_id;
drop index if exists public.conversations_chat_id_key;
alter table public.conversations drop column if exists chat_id;
notify pgrst, 'reload schema';
```
Add a "Phase 2 (after merge)" paragraph to `docs/CHANNELS.md`: run `npm run db:apply -- supabase/migrations/2026-10-11-drop-legacy-chat-ids.sql`, then delete the three `// legacy` lines in `src/store/supabase.ts` (`legacyColumns`, the `tg_chat_id` in `upsertMember`, the `chat_id` in `setConversation`), the legacy columns in `supabase/schema.sql`, `legacyTelegramId` in `src/channels/ref.ts`, and their tests.

- [ ] **Step 2: Commit** — `git add -A && git -c … commit -m "SQL: phase-2 migration dropping legacy Telegram id columns (run after merge)\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

## Self-review notes

- Spec coverage: identity (T1), Messenger interface and 24 h rule (T2, T7), inbound core and Telegram translator (T3), config/links (T4), parser (T5), senders (T6), router/wiring (T7), webhook (T8), scripts and e2e (T9), docs/deploy/live (T10), phase 2 (T11). Templates done-page rendering is a note only, as the spec says.
- Contract amendment: `parseMetaWebhook` returns `InboundMessage[]` with `eventId` (T5 updates the spec). `MediaFetch` lives in `src/channels/meta/graph.ts` and may return `name`.
- Type consistency: `conclude(chatRef, messageRef | null, full, short, opts?)` everywhere; `typing(chatRef, inReplyTo?)`; `RunRequest.chatRef`; `Member.last_seen_at`; `legacyColumns` only in the Supabase store.
