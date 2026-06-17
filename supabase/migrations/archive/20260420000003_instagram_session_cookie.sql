-- Instagram session cookies harvested from the Chrome extension running on
-- the cc.tech Chrome profile (AI-8340 Phase L). Stored as JSON blob
-- (sessionid + ds_user_id + csrftoken + mid + ig_did) so the daemon can
-- post stories / read feeds via Julian's real browser session.

ALTER TABLE public.clapcheeks_user_settings
    ADD COLUMN IF NOT EXISTS instagram_auth_token            TEXT,
    ADD COLUMN IF NOT EXISTS instagram_auth_token_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS instagram_auth_source           TEXT;

CREATE INDEX IF NOT EXISTS idx_clapcheeks_settings_ig_update
    ON public.clapcheeks_user_settings (instagram_auth_token_updated_at DESC)
    WHERE instagram_auth_token IS NOT NULL;
