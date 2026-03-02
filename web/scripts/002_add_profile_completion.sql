-- Add profile completion fields to profiles table
alter table public.profiles
add column if not exists profile_completed boolean default false,
add column if not exists emergency_contact_name text,
add column if not exists emergency_contact_phone text,
add column if not exists address text,
add column if not exists identity_verified boolean default false,
add column if not exists identity_verification_provider text,
add column if not exists identity_verification_id text,
add column if not exists identity_verification_date timestamptz;

-- Create index for profile completion checks
create index if not exists idx_profiles_completed on public.profiles(id, profile_completed);
