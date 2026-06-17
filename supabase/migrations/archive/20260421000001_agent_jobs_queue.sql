-- Phase M (AI-8345) - Chrome-extension API routing queue.
--
-- The daemon no longer calls tinder.com / hinge.co / instagram.com
-- directly from the VPS. Instead, it enqueues job rows into this table.
-- The Chrome extension (token-harvester background.js) polls the table
-- every ~10s, claims one job at a time, executes the fetch inside the
-- user's real Chrome session (credentials: include -> residential IP +
-- genuine cookies + genuine browser fingerprint), and POSTs the result
-- back to /api/ingest/api-result which marks the row completed.
--
-- Origin: Phase A (AI-8315) selfie verification incident 2026-04-20
-- (16 /v2/matches calls from a VPS IP with a spoofed iOS UA tripped
-- Tinder's anti-bot and forced Julian into selfie verification).

CREATE TABLE IF NOT EXISTS public.clapcheeks_agent_jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,

    -- What kind of job this is. Keep as free-text so new platforms
    -- can be added without a migration. Known values:
    --   list_matches, get_profile, send_message, list_conversations,
    --   ig_user_feed, ig_get_profile
    job_type     TEXT NOT NULL,
    platform     TEXT NOT NULL,

    -- Everything the extension needs to perform the fetch. Shape:
    --   {
    --     "url": "https://api.gotinder.com/v2/matches?count=60&locale=en",
    --     "method": "GET",
    --     "headers": { "X-Auth-Token": "...optional..." },
    --     "body": null | object
    --   }
    -- The extension merges these with credentials: 'include' so the
    -- real session cookies + fingerprint ride through.
    job_params   JSONB NOT NULL,

    -- Lifecycle: pending -> claimed -> in_progress -> completed | failed
    -- stale_no_extension terminal state set by daemon when no
    -- extension has been seen in time to claim.
    status       TEXT NOT NULL DEFAULT 'pending',

    claimed_by   TEXT,
    claimed_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Raw response payload the extension delivers back. Shape:
    --   { "status_code": 200, "body": ..., "headers": {...} }
    result_jsonb JSONB,
    error        TEXT,

    retry_count  INT NOT NULL DEFAULT 0,
    priority     INT NOT NULL DEFAULT 5,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT clapcheeks_agent_jobs_status_check
      CHECK (status IN (
          'pending', 'claimed', 'in_progress',
          'completed', 'failed', 'stale_no_extension'
      ))
);

-- Poll index used by both the extension (status=pending, oldest first)
-- and the daemon's stale-job sweep.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_agent_jobs_status_created
    ON public.clapcheeks_agent_jobs (status, created_at);

-- Per-user lookup used when the daemon waits on a job it enqueued.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_agent_jobs_user_created
    ON public.clapcheeks_agent_jobs (user_id, created_at DESC);

-- Row-Level Security ------------------------------------------------------
-- The daemon uses the service role key (bypasses RLS). The extension
-- speaks to Supabase REST via anon key + the user's session JWT (or via
-- the /api/agent/next-job endpoint, which enforces its own device-token
-- check). Either way we want users to see only their own rows.

ALTER TABLE public.clapcheeks_agent_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_agent_jobs'
    AND policyname = 'agent_jobs_select_own'
  ) THEN
    CREATE POLICY "agent_jobs_select_own"
      ON public.clapcheeks_agent_jobs FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_agent_jobs'
    AND policyname = 'agent_jobs_insert_own'
  ) THEN
    CREATE POLICY "agent_jobs_insert_own"
      ON public.clapcheeks_agent_jobs FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_agent_jobs'
    AND policyname = 'agent_jobs_update_own'
  ) THEN
    CREATE POLICY "agent_jobs_update_own"
      ON public.clapcheeks_agent_jobs FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_agent_jobs'
    AND policyname = 'agent_jobs_delete_own'
  ) THEN
    CREATE POLICY "agent_jobs_delete_own"
      ON public.clapcheeks_agent_jobs FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.clapcheeks_agent_jobs IS
  'Phase M (AI-8345) extension-routed API job queue. '
  'Daemon enqueues; Chrome extension drains; results come back via '
  '/api/ingest/api-result. Never call Tinder/Hinge/Instagram APIs '
  'directly from the VPS -- route them through here.';
