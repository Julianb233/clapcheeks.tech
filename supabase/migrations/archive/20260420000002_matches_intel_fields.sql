-- Phase A (AI-8315): Match intake loop storage.
--
-- Extends public.clapcheeks_matches so the daemon can store full profile
-- intel pulled directly from Tinder + Hinge APIs, plus photo mirrors stored
-- in the `match-photos` Supabase Storage bucket. Phase B/C columns
-- (vision_summary, instagram_intel) are added now but left NULL-able so
-- later phases can fill them without another migration.
--
-- The existing columns (id, user_id, platform, match_id, match_name, opened,
-- opener_sent_at, created_at) are preserved. `external_id` mirrors match_id
-- so the UNIQUE key reads naturally but we do not migrate data (safe —
-- match_id IS the external id from each platform).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.clapcheeks_matches
    ADD COLUMN IF NOT EXISTS external_id        TEXT,
    ADD COLUMN IF NOT EXISTS name               TEXT,
    ADD COLUMN IF NOT EXISTS age                INT,
    ADD COLUMN IF NOT EXISTS bio                TEXT,
    ADD COLUMN IF NOT EXISTS photos_jsonb       JSONB  DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS prompts_jsonb      JSONB  DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS job                TEXT,
    ADD COLUMN IF NOT EXISTS school             TEXT,
    ADD COLUMN IF NOT EXISTS instagram_handle   TEXT,
    ADD COLUMN IF NOT EXISTS spotify_artists    JSONB,
    ADD COLUMN IF NOT EXISTS birth_date         DATE,
    ADD COLUMN IF NOT EXISTS zodiac             TEXT,
    ADD COLUMN IF NOT EXISTS match_intel        JSONB,
    ADD COLUMN IF NOT EXISTS vision_summary     TEXT,       -- filled by Phase B
    ADD COLUMN IF NOT EXISTS instagram_intel    JSONB,      -- filled by Phase C
    ADD COLUMN IF NOT EXISTS status             TEXT        DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS last_activity_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT now();

-- Backfill external_id from match_id so the new unique constraint is satisfied
UPDATE public.clapcheeks_matches
   SET external_id = match_id
 WHERE external_id IS NULL
   AND match_id IS NOT NULL;

-- Status allowed values guard (soft enforcement — extendable later)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_status_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_status_check
            CHECK (status IN (
                'new', 'opened', 'conversing', 'stalled',
                'date_proposed', 'date_booked', 'dated', 'ghosted'
            ));
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Unique (user_id, platform, external_id) for idempotent upsert
-- ---------------------------------------------------------------------------

-- A looser (user_id, platform, match_id) unique may already exist from the
-- 2024-01 migration. Add the new-shape unique too; keep both for safety.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_user_platform_external_uq'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_user_platform_external_uq
            UNIQUE (user_id, platform, external_id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes for common dashboard queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_status
    ON public.clapcheeks_matches (user_id, status, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_platform
    ON public.clapcheeks_matches (user_id, platform);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_updated_at
    ON public.clapcheeks_matches (updated_at DESC);

-- ---------------------------------------------------------------------------
-- 4. updated_at auto-touch trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.clapcheeks_matches_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clapcheeks_matches_touch_updated_at
    ON public.clapcheeks_matches;

CREATE TRIGGER trg_clapcheeks_matches_touch_updated_at
    BEFORE UPDATE ON public.clapcheeks_matches
    FOR EACH ROW
    EXECUTE FUNCTION public.clapcheeks_matches_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RLS — reaffirm owner-only access for all new columns (already enabled
--    in 20240101000002_outward_core.sql, but RLS is enforced per-policy so
--    the existing SELECT/INSERT/UPDATE policies cover the new columns
--    automatically). Add a DELETE policy so users can remove matches too.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE tablename  = 'clapcheeks_matches'
           AND policyname = 'Users can delete own matches'
    ) THEN
        CREATE POLICY "Users can delete own matches"
            ON public.clapcheeks_matches FOR DELETE
            USING (auth.uid() = user_id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Storage bucket for match photo mirrors
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
     VALUES ('match-photos', 'match-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Allow the owner (user_id encoded as the first path segment) to read/write
-- their own match photos. Service role bypasses RLS so the daemon is fine.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename  = 'objects'
           AND policyname = 'match-photos owner select'
    ) THEN
        CREATE POLICY "match-photos owner select"
            ON storage.objects FOR SELECT
            USING (
                bucket_id = 'match-photos'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename  = 'objects'
           AND policyname = 'match-photos owner delete'
    ) THEN
        CREATE POLICY "match-photos owner delete"
            ON storage.objects FOR DELETE
            USING (
                bucket_id = 'match-photos'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
END $$;
