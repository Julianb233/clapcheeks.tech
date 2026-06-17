-- Migration: Consolidate analytics_daily tables into clapcheeks_analytics_daily (DB-02)
--
-- Problem: Two analytics tables exist:
--   1. clapcheeks_analytics_daily (from outward_analytics_daily rename in migration 004)
--      - Columns: platform, swipes_right, swipes_left, matches, messages_sent, dates_booked
--   2. analytics_daily (from migration 009)
--      - Columns: app, swipes_right, swipes_left, matches, conversations_started, dates_booked, money_spent
--
-- The app code (dashboard, coaching, reports) uses analytics_daily.
-- The agent sync and admin pages use clapcheeks_analytics_daily.
-- We consolidate into clapcheeks_analytics_daily using the migration 009 schema (more complete).

-- Step 1: Drop the old clapcheeks_analytics_daily (from outward rename) if it exists
-- This table has less data/columns than analytics_daily
DROP TABLE IF EXISTS public.clapcheeks_analytics_daily CASCADE;

-- Step 2: Rename analytics_daily to clapcheeks_analytics_daily
ALTER TABLE IF EXISTS public.analytics_daily RENAME TO clapcheeks_analytics_daily;

-- Step 3: Rename the index from analytics_daily to clapcheeks prefix
DROP INDEX IF EXISTS public.idx_analytics_daily_user_date;
CREATE INDEX IF NOT EXISTS idx_clapcheeks_analytics_daily_user_date
  ON public.clapcheeks_analytics_daily(user_id, date);

-- Step 4: Ensure RLS is enabled and policies exist
ALTER TABLE public.clapcheeks_analytics_daily ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- SELECT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_analytics_daily'
    AND policyname = 'analytics_daily_select_own'
  ) THEN
    CREATE POLICY "analytics_daily_select_own"
      ON public.clapcheeks_analytics_daily FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  -- INSERT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_analytics_daily'
    AND policyname = 'analytics_daily_insert_own'
  ) THEN
    CREATE POLICY "analytics_daily_insert_own"
      ON public.clapcheeks_analytics_daily FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  -- UPDATE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_analytics_daily'
    AND policyname = 'analytics_daily_update_own'
  ) THEN
    CREATE POLICY "analytics_daily_update_own"
      ON public.clapcheeks_analytics_daily FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;
END $$;
