-- Migration: Constraints and indexes for clapcheeks_queued_replies (DB-07, DB-08)

-- DB-07: CHECK constraint on status column
-- First update any invalid status values to 'queued' (safety net)
UPDATE public.clapcheeks_queued_replies
  SET status = 'queued'
  WHERE status NOT IN ('queued', 'sent', 'failed');

-- Add CHECK constraint (will fail if invalid rows exist, hence the UPDATE above)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'clapcheeks_queued_replies'
    AND constraint_name = 'check_valid_status'
  ) THEN
    ALTER TABLE public.clapcheeks_queued_replies
      ADD CONSTRAINT check_valid_status
      CHECK (status IN ('queued', 'sent', 'failed'));
  END IF;
END $$;

-- DB-08: Composite index for efficient queue lookups
CREATE INDEX IF NOT EXISTS idx_queued_replies_user_status
  ON public.clapcheeks_queued_replies(user_id, status);

-- Additional index for dashboard queries sorted by creation time
CREATE INDEX IF NOT EXISTS idx_queued_replies_user_created
  ON public.clapcheeks_queued_replies(user_id, created_at DESC);
