-- Saved ad plans (2026-10-18, docs/superpowers/plans/2026-10-18-boost-proposals.md, Task 4): propose_boost's change rows have
-- entity 'boost_plan'. The plan lives in the change row itself (no table); applying it writes nothing. Idempotent; schema-integrations.sql
-- carries the same constraint.
--   npm run db:apply -- supabase/migrations/2026-10-18-boost-plan-entity.sql
alter table public.changes drop constraint if exists changes_entity_check;
alter table public.changes add constraint changes_entity_check
  check (entity in ('venue', 'category', 'item', 'holiday', 'announcement', 'media', 'site_text', 'wp_page', 'wp_media', 'wp_option', 'wp_menu', 'wp_product', 'social_post', 'social_reply', 'social_moderate', 'boost_plan'));

notify pgrst, 'reload schema';
