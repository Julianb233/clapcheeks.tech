-- Migration: Restrict profiles RLS to own-row only (DB-05)
-- Problem: scripts/001_create_schema.sql created "profiles_select_all" with USING (true)
-- which lets any authenticated user read any other user's profile data.

-- Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop overly permissive policies
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

-- Ensure restrictive own-row policies exist
DO $$ BEGIN
  -- SELECT: only own profile
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Users can view own profile'
  ) THEN
    CREATE POLICY "Users can view own profile"
      ON public.profiles FOR SELECT
      USING (auth.uid() = id);
  END IF;

  -- UPDATE: only own profile
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Users can update own profile'
  ) THEN
    CREATE POLICY "Users can update own profile"
      ON public.profiles FOR UPDATE
      USING (auth.uid() = id);
  END IF;

  -- INSERT: only own profile (for trigger-based creation)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY "profiles_insert_own"
      ON public.profiles FOR INSERT
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- Also drop the overly permissive delete policy from scripts/001
DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
-- No DELETE policy on profiles — users should not be able to delete their profile
-- (cascaded from auth.users deletion instead)
