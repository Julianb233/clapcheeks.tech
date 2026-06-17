-- Profile Photos: user-owned photo library categorized for dating-app profile building.
-- Sources: direct upload (drag-drop), Instagram import, Mac Photos sync.

CREATE TABLE IF NOT EXISTS public.profile_photos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_path  TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT 'uncategorized',
    source        TEXT NOT NULL DEFAULT 'upload'
                    CHECK (source IN ('upload','instagram','mac_photos')),
    source_ref    TEXT,
    caption       TEXT,
    width         INT,
    height        INT,
    bytes         BIGINT,
    mime_type     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, storage_path)
);

CREATE INDEX IF NOT EXISTS profile_photos_user_category_idx
    ON public.profile_photos (user_id, category, created_at DESC);

ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='profile_photos'
          AND policyname='profile_photos owner all'
    ) THEN
        CREATE POLICY "profile_photos owner all"
            ON public.profile_photos FOR ALL
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- Storage bucket (private). Mirror of match-photos pattern.
INSERT INTO storage.buckets (id, name, public)
     VALUES ('profile-photos', 'profile-photos', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='storage' AND tablename='objects'
          AND policyname='profile-photos owner select'
    ) THEN
        CREATE POLICY "profile-photos owner select"
            ON storage.objects FOR SELECT
            USING (bucket_id = 'profile-photos' AND owner = auth.uid());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='storage' AND tablename='objects'
          AND policyname='profile-photos owner insert'
    ) THEN
        CREATE POLICY "profile-photos owner insert"
            ON storage.objects FOR INSERT
            WITH CHECK (bucket_id = 'profile-photos' AND owner = auth.uid());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='storage' AND tablename='objects'
          AND policyname='profile-photos owner delete'
    ) THEN
        CREATE POLICY "profile-photos owner delete"
            ON storage.objects FOR DELETE
            USING (bucket_id = 'profile-photos' AND owner = auth.uid());
    END IF;
END $$;
