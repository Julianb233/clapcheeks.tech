-- AI-8809: Realtime message stream + AI master on/off toggle
--
-- 1. Adds ai_active / ai_paused_until / ai_paused_reason to clapcheeks_user_settings
-- 2. Adds ai_active per-match override to clapcheeks_matches
-- 3. Creates helper view clapcheeks_ai_effective_state (union of both signals)
-- 4. Enables Supabase Realtime on clapcheeks_conversations (idempotent)
--
-- NOTE (AI-8812): clapcheeks_conversations stores messages as a JSONB array on a
-- single row per match — NOT individual message rows. A per-row INSERT trigger with
-- direction filtering is therefore not applicable.  The pg_notify fast path for
-- AI-8772 push notifications is deferred to a follow-up issue.

-- ── 1. User-level AI gate ─────────────────────────────────────────────────
ALTER TABLE public.clapcheeks_user_settings
  ADD COLUMN IF NOT EXISTS ai_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ai_paused_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_paused_reason TEXT;

COMMENT ON COLUMN public.clapcheeks_user_settings.ai_active
  IS 'Master AI kill-switch. FALSE = all agent autonomy paused for this user.';
COMMENT ON COLUMN public.clapcheeks_user_settings.ai_paused_until
  IS 'Snooze-until timestamp. AI resumes automatically at this time even if ai_active=FALSE.';
COMMENT ON COLUMN public.clapcheeks_user_settings.ai_paused_reason
  IS 'Human-readable reason stored when AI is paused (e.g. "On a date", "Manual mode").';

-- ── 2. Per-match AI override ──────────────────────────────────────────────
ALTER TABLE public.clapcheeks_matches
  ADD COLUMN IF NOT EXISTS ai_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.clapcheeks_matches.ai_active
  IS 'Per-match AI override. FALSE = agent stays silent for this match even if user ai_active=TRUE.';

-- ── 3. Effective-state helper view ────────────────────────────────────────
-- Combined signal: AI is active IFF match.ai_active AND user.ai_active AND
-- snooze has expired (or was never set).
CREATE OR REPLACE VIEW public.clapcheeks_ai_effective_state AS
SELECT
  m.id                                                         AS match_id,
  m.user_id,
  (
    m.ai_active
    AND COALESCE(s.ai_active, TRUE)
    AND (s.ai_paused_until IS NULL OR s.ai_paused_until < now())
  )                                                            AS is_active,
  s.ai_paused_until,
  s.ai_paused_reason
FROM public.clapcheeks_matches       m
LEFT JOIN public.clapcheeks_user_settings s ON s.user_id = m.user_id;

COMMENT ON VIEW public.clapcheeks_ai_effective_state
  IS 'Merged AI active state per match. Query this instead of checking both tables separately.';

-- Grant read access to authenticated users (RLS on base tables already
-- restricts which rows they see).
GRANT SELECT ON public.clapcheeks_ai_effective_state TO authenticated;

-- ── 4. Enable Supabase Realtime on clapcheeks_conversations (idempotent) ──
-- clapcheeks_conversations stores messages as a JSONB array (messages jsonb)
-- on a single row per match.  Clients subscribe to UPDATE events and diff the
-- messages array to detect new entries (see web/lib/realtime/messages.ts).
DO $rt$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.clapcheeks_conversations;
EXCEPTION
  WHEN OTHERS THEN
    -- Table already in publication or publication doesn't exist in dev — safe to ignore.
    NULL;
END $rt$;
