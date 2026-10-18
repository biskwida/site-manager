-- What is around the café (2026-10-18, docs/superpowers/plans/2026-10-18-boost-proposals.md, Task 1): the venue's address geocoded once with
-- OpenStreetMap Nominatim plus the places Overpass finds within 2 km, kept for 30 days so each venue costs OSM at most one geocode per
-- address and one Overpass query a month; a failed lookup is remembered (failed_at) so OSM is not asked again for an hour.
-- fetched_at is the last success (null: it never answered). One row per venue; places is [{kind, name, meters}] (src/geo/osm.ts). Only public map data and
-- the café's own address. Server-only: RLS on, no policies, nothing granted to anon/authenticated. Idempotent; schema.sql and
-- policies.sql carry the same statements.
--   npm run db:apply -- supabase/migrations/2026-10-18-venue-surroundings.sql
create table if not exists public.venue_surroundings (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  address text not null,
  lat double precision,
  lng double precision,
  places jsonb not null default '[]',
  fetched_at timestamptz,
  failed_at timestamptz
);
alter table public.venue_surroundings enable row level security;
revoke all on public.venue_surroundings from anon, authenticated;

notify pgrst, 'reload schema';
