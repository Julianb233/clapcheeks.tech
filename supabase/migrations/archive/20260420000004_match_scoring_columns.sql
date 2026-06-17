-- Phase I: Rule-based match scoring columns
-- Adds scoring fields to clapcheeks_matches so the dashboard can sort by
-- final_score the moment a match is pulled from Tinder/Hinge.
--
-- Weight source of truth lives in:
--   clapcheeks_user_settings.persona.ranking_weights
-- for user 9c848c51-8996-4f1f-9dbf-50128e3408ea.
--
-- final_score = 0.35 * location_score + 0.65 * criteria_score
-- If any dealbreaker flag is hit, final_score = 0.0 and flags are captured.
-- Casual-intent signals contribute up to +18 points into criteria_score.
--
-- cluster_id is reserved for Phase K (duplicate / same-person cluster
-- detection) and is left NULL for now.

ALTER TABLE public.clapcheeks_matches
    ADD COLUMN IF NOT EXISTS location_score     REAL,
    ADD COLUMN IF NOT EXISTS criteria_score     REAL,
    ADD COLUMN IF NOT EXISTS final_score        REAL,
    ADD COLUMN IF NOT EXISTS dealbreaker_flags  JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS scoring_reason     TEXT,
    ADD COLUMN IF NOT EXISTS distance_miles     REAL,
    ADD COLUMN IF NOT EXISTS cluster_id         UUID,
    ADD COLUMN IF NOT EXISTS scored_at          TIMESTAMPTZ;

-- Dashboard sort: fastest-to-slowest sorted scan on score
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_final_score
    ON public.clapcheeks_matches (final_score DESC NULLS LAST);

-- Daemon lookup: unscored rows
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_unscored
    ON public.clapcheeks_matches (user_id, created_at DESC)
    WHERE final_score IS NULL;
