-- What an own-site venue's website is built with (2026-10-19, docs/superpowers/plans/2026-10-19-getclaudia-onboarding.md, Task 5): asked at
-- onboarding ("I already have a website"), it decides how the checklist connects the site (WordPress plugin, or a menu-page link for the rest).
-- null for every other venue. Server-only like site_url and site_mode: not in the anon column grant list (policies.sql).
-- Safe to re-run. schema.sql carries the same statements.
--   npm run db:apply -- supabase/migrations/2026-10-19-site-platform.sql
alter table public.venues add column if not exists site_platform text;
alter table public.venues drop constraint if exists venues_site_platform_check;
alter table public.venues add constraint venues_site_platform_check check (site_platform is null or site_platform in ('wordpress', 'wix', 'squarespace', 'shopify', 'other', 'unknown'));

notify pgrst, 'reload schema';
