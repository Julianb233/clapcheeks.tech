-- Track every AI-generated opener and its outcome
create table if not exists public.clapcheeks_opener_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  platform text not null,
  opener_text text not null,
  opener_style text,
  match_name text,
  got_reply boolean default false,
  reply_received_at timestamptz,
  conversation_stage text default 'opened',
  created_at timestamptz default now()
);

-- Track conversation stage progressions
create table if not exists public.clapcheeks_conversation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  platform text not null,
  match_id text,
  from_stage text,
  to_stage text,
  messages_sent int default 0,
  days_to_progress float,
  created_at timestamptz default now()
);

alter table public.clapcheeks_opener_log enable row level security;
alter table public.clapcheeks_conversation_events enable row level security;

create policy "Users see own opener logs" on public.clapcheeks_opener_log
  for all using (auth.uid() = user_id);
create policy "Users see own conversation events" on public.clapcheeks_conversation_events
  for all using (auth.uid() = user_id);

-- Indexes for common queries
create index idx_opener_log_user_created on public.clapcheeks_opener_log (user_id, created_at desc);
create index idx_opener_log_user_platform on public.clapcheeks_opener_log (user_id, platform);
create index idx_conversation_events_user on public.clapcheeks_conversation_events (user_id, created_at desc);
