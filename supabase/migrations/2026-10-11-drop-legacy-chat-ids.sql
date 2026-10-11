-- Phase 2 of the channel identity change. Run order (docs/CHANNELS.md, "Phase 2"):
--   1) merge build/channels and deploy production; 2) move the Meta keys to Production, repoint the three Meta callback URLs, retire the preview;
--   3) deploy the code cleanup (no more legacy writes, legacyTelegramId/legacyColumns gone, legacy parts of schema.sql gone);
--   4) only then run this file. Running it before step 3 makes PostgREST reject every write that still sends the legacy fields (PGRST204).
-- After this has run, never run a bare `npm run db:apply` until the schema.sql cleanup has landed: the old schema.sql re-adds the bridge.
-- Removes the legacy bridge (trigger function and triggers), then the bigint columns the Telegram-only build used.
-- Order matters: the bridge function references the legacy columns, so it goes first. Idempotent.
drop trigger if exists fill_chat_ref on public.venue_members;
drop trigger if exists fill_chat_ref on public.change_sets;
drop trigger if exists fill_chat_ref on public.conversations;
drop function if exists public.fill_chat_ref();

drop index if exists public.venue_members_chat_idx;       -- older unique index on tg_chat_id, still present on databases migrated from the first schema
drop index if exists public.venue_members_tg_chat_id_key;
alter table public.venue_members drop column if exists tg_chat_id;
alter table public.change_sets drop column if exists chat_id, drop column if exists tg_message_id;
drop index if exists public.conversations_chat_id_key;
alter table public.conversations drop column if exists chat_id;
notify pgrst, 'reload schema';
