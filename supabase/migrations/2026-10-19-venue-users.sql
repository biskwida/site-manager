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

alter table public.venue_users enable row level security;
revoke all on public.venue_users from anon, authenticated;
alter table public.account_invites enable row level security;
revoke all on public.account_invites from anon, authenticated;

notify pgrst, 'reload schema';
