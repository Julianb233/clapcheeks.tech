-- Track reschedules and flakes as first-class signals on every match.
-- flake_count already exists; add reschedule_count + audit-log table.

ALTER TABLE IF EXISTS public.clapcheeks_matches
  ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.clapcheeks_matches
  ADD COLUMN IF NOT EXISTS last_reschedule_at timestamptz;

ALTER TABLE IF EXISTS public.clapcheeks_matches
  ADD COLUMN IF NOT EXISTS last_flake_at timestamptz;

-- Append-only event log so Julian can scroll the history without touching the
-- match row's running counters. Used by the dashboard "she rescheduled / she
-- flaked" UI and by the python coach to factor history into close_probability.
CREATE TABLE IF NOT EXISTS public.clapcheeks_date_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  match_id uuid REFERENCES public.clapcheeks_matches(id) ON DELETE CASCADE NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'date_proposed',
    'date_booked',
    'date_attended',
    'rescheduled',
    'flaked',
    'cancelled_by_him',
    'cancelled_by_her'
  )),
  original_slot timestamptz,
  new_slot timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_date_events_user_match
  ON public.clapcheeks_date_events(user_id, match_id, created_at DESC);

ALTER TABLE public.clapcheeks_date_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clapcheeks_date_events' AND policyname='date_events_select_own') THEN
    CREATE POLICY "date_events_select_own"
      ON public.clapcheeks_date_events FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clapcheeks_date_events' AND policyname='date_events_insert_own') THEN
    CREATE POLICY "date_events_insert_own"
      ON public.clapcheeks_date_events FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
