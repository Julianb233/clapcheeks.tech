-- Platform auth tokens can now be pushed from any Chrome where Julian is
-- logged into tinder.com (via the token-harvester extension), and the
-- daemon polls these columns instead of requiring manual capture.

ALTER TABLE public.clapcheeks_user_settings
    ADD COLUMN IF NOT EXISTS tinder_auth_token            TEXT,
    ADD COLUMN IF NOT EXISTS tinder_auth_token_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tinder_auth_source           TEXT,   -- ext | cli | web
    ADD COLUMN IF NOT EXISTS hinge_auth_token             TEXT,
    ADD COLUMN IF NOT EXISTS hinge_auth_token_updated_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hinge_auth_source            TEXT;

-- Index so the daemon poll is cheap
CREATE INDEX IF NOT EXISTS idx_clapcheeks_settings_tinder_update
    ON public.clapcheeks_user_settings (tinder_auth_token_updated_at DESC)
    WHERE tinder_auth_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clapcheeks_settings_hinge_update
    ON public.clapcheeks_user_settings (hinge_auth_token_updated_at DESC)
    WHERE hinge_auth_token IS NOT NULL;
