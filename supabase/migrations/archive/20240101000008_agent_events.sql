-- Agent events + push token tables
create table if not exists public.clapcheeks_agent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  event_type text not null,
  data jsonb,
  occurred_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.clapcheeks_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  expo_token text not null,
  device_name text,
  created_at timestamptz default now(),
  unique(user_id, expo_token)
);

create index if not exists idx_agent_events_user on public.clapcheeks_agent_events(user_id, created_at desc);
create index if not exists idx_agent_events_type on public.clapcheeks_agent_events(event_type);

alter table public.clapcheeks_agent_events enable row level security;
alter table public.clapcheeks_push_tokens enable row level security;

create policy "Users see own events" on public.clapcheeks_agent_events
  for select using (auth.uid() = user_id);

create policy "Users manage own tokens" on public.clapcheeks_push_tokens
  for all using (auth.uid() = user_id);
