-- Site Manager schema. Idempotent: safe to re-run. Applied by `npm run db:apply`.
create extension if not exists pgcrypto;

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  tagline_bg text not null default '',
  tagline_en text not null default '',
  about_bg text not null default '',
  about_en text not null default '',
  address text not null default '',
  phone text not null default '',
  maps_url text not null default '',
  instagram text not null default '',
  cover_media_id uuid,
  logo_media_id uuid,
  hours jsonb not null default '{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":{"open":"09:00","close":"16:00"},"sun":null}'::jsonb,
  tz text not null default 'Europe/Sofia',
  default_lang text not null default 'bg' check (default_lang in ('bg', 'en')),
  theme jsonb not null default '{"accent":"#2f6b4f"}'::jsonb,
  created_at timestamptz not null default now()
);

-- Templates, wizard drafts and deployments (idempotent column adds; constraints re-created so re-runs pick up new ids).
alter table public.venues add column if not exists template text not null default 'classic';
alter table public.venues add column if not exists business_type text not null default 'cafe';
alter table public.venues add column if not exists status text not null default 'live';
alter table public.venues add column if not exists deploy jsonb;
alter table public.venues add column if not exists wizard_draft jsonb;
alter table public.venues add column if not exists draft_token_hash text;
-- Wizard Instagram import: the owner's recent photos read once at sign-in (server-only; cleared on publish; no token is ever stored).
alter table public.venues add column if not exists instagram_import jsonb;
-- claimPublish: set while a publish of this draft runs (one conditional UPDATE), so two publishes cannot both run; stale after 5 minutes.
alter table public.venues add column if not exists publishing_at timestamptz;
-- Own site: the venue's site is built and hosted elsewhere and reads our public feed (https URL); null = hosted or template deploy.
-- When set, the first owner join creates no provider project. Owner-only: not granted to anon (policies.sql).
alter table public.venues add column if not exists site_url text;
-- Site mode (2026-10-19): claudia = hosted /<slug> or template deploy; own = site_url is an external site (no deploy); none = no website (social only).
-- Replaces "site_url set = own site". Owner-only like site_url: not granted to anon (policies.sql).
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'venues' and column_name = 'site_mode') then
    alter table public.venues add column if not exists site_mode text not null default 'claudia';
    -- Only on the run that adds the column: venues that had an own-site URL keep behaving as before. Later runs never touch site_mode,
    -- so a venue the owner moved back to claudia or none is not pulled back to own.
    update public.venues set site_mode='own' where site_url is not null and site_url <> '' and site_mode='claudia';
  end if;
end $$;
alter table public.venues drop constraint if exists venues_site_mode_check;
alter table public.venues add constraint venues_site_mode_check check (site_mode in ('claudia', 'own', 'none'));
alter table public.venues drop constraint if exists venues_site_mode_own_url_check;
alter table public.venues add constraint venues_site_mode_own_url_check check (site_mode <> 'own' or (site_url is not null and site_url <> ''));
-- Own-site venues: what the site is built with (2026-10-19, Task 5); decides how the onboarding checklist connects it. Owner-only (not granted to anon).
alter table public.venues add column if not exists site_platform text;
alter table public.venues drop constraint if exists venues_site_platform_check;
alter table public.venues add constraint venues_site_platform_check check (site_platform is null or site_platform in ('wordpress', 'wix', 'squarespace', 'shopify', 'other', 'unknown'));
-- How the venue was made (2026-10-19): operator (default) | wizard | start. Only operator-made own sites redirect off our domain. Owner-only (not granted to anon).
alter table public.venues add column if not exists created_via text not null default 'operator';
alter table public.venues drop constraint if exists venues_created_via_check;
alter table public.venues add constraint venues_created_via_check check (created_via in ('operator', 'wizard', 'start'));
-- Monthly change limit (pricing plans; src/domain/limits.ts): applied change sets per calendar month in the venue's tz. null = unlimited.
alter table public.venues add column if not exists change_limit integer;
alter table public.venues drop constraint if exists venues_change_limit_check;
alter table public.venues add constraint venues_change_limit_check check (change_limit is null or change_limit >= 0);
-- Comment replies (2026-10-15): how the owner hears about comments under the venue's posts and the monthly cap on comment
-- actions. Owner-only (policies.sql grants columns one by one, so these never reach the anon key).
alter table public.venues add column if not exists comment_mode text not null default 'each';
alter table public.venues drop constraint if exists venues_comment_mode_check;
alter table public.venues add constraint venues_comment_mode_check check (comment_mode in ('each', 'digest', 'off'));
alter table public.venues add column if not exists comment_digest_hour integer not null default 9;
alter table public.venues drop constraint if exists venues_comment_digest_hour_check;
alter table public.venues add constraint venues_comment_digest_hour_check check (comment_digest_hour between 0 and 23);
alter table public.venues add column if not exists comment_limit integer default 300;
alter table public.venues drop constraint if exists venues_comment_limit_check;
alter table public.venues add constraint venues_comment_limit_check check (comment_limit is null or comment_limit >= 0);
alter table public.venues add column if not exists last_comment_digest_at timestamptz;
alter table public.venues drop constraint if exists venues_template_check;
alter table public.venues add constraint venues_template_check check (template in ('classic', 'nocturne', 'lumen', 'furna', 'mehana', 'kvartal'));
alter table public.venues drop constraint if exists venues_business_type_check;
alter table public.venues add constraint venues_business_type_check check (business_type in ('cafe', 'bar', 'restaurant'));
alter table public.venues drop constraint if exists venues_status_check;
alter table public.venues add constraint venues_status_check check (status in ('draft', 'live'));
create unique index if not exists venues_draft_token_idx on public.venues (draft_token_hash) where draft_token_hash is not null;
create index if not exists venues_status_idx on public.venues (status, created_at);

create table if not exists public.rate_limits (
  key text primary key,
  count int not null,
  window_start timestamptz not null
);

-- Atomic fixed-window counter; true when the call is allowed (count after increment <= p_max). Service role only (see policies.sql).
create or replace function public.bump_rate_limit(p_key text, p_window_ms int, p_max int, p_now timestamptz) returns boolean language sql as $$
  with up as (
    insert into public.rate_limits as r (key, count, window_start) values (p_key, 1, p_now)
    on conflict (key) do update set
      count = case when r.window_start + make_interval(secs => p_window_ms / 1000.0) <= p_now then 1 else r.count + 1 end,
      window_start = case when r.window_start + make_interval(secs => p_window_ms / 1000.0) <= p_now then p_now else r.window_start end
    returning r.count as n
  )
  select n <= p_max from up;
$$;

create table if not exists public.venue_members (
  venue_id uuid not null references public.venues(id) on delete cascade,
  chat_ref text not null,                 -- "<channel>:<id>", src/channels/ref.ts
  tg_chat_id bigint,                      -- legacy, tg: refs only; dropped by migrations/2026-10-11-drop-legacy-chat-ids.sql
  role text not null check (role in ('owner', 'staff')),
  lang text not null default 'bg' check (lang ~ '^[a-z]{2}$'),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (venue_id, chat_ref)
);
-- One venue per chat: the bot looks members up by chat_ref alone.
create unique index if not exists venue_members_chat_ref_key on public.venue_members (chat_ref);
create unique index if not exists venue_members_tg_chat_id_key on public.venue_members (venue_id, tg_chat_id);
-- Any conversation language (2026-10-16): the lower-case ISO 639-1 code of the member's last message that showed one ("bg", "en",
-- "de", …), not only bg/en. Re-created so an existing database learns it (migrations/2026-10-16-chat-lang.sql does the same).
alter table public.venue_members drop constraint if exists venue_members_lang_check;
alter table public.venue_members add constraint venue_members_lang_check check (lang ~ '^[a-z]{2}$');

create table if not exists public.venue_invites (
  code text primary key check (length(code) >= 8),
  venue_id uuid not null references public.venues(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists public.venue_admin_tokens (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  token text not null unique check (length(token) >= 32)
);

create table if not exists public.site_texts (
  venue_id uuid not null references public.venues(id) on delete cascade,
  key text not null check (key in ('welcome', 'footer_note')),
  text_bg text not null default '',
  text_en text not null default '',
  primary key (venue_id, key)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name_bg text not null,
  name_en text not null,
  position int not null default 0,
  active boolean not null default true
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  name_bg text not null,
  name_en text not null,
  desc_bg text not null default '',
  desc_en text not null default '',
  price_eur numeric(8,2) not null check (price_eur >= 0.10 and price_eur <= 500),
  allergens int[] not null default '{}',
  image_media_id uuid,
  sold_out_until timestamptz,
  is_special boolean not null default false,
  special_expires_at timestamptz,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_venue_idx on public.items (venue_id);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  date date not null,
  note_bg text not null default '',
  note_en text not null default '',
  unique (venue_id, date)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  text_bg text not null,
  text_en text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  is_gallery boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.change_sets (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  chat_ref text,
  chat_id bigint,                          -- legacy, see venue_members
  summary_bg text not null default '',
  summary_en text not null default '',
  preview_bg text not null default '',
  preview_en text not null default '',
  source text not null check (source in ('text', 'voice', 'photo', 'dashboard', 'auto', 'undo', 'comment')),
  status text not null default 'proposed'
    check (status in ('proposed', 'scheduled', 'applied', 'rejected', 'expired', 'cancelled', 'reverted')),
  apply_at timestamptz,
  reminded_at timestamptz,
  decided_at timestamptz,
  applied_at timestamptz,
  reverted_by uuid,
  undoes_id uuid,
  message_ref text,
  tg_message_id bigint,                    -- legacy
  created_at timestamptz not null default now()
);
create index if not exists change_sets_venue_idx on public.change_sets (venue_id, created_at desc);
create index if not exists change_sets_status_idx on public.change_sets (status, apply_at);
create index if not exists change_sets_chat_ref_idx on public.change_sets (venue_id, chat_ref) where status = 'proposed';
-- countAppliedChangeSets: applied sets of one venue in a month.
create index if not exists change_sets_applied_idx on public.change_sets (venue_id, applied_at) where applied_at is not null;

-- Comment replies (2026-10-15): proposals made by the comment poller / reply_to_comments. Re-created so an existing database learns the new source.
alter table public.change_sets drop constraint if exists change_sets_source_check;
alter table public.change_sets add constraint change_sets_source_check
  check (source in ('text', 'voice', 'photo', 'dashboard', 'auto', 'undo', 'comment'));
-- One proposal message per owner chat for comment sets: { "<chat_ref>": "<message_ref>" }.
alter table public.change_sets add column if not exists proposal_refs jsonb;

create table if not exists public.changes (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references public.change_sets(id) on delete cascade,
  position int not null,
  op text not null,
  entity text not null check (entity in ('venue', 'category', 'item', 'holiday', 'announcement', 'media', 'site_text')),
  entity_id text not null,
  before jsonb,
  after jsonb
);
create index if not exists changes_set_idx on public.changes (change_set_id, position);

create table if not exists public.conversations (
  venue_id uuid not null references public.venues(id) on delete cascade,
  chat_ref text not null,
  chat_id bigint,                          -- legacy
  turns jsonb not null default '[]'::jsonb,
  correction_for uuid,
  updated_at timestamptz not null default now(),
  primary key (venue_id, chat_ref)
);
create unique index if not exists conversations_chat_id_key on public.conversations (venue_id, chat_id);
-- Legacy bridge: production (Telegram-only) still writes the bigint columns. Dropped by migrations/2026-10-11-drop-legacy-chat-ids.sql.
create or replace function public.fill_chat_ref() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'venue_members' then
    if new.chat_ref is null and new.tg_chat_id is not null then new.chat_ref := 'tg:' || new.tg_chat_id; end if;
  elsif tg_table_name = 'change_sets' then
    if new.chat_ref is null and new.chat_id is not null then new.chat_ref := 'tg:' || new.chat_id; end if;
    if new.message_ref is null and new.tg_message_id is not null then new.message_ref := new.tg_message_id::text; end if;
  elsif tg_table_name = 'conversations' then
    if new.chat_ref is null and new.chat_id is not null then new.chat_ref := 'tg:' || new.chat_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists fill_chat_ref on public.venue_members;
create trigger fill_chat_ref before insert or update on public.venue_members for each row execute function public.fill_chat_ref();
drop trigger if exists fill_chat_ref on public.change_sets;
create trigger fill_chat_ref before insert or update on public.change_sets for each row execute function public.fill_chat_ref();
drop trigger if exists fill_chat_ref on public.conversations;
create trigger fill_chat_ref before insert or update on public.conversations for each row execute function public.fill_chat_ref();

-- items.updated_at maintenance
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();

-- Meta data deletion requests (2026-10-14): one row per "Data Deletion Request" callback (src/server/meta-deletion.ts); the
-- confirmation code is what /data-deletion?code= looks up. Server-only (policies.sql). Apply only this: npm run db:apply -- schema.sql policies.sql
create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('facebook', 'instagram')),
  subject_id text not null,               -- app-scoped user id from Meta's signed_request
  confirmation_code text not null unique,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Translations of Claudia's fixed texts (2026-10-16) into conversation languages other than Bulgarian and English: one row per
-- language and source text (source_hash: sha256 of the text), written once and then reused. Names, quotes, captions and customer
-- words are numbered markers (⟦1⟧) in both the source and the stored text (src/bot/translate.ts): no customer text is kept here.
-- Server-only (policies.sql).
create table if not exists public.translations (
  lang text not null check (lang ~ '^[a-z]{2}$'),
  source_hash text not null,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (lang, source_hash)
);

-- What is around the café (2026-10-18): the address geocoded with OpenStreetMap Nominatim plus the places Overpass finds within 2 km,
-- cached 30 days; places is [{kind, name, meters}] (src/geo/osm.ts); fetched_at is the last success (null: never), failed_at the last
-- failed lookup (no new request within an hour). Server-only (policies.sql).
create table if not exists public.venue_surroundings (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  address text not null,
  lat double precision,
  lng double precision,
  places jsonb not null default '[]',
  fetched_at timestamptz,
  failed_at timestamptz
);

-- Accounts (2026-10-19, docs/superpowers/plans/2026-10-19-getclaudia-onboarding.md, Task 3): who may open a venue's dashboard
-- without the ?key= link. venue_users links a Supabase Auth user (email link or Google) to a venue; account_invites holds an email
-- that is promised a venue before its owner has signed in once (npm run account:invite): the first sign-in with that email
-- claims it (claimed_at) and links the user as owner. Emails are stored lower case (no citext extension needed). Server-only
-- (policies.sql). Apply only this: npm run db:apply -- supabase/migrations/2026-10-19-venue-users.sql
create table if not exists public.venue_users (
  venue_id uuid not null references public.venues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);
create index if not exists venue_users_user_idx on public.venue_users(user_id);

create table if not exists public.account_invites (
  venue_id uuid not null references public.venues(id) on delete cascade,
  email text not null check (email = lower(email)),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  primary key (venue_id, email)
);
create index if not exists account_invites_email_idx on public.account_invites(email);

