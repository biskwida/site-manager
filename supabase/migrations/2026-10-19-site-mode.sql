-- Explicit site mode (2026-10-19, docs/superpowers/plans/2026-10-19-getclaudia-onboarding.md, Task 2): replaces the implicit rule
-- "venues.site_url is set = the venue has its own site".
--   claudia = the hosted /<slug> or a template deploy that Claudia builds and runs (the default, and every venue today without a site_url)
--   own     = a site built and hosted elsewhere (site_url) that reads the public feed; no deploy
--   none    = no website (social media only); no deploy, /<slug> still renders the default template with what data exists
-- Server-only like site_url: not in the anon column grant list (policies.sql). Safe to re-run: the backfill runs only when this run adds the
-- column; the constraints are dropped and re-added. schema.sql carries the same statements.
--   npm run db:apply -- supabase/migrations/2026-10-19-site-mode.sql
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'venues' and column_name = 'site_mode') then
    alter table public.venues add column if not exists site_mode text not null default 'claudia';
    -- Only on the run that adds the column: venues that had an own-site URL keep behaving as before. Later runs never touch site_mode,
    -- so a venue the owner moved back to claudia or none is not pulled back to own.
    update public.venues set site_mode='own' where site_url is not null and site_url <> '' and site_mode='claudia';
  end if;
end $$;
alter table public.venues drop constraint if exists venues_site_mode_check;
alter table public.venues add constraint venues_site_mode_check check (site_mode in ('claudia', 'own', 'none'));
alter table public.venues drop constraint if exists venues_site_mode_own_url_check;
alter table public.venues add constraint venues_site_mode_own_url_check check (site_mode <> 'own' or (site_url is not null and site_url <> ''));

notify pgrst, 'reload schema';
