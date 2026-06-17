-- AI-8766 — Encrypt platform tokens at rest
--
-- Today, clapcheeks_user_settings stores Tinder / Hinge / Instagram (and a
-- planned Bumble) auth tokens as plaintext TEXT. A leaked Supabase
-- service-role key would let an attacker read every active user's session
-- cookie and hijack their dating accounts.
--
-- Application-level AES-256-GCM encryption is added in this migration. The
-- key is derived per-user via scrypt(master_key, user_id) so a leak of a
-- single decrypted blob does not reveal the master key, and so master-key
-- rotation is decoupled from per-row salting.
--
-- Wire format of an encrypted blob (bytea):
--
--   byte 0       : version (currently 1)
--   bytes 1..12  : iv (12 random bytes)
--   bytes 13..28 : GCM tag (16 bytes)
--   bytes 29..   : ciphertext
--
-- This is gradual migration: plaintext columns stay in place, marked
-- DEPRECATED, until a backfill script populates the *_enc columns AND every
-- reader prefers the encrypted column. A follow-up issue will drop the
-- plaintext columns once telemetry confirms they are unread.

ALTER TABLE public.clapcheeks_user_settings
    ADD COLUMN IF NOT EXISTS tinder_auth_token_enc      bytea,
    ADD COLUMN IF NOT EXISTS hinge_auth_token_enc       bytea,
    ADD COLUMN IF NOT EXISTS bumble_session_enc         bytea,
    ADD COLUMN IF NOT EXISTS instagram_auth_token_enc   bytea,
    ADD COLUMN IF NOT EXISTS token_enc_version          int  DEFAULT 1;

COMMENT ON COLUMN public.clapcheeks_user_settings.tinder_auth_token IS
    'DEPRECATED — use tinder_auth_token_enc. Plaintext retained for backfill only (AI-8766).';
COMMENT ON COLUMN public.clapcheeks_user_settings.hinge_auth_token IS
    'DEPRECATED — use hinge_auth_token_enc. Plaintext retained for backfill only (AI-8766).';
COMMENT ON COLUMN public.clapcheeks_user_settings.instagram_auth_token IS
    'DEPRECATED — use instagram_auth_token_enc. Plaintext retained for backfill only (AI-8766).';

COMMENT ON COLUMN public.clapcheeks_user_settings.tinder_auth_token_enc IS
    'AES-256-GCM ciphertext: version(1)|iv(12)|tag(16)|ct. Key = scrypt(MASTER, user_id).';
COMMENT ON COLUMN public.clapcheeks_user_settings.hinge_auth_token_enc IS
    'AES-256-GCM ciphertext: version(1)|iv(12)|tag(16)|ct. Key = scrypt(MASTER, user_id).';
COMMENT ON COLUMN public.clapcheeks_user_settings.bumble_session_enc IS
    'AES-256-GCM ciphertext for Bumble session cookies. Format same as other *_enc columns.';
COMMENT ON COLUMN public.clapcheeks_user_settings.instagram_auth_token_enc IS
    'AES-256-GCM ciphertext for Instagram cookie blob. Format same as other *_enc columns.';
COMMENT ON COLUMN public.clapcheeks_user_settings.token_enc_version IS
    'Bumped when the master key is rotated. Used to detect rows still encrypted under the previous key.';

-- Indexes that exist on plaintext columns (idx_clapcheeks_settings_tinder_update etc)
-- still apply for the daemon-poll workflow. Once we drop plaintext, follow-up
-- migration will rebuild equivalent partial indexes on *_updated_at WHERE *_enc IS NOT NULL.
