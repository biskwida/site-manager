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
alter table public.venues drop constraint if exists venues_template_check;
alter table public.venues add constraint venues_template_check check (template in ('classic', 'nocturne', 'lumen'));
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
  tg_chat_id bigint not null,
  role text not null check (role in ('owner', 'staff')),
  lang text not null default 'bg' check (lang in ('bg', 'en')),
  created_at timestamptz not null default now(),
  primary key (venue_id, tg_chat_id)
);
-- One venue per Telegram chat: the bot looks members up by chat id alone.
create unique index if not exists venue_members_chat_idx on public.venue_members (tg_chat_id);

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
  chat_id bigint,
  summary_bg text not null default '',
  summary_en text not null default '',
  preview_bg text not null default '',
  preview_en text not null default '',
  source text not null check (source in ('text', 'voice', 'photo', 'dashboard', 'auto', 'undo')),
  status text not null default 'proposed'
    check (status in ('proposed', 'scheduled', 'applied', 'rejected', 'expired', 'cancelled', 'reverted')),
  apply_at timestamptz,
  reminded_at timestamptz,
  decided_at timestamptz,
  applied_at timestamptz,
  reverted_by uuid,
  undoes_id uuid,
  tg_message_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists change_sets_venue_idx on public.change_sets (venue_id, created_at desc);
create index if not exists change_sets_status_idx on public.change_sets (status, apply_at);

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
  chat_id bigint not null,
  turns jsonb not null default '[]'::jsonb,
  correction_for uuid,
  updated_at timestamptz not null default now(),
  primary key (venue_id, chat_id)
);

-- items.updated_at maintenance
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();
