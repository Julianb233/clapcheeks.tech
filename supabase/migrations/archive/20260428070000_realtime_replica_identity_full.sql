-- AI-8876: REPLICA IDENTITY FULL + O2 status-callback mirror table
--
-- Problem:
--   clapcheeks_conversations was enrolled in supabase_realtime (AI-8809) but
--   without REPLICA IDENTITY FULL.  Postgres only emits primary-key columns in
--   the `old` record on UPDATE events when the default identity is used.  That
--   means payload.old.messages is always NULL in Supabase Realtime UPDATE
--   events, which breaks the extractNewEntries() delta logic in
--   web/lib/realtime/messages.ts:74 — oldMessages falls back to [] and the
--   code emits the ENTIRE messages array as "new" on every update instead of
--   just the appended tail.
--
-- Fix:
--   ALTER TABLE … REPLICA IDENTITY FULL — Postgres now writes the complete old
--   row into the WAL on every UPDATE.  Supabase Realtime forwards it to
--   subscribers as payload.old.  extractNewEntries() works correctly because
--   oldMessages is now populated.
--
-- Trade-off (document in PR):
--   REPLICA IDENTITY FULL roughly doubles WAL volume for this table on each
--   UPDATE.  clapcheeks_conversations rows are small (a few KB of JSONB), so
--   the absolute impact is minimal.  Revert to DEFAULT with:
--     ALTER TABLE public.clapcheeks_conversations REPLICA IDENTITY DEFAULT;
--   if WAL pressure becomes an issue.
--
-- This migration must sort AFTER:
--   20260428060000_conversations_dedup_and_unique.sql  (backend PR #72)
--
-- Order of operations:
--   1. REPLICA IDENTITY FULL on clapcheeks_conversations
--   2. (Re-)enroll in supabase_realtime publication (idempotent)
--   3. Create bb_message_callbacks table for O2 status-callback mirror
-- ---------------------------------------------------------------------------

-- ── 1. REPLICA IDENTITY FULL ─────────────────────────────────────────────────
ALTER TABLE public.clapcheeks_conversations REPLICA IDENTITY FULL;

COMMENT ON TABLE public.clapcheeks_conversations IS
    'Per-match conversation store. REPLICA IDENTITY FULL is set so Supabase '
    'Realtime UPDATE events include the full old row, enabling the delta logic '
    'in web/lib/realtime/messages.ts to extract only newly appended messages. '
    'AI-8876.';

-- ── 2. (Re-)enroll in realtime publication (idempotent) ───────────────────────
DO $pub$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.clapcheeks_conversations;
EXCEPTION
  WHEN OTHERS THEN
    -- "already member" (42710) or publication missing in dev — safe to swallow
    NULL;
END $pub$;

-- ── 3. bb_message_callbacks — O2 status-callback mirror ──────────────────────
--
-- Purpose:
--   When clapcheeks sends a message via BlueBubbles the outbound send path can
--   optionally record a `status_callback` URL per message.  When BlueBubbles
--   fires an `updated-message` event for that GUID (delivered / read / error),
--   the webhook receiver looks up the callback URL here and fires a
--   SendBlue-compatible POST:
--     { message_handle: "+15551234567", status: "DELIVERED", error_code: null }
--   This mirrors the SendBlue status-callback contract so any code written
--   against SendBlue docs (or future SendBlue SDK calls) can drop in unchanged.
--
-- Lifecycle:
--   INSERT: when a message is sent (via BB /api/v1/message or the daemon)
--   UPDATE: when the callback has been delivered (dispatched_at filled in)
--   DELETE: not expected in normal flow; rows are retained for audit
--   TTL: rows older than 30 days can be archived (background job, not enforced
--        here — add a pg_partman partition if volume warrants)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bb_message_callbacks (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    message_guid     TEXT        NOT NULL,        -- BB message GUID (also in bluebubbles_events.event_guid)
    callback_url     TEXT        NOT NULL,        -- target URL to POST status to
    -- The number the message was sent to (E.164).  Used as message_handle in
    -- the SendBlue-compat payload so the receiver can skip a GUID lookup.
    to_handle        TEXT,
    -- Outbound platform for cross-service routing
    platform         TEXT        NOT NULL DEFAULT 'bluebubbles',
    -- Last known status (mirrors SendBlue enum):
    --   REGISTERED | PENDING | DECLINED | QUEUED | ACCEPTED | SENT
    --   | DELIVERED | READ | ERROR
    status           TEXT,
    error_code       TEXT,                        -- BB error code if status=ERROR
    -- Timestamps
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    dispatched_at    TIMESTAMPTZ,                 -- when we last POSTed to callback_url
    -- Allow duplicate-safe upserts keyed on message_guid
    CONSTRAINT bb_message_callbacks_guid_unique UNIQUE (message_guid)
);

COMMENT ON TABLE public.bb_message_callbacks IS
    'O2 status-callback mirror layer (AI-8876). Maps BB message_guid → '
    'callback_url so the webhook receiver can fire SendBlue-compatible status '
    'POSTs when an updated-message event arrives.';

COMMENT ON COLUMN public.bb_message_callbacks.message_guid IS
    'BlueBubbles message GUID.  Correlates with bluebubbles_events.event_guid.';
COMMENT ON COLUMN public.bb_message_callbacks.callback_url IS
    'URL to POST { message_handle, status, error_code } when status changes.';
COMMENT ON COLUMN public.bb_message_callbacks.to_handle IS
    'E.164 phone number the message was sent to.  Used as message_handle in '
    'the SendBlue-compat payload.';
COMMENT ON COLUMN public.bb_message_callbacks.status IS
    'Current delivery status in SendBlue enum format: REGISTERED | PENDING | '
    'DECLINED | QUEUED | ACCEPTED | SENT | DELIVERED | READ | ERROR.';

-- Index for webhook receiver: lookup by GUID on every incoming updated-message
CREATE INDEX IF NOT EXISTS idx_bb_message_callbacks_guid
    ON public.bb_message_callbacks (message_guid);

-- Index for background retry job: find rows with pending dispatches
CREATE INDEX IF NOT EXISTS idx_bb_message_callbacks_undispatched
    ON public.bb_message_callbacks (created_at)
    WHERE dispatched_at IS NULL AND callback_url IS NOT NULL;

-- RLS: service role only (webhook receiver uses service role key; no user-level
-- access needed here — conversation status is surfaced through the main tables)
ALTER TABLE public.bb_message_callbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_bb_callbacks"
    ON public.bb_message_callbacks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
