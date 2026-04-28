-- Create profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  display_name text,
  bio text,
  profile_image_url text,
  phone text,
  date_of_birth date,
  city text,
  country text default 'Chile',
  
  -- Verification and safety
  is_verified boolean default false,
  verification_method text, -- 'id_card', 'social_media', etc.
  verification_date timestamptz,
  reputation_score integer default 0,
  total_events_attended integer default 0,
  total_events_created integer default 0,
  
  -- Preferences
  preferred_sports text[], -- array of sport types
  skill_levels jsonb, -- {cycling: 'intermediate', running: 'beginner'}
  
  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create events table
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  
  -- Event details
  title text not null,
  description text,
  sport_type text not null, -- 'cycling', 'mtb', 'trail_running', 'trekking', 'running'
  difficulty_level text not null, -- 'beginner', 'intermediate', 'advanced'
  
  -- Location
  meeting_point text not null,
  meeting_point_lat decimal(10, 8),
  meeting_point_lng decimal(11, 8),
  route_description text,
  distance_km decimal(6, 2),
  elevation_gain_m integer,
  
  -- Timing
  event_date date not null,
  event_time time not null,
  estimated_duration_minutes integer,
  
  -- Capacity
  max_participants integer,
  current_participants integer default 1, -- creator is first participant
  
  -- Status
  status text default 'open', -- 'open', 'full', 'cancelled', 'completed'
  is_public boolean default true,
  
  -- Safety
  emergency_contact text,
  required_equipment text[],
  safety_notes text,
  
  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create event_participants table
create table if not exists public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  
  -- Participation details
  status text default 'confirmed', -- 'confirmed', 'cancelled', 'attended'
  joined_at timestamptz default now(),
  
  -- Unique constraint: one user per event
  unique(event_id, user_id)
);

-- Create groups table (for influencers/leaders)
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references public.profiles(id) on delete cascade,
  
  -- Group details
  name text not null,
  description text,
  sport_type text not null,
  group_image_url text,
  
  -- Settings
  is_private boolean default false,
  max_members integer,
  current_members integer default 1,
  
  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create group_members table
create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  
  -- Membership details
  role text default 'member', -- 'leader', 'admin', 'member'
  joined_at timestamptz default now(),
  
  -- Unique constraint: one user per group
  unique(group_id, user_id)
);

-- Create notifications table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  
  -- Notification details
  type text not null, -- 'event_invite', 'event_reminder', 'group_invite', 'safety_alert'
  title text not null,
  message text not null,
  
  -- Related entities
  related_event_id uuid references public.events(id) on delete cascade,
  related_group_id uuid references public.groups(id) on delete cascade,
  
  -- Status
  is_read boolean default false,
  read_at timestamptz,
  
  -- Timestamps
  created_at timestamptz default now()
);

-- Enable Row Level Security on all tables
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.notifications enable row level security;

-- RLS Policies for profiles
create policy "profiles_select_all"
  on public.profiles for select
  using (true); -- Everyone can view profiles

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

create policy "profiles_delete_own"
  on public.profiles for delete
  using (auth.uid() = id);

-- RLS Policies for events
create policy "events_select_all"
  on public.events for select
  using (true); -- Everyone can view public events

create policy "events_insert_own"
  on public.events for insert
  with check (auth.uid() = creator_id);

create policy "events_update_own"
  on public.events for update
  using (auth.uid() = creator_id);

create policy "events_delete_own"
  on public.events for delete
  using (auth.uid() = creator_id);

-- RLS Policies for event_participants
create policy "participants_select_all"
  on public.event_participants for select
  using (true); -- Everyone can see who's participating

create policy "participants_insert_own"
  on public.event_participants for insert
  with check (auth.uid() = user_id);

create policy "participants_update_own"
  on public.event_participants for update
  using (auth.uid() = user_id);

create policy "participants_delete_own"
  on public.event_participants for delete
  using (auth.uid() = user_id);

-- RLS Policies for groups
create policy "groups_select_all"
  on public.groups for select
  using (true); -- Everyone can view groups

create policy "groups_insert_own"
  on public.groups for insert
  with check (auth.uid() = leader_id);

create policy "groups_update_own"
  on public.groups for update
  using (auth.uid() = leader_id);

create policy "groups_delete_own"
  on public.groups for delete
  using (auth.uid() = leader_id);

-- RLS Policies for group_members
create policy "group_members_select_all"
  on public.group_members for select
  using (true); -- Everyone can see group members

create policy "group_members_insert_own"
  on public.group_members for insert
  with check (auth.uid() = user_id);

create policy "group_members_update_own"
  on public.group_members for update
  using (auth.uid() = user_id);

create policy "group_members_delete_own"
  on public.group_members for delete
  using (auth.uid() = user_id);

-- RLS Policies for notifications
create policy "notifications_select_own"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "notifications_insert_own"
  on public.notifications for insert
  with check (auth.uid() = user_id);

create policy "notifications_update_own"
  on public.notifications for update
  using (auth.uid() = user_id);

create policy "notifications_delete_own"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- Create indexes for better performance
create index if not exists idx_events_sport_type on public.events(sport_type);
create index if not exists idx_events_date on public.events(event_date);
create index if not exists idx_events_creator on public.events(creator_id);
create index if not exists idx_event_participants_event on public.event_participants(event_id);
create index if not exists idx_event_participants_user on public.event_participants(user_id);
create index if not exists idx_groups_sport_type on public.groups(sport_type);
create index if not exists idx_notifications_user on public.notifications(user_id);
create index if not exists idx_notifications_unread on public.notifications(user_id, is_read);

-- Create updated_at trigger function
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Add updated_at triggers
create trigger profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.handle_updated_at();

create trigger events_updated_at
  before update on public.events
  for each row
  execute function public.handle_updated_at();

create trigger groups_updated_at
  before update on public.groups
  for each row
  execute function public.handle_updated_at();
