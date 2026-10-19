-- How a venue was made (2026-10-19, Task 5 fix round 1): operator = by us (venue:create, seeds; the default, so every existing venue),
-- wizard = published from the website wizard, start = created by the owner on /start (an own site or social only).
-- Self-serve own sites ("start") must not turn /<slug> into a redirect to a site an anonymous sign-up typed in (an open redirect), so
-- ownSiteRedirect only redirects operator-made venues. Server-only like site_mode: not in the anon column grant list (policies.sql).
-- Safe to re-run. schema.sql carries the same statements.
--   npm run db:apply -- supabase/migrations/2026-10-19-created-via.sql
alter table public.venues add column if not exists created_via text not null default 'operator';
alter table public.venues drop constraint if exists venues_created_via_check;
alter table public.venues add constraint venues_created_via_check check (created_via in ('operator', 'wizard', 'start'));

notify pgrst, 'reload schema';
