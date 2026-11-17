-- Google reviews (docs/superpowers/plans/2026-11-13-google-business-profile.md, Task 6): a Google review rides the comment pipeline
-- as a third network. social_comments.network accepts 'google'; rating (1-5, reviews only) and review_updated_at (when the reviewer
-- last edited it) are new. Safe to re-run. schema-integrations.sql carries the same statements.
--   npm run db:apply -- supabase/migrations/2026-10-31-google-reviews.sql
alter table public.social_comments drop constraint if exists social_comments_network_check;
alter table public.social_comments add constraint social_comments_network_check check (network in ('facebook', 'instagram', 'google'));
alter table public.social_comments add column if not exists rating smallint check (rating is null or rating between 1 and 5);
alter table public.social_comments add column if not exists review_updated_at timestamptz;

notify pgrst, 'reload schema';
