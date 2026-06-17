-- Operator push notification preferences (AI-8772).
--
-- Each operator chooses which channel(s) deliver each event type the agent
-- emits (date booked, ban detected, new match, draft queued, token expiring).
-- Channels: email (Resend), imessage (god mac send self), push (PWA web push).
--
-- channels_per_event is a jsonb map from event_type -> array of channel ids.
-- Example:
--   {
--     "date_booked":     ["email","imessage"],
--     "ban_detected":    ["email","imessage","push"],
--     "new_match":       [],
--     "draft_queued":    ["push"],
--     "token_expiring":  ["email"]
--   }
--
-- quiet_hours_start / quiet_hours_end are operator-local hours (0-23). The
-- dispatcher in /api/notify suppresses non-urgent events that fall inside
-- the quiet window. ban_detected and token_expiring still fire (they are
-- safety-critical) but are tagged `quiet_hours=true` so the receiver can
-- choose to mute.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.clapcheeks_notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  phone_e164 text,
  channels_per_event jsonb NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours_start int NOT NULL DEFAULT 21,
  quiet_hours_end int NOT NULL DEFAULT 8,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clapcheeks_notification_prefs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'clapcheeks_notification_prefs'
       AND policyname = 'users own notification prefs'
  ) THEN
    CREATE POLICY "users own notification prefs" ON public.clapcheeks_notification_prefs
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- iMessage outbound queue. The agent (running on the operator's Mac)
-- polls this table and consumes any rows targeted at its user_id, then
-- shells out to `god mac send` / `osascript`. The web /api/notify route
-- inserts here when an iMessage channel is chosen.
CREATE TABLE IF NOT EXISTS public.clapcheeks_outbound_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL,                       -- 'imessage' for now
  phone_e164 text NOT NULL,
  body text NOT NULL,
  event_type text,
  status text NOT NULL DEFAULT 'pending',      -- pending | sent | failed
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbound_notifications_user_pending
  ON public.clapcheeks_outbound_notifications (user_id, created_at)
  WHERE status = 'pending';

ALTER TABLE public.clapcheeks_outbound_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'clapcheeks_outbound_notifications'
       AND policyname = 'users see own outbound notifications'
  ) THEN
    CREATE POLICY "users see own outbound notifications" ON public.clapcheeks_outbound_notifications
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- Web push queue. The future PWA service worker reads this and delivers
-- via the Push API; for now we just persist so we don't drop events on
-- the floor while the SW is being built.
CREATE TABLE IF NOT EXISTS public.clapcheeks_push_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  event_type text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',      -- pending | sent | failed
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_push_queue_user_pending
  ON public.clapcheeks_push_queue (user_id, created_at)
  WHERE status = 'pending';

ALTER TABLE public.clapcheeks_push_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'clapcheeks_push_queue'
       AND policyname = 'users see own push queue'
  ) THEN
    CREATE POLICY "users see own push queue" ON public.clapcheeks_push_queue
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
