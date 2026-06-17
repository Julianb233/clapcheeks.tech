-- Phase K (AI-8339): Social graph collision detector + friend-cluster dedupe.
--
-- Extends public.clapcheeks_matches with mutual-friend + cluster columns so
-- the daemon can flag high-overlap matches and the dashboard can surface
-- cluster relationships. Additive only: every column is guarded with
-- IF NOT EXISTS so this can land alongside Phase J's roster migration
-- without conflict.
--
-- Schema (all nullable / defaulted):
--   mutual_friends_count INT         -- count surfaced in UI and used for band
--   mutual_friends_list JSONB        -- [{name, handle, source, confidence}]
--   social_risk_band TEXT            -- safe | watch | high_risk | auto_flag
--   friend_cluster_id UUID           -- shared id across cluster members
--   cluster_rank INT                 -- 1 = leader, 2+ = suppressed
--   shared_female_friends JSONB      -- intersection used for cluster trigger
--   social_graph_confidence REAL     -- 0..1 detector confidence
--   social_graph_sources JSONB       -- ["hinge_native","ig_overlap",...]
--   social_graph_scanned_at TIMESTAMPTZ  -- last detection run
--
-- Indexes:
--   idx_clapcheeks_matches_friend_cluster_id   (friend_cluster_id)
--   idx_clapcheeks_matches_social_risk_band    (social_risk_band)
--
-- Note: Phase I added a nullable `cluster_id` column reserved for "Phase K".
-- We keep that column untouched (don't rename, don't drop) and use the new
-- `friend_cluster_id` as the canonical social-cluster id per the AI-8339
-- scope. This avoids colliding with any other phase that may have already
-- populated `cluster_id` with a different semantic.

ALTER TABLE public.clapcheeks_matches
    ADD COLUMN IF NOT EXISTS mutual_friends_count     INT         DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mutual_friends_list      JSONB       DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS social_risk_band         TEXT        DEFAULT 'safe',
    ADD COLUMN IF NOT EXISTS friend_cluster_id        UUID,
    ADD COLUMN IF NOT EXISTS cluster_rank             INT         DEFAULT 1,
    ADD COLUMN IF NOT EXISTS shared_female_friends    JSONB       DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS social_graph_confidence  REAL,
    ADD COLUMN IF NOT EXISTS social_graph_sources     JSONB       DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS social_graph_scanned_at  TIMESTAMPTZ;

-- Soft CHECK for social_risk_band (only add if not already present, so a
-- prior phase cannot conflict with us).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_social_risk_band_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_social_risk_band_check
            CHECK (
                social_risk_band IN ('safe', 'watch', 'high_risk', 'auto_flag')
            );
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_friend_cluster_id
    ON public.clapcheeks_matches (friend_cluster_id)
    WHERE friend_cluster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_social_risk_band
    ON public.clapcheeks_matches (user_id, social_risk_band)
    WHERE social_risk_band IS NOT NULL;

-- Daemon lookup: un-scanned rows for social graph detection.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_social_unscanned
    ON public.clapcheeks_matches (user_id, created_at DESC)
    WHERE social_graph_scanned_at IS NULL;
