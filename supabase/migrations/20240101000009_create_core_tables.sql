-- Core tables for ClapCheeks.tech SaaS platform
-- Depends on: 20240101000001_create_user_profiles.sql (profiles table)

-- ============================================================
-- 1. devices — registered local agents per user
-- ============================================================
create table if not exists public.devices (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  device_name text not null,
  platform text not null,
  agent_version text,
  last_seen_at timestamptz default now() not null,
  is_active boolean default true not null,
  created_at timestamptz default now() not null
);

create index idx_devices_user_id on public.devices(user_id);

-- ============================================================
-- 2. analytics_daily — daily metrics per user per app
-- ============================================================
create table if not exists public.analytics_daily (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  swipes_right integer default 0 not null,
  swipes_left integer default 0 not null,
  matches integer default 0 not null,
  conversations_started integer default 0 not null,
  dates_booked integer default 0 not null,
  money_spent numeric(10,2) default 0 not null,
  app text not null check (app in ('tinder', 'bumble', 'hinge')),
  created_at timestamptz default now() not null,

  unique(user_id, date, app)
);

create index idx_analytics_daily_user_date on public.analytics_daily(user_id, date);

-- ============================================================
-- 3. ai_suggestions — AI coaching suggestions for users
-- ============================================================
create table if not exists public.ai_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  suggestion_text text not null,
  category text not null,
  was_helpful boolean,
  created_at timestamptz default now() not null
);

create index idx_ai_suggestions_user_id on public.ai_suggestions(user_id);

-- ============================================================
-- 4. subscriptions — Stripe subscription tracking
-- ============================================================
create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  stripe_subscription_id text unique,
  plan text not null check (plan in ('starter', 'pro', 'elite')),
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_subscriptions_user_id on public.subscriptions(user_id);
create index idx_subscriptions_stripe_id on public.subscriptions(stripe_subscription_id);

-- Auto-update updated_at on subscriptions
create or replace trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
