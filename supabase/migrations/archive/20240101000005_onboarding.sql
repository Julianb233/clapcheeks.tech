-- Add onboarding fields to profiles
alter table public.profiles
  add column if not exists onboarding_completed boolean default false,
  add column if not exists selected_mode text,
  add column if not exists selected_platforms text[];
