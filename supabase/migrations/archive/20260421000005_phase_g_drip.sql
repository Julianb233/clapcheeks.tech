-- Phase G (AI-8321): Follow-up drip daemon state columns.
--
-- Adds the state needed on clapcheeks_matches for the drip state machine to
-- reason about cadence, bump caps, outcome prompts, and outcome labels.
-- Everything is NULL-safe and idempotent.
--
-- The drip worker reads `persona.followup_cadence` from
-- clapcheeks_user_settings (no schema change needed there — persona is JSONB)
-- and writes per-match state here.

-- ---------------------------------------------------------------------------
-- clapcheeks_matches — drip state
-- ---------------------------------------------------------------------------

ALTER TABLE public.clapcheeks_matches
    ADD COLUMN IF NOT EXISTS last_drip_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS drip_count           INT       DEFAULT 0,
    ADD COLUMN IF NOT EXISTS outcome_prompted_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS outcome              TEXT;

-- outcome is a small closed enum when set; NULL is fine (no outcome captured).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_outcome_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_outcome_check
            CHECK (
                outcome IS NULL
                OR outcome IN ('closed', 'second_date', 'nope')
            );
    END IF;
END $$;

-- Daemon lookup: "who needs a drip next?" — cheap index to keep the 15-min
-- scan O(recent rows) instead of full-table.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_last_drip_at
    ON public.clapcheeks_matches (user_id, last_drip_at);

-- Daemon lookup: date_booked rows whose outcome hasn't been captured yet.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_outcome_pending
    ON public.clapcheeks_matches (user_id, status, outcome_prompted_at)
    WHERE outcome IS NULL;
