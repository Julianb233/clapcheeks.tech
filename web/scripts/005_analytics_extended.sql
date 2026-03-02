-- Phase 16: Analytics Extended Tables
-- Adds conversation stats and spending tracking for full analytics dashboard

-- Conversation analytics per user/day/platform
create table if not exists public.clapcheeks_conversation_stats (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  platform text not null,
  messages_sent int default 0,
  messages_received int default 0,
  conversations_started int default 0,
  conversations_replied int default 0,
  conversations_ghosted int default 0,
  avg_response_time_mins int,
  created_at timestamptz default now() not null,
  unique(user_id, date, platform)
);

create index if not exists idx_conversation_stats_user_date
  on clapcheeks_conversation_stats(user_id, date);

alter table clapcheeks_conversation_stats enable row level security;

create policy "conversation_stats_select_own"
  on public.clapcheeks_conversation_stats for select
  using (auth.uid() = user_id);

create policy "conversation_stats_insert_own"
  on public.clapcheeks_conversation_stats for insert
  with check (auth.uid() = user_id);

create policy "conversation_stats_update_own"
  on public.clapcheeks_conversation_stats for update
  using (auth.uid() = user_id);

-- Spending tracker
create table if not exists public.clapcheeks_spending (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  platform text,
  category text not null check (category in ('drinks', 'dinner', 'activities', 'subscriptions', 'boost', 'gift', 'other')),
  amount numeric(10,2) not null,
  description text,
  created_at timestamptz default now() not null
);

create index if not exists idx_spending_user_date
  on clapcheeks_spending(user_id, date);

alter table clapcheeks_spending enable row level security;

create policy "spending_select_own"
  on public.clapcheeks_spending for select
  using (auth.uid() = user_id);

create policy "spending_insert_own"
  on public.clapcheeks_spending for insert
  with check (auth.uid() = user_id);

create policy "spending_update_own"
  on public.clapcheeks_spending for update
  using (auth.uid() = user_id);

create policy "spending_delete_own"
  on public.clapcheeks_spending for delete
  using (auth.uid() = user_id);

-- rizz_score column already exists on profiles (added in 004_clap_cheeks_profile.sql)
