-- Phase L (AI-8340) - Instagram content library + auto-posting.
--
-- Julian's IG presence is part of the dating funnel: once a match moves off
-- Tinder/Hinge and opens his profile, a stale or thirsty grid tanks the
-- conversion rate. Phase L adds a supabase-backed library of candidate
-- images/videos categorized by vibe (beach/dog/active/food/speaking/bts)
-- and a scheduler that picks stories to post in a human-looking ratio.
--
-- The posting engine rides the Phase M queue pattern (no direct IG API
-- calls from the VPS). The daemon enqueues ``ig_post_story`` jobs; the
-- Chrome extension performs the upload with credentials: include so the
-- IG session cookie rides through.
--
-- Freshness rule: whenever Phase G (opener drafter) is about to fire on
-- a match with final_score >= 0.85 and the most recent posted story is
-- older than persona.content_library.freshness_rule.max_staleness_days,
-- the daemon first posts a library item, then lets the opener go.
--
-- All columns except the JSONB bags are typed as TEXT on purpose so new
-- categories or post_types can be added without another migration.

CREATE TABLE IF NOT EXISTS public.clapcheeks_content_library (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Storage path inside the ``julian-content`` bucket (or any other
    -- per-user bucket). The dashboard uploader writes the object then
    -- inserts the row with this path.
    media_path       TEXT NOT NULL,

    -- ``photo`` / ``video`` / ``carousel``. Left as TEXT so extra shapes
    -- (reel, boomerang) can be added without a schema change.
    media_type       TEXT NOT NULL DEFAULT 'photo',

    -- One of the persona.content_library.categories entries
    -- (beach_house_work_from_home, beach_active, dog_faith,
    --  entrepreneur_behind_scenes, ted_talk_speaking,
    --  food_drinks_mission_beach). Free-text so the persona can grow.
    category         TEXT NOT NULL,

    -- Optional pre-written caption. When NULL the posting engine posts
    -- the media without caption (stories typically don't need one).
    caption          TEXT,

    -- Time-of-day hint for the scheduler. ``golden_hour`` / ``workday``
    -- / ``evening`` / ``anytime``.
    target_time_of_day TEXT DEFAULT 'anytime',

    -- Populated when the posting engine confirms the upload succeeded.
    posted_at        TIMESTAMPTZ,
    platform_post_id TEXT,

    -- ``story`` / ``feed`` / ``reel``. Matters for the freshness-gate
    -- lookup which only cares about ``story``.
    post_type        TEXT DEFAULT 'story',

    -- Free-form performance bag (view_count, reply_count, etc.) that
    -- Phase M's future metrics job can backfill.
    performance_jsonb JSONB DEFAULT '{}'::jsonb,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT clapcheeks_content_library_media_type_check
      CHECK (media_type IN ('photo', 'video', 'carousel', 'reel')),
    CONSTRAINT clapcheeks_content_library_post_type_check
      CHECK (post_type IN ('story', 'feed', 'reel'))
);

-- Freshness query: "when was the most recent story posted for this
-- user?". Phase G calls this before every high-score opener fire.
CREATE INDEX IF NOT EXISTS idx_content_library_posted
    ON public.clapcheeks_content_library (user_id, posted_at DESC NULLS FIRST);

-- Scheduler diversity query: "what does the last week of posts look
-- like per category?".
CREATE INDEX IF NOT EXISTS idx_content_library_user_category_posted
    ON public.clapcheeks_content_library (user_id, category, posted_at DESC);

-- RLS: user owns their library. Service-role daemon bypasses RLS when
-- the scheduler/publisher runs.
ALTER TABLE public.clapcheeks_content_library ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_content_library'
    AND policyname = 'content_library_select_own'
  ) THEN
    CREATE POLICY "content_library_select_own"
      ON public.clapcheeks_content_library FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_content_library'
    AND policyname = 'content_library_insert_own'
  ) THEN
    CREATE POLICY "content_library_insert_own"
      ON public.clapcheeks_content_library FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_content_library'
    AND policyname = 'content_library_update_own'
  ) THEN
    CREATE POLICY "content_library_update_own"
      ON public.clapcheeks_content_library FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_content_library'
    AND policyname = 'content_library_delete_own'
  ) THEN
    CREATE POLICY "content_library_delete_own"
      ON public.clapcheeks_content_library FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- updated_at trigger so the dashboard can sort by last-touched without
-- the app-layer having to remember to stamp it.
CREATE OR REPLACE FUNCTION public._clapcheeks_content_library_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_clapcheeks_content_library_updated_at
    ON public.clapcheeks_content_library;
CREATE TRIGGER trg_clapcheeks_content_library_updated_at
    BEFORE UPDATE ON public.clapcheeks_content_library
    FOR EACH ROW EXECUTE FUNCTION public._clapcheeks_content_library_updated_at();

COMMENT ON TABLE public.clapcheeks_content_library IS
  'Phase L (AI-8340) Instagram content library. Dashboard uploads land '
  'here, the scheduler picks rows by category ratio, and the Phase M '
  'queue-backed publisher flips posted_at when IG confirms the upload.';

-- ---------------------------------------------------------------------------
-- Posting queue
-- ---------------------------------------------------------------------------
--
-- A lightweight day-planner that maps future timestamps to
-- content_library rows. The scheduler daemon (09:00 PT daily) writes 7
-- days of rows; the publisher drains rows whose scheduled_for has
-- passed and whose status is ``pending``. Keeping it separate from
-- content_library means we can reschedule without losing the item's
-- posted history.

CREATE TABLE IF NOT EXISTS public.clapcheeks_posting_queue (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content_library_id UUID NOT NULL REFERENCES public.clapcheeks_content_library(id)
                        ON DELETE CASCADE,

    -- When the item should be posted. The daemon compares now() >=
    -- scheduled_for before firing.
    scheduled_for     TIMESTAMPTZ NOT NULL,

    -- pending -> in_progress -> posted | failed | cancelled
    status            TEXT NOT NULL DEFAULT 'pending',

    -- Set when the publisher enqueues an agent_job for this row. Used
    -- to reconcile on next tick and avoid double-posts.
    agent_job_id      UUID REFERENCES public.clapcheeks_agent_jobs(id),

    posted_at         TIMESTAMPTZ,
    error             TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT clapcheeks_posting_queue_status_check
      CHECK (status IN ('pending', 'in_progress', 'posted', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_posting_queue_due
    ON public.clapcheeks_posting_queue (status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_posting_queue_user_scheduled
    ON public.clapcheeks_posting_queue (user_id, scheduled_for DESC);

-- Stop a single library row from being scheduled twice in the pending
-- window (defensive - the scheduler also filters in-memory).
CREATE UNIQUE INDEX IF NOT EXISTS uq_posting_queue_pending_one_per_item
    ON public.clapcheeks_posting_queue (content_library_id)
    WHERE status = 'pending';

ALTER TABLE public.clapcheeks_posting_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_posting_queue'
    AND policyname = 'posting_queue_select_own'
  ) THEN
    CREATE POLICY "posting_queue_select_own"
      ON public.clapcheeks_posting_queue FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_posting_queue'
    AND policyname = 'posting_queue_all_own'
  ) THEN
    CREATE POLICY "posting_queue_all_own"
      ON public.clapcheeks_posting_queue FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.clapcheeks_posting_queue IS
  'Phase L (AI-8340) 7-day rolling post schedule. Daemon scheduler '
  'writes rows daily; publisher drains due rows and flips status to '
  'posted after the Phase M agent_job completes.';
