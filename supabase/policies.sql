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
alter table public.rate_limits enable row level security;

revoke all on public.venue_members, public.venue_invites, public.venue_admin_tokens, public.change_sets, public.changes, public.conversations, public.rate_limits from anon, authenticated;
revoke execute on function public.bump_rate_limit(text, int, int, timestamptz) from anon, authenticated, public;
revoke insert, update, delete, truncate on public.venues, public.site_texts, public.categories, public.items, public.holidays, public.announcements, public.media from anon, authenticated;
grant select on public.site_texts, public.categories, public.items, public.holidays, public.announcements, public.media to anon, authenticated;
-- R27: venues are readable column by column. The list is exactly PublicVenue (src/server/site.ts, the public feed's venue), so
-- deploy, wizard_draft, draft_token_hash, publishing_at, instagram_import, site_url, site_mode, site_platform, created_via, change_limit, comment_mode, comment_digest_hour, comment_limit
-- and last_comment_digest_at are never readable with the anon key, not even on a live row. Revoking the table privilege also
-- drops every column grant, so a re-run (db:apply) starts clean each time.
-- test/policies-grants.test.ts keeps this list equal to PublicVenue.
revoke select on public.venues from anon, authenticated;
grant select (id, slug, name, tagline_bg, tagline_en, about_bg, about_en, address, phone, maps_url, instagram, cover_media_id, logo_media_id, hours, tz, default_lang, theme, template, business_type, status, created_at) on public.venues to anon, authenticated;

-- Anon sees only live venues and their content; wizard drafts are reachable solely through the server with the draft token.
drop policy if exists "anon read venues" on public.venues;
create policy "anon read venues" on public.venues for select to anon, authenticated using (status = 'live');
do $$
declare t text;
begin
  foreach t in array array['site_texts', 'categories', 'items', 'holidays', 'announcements', 'media'] loop
    execute format('drop policy if exists "anon read %1$s" on public.%1$I', t);
    execute format('create policy "anon read %1$s" on public.%1$I for select to anon, authenticated using (exists (select 1 from public.venues v where v.id = %1$I.venue_id and v.status = ''live''))', t);
  end loop;
end $$;
-- venue_members, venue_invites, venue_admin_tokens, change_sets, changes, conversations, rate_limits: RLS on, no policies => invisible to anon.

-- Meta data deletion requests (2026-10-14): server-only, like the tables above (RLS on, no policies, no grants).
alter table public.data_deletion_requests enable row level security;
revoke all on public.data_deletion_requests from anon, authenticated;

-- Translations of Claudia's fixed texts (2026-10-16): server-only, like the tables above (RLS on, no policies, no grants).
alter table public.translations enable row level security;
revoke all on public.translations from anon, authenticated;

-- What is around the café (2026-10-18): server-only, like the tables above (RLS on, no policies, no grants).
alter table public.venue_surroundings enable row level security;
revoke all on public.venue_surroundings from anon, authenticated;

-- Accounts (2026-10-19): server-only, like the tables above (RLS on, no policies, no grants). The app reads them with the service-role key.
alter table public.venue_users enable row level security;
revoke all on public.venue_users from anon, authenticated;
alter table public.account_invites enable row level security;
revoke all on public.account_invites from anon, authenticated;

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
