-- Phase H (AI-8322): ML preference learner — swipe decision log + model weights.
--
-- Captures every like/pass/super_like decision (both retroactive imports from
-- Tinder/Hinge GDPR exports and forward-going live swipes) so the nightly
-- trainer can fit a logistic regression / gradient boosted classifier and
-- write serialized weights back to clapcheeks_user_settings.preference_model_v.
--
-- Phase I scoring blends the model output with the rule-based score at
-- intake so >0.85 auto-likes and <0.15 auto-passes. Below 200 decisions we
-- fall back to rules only.
--
-- Idempotent: safe to rerun.

-- ---------------------------------------------------------------------------
-- clapcheeks_swipe_decisions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clapcheeks_swipe_decisions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL,
    match_id         UUID REFERENCES public.clapcheeks_matches(id) ON DELETE SET NULL,
    platform         TEXT NOT NULL,
    external_id      TEXT,
    features         JSONB NOT NULL,
    model_score      REAL,
    decision         TEXT NOT NULL CHECK (decision IN ('like','pass','super_like')),
    julian_override  BOOLEAN DEFAULT false,
    decided_at       TIMESTAMPTZ DEFAULT now()
);

-- Hot path: "recent swipes for this user" — trainer + dashboard both use it.
CREATE INDEX IF NOT EXISTS idx_swipe_decisions_user
    ON public.clapcheeks_swipe_decisions (user_id, decided_at DESC);

-- Secondary: dedupe + reingest support on retroactive GDPR imports.
CREATE INDEX IF NOT EXISTS idx_swipe_decisions_platform_external
    ON public.clapcheeks_swipe_decisions (user_id, platform, external_id)
    WHERE external_id IS NOT NULL;

-- RLS: match the pattern used on clapcheeks_matches / clapcheeks_agent_events.
ALTER TABLE public.clapcheeks_swipe_decisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE tablename = 'clapcheeks_swipe_decisions'
           AND policyname = 'Users see own swipe decisions'
    ) THEN
        CREATE POLICY "Users see own swipe decisions"
            ON public.clapcheeks_swipe_decisions
            FOR SELECT USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE tablename = 'clapcheeks_swipe_decisions'
           AND policyname = 'Users insert own swipe decisions'
    ) THEN
        CREATE POLICY "Users insert own swipe decisions"
            ON public.clapcheeks_swipe_decisions
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- clapcheeks_user_settings.preference_model_v
-- ---------------------------------------------------------------------------
-- JSONB column holds the serialized classifier: {model_type, coefficients or
-- tree_json, feature_keys, accuracy, trained_at, n_samples}. Phase I scoring
-- loads and inferences against this.

ALTER TABLE public.clapcheeks_user_settings
    ADD COLUMN IF NOT EXISTS preference_model_v JSONB;

COMMENT ON COLUMN public.clapcheeks_user_settings.preference_model_v
    IS 'Phase H (AI-8322): serialized preference classifier — weights + feature keys + metadata. Null until trainer fires.';
