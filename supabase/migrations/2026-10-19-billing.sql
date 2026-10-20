-- Billing (2026-10-19, docs/superpowers/plans/2026-10-19-getclaudia-onboarding.md, Task 6): the plan, the free trial and the Stripe ids of a
-- venue, and billing_events. All of it is server-only (the app reads it with the service-role key): the new venue columns are not in the
-- anon column grant list and billing_events has RLS on with nothing granted (policies.sql). Grandfather: every venue that exists when the
-- columns are added gets plan 'both' and billing_status 'active'. Safe to re-run: the backfill runs only on the run that adds the columns,
-- the constraints are dropped and re-added. schema.sql carries the same statements.
--   npm run db:apply -- supabase/migrations/2026-10-19-billing.sql
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'venues' and column_name = 'billing_status') then
    alter table public.venues add column if not exists plan text;
    alter table public.venues add column if not exists billing_status text;
    alter table public.venues add column if not exists trial_started_at timestamptz;
    alter table public.venues add column if not exists trial_ends_at timestamptz;
    alter table public.venues add column if not exists past_due_since timestamptz;
    alter table public.venues add column if not exists stripe_customer_id text;
    alter table public.venues add column if not exists stripe_subscription_id text;
    alter table public.venues add column if not exists trial_reminder_sent text;
    alter table public.venues add column if not exists website_fee_paid boolean not null default false;
    -- Only on the run that adds the columns: every venue that exists today keeps working exactly as before (all features, no trial).
    -- Later runs never touch plan or billing_status, so a venue moved to another plan or status is not pulled back.
    update public.venues set plan='both', billing_status='active';
  end if;
end $$;
alter table public.venues drop constraint if exists venues_plan_check;
alter table public.venues add constraint venues_plan_check check (plan is null or plan in ('admin', 'social', 'both'));
alter table public.venues drop constraint if exists venues_billing_status_check;
alter table public.venues add constraint venues_billing_status_check check (billing_status is null or billing_status in ('trialing', 'active', 'past_due', 'paused', 'canceled'));
alter table public.venues drop constraint if exists venues_trial_reminder_sent_check;
alter table public.venues add constraint venues_trial_reminder_sent_check check (trial_reminder_sent is null or trial_reminder_sent in ('soon', 'ended'));
create unique index if not exists venues_stripe_customer_idx on public.venues(stripe_customer_id) where stripe_customer_id is not null;

-- Stripe event ids already handled (the webhook applies the event first and then records its id; a second delivery of a recorded id is ignored, and an event that failed to apply is not recorded, so Stripe's retry is applied).
create table if not exists public.billing_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

notify pgrst, 'reload schema';
