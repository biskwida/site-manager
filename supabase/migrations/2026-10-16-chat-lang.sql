-- Any conversation language (2026-10-16, docs/superpowers/plans/2026-10-16-conversation-language.md).
-- 1) venue_members.lang holds the lower-case ISO 639-1 code of the member's last message that showed a language ("bg", "en",
--    "de", "el", …), not only bg/en. Every existing row ('bg' or 'en') already passes the new check.
-- 2) translations: Claudia's fixed texts translated into the other conversation languages, one row per language and source text,
--    written once and then reused. Server-only: RLS on, no policies, nothing granted to anon/authenticated.
-- Run it BEFORE deploying the code that writes other languages: until then the old check refuses them, and linking a Telegram
-- user whose app is set to, say, Portuguese fails. Idempotent; schema.sql and policies.sql carry the same statements.
--   npm run db:apply -- supabase/migrations/2026-10-16-chat-lang.sql
alter table public.venue_members drop constraint if exists venue_members_lang_check;
alter table public.venue_members add constraint venue_members_lang_check check (lang ~ '^[a-z]{2}$');

create table if not exists public.translations (
  lang text not null check (lang ~ '^[a-z]{2}$'),
  source_hash text not null,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (lang, source_hash)
);
alter table public.translations enable row level security;
revoke all on public.translations from anon, authenticated;

notify pgrst, 'reload schema';
