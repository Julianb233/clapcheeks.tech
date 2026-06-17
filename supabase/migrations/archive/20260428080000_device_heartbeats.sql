-- AI-8876 [frontend]: clapcheeks_device_heartbeats table
--
-- Stores the latest heartbeat payload from each daemon (one row per token,
-- upserted on every POST /api/agent/heartbeat call).  Keeps a lightweight
-- liveness + version history so ops tooling can query daemon health without
-- reading the full clapcheeks_agent_tokens table.
--
-- Schema:
--   token_id        FK → clapcheeks_agent_tokens.id (unique key for upserts)
--   user_id         FK → auth.users.id
--   device_name     Friendly label echoed from the daemon's POST body
--   daemon_version  Semver string (e.g. "1.4.2")
--   last_sync_at    Timestamp the daemon last ran a full sync cycle
--   errors_jsonb    Last known error snapshot (JSONB) from the daemon
--   last_heartbeat_at  When we last received a heartbeat from this device
--   created_at      Row creation (first heartbeat)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clapcheeks_device_heartbeats (
    id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    token_id          UUID        NOT NULL,
    user_id           UUID,
    device_name       TEXT,
    daemon_version    TEXT,
    last_sync_at      TIMESTAMPTZ,
    errors_jsonb      JSONB,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One row per token; upsert keyed on token_id
    CONSTRAINT clapcheeks_device_heartbeats_token_unique UNIQUE (token_id),

    CONSTRAINT clapcheeks_device_heartbeats_token_fk
        FOREIGN KEY (token_id)
        REFERENCES public.clapcheeks_agent_tokens (id)
        ON DELETE CASCADE,

    CONSTRAINT clapcheeks_device_heartbeats_user_fk
        FOREIGN KEY (user_id)
        REFERENCES auth.users (id)
        ON DELETE SET NULL
);

COMMENT ON TABLE public.clapcheeks_device_heartbeats IS
    'Latest heartbeat payload from each daemon device (AI-8876). '
    'One row per clapcheeks_agent_tokens entry, upserted on every '
    'POST /api/agent/heartbeat call.';

-- Fast lookup by user (fleet health dashboard)
CREATE INDEX IF NOT EXISTS idx_cdh_user_id
    ON public.clapcheeks_device_heartbeats (user_id);

-- Fast lookup by last heartbeat time (stale-device queries)
CREATE INDEX IF NOT EXISTS idx_cdh_last_heartbeat
    ON public.clapcheeks_device_heartbeats (last_heartbeat_at DESC);

-- RLS: users see only their own device heartbeats; service role sees all.
ALTER TABLE public.clapcheeks_device_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_heartbeats"
    ON public.clapcheeks_device_heartbeats
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "service_role_all_heartbeats"
    ON public.clapcheeks_device_heartbeats
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
