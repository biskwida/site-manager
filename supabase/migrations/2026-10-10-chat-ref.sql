-- Phase 1 of the channel identity change (see docs/superpowers/specs/2026-10-10-site-manager-channels-design.md).
-- Additive: production code that still uses the bigint columns keeps working. Idempotent.
alter table public.venue_members add column if not exists chat_ref text, add column if not exists last_seen_at timestamptz;
update public.venue_members set chat_ref = 'tg:' || tg_chat_id where chat_ref is null;
-- Legacy bridge: production (Telegram-only) still writes the bigint columns. Dropped by migrations/2026-10-11-drop-legacy-chat-ids.sql.
create or replace function public.fill_chat_ref() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'venue_members' then
    if new.chat_ref is null and new.tg_chat_id is not null then new.chat_ref := 'tg:' || new.tg_chat_id; end if;
  elsif tg_table_name = 'change_sets' then
    if new.chat_ref is null and new.chat_id is not null then new.chat_ref := 'tg:' || new.chat_id; end if;
    if new.message_ref is null and new.tg_message_id is not null then new.message_ref := new.tg_message_id::text; end if;
  elsif tg_table_name = 'conversations' then
    if new.chat_ref is null and new.chat_id is not null then new.chat_ref := 'tg:' || new.chat_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists fill_chat_ref on public.venue_members;
create trigger fill_chat_ref before insert or update on public.venue_members for each row execute function public.fill_chat_ref();
drop trigger if exists fill_chat_ref on public.change_sets;
create trigger fill_chat_ref before insert or update on public.change_sets for each row execute function public.fill_chat_ref();
drop trigger if exists fill_chat_ref on public.conversations;
create trigger fill_chat_ref before insert or update on public.conversations for each row execute function public.fill_chat_ref();
alter table public.venue_members alter column chat_ref set not null;
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'venue_members_pkey' and conrelid = 'public.venue_members'::regclass
             and pg_get_constraintdef(oid) like '%tg_chat_id%') then
    alter table public.venue_members drop constraint venue_members_pkey;
    alter table public.venue_members add primary key (venue_id, chat_ref);
  end if;
end $$;
alter table public.venue_members alter column tg_chat_id drop not null;
create unique index if not exists venue_members_chat_ref_key on public.venue_members (chat_ref);
create unique index if not exists venue_members_tg_chat_id_key on public.venue_members (venue_id, tg_chat_id);

alter table public.change_sets add column if not exists chat_ref text, add column if not exists message_ref text;
update public.change_sets set chat_ref = 'tg:' || chat_id where chat_id is not null and chat_ref is null;
update public.change_sets set message_ref = tg_message_id::text where tg_message_id is not null and message_ref is null;
create index if not exists change_sets_chat_ref_idx on public.change_sets (venue_id, chat_ref) where status = 'proposed';

alter table public.conversations add column if not exists chat_ref text;
update public.conversations set chat_ref = 'tg:' || chat_id where chat_ref is null;
alter table public.conversations alter column chat_ref set not null;
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'conversations_pkey' and conrelid = 'public.conversations'::regclass
             and pg_get_constraintdef(oid) like '%chat_id%') then
    alter table public.conversations drop constraint conversations_pkey;
    alter table public.conversations add primary key (venue_id, chat_ref);
  end if;
end $$;
alter table public.conversations alter column chat_id drop not null;
create unique index if not exists conversations_chat_id_key on public.conversations (venue_id, chat_id);
notify pgrst, 'reload schema';
