-- AI-8764 — Token Health Panel + Ban Risk Indicator
--
-- 1. New table `clapcheeks_ban_events`: per-user, per-platform timeline of
--    ban-related signals captured by the BanMonitor (`agent/clapcheeks/safety/ban_monitor.py`).
--    Used by the dashboard sticky connection-bar and the /intel/health page.
-- 2. Extends `clapcheeks_user_settings` with `*_token_expires_at` / `*_session_expires_at`
--    columns so the connection bar can render "expires 2d" warnings before tokens die.

-- ---------------------------------------------------------------------------
-- Ban events table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clapcheeks_ban_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform text NOT NULL,
    -- 'match_rate_drop' | 'likes_you_freeze' | 'send_failure' | 'recaptcha'
    -- | 'shadowban_suspected' | 'http_403' | 'http_429' | 'token_expired'
    -- | 'json_pattern_hard' | 'json_pattern_soft' | etc.
    signal_type text NOT NULL,
    severity text NOT NULL DEFAULT 'info',  -- 'info' | 'warn' | 'critical'
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    detected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clapcheeks_ban_events ENABLE ROW LEVEL SECURITY;

-- Read: users own rows only
DROP POLICY IF EXISTS "users own ban events read" ON public.clapcheeks_ban_events;
CREATE POLICY "users own ban events read"
    ON public.clapcheeks_ban_events
    FOR SELECT
    USING (auth.uid() = user_id);

-- Write: only service role inserts (signal collection happens in the local agent
-- via the service-role key, never directly from the browser).
DROP POLICY IF EXISTS "service role write ban events" ON public.clapcheeks_ban_events;
CREATE POLICY "service role write ban events"
    ON public.clapcheeks_ban_events
    FOR INSERT
    WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ban_events_user_platform
    ON public.clapcheeks_ban_events (user_id, platform, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ban_events_user_recent
    ON public.clapcheeks_ban_events (user_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ban_events_severity
    ON public.clapcheeks_ban_events (severity, detected_at DESC)
    WHERE severity IN ('warn', 'critical');

COMMENT ON TABLE public.clapcheeks_ban_events IS
    'Timeline of ban-risk signals per user/platform. Written by ban_monitor.py via service role; read by /intel/health and the sticky connection bar.';

-- ---------------------------------------------------------------------------
-- Token / session expiry columns on clapcheeks_user_settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.clapcheeks_user_settings
    ADD COLUMN IF NOT EXISTS tinder_auth_token_expires_at  timestamptz,
    ADD COLUMN IF NOT EXISTS hinge_auth_token_expires_at   timestamptz,
    ADD COLUMN IF NOT EXISTS bumble_session_expires_at     timestamptz;

CREATE INDEX IF NOT EXISTS idx_clapcheeks_settings_tinder_expires
    ON public.clapcheeks_user_settings (tinder_auth_token_expires_at)
    WHERE tinder_auth_token_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clapcheeks_settings_hinge_expires
    ON public.clapcheeks_user_settings (hinge_auth_token_expires_at)
    WHERE hinge_auth_token_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clapcheeks_settings_bumble_expires
    ON public.clapcheeks_user_settings (bumble_session_expires_at)
    WHERE bumble_session_expires_at IS NOT NULL;
