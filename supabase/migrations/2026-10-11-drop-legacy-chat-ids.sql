-- Phase 2 of the channel identity change. Run ONLY after main carries build/channels and production is redeployed.
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
