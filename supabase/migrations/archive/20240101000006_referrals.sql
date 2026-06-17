-- Referral system: track referrals, reward 1 free month per conversion

create table if not exists public.clapcheeks_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid references auth.users not null,
  referred_id uuid references auth.users,
  referral_code text unique not null,
  status text default 'pending',  -- pending | converted | rewarded
  converted_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz default now()
);

alter table public.clapcheeks_referrals enable row level security;

create policy "Users see own referrals" on public.clapcheeks_referrals
  for select using (auth.uid() = referrer_id);

-- Add referral columns to profiles
alter table public.profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by text,  -- the code used at signup
  add column if not exists free_months_earned int default 0;

-- Auto-generate referral code on new profile
create or replace function public.generate_referral_code()
returns trigger language plpgsql as $$
begin
  new.referral_code := lower(substring(md5(new.id::text) for 8));
  return new;
end;
$$;

create trigger set_referral_code
  before insert on public.profiles
  for each row execute function public.generate_referral_code();
