-- Destinations and their sync queue are server-only: RLS on, no policies, no grants for anon/authenticated.
alter table public.venue_destinations enable row level security;
alter table public.destination_syncs enable row level security;
revoke all on public.venue_destinations, public.destination_syncs from anon, authenticated;
notify pgrst, 'reload schema';
