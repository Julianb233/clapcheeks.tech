-- AI-8808: Reactions, tapbacks, iMessage effects + BlueBubbles adapter
--
-- Additive migration. All changes are IF NOT EXISTS / conditional so they
-- are safe to re-run and do not break existing data.
--
-- Changes:
--
--   clapcheeks_conversations
--     + reactions   JSONB DEFAULT '[]'   -- per-message tapback/react store
--     + effect_id   TEXT                 -- iMessage screen effect applied
--
--   clapcheeks_user_settings
--     + bluebubbles_url       TEXT  -- e.g. http://192.168.1.5:1234
--     + bluebubbles_password  bytea -- AES-256-GCM encrypted (same wire
--                                      format as other *_enc columns from
--                                      AI-8766: version(1)|iv(12)|tag(16)|ct)
--
-- NOTE: The task spec referenced clapcheeks_match_messages but that table
-- does not exist in this schema. The per-message store lives in
-- clapcheeks_conversations.messages (JSONB array). We add reaction /
-- effect metadata columns at the conversation row level so individual
-- message reactions can be stored inside the messages JSONB array
-- (reaction = {msg_guid, kind, actor}). The top-level columns below serve
-- as aggregated ring-fencing (last reaction kind, last effect applied) and
-- can be evolved into a proper join table in a follow-up migration.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. clapcheeks_conversations: reactions + effect_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.clapcheeks_conversations
    ADD COLUMN IF NOT EXISTS reactions  JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS effect_id  TEXT;

COMMENT ON COLUMN public.clapcheeks_conversations.reactions IS
    'Array of tapback/react events on messages in this conversation. '
    'Each element: {msg_guid TEXT, kind TEXT, actor TEXT, ts TIMESTAMPTZ}. '
    'Populated by the BlueBubbles WebSocket inbound event handler (AI-8808).';

COMMENT ON COLUMN public.clapcheeks_conversations.effect_id IS
    'iMessage screen effect ID applied to the last outbound message. '
    'One of: slam | loud | gentle | invisible | lasers | balloons | '
    'confetti | fireworks | celebration | spotlight | echo (AI-8808).';

-- ---------------------------------------------------------------------------
-- 2. clapcheeks_user_settings: BlueBubbles server credentials
-- ---------------------------------------------------------------------------

ALTER TABLE public.clapcheeks_user_settings
    ADD COLUMN IF NOT EXISTS bluebubbles_url       TEXT,
    ADD COLUMN IF NOT EXISTS bluebubbles_password  BYTEA;

COMMENT ON COLUMN public.clapcheeks_user_settings.bluebubbles_url IS
    'Base URL of the user''s BlueBubbles Server, e.g. http://192.168.1.5:1234. '
    'When set, the iMessage sender routes tapbacks + effects through the '
    'BlueBubbles REST API instead of god mac send / osascript (AI-8808).';

COMMENT ON COLUMN public.clapcheeks_user_settings.bluebubbles_password IS
    'AES-256-GCM ciphertext of the BlueBubbles Server password. '
    'Wire format: version(1)|iv(12)|tag(16)|ct — identical to other *_enc '
    'columns (AI-8766). Key = scrypt(CLAPCHEEKS_TOKEN_MASTER_KEY, user_id).';

-- Index for daemon: quickly find users who have BlueBubbles configured.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_settings_bluebubbles
    ON public.clapcheeks_user_settings (user_id)
    WHERE bluebubbles_url IS NOT NULL;
