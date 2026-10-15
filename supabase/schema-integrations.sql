-- Site Manager integrations: destinations (WordPress today; Google, GitHub later). Idempotent.
-- Applied by `npm run db:apply` after schema.sql.

create table if not exists public.venue_destinations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  kind text not null check (kind in ('wordpress', 'google', 'github')),
  config jsonb not null default '{}'::jsonb,
  -- base64 of AES-256-GCM(iv || tag || ciphertext) under DESTINATION_SECRET_KEY; server-only (see policies-integrations.sql)
  secrets text not null default '',
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, kind)
);

create table if not exists public.destination_syncs (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  destination_id uuid not null references public.venue_destinations(id) on delete cascade,
  change_set_id uuid not null references public.change_sets(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists destination_syncs_due_idx on public.destination_syncs (status, next_at);
create index if not exists destination_syncs_set_idx on public.destination_syncs (change_set_id);
create index if not exists destination_syncs_venue_idx on public.destination_syncs (venue_id, created_at);

-- Change rows may now point at entities that live on the owner's WordPress site or social accounts (social_post, 2026-10-11).
-- One constraint for both: a second add with a narrower list would fail on a database that already has social_post rows.
alter table public.changes drop constraint if exists changes_entity_check;
alter table public.changes add constraint changes_entity_check
  check (entity in ('venue', 'category', 'item', 'holiday', 'announcement', 'media', 'site_text', 'wp_page', 'wp_media', 'wp_option', 'wp_menu', 'wp_product', 'social_post', 'social_reply', 'social_moderate'));

-- Social posting (2026-10-11): the venue's Facebook Page and Instagram account as destinations (the social_post entity is in
-- changes_entity_check above). Apply only this file live: npm run db:apply -- schema-integrations.sql
alter table public.venue_destinations drop constraint if exists venue_destinations_kind_check;
alter table public.venue_destinations add constraint venue_destinations_kind_check
  check (kind in ('wordpress', 'google', 'github', 'facebook', 'instagram'));

-- One push per sync row at a time (claimSync): a run sets leased_until before pushing and clears it after; a row whose lease
-- ended (a crashed run) can be taken again. Social track, 2026-10-11.
alter table public.destination_syncs add column if not exists leased_until timestamptz;

-- Comment replies (2026-10-15): customer comments under posts Site Manager published. Customer content: the tick blanks text and author after 30 days and deletes rows
-- older than 60 days. RLS on, no anon access (policies-integrations.sql). Apply only this file live: npm run db:apply -- schema-integrations.sql
create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  network text not null check (network in ('facebook', 'instagram')),
  post_ref text not null,
  comment_id text not null unique,
  parent_id text,
  author_id text not null default '',
  author_name text not null default '',
  text text not null default '',
  created_at timestamptz not null,
  seen_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'proposed', 'replied', 'ignored', 'expired', 'own', 'nested', 'hidden', 'deleted')),
  change_set_id uuid references public.change_sets(id) on delete set null,
  reply_id text,
  replied_at timestamptz,
  post_caption text not null default '',
  post_permalink text,
  draft_text text,
  draft_kind text,
  deferred boolean not null default false,
  hold_attempts integer not null default 0,
  held_at timestamptz
);
-- Proposal sends that reached no owner (2026-10-15 fix wave): after 5 the comment waits until an owner writes.
alter table public.social_comments add column if not exists hold_attempts integer not null default 0;
alter table public.social_comments add column if not exists held_at timestamptz;
create index if not exists social_comments_venue_status_idx on public.social_comments (venue_id, status);
create index if not exists social_comments_created_idx on public.social_comments (created_at);
