-- AI label (2026-10-24, docs/superpowers/plans/2026-10-24-restyle-photo.md, Task 1): venues.ai_label = label restyled pictures as AI-made
-- (a note in the caption and Instagram's is_ai_generated). Nullable with no default: null reads as off.
-- Server-only like site_url: not in the anon column grant list (policies.sql). Safe to re-run. schema.sql carries the same statement.
--   npm run db:apply -- supabase/migrations/2026-10-24-ai-label.sql
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'venues' and column_name = 'ai_label') then
    alter table public.venues add column ai_label boolean;
  end if;
end $$;

notify pgrst, 'reload schema';
