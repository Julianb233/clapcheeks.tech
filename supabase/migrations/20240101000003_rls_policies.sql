-- Row Level Security policies for core tables
-- Users can only access their own data

-- ============================================================
-- devices
-- ============================================================
alter table public.devices enable row level security;

create policy "Users can view own devices"
  on public.devices for select
  using (auth.uid() = user_id);

create policy "Users can insert own devices"
  on public.devices for insert
  with check (auth.uid() = user_id);

create policy "Users can update own devices"
  on public.devices for update
  using (auth.uid() = user_id);

create policy "Users can delete own devices"
  on public.devices for delete
  using (auth.uid() = user_id);

-- ============================================================
-- analytics_daily
-- ============================================================
alter table public.analytics_daily enable row level security;

create policy "Users can view own analytics"
  on public.analytics_daily for select
  using (auth.uid() = user_id);

create policy "Users can insert own analytics"
  on public.analytics_daily for insert
  with check (auth.uid() = user_id);

create policy "Users can update own analytics"
  on public.analytics_daily for update
  using (auth.uid() = user_id);

-- ============================================================
-- ai_suggestions
-- ============================================================
alter table public.ai_suggestions enable row level security;

create policy "Users can view own suggestions"
  on public.ai_suggestions for select
  using (auth.uid() = user_id);

create policy "Users can insert own suggestions"
  on public.ai_suggestions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own suggestions"
  on public.ai_suggestions for update
  using (auth.uid() = user_id);

-- ============================================================
-- subscriptions
-- ============================================================
alter table public.subscriptions enable row level security;

create policy "Users can view own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
