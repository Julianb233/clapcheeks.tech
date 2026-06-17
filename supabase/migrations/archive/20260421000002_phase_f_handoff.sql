-- Phase F (AI-8320): Offline contacts + cross-platform iMessage handoff.
--
-- Extends public.clapcheeks_matches with columns needed to (a) store
-- offline contacts ingested via the dashboard, and (b) detect + drive the
-- Tinder/Hinge -> iMessage handoff. Also extends clapcheeks_conversations
-- with a `channel` tag so platform + iMessage events can coexist on the
-- same match row.
--
-- Idempotent. All columns are NULL-safe defaults.

-- ---------------------------------------------------------------------------
-- 1. clapcheeks_matches columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.clapcheeks_matches
    ADD COLUMN IF NOT EXISTS her_phone            TEXT,
    ADD COLUMN IF NOT EXISTS julian_shared_phone  BOOLEAN  DEFAULT false,
    ADD COLUMN IF NOT EXISTS handoff_complete     BOOLEAN  DEFAULT false,
    ADD COLUMN IF NOT EXISTS primary_channel      TEXT     DEFAULT 'platform',
    ADD COLUMN IF NOT EXISTS met_at               TEXT,
    ADD COLUMN IF NOT EXISTS source               TEXT,
    ADD COLUMN IF NOT EXISTS first_impression     TEXT,
    ADD COLUMN IF NOT EXISTS handoff_detected_at  TIMESTAMPTZ;

-- Allow 'chatting_phone' as a valid status — used post-handoff.
-- Existing status constraint (from 20260420000002) locks the value set,
-- so drop + recreate with the extra enum member.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_status_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            DROP CONSTRAINT clapcheeks_matches_status_check;
    END IF;

    ALTER TABLE public.clapcheeks_matches
        ADD CONSTRAINT clapcheeks_matches_status_check
        CHECK (status IN (
            'new', 'opened', 'conversing', 'chatting', 'chatting_phone',
            'stalled', 'date_proposed', 'date_booked', 'dated', 'ghosted'
        ));
END $$;

-- primary_channel guard
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_primary_channel_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_primary_channel_check
            CHECK (primary_channel IN ('platform', 'imessage'));
    END IF;
END $$;

-- source guard (leaves NULL valid for legacy rows)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_matches_source_check'
    ) THEN
        ALTER TABLE public.clapcheeks_matches
            ADD CONSTRAINT clapcheeks_matches_source_check
            CHECK (source IS NULL OR source IN (
                'imessage', 'platform', 'tinder', 'hinge', 'bumble', 'offline'
            ));
    END IF;
END $$;

-- Helpful indexes for the daemon lookup by phone.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_her_phone
    ON public.clapcheeks_matches (user_id, her_phone)
    WHERE her_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_handoff_complete
    ON public.clapcheeks_matches (user_id, handoff_complete)
    WHERE handoff_complete = true;

-- ---------------------------------------------------------------------------
-- 2. clapcheeks_conversations: channel tag so a single match row can own
--    both platform messages and iMessage messages on one timeline.
-- ---------------------------------------------------------------------------

ALTER TABLE public.clapcheeks_conversations
    ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'platform';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'clapcheeks_conversations_channel_check'
    ) THEN
        ALTER TABLE public.clapcheeks_conversations
            ADD CONSTRAINT clapcheeks_conversations_channel_check
            CHECK (channel IN ('platform', 'imessage'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clapcheeks_conversations_channel
    ON public.clapcheeks_conversations (user_id, match_id, channel);
