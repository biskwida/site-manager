-- 1. Row-level security and grants. Anon (browser) may read the public site tables; everything else is server-only.
alter table public.venues enable row level security;
alter table public.venue_members enable row level security;
alter table public.venue_invites enable row level security;
alter table public.venue_admin_tokens enable row level security;
alter table public.site_texts enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.holidays enable row level security;
alter table public.announcements enable row level security;
alter table public.media enable row level security;
alter table public.change_sets enable row level security;
alter table public.changes enable row level security;
alter table public.conversations enable row level security;

revoke all on public.venue_members, public.venue_invites, public.venue_admin_tokens, public.change_sets, public.changes, public.conversations from anon, authenticated;
revoke insert, update, delete, truncate on public.venues, public.site_texts, public.categories, public.items, public.holidays, public.announcements, public.media from anon, authenticated;
grant select on public.venues, public.site_texts, public.categories, public.items, public.holidays, public.announcements, public.media to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['venues', 'site_texts', 'categories', 'items', 'holidays', 'announcements', 'media'] loop
    execute format('drop policy if exists "anon read %1$s" on public.%1$I', t);
    execute format('create policy "anon read %1$s" on public.%1$I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
-- venue_members, venue_invites, venue_admin_tokens, change_sets, changes, conversations: RLS on, no policies => invisible to anon.

-- 2. No RPCs: the owner dashboard and the public site read through the app's server (service-role key, never in the browser).

-- 3. Realtime for the public site and the dashboard.
do $$
declare t text;
begin
  foreach t in array array['items', 'categories', 'venues', 'holidays', 'announcements', 'site_texts', 'media'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 4. Storage: public bucket for venue images (uploads happen with the service-role key).
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('media', 'media', true, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'], 5242880)
on conflict (id) do update set public = true, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';
