-- Voice transcription + AI First Date context + Google Calendar OAuth
-- Session 2026-04-22 (Julian): whole-app voice input, AI First Date
-- onboarding interview, and calendar integration for scheduling dates.

-- ============================================================================
-- 1. user_voice_context
-- ----------------------------------------------------------------------------
-- Stores the structured output of the AI First Date interview plus any free-
-- form user context the agent should pull from. One row per user. `answers`
-- is a JSON object keyed by question_id so the question set can evolve
-- without a schema change.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_voice_context (
    user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    answers        JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary        TEXT,
    persona_blob   TEXT,
    completed_at   TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_voice_context_completed
    ON public.user_voice_context (completed_at)
    WHERE completed_at IS NOT NULL;

ALTER TABLE public.user_voice_context ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'user_voice_context'
          AND policyname = 'user_voice_context_owner_all'
    ) THEN
        CREATE POLICY user_voice_context_owner_all ON public.user_voice_context
            FOR ALL USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================================
-- 2. voice_transcripts
-- ----------------------------------------------------------------------------
-- Audit log of every Whisper call. Lets us debug bad transcriptions, build
-- analytics, and re-derive answers if the AI First Date pipeline evolves.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.voice_transcripts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source       TEXT NOT NULL DEFAULT 'generic',
    context_id   TEXT,
    text         TEXT NOT NULL,
    duration_ms  INT,
    bytes        INT,
    model        TEXT NOT NULL DEFAULT 'whisper-1',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_transcripts_user_created
    ON public.voice_transcripts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_transcripts_source
    ON public.voice_transcripts (source);

ALTER TABLE public.voice_transcripts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'voice_transcripts'
          AND policyname = 'voice_transcripts_owner_read'
    ) THEN
        CREATE POLICY voice_transcripts_owner_read ON public.voice_transcripts
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'voice_transcripts'
          AND policyname = 'voice_transcripts_owner_insert'
    ) THEN
        CREATE POLICY voice_transcripts_owner_insert ON public.voice_transcripts
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================================
-- 3. google_calendar_tokens
-- ----------------------------------------------------------------------------
-- Per-user OAuth tokens for Google Calendar. `refresh_token` is the long-lived
-- credential; `access_token` + `expires_at` are rotated on refresh. `scopes`
-- records what the user consented to so we can detect scope upgrades.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
    user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    google_email  TEXT NOT NULL,
    google_sub    TEXT,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    scopes        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    calendar_id   TEXT NOT NULL DEFAULT 'primary',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_tokens_email
    ON public.google_calendar_tokens (google_email);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- Service role writes tokens (we never expose them to the client).
-- Owner can SELECT a redacted view via RPC if we add one later.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'google_calendar_tokens'
          AND policyname = 'google_calendar_tokens_owner_read'
    ) THEN
        CREATE POLICY google_calendar_tokens_owner_read ON public.google_calendar_tokens
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================================================
-- 4. knowledge storage bucket
-- ----------------------------------------------------------------------------
-- Private bucket for user-uploaded context (PDFs, notes, transcripts, etc.).
-- Path convention: {user_id}/{filename}. RLS enforces owner-only access.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'knowledge',
    'knowledge',
    false,
    52428800,
    NULL
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename  = 'objects'
          AND policyname = 'knowledge_owner_read'
    ) THEN
        CREATE POLICY knowledge_owner_read ON storage.objects
            FOR SELECT
            USING (
                bucket_id = 'knowledge'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename  = 'objects'
          AND policyname = 'knowledge_owner_insert'
    ) THEN
        CREATE POLICY knowledge_owner_insert ON storage.objects
            FOR INSERT
            WITH CHECK (
                bucket_id = 'knowledge'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename  = 'objects'
          AND policyname = 'knowledge_owner_update'
    ) THEN
        CREATE POLICY knowledge_owner_update ON storage.objects
            FOR UPDATE
            USING (
                bucket_id = 'knowledge'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename  = 'objects'
          AND policyname = 'knowledge_owner_delete'
    ) THEN
        CREATE POLICY knowledge_owner_delete ON storage.objects
            FOR DELETE
            USING (
                bucket_id = 'knowledge'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
END $$;

-- ============================================================================
-- 5. knowledge_documents — metadata index for knowledge bucket
-- ----------------------------------------------------------------------------
-- Lets us query what's in the bucket without listing storage. Enables search,
-- embedding status tracking, and "files the AI has learned from".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.knowledge_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_path  TEXT NOT NULL,
    filename      TEXT NOT NULL,
    title         TEXT,
    kind          TEXT NOT NULL DEFAULT 'document',
    mime_type     TEXT,
    bytes         BIGINT,
    extracted_text TEXT,
    summary       TEXT,
    embedded_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_user_kind
    ON public.knowledge_documents (user_id, kind);

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'knowledge_documents'
          AND policyname = 'knowledge_documents_owner_all'
    ) THEN
        CREATE POLICY knowledge_documents_owner_all ON public.knowledge_documents
            FOR ALL USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;
