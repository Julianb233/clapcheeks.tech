-- Row Level Security policies for core tables
-- Users can only access their own data
-- Note: devices/analytics_daily/ai_suggestions/clapcheeks_subscriptions created in migration 009

-- All policies are wrapped in DO blocks so this migration is safe to run
-- before or after migration 009 (tables may not exist yet at migration 003 time)

do $$ begin
  -- ============================================================
  -- devices
  -- ============================================================
  if exists (select 1 from information_schema.tables where table_name = 'devices' and table_schema = 'public') then
    execute 'alter table public.devices enable row level security';
    if not exists (select 1 from pg_policies where tablename = 'devices' and policyname = 'Users can view own devices') then
      execute 'create policy "Users can view own devices" on public.devices for select using (auth.uid() = user_id)';
      execute 'create policy "Users can insert own devices" on public.devices for insert with check (auth.uid() = user_id)';
      execute 'create policy "Users can update own devices" on public.devices for update using (auth.uid() = user_id)';
      execute 'create policy "Users can delete own devices" on public.devices for delete using (auth.uid() = user_id)';
    end if;
  end if;

  -- ============================================================
  -- analytics_daily
  -- ============================================================
  if exists (select 1 from information_schema.tables where table_name = 'analytics_daily' and table_schema = 'public') then
    execute 'alter table public.analytics_daily enable row level security';
    if not exists (select 1 from pg_policies where tablename = 'analytics_daily' and policyname = 'Users can view own analytics') then
      execute 'create policy "Users can view own analytics" on public.analytics_daily for select using (auth.uid() = user_id)';
      execute 'create policy "Users can insert own analytics" on public.analytics_daily for insert with check (auth.uid() = user_id)';
      execute 'create policy "Users can update own analytics" on public.analytics_daily for update using (auth.uid() = user_id)';
    end if;
  end if;

  -- ============================================================
  -- ai_suggestions
  -- ============================================================
  if exists (select 1 from information_schema.tables where table_name = 'ai_suggestions' and table_schema = 'public') then
    execute 'alter table public.ai_suggestions enable row level security';
    if not exists (select 1 from pg_policies where tablename = 'ai_suggestions' and policyname = 'Users can view own suggestions') then
      execute 'create policy "Users can view own suggestions" on public.ai_suggestions for select using (auth.uid() = user_id)';
      execute 'create policy "Users can insert own suggestions" on public.ai_suggestions for insert with check (auth.uid() = user_id)';
      execute 'create policy "Users can update own suggestions" on public.ai_suggestions for update using (auth.uid() = user_id)';
    end if;
  end if;

  -- ============================================================
  -- clapcheeks_subscriptions (Stripe — renamed from subscriptions to avoid collision)
  -- ============================================================
  if exists (select 1 from information_schema.tables where table_name = 'clapcheeks_subscriptions' and table_schema = 'public') then
    execute 'alter table public.clapcheeks_subscriptions enable row level security';
    if not exists (select 1 from pg_policies where tablename = 'clapcheeks_subscriptions' and policyname = 'Users can view own subscription') then
      execute 'create policy "Users can view own subscription" on public.clapcheeks_subscriptions for select using (auth.uid() = user_id)';
    end if;
  end if;
end $$;
