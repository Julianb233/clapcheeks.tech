-- Phase J (AI-8338): Roster CRM view — health score, stage pipeline,
-- Julian rank, close probability, bonus factors.
--
-- Extends clapcheeks_matches with columns used by:
--   * /dashboard/roster kanban (stage, health_score, julian_rank, close_probability)
--   * Health score cron (messages_*, his_to_her_ratio, avg_reply_hours, etc.)
--   * Bonus factors (geographic_cluster_id, red_flags, boundary_flags_count,
--     last_her_initiated_at, sentiment_trajectory, night_energy, recurrence_score)
--
-- IMPORTANT: every ADD COLUMN uses IF NOT EXISTS because Phase K is landing
-- in parallel on the same table (geographic cluster + duplicate detection).
-- Order of application between Phase J/K is not guaranteed.

ALTER TABLE public.clapcheeks_matches
    -- Pipeline stage (roster column / kanban swim lane).
    ADD COLUMN IF NOT EXISTS stage                     TEXT     DEFAULT 'new_match',
    -- Health score 0-100, recomputed hourly by agent/clapcheeks/roster/health.py
    ADD COLUMN IF NOT EXISTS health_score              INT,
    ADD COLUMN IF NOT EXISTS health_score_updated_at   TIMESTAMPTZ,
    -- Julian-set rank 1-10 (subjective override signal for Phase H ML model).
    ADD COLUMN IF NOT EXISTS julian_rank               INT,
    -- Derived close probability 0.0-1.0 (final_score * health_score * stage_mult).
    ADD COLUMN IF NOT EXISTS close_probability         REAL,
    -- Volume + cadence metrics
    ADD COLUMN IF NOT EXISTS messages_total            INT      DEFAULT 0,
    ADD COLUMN IF NOT EXISTS messages_7d               INT      DEFAULT 0,
    ADD COLUMN IF NOT EXISTS messages_30d              INT      DEFAULT 0,
    ADD COLUMN IF NOT EXISTS his_to_her_ratio          REAL,
    ADD COLUMN IF NOT EXISTS avg_reply_hours           REAL,
    ADD COLUMN IF NOT EXISTS time_to_date_days         INT,
    ADD COLUMN IF NOT EXISTS flake_count               INT      DEFAULT 0,
    -- Qualitative / ML-style signals
    ADD COLUMN IF NOT EXISTS sentiment_trajectory      TEXT,
    ADD COLUMN IF NOT EXISTS night_energy              REAL,
    ADD COLUMN IF NOT EXISTS recurrence_score          REAL,
    -- Boundary / red-flag tracking (drives auto-archive)
    ADD COLUMN IF NOT EXISTS red_flags                 JSONB    DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS boundary_flags_count      INT      DEFAULT 0,
    -- Engagement tracking
    ADD COLUMN IF NOT EXISTS last_her_initiated_at     TIMESTAMPTZ,
    -- Bonus factor: geographic clustering for date-chaining.
    -- Phase K may also add this column; IF NOT EXISTS handles the race.
    ADD COLUMN IF NOT EXISTS geographic_cluster_id     UUID;

-- Stage enum (permissive CHECK — Phase K may add archived_cluster_dupe).
-- Using DO $$ so we can drop/replace cleanly if the set changes later.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_stage_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_stage_check
            CHECK (
                stage IN (
                    'new_match',
                    'chatting',
                    'chatting_phone',
                    'date_proposed',
                    'date_booked',
                    'date_attended',
                    'hooked_up',
                    'recurring',
                    'faded',
                    'ghosted',
                    'archived',
                    'archived_cluster_dupe'
                )
            );
    END IF;
END $$;

-- Julian rank range 1-10.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_julian_rank_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_julian_rank_check
            CHECK (julian_rank IS NULL OR (julian_rank BETWEEN 1 AND 10));
    END IF;
END $$;

-- Roster kanban sort: fast "pull top N per stage".
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_stage_close
    ON public.clapcheeks_matches (user_id, stage, close_probability DESC NULLS LAST);

-- Daily top-3 lookup: highest close_probability needing outreach today.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_close_probability
    ON public.clapcheeks_matches (user_id, close_probability DESC NULLS LAST)
    WHERE stage NOT IN ('archived', 'archived_cluster_dupe', 'ghosted', 'faded');

-- Health-score recompute cron: "who's stale?"
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_health_updated
    ON public.clapcheeks_matches (user_id, health_score_updated_at NULLS FIRST);

-- Geographic cluster lookup for date-chaining.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_geo_cluster
    ON public.clapcheeks_matches (user_id, geographic_cluster_id)
    WHERE geographic_cluster_id IS NOT NULL;
