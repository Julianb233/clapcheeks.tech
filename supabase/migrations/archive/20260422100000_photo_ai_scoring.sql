-- AI-8458 sibling / follow-on: Claude vision auto-scoring for profile photos.
--
-- Extends public.profile_photos (the user's own photo library used for
-- dating-app profile curation) with Claude-Vision-derived fields. The
-- category stays user-owned; `ai_category_suggested` is advisory only and
-- surfaced in the UI as a one-click "apply suggestion" affordance.
--
-- Safe to run standalone: creates the table if a parallel migration has
-- not landed yet, then idempotently adds the AI columns. Existing rows
-- stay intact; all new columns are nullable.

CREATE TABLE IF NOT EXISTS public.profile_photos (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'uncategorized',
    source       TEXT,
    source_ref   TEXT,
    caption      TEXT,
    width        INT,
    height       INT,
    bytes        BIGINT,
    mime_type    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_photos_user_category
    ON public.profile_photos (user_id, category);

ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'profile_photos'
          AND policyname = 'profile_photos_owner_all'
    ) THEN
        CREATE POLICY profile_photos_owner_all ON public.profile_photos
            FOR ALL USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- AI scoring columns (the scope of this migration per AI-8458 follow-on).
ALTER TABLE public.profile_photos
    ADD COLUMN IF NOT EXISTS ai_score               INT,
    ADD COLUMN IF NOT EXISTS ai_score_reason        TEXT,
    ADD COLUMN IF NOT EXISTS ai_category_suggested  TEXT,
    ADD COLUMN IF NOT EXISTS ai_categorized_at      TIMESTAMPTZ;
