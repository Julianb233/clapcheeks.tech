-- Phase 17: AI Coaching Engine tables

create table if not exists public.clapcheeks_coaching_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  generated_at timestamptz default now() not null,
  week_start date not null,
  tips jsonb not null,
  stats_snapshot jsonb,
  feedback_score int,
  model_used text default 'claude-sonnet-4-6',
  created_at timestamptz default now() not null,
  unique(user_id, week_start)
);

alter table clapcheeks_coaching_sessions enable row level security;

create policy "Users can view own coaching sessions"
  on clapcheeks_coaching_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own coaching sessions"
  on clapcheeks_coaching_sessions for insert
  with check (auth.uid() = user_id);

-- Tip feedback table
create table if not exists public.clapcheeks_tip_feedback (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  coaching_session_id uuid references clapcheeks_coaching_sessions(id) on delete cascade not null,
  tip_index int not null,
  helpful boolean not null,
  created_at timestamptz default now() not null,
  unique(user_id, coaching_session_id, tip_index)
);

alter table clapcheeks_tip_feedback enable row level security;

create policy "Users can view own tip feedback"
  on clapcheeks_tip_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert own tip feedback"
  on clapcheeks_tip_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tip feedback"
  on clapcheeks_tip_feedback for update
  using (auth.uid() = user_id);
