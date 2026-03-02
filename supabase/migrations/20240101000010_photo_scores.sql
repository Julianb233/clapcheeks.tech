create table if not exists public.clapcheeks_photo_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  filename text not null,
  score float not null,
  face_score float,
  smile_score float,
  background_score float,
  lighting_score float,
  solo_score float,
  tips jsonb,
  scored_at timestamptz default now()
);
alter table public.clapcheeks_photo_scores enable row level security;
create policy "Users see own scores" on public.clapcheeks_photo_scores
  for all using (auth.uid() = user_id);
