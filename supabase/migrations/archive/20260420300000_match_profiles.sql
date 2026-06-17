-- Migration: match_profiles — rich profile engine for every match
-- Extends clapcheeks_leads with deep enrichment data: zodiac compatibility,
-- Instagram scrape results, DISC communication profile, and AI-extracted interests.

-- ---------------------------------------------------------------------------
-- match_profiles — one row per enriched match profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lead_id             UUID REFERENCES public.clapcheeks_leads(id) ON DELETE SET NULL,

    -- Basic identity (can exist without a lead — manual add)
    name                TEXT NOT NULL,
    age                 INTEGER,
    platform            TEXT,                 -- tinder | hinge | bumble | manual
    match_id            TEXT,                 -- platform-native id (nullable for manual)

    -- Birthday + zodiac
    birthday            DATE,
    zodiac_sign         TEXT,                 -- Aries, Taurus, ...
    zodiac_cusp         TEXT,                 -- e.g. "Aries-Taurus cusp" if within 2 days
    user_zodiac_sign    TEXT,                 -- the user's own sign for compatibility
    zodiac_compatibility_score NUMERIC(3,1),  -- 0.0–10.0
    zodiac_compatibility_desc  TEXT,          -- "Great chemistry — fire meets air"

    -- Bio + prompts snapshot
    bio_text            TEXT,
    prompts             JSONB DEFAULT '[]'::jsonb,   -- [{question, answer}]
    photos_urls         JSONB DEFAULT '[]'::jsonb,   -- [url, url, ...]

    -- Instagram enrichment
    instagram_handle    TEXT,
    instagram_data      JSONB DEFAULT '{}'::jsonb,   -- raw scraped profile
    instagram_scraped_at TIMESTAMPTZ,
    instagram_interests JSONB DEFAULT '[]'::jsonb,   -- AI-extracted interests
    instagram_bio       TEXT,
    instagram_followers INTEGER,
    instagram_following INTEGER,
    instagram_post_count INTEGER,

    -- AI-extracted interests (combined from all sources)
    interests           JSONB DEFAULT '[]'::jsonb,   -- ["travel", "yoga", ...]
    interest_overlap    JSONB DEFAULT '[]'::jsonb,   -- interests shared with user

    -- Communication profile (DISC-based)
    disc_type           TEXT,                 -- D, I, S, C or blend like "DI"
    disc_scores         JSONB DEFAULT '{}'::jsonb,   -- {D:0.7, I:0.5, S:0.2, C:0.1}
    communication_style TEXT,                 -- "direct and assertive"
    conversation_strategy TEXT,               -- AI-generated approach for this person
    opener_suggestions  JSONB DEFAULT '[]'::jsonb,   -- AI-generated openers
    topics_to_discuss   JSONB DEFAULT '[]'::jsonb,   -- good conversation topics
    topics_to_avoid     JSONB DEFAULT '[]'::jsonb,   -- risky topics for this person

    -- Enrichment pipeline state
    enrichment_status   TEXT DEFAULT 'pending',  -- pending | enriching | complete | failed
    enrichment_error    TEXT,
    enriched_at         TIMESTAMPTZ,

    -- User notes
    notes               TEXT,
    tags                JSONB DEFAULT '[]'::jsonb,   -- ["promising", "funny", ...]
    favorited           BOOLEAN DEFAULT false,

    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),

    UNIQUE (user_id, platform, match_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_match_profiles_user
    ON public.match_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_match_profiles_lead
    ON public.match_profiles (lead_id)
    WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_match_profiles_enrichment
    ON public.match_profiles (user_id, enrichment_status);
CREATE INDEX IF NOT EXISTS idx_match_profiles_zodiac
    ON public.match_profiles (user_id, zodiac_sign);
CREATE INDEX IF NOT EXISTS idx_match_profiles_instagram
    ON public.match_profiles (instagram_handle)
    WHERE instagram_handle IS NOT NULL;

-- RLS
ALTER TABLE public.match_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_profiles_owner_select" ON public.match_profiles;
CREATE POLICY "match_profiles_owner_select" ON public.match_profiles
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "match_profiles_owner_insert" ON public.match_profiles;
CREATE POLICY "match_profiles_owner_insert" ON public.match_profiles
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "match_profiles_owner_update" ON public.match_profiles;
CREATE POLICY "match_profiles_owner_update" ON public.match_profiles
    FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "match_profiles_owner_delete" ON public.match_profiles;
CREATE POLICY "match_profiles_owner_delete" ON public.match_profiles
    FOR DELETE USING (user_id = auth.uid());

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION public._match_profiles_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_profiles_updated_at ON public.match_profiles;
CREATE TRIGGER trg_match_profiles_updated_at
    BEFORE UPDATE ON public.match_profiles
    FOR EACH ROW EXECUTE FUNCTION public._match_profiles_set_updated_at();
