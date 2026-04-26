-- Dedupe table for cron-triggered hot-reply notifications.
-- One row per (match_id, last_her_initiated_at) so we never ping twice
-- for the same inbound message even if the cron overlaps.
CREATE TABLE IF NOT EXISTS public.clapcheeks_match_notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  match_id uuid REFERENCES public.clapcheeks_matches(id) ON DELETE CASCADE NOT NULL,
  dedupe_key text UNIQUE NOT NULL,
  channel text NOT NULL DEFAULT 'imessage',
  body text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_match_notifications_user_match
  ON public.clapcheeks_match_notifications(user_id, match_id, sent_at DESC);

ALTER TABLE public.clapcheeks_match_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clapcheeks_match_notifications' AND policyname='match_notifications_select_own') THEN
    CREATE POLICY "match_notifications_select_own"
      ON public.clapcheeks_match_notifications FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clapcheeks_match_notifications' AND policyname='match_notifications_insert_service') THEN
    CREATE POLICY "match_notifications_insert_service"
      ON public.clapcheeks_match_notifications FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
