-- Migration: Add UPDATE/DELETE RLS policies on clapcheeks_queued_replies (DB-06)
-- Currently only SELECT and INSERT policies exist (from migration 012).
-- Users need UPDATE (to modify queued messages) and DELETE (to cancel them).

DO $$ BEGIN
  -- UPDATE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_queued_replies'
    AND policyname = 'Users can update own queued replies'
  ) THEN
    CREATE POLICY "Users can update own queued replies"
      ON public.clapcheeks_queued_replies FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  -- DELETE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_queued_replies'
    AND policyname = 'Users can delete own queued replies'
  ) THEN
    CREATE POLICY "Users can delete own queued replies"
      ON public.clapcheeks_queued_replies FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
