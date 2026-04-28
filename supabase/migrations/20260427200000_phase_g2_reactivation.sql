-- Phase G2 (AI-8804): Ghost-recovery / reactivation campaign columns.
--
-- Ghosted matches previously sat abandoned forever. This migration adds the
-- columns the drip state machine needs to schedule and track low-pressure
-- reactivation attempts N days after a match is marked ghosted.
--
-- Additive only (IF NOT EXISTS / DO $$). Safe to re-run.

-- ---------------------------------------------------------------------------
-- clapcheeks_matches — reactivation state
-- ---------------------------------------------------------------------------

ALTER TABLE public.clapcheeks_matches
    ADD COLUMN IF NOT EXISTS reactivation_count        INT          DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_reactivation_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reactivation_eligible_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reactivation_outcome      TEXT,
    ADD COLUMN IF NOT EXISTS reactivation_disabled     BOOLEAN      DEFAULT FALSE;

-- reactivation_outcome is a small closed enum when set; NULL means "pending /
-- not yet attempted and concluded".
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_reactivation_outcome_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_reactivation_outcome_check
            CHECK (
                reactivation_outcome IS NULL
                OR reactivation_outcome IN ('replied', 'ignored', 'burned', 'opted_out')
            );
    END IF;
END $$;

-- Partial index: quickly find ghosted matches that are eligible for
-- reactivation and have not been disabled or burned.
-- The daemon scans this every 15 min.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_reactivation_eligible
    ON public.clapcheeks_matches (user_id, reactivation_eligible_at)
    WHERE status = 'ghosted'
      AND reactivation_disabled IS NOT TRUE
      AND reactivation_outcome IS NULL;
