-- Phase B: Photo vision analysis (AI-8316)
--
-- Extends clapcheeks_photo_scores to store per-photo Claude Vision output
-- so Phase I's rule-based scorer can read body-type / activity / travel /
-- food / energy signals off real image analysis instead of keyword guesses.
--
-- The original schema (20240101000010_photo_scores.sql) stored only user
-- photo QA heuristics (face/smile/lighting). For match photos we need a
-- superset with structured tags + a photo_hash to dedupe re-runs.
--
-- All new columns are nullable so existing user-photo-scorer rows keep
-- working. New match-photo rows are identified by having match_id set.

ALTER TABLE public.clapcheeks_photo_scores
    ADD COLUMN IF NOT EXISTS match_id          UUID REFERENCES public.clapcheeks_matches(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS photo_url         TEXT,
    ADD COLUMN IF NOT EXISTS photo_hash        TEXT,
    ADD COLUMN IF NOT EXISTS activities        JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS locations         JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS food_signals      JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS aesthetic         TEXT,
    ADD COLUMN IF NOT EXISTS energy            TEXT,
    ADD COLUMN IF NOT EXISTS solo_vs_group     TEXT,
    ADD COLUMN IF NOT EXISTS travel_signals    JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS notable_details   JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS vision_model      TEXT DEFAULT 'claude-sonnet-4-6',
    ADD COLUMN IF NOT EXISTS analyzed_at       TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS cost_usd          REAL DEFAULT 0;

-- The legacy user-photo scorer required filename / score NOT NULL. Relax
-- both so match-photo rows (which have photo_url instead of filename)
-- can be inserted without a bogus score value.
ALTER TABLE public.clapcheeks_photo_scores
    ALTER COLUMN filename DROP NOT NULL,
    ALTER COLUMN score    DROP NOT NULL;

-- Dedupe: one row per (match, photo). Rerunning the worker on the same
-- match_id + photo_hash updates the existing row instead of creating a
-- duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_photo_scores_match_photo
    ON public.clapcheeks_photo_scores (match_id, photo_hash)
    WHERE match_id IS NOT NULL AND photo_hash IS NOT NULL;

-- Daemon lookup: unanalyzed match_id lookups
CREATE INDEX IF NOT EXISTS idx_photo_scores_match_analyzed
    ON public.clapcheeks_photo_scores (match_id, analyzed_at DESC)
    WHERE match_id IS NOT NULL;

-- RLS: policy on the legacy table only allowed auth.uid() = user_id.
-- Service-role writes (which the daemon uses) bypass RLS, so no change
-- needed. Leave the existing policy in place.
