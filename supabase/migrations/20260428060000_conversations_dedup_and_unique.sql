-- AI-8876: Deduplicate clapcheeks_conversations and enforce (user_id, match_id)
-- uniqueness to prevent future sync runs from creating duplicate rows.
--
-- Background: sync_chatdb_to_supabase.py inserts a new row on every run
-- (idempotency was intended but no unique constraint was enforced).
-- As a result 6 match_ids each accumulated ~167 duplicate rows (1200 total
-- rows for 6 contacts).  This migration:
--   1. Deletes all duplicate rows, keeping the row with the highest ctid
--      (most recently inserted) for each (user_id, match_id) pair.
--   2. Adds a unique constraint on (user_id, match_id) so future duplicates
--      are rejected at the DB level.
--
-- NOTE: clapcheeks_conversations rows use a `messages` JSONB array (shape A)
-- for sync-derived rows and individual body/direction/sent_at columns (shape B)
-- for daemon-written rows.  The unique constraint spans both shapes.
-- Coordinate with the realtime agent who owns REPLICA IDENTITY changes.

-- Step 1: Delete duplicate rows, keep only the newest per (user_id, match_id)
DELETE FROM public.clapcheeks_conversations
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, match_id) id
  FROM public.clapcheeks_conversations
  ORDER BY user_id, match_id, created_at DESC NULLS LAST
);

-- Step 2: Add unique constraint (idempotent)
ALTER TABLE public.clapcheeks_matches
  DROP CONSTRAINT IF EXISTS uq_clapcheeks_conversations_user_match;

ALTER TABLE public.clapcheeks_conversations
  ADD CONSTRAINT uq_clapcheeks_conversations_user_match
  UNIQUE (user_id, match_id);

-- Step 3: Normalise any bare match_ids (no colon) to <platform>:<external_id>
-- In practice all rows already have the imessage:+phone prefix, but this
-- guard handles any edge cases from manual inserts.
UPDATE public.clapcheeks_conversations
SET match_id = platform || ':' || match_id
WHERE match_id NOT LIKE '%:%'
  AND platform IS NOT NULL
  AND platform <> '';
