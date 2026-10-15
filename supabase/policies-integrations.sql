-- Destinations, their sync queue and customer comments are server-only: RLS on, no policies, no grants for anon/authenticated.
alter table public.venue_destinations enable row level security;
alter table public.destination_syncs enable row level security;
alter table public.social_comments enable row level security;
revoke all on public.venue_destinations, public.destination_syncs, public.social_comments from anon, authenticated;
notify pgrst, 'reload schema';
