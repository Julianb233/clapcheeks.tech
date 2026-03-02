-- Outward core tables
-- Depends on: 20240101000001_create_user_profiles.sql (profiles table)

-- ============================================================
-- Add subscription columns to profiles (if not exists)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'subscription_tier'
  ) then
    alter table public.profiles add column subscription_tier text default 'free';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'stripe_customer_id'
  ) then
    alter table public.profiles add column stripe_customer_id text;
  end if;
end $$;

-- ============================================================
-- 1. outward_agent_tokens — registered agent devices per user
-- ============================================================
create table if not exists public.outward_agent_tokens (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  token text unique not null,
  device_name text,
  created_at timestamptz default now(),
  last_seen_at timestamptz
);

alter table public.outward_agent_tokens enable row level security;

create policy "Users can view own agent tokens"
  on public.outward_agent_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert own agent tokens"
  on public.outward_agent_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can update own agent tokens"
  on public.outward_agent_tokens for update
  using (auth.uid() = user_id);

create policy "Users can delete own agent tokens"
  on public.outward_agent_tokens for delete
  using (auth.uid() = user_id);

-- ============================================================
-- 2. outward_sessions — swiping session tracking
-- ============================================================
create table if not exists public.outward_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  platform text not null,
  mode text,
  liked int default 0,
  passed int default 0,
  errors int default 0,
  started_at timestamptz default now(),
  ended_at timestamptz
);

alter table public.outward_sessions enable row level security;

create policy "Users can view own sessions"
  on public.outward_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on public.outward_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.outward_sessions for update
  using (auth.uid() = user_id);

-- ============================================================
-- 3. outward_matches — match tracking per platform
-- ============================================================
create table if not exists public.outward_matches (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  platform text not null,
  match_id text not null,
  match_name text,
  opened bool default false,
  opener_sent_at timestamptz,
  created_at timestamptz default now(),
  unique(user_id, platform, match_id)
);

alter table public.outward_matches enable row level security;

create policy "Users can view own matches"
  on public.outward_matches for select
  using (auth.uid() = user_id);

create policy "Users can insert own matches"
  on public.outward_matches for insert
  with check (auth.uid() = user_id);

create policy "Users can update own matches"
  on public.outward_matches for update
  using (auth.uid() = user_id);

-- ============================================================
-- 4. outward_conversations — conversation tracking
-- ============================================================
create table if not exists public.outward_conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  platform text not null,
  match_id text not null,
  messages jsonb default '[]',
  stage text default 'opened',
  last_message_at timestamptz,
  created_at timestamptz default now()
);

alter table public.outward_conversations enable row level security;

create policy "Users can view own conversations"
  on public.outward_conversations for select
  using (auth.uid() = user_id);

create policy "Users can insert own conversations"
  on public.outward_conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own conversations"
  on public.outward_conversations for update
  using (auth.uid() = user_id);

-- ============================================================
-- 5. outward_analytics_daily — daily metrics per user per platform
-- ============================================================
create table if not exists public.outward_analytics_daily (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  date date not null,
  platform text not null,
  swipes_right int default 0,
  swipes_left int default 0,
  matches int default 0,
  messages_sent int default 0,
  dates_booked int default 0,
  unique(user_id, date, platform)
);

alter table public.outward_analytics_daily enable row level security;

create policy "Users can view own analytics daily"
  on public.outward_analytics_daily for select
  using (auth.uid() = user_id);

create policy "Users can insert own analytics daily"
  on public.outward_analytics_daily for insert
  with check (auth.uid() = user_id);

create policy "Users can update own analytics daily"
  on public.outward_analytics_daily for update
  using (auth.uid() = user_id);
