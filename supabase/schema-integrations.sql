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

-- Change rows may now point at entities that live on the owner's WordPress site.
alter table public.changes drop constraint if exists changes_entity_check;
alter table public.changes add constraint changes_entity_check
  check (entity in ('venue', 'category', 'item', 'holiday', 'announcement', 'media', 'site_text', 'wp_page', 'wp_media', 'wp_option', 'wp_menu', 'wp_product'));
