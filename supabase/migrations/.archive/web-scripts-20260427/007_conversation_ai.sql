-- Phase 18: Conversation AI tables

create table if not exists public.clapcheeks_voice_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  style_summary text,
  sample_phrases jsonb default '[]'::jsonb,
  tone text default 'casual' check (tone in ('casual', 'formal', 'playful')),
  profile_data jsonb default '{}'::jsonb,
  messages_analyzed int default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table clapcheeks_voice_profiles enable row level security;

create policy "Users can view own voice profile"
  on clapcheeks_voice_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own voice profile"
  on clapcheeks_voice_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own voice profile"
  on clapcheeks_voice_profiles for update
  using (auth.uid() = user_id);

-- Reply suggestions table
create table if not exists public.clapcheeks_reply_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  conversation_context text not null,
  suggestions jsonb not null,
  created_at timestamptz default now() not null
);

alter table clapcheeks_reply_suggestions enable row level security;

create policy "Users can view own reply suggestions"
  on clapcheeks_reply_suggestions for select
  using (auth.uid() = user_id);

create policy "Users can insert own reply suggestions"
  on clapcheeks_reply_suggestions for insert
  with check (auth.uid() = user_id);
