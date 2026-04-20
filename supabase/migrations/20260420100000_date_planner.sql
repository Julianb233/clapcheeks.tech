-- Date Planner: dates, ideas, budget, calendar sync
-- Phase 43: AI-8328

-- Planned/completed dates
create table if not exists clapcheeks_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid, -- optional FK to matches table
  match_name text,
  title text not null,
  description text,
  venue_name text,
  venue_address text,
  venue_url text,
  scheduled_at timestamptz,
  status text not null default 'idea' check (status in ('idea', 'planned', 'confirmed', 'completed', 'cancelled')),
  -- Post-date fields
  rating integer check (rating >= 1 and rating <= 5),
  notes text,
  went_well text[], -- tags for what went well
  improve text[], -- tags for what to improve
  -- Budget
  estimated_cost numeric(10,2),
  actual_cost numeric(10,2),
  -- Calendar sync
  google_calendar_event_id text,
  calendar_synced boolean default false,
  -- Metadata
  tags text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Date expenses (line items for budget tracking)
create table if not exists clapcheeks_date_expenses (
  id uuid primary key default gen_random_uuid(),
  date_id uuid not null references clapcheeks_dates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('food', 'drinks', 'activity', 'transport', 'gifts', 'other')),
  description text,
  amount numeric(10,2) not null,
  created_at timestamptz default now()
);

-- Date ideas (saved/generated ideas)
create table if not exists clapcheeks_date_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  category text not null check (category in ('adventure', 'food', 'creative', 'nightlife', 'outdoors', 'cultural', 'chill', 'surprise')),
  estimated_cost_range text, -- e.g. '$', '$$', '$$$'
  duration_minutes integer,
  best_for text[], -- e.g. ['first_date', 'casual', 'romantic', 'adventurous']
  location_type text check (location_type in ('indoor', 'outdoor', 'both')),
  saved boolean default false,
  ai_generated boolean default false,
  created_at timestamptz default now()
);

-- Google Calendar OAuth tokens (per user)
create table if not exists clapcheeks_calendar_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  calendar_id text default 'primary',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS policies
alter table clapcheeks_dates enable row level security;
alter table clapcheeks_date_expenses enable row level security;
alter table clapcheeks_date_ideas enable row level security;
alter table clapcheeks_calendar_tokens enable row level security;

create policy "Users can manage own dates" on clapcheeks_dates
  for all using (auth.uid() = user_id);

create policy "Users can manage own expenses" on clapcheeks_date_expenses
  for all using (auth.uid() = user_id);

create policy "Users can manage own ideas" on clapcheeks_date_ideas
  for all using (auth.uid() = user_id);

create policy "Users can manage own calendar tokens" on clapcheeks_calendar_tokens
  for all using (auth.uid() = user_id);

-- Indexes
create index idx_dates_user_status on clapcheeks_dates(user_id, status);
create index idx_dates_user_scheduled on clapcheeks_dates(user_id, scheduled_at);
create index idx_date_expenses_date on clapcheeks_date_expenses(date_id);
create index idx_date_ideas_user on clapcheeks_date_ideas(user_id, category);

-- Updated_at trigger
create or replace function update_dates_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_dates_updated_at
  before update on clapcheeks_dates
  for each row execute function update_dates_updated_at();
