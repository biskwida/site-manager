-- Shopify (docs/SHOPIFY.md, phase 1): a venue's Shopify store is a destination of kind 'shopify', and change rows may point at
-- products and pages that live in that store. Safe to re-run. schema-integrations.sql carries the same statements.
--   npm run db:apply -- supabase/migrations/2026-11-20-shopify.sql
alter table public.venue_destinations drop constraint if exists venue_destinations_kind_check;
alter table public.venue_destinations add constraint venue_destinations_kind_check
  check (kind in ('wordpress', 'google', 'github', 'facebook', 'instagram', 'shopify'));

alter table public.changes drop constraint if exists changes_entity_check;
alter table public.changes add constraint changes_entity_check
  check (entity in ('venue', 'category', 'item', 'holiday', 'announcement', 'media', 'site_text', 'wp_page', 'wp_media', 'wp_option', 'wp_menu', 'wp_product', 'shopify_product', 'shopify_page', 'social_post', 'social_reply', 'social_moderate', 'boost_plan'));

notify pgrst, 'reload schema';
