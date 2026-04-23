-- Phase 42: Scheduled Messaging — follow-up sequences config
-- AI-8327
--
-- Per-user configuration for automated follow-up sequences:
-- - delays_hours: ordered list of hour offsets to fire a follow-up after last outbound (e.g. [24, 72, 168])
-- - warmth_threshold: conversation warmth score at which an app-to-text transition fires
-- - optimal_send_window: preferred local-time window to deliver (HH:MM ranges)
-- - quiet_hours_start/end: never schedule inside this window

CREATE TABLE IF NOT EXISTS public.clapcheeks_followup_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  delays_hours JSONB NOT NULL DEFAULT '[24, 72, 168]'::jsonb,
  max_followups INTEGER NOT NULL DEFAULT 3,
  app_to_text_enabled BOOLEAN NOT NULL DEFAULT true,
  warmth_threshold REAL NOT NULL DEFAULT 0.7
    CHECK (warmth_threshold >= 0 AND warmth_threshold <= 1),
  min_messages_before_transition INTEGER NOT NULL DEFAULT 12,
  optimal_send_start_hour SMALLINT NOT NULL DEFAULT 18
    CHECK (optimal_send_start_hour >= 0 AND optimal_send_start_hour <= 23),
  optimal_send_end_hour SMALLINT NOT NULL DEFAULT 21
    CHECK (optimal_send_end_hour >= 0 AND optimal_send_end_hour <= 23),
  quiet_hours_start SMALLINT NOT NULL DEFAULT 23
    CHECK (quiet_hours_start >= 0 AND quiet_hours_start <= 23),
  quiet_hours_end SMALLINT NOT NULL DEFAULT 8
    CHECK (quiet_hours_end >= 0 AND quiet_hours_end <= 23),
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clapcheeks_followup_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own followup config"
  ON public.clapcheeks_followup_sequences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_followup_sequences_user
  ON public.clapcheeks_followup_sequences(user_id);

CREATE OR REPLACE FUNCTION public.update_followup_sequences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS followup_sequences_updated_at ON public.clapcheeks_followup_sequences;
CREATE TRIGGER followup_sequences_updated_at
  BEFORE UPDATE ON public.clapcheeks_followup_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_followup_sequences_updated_at();

-- Track the sequence step so repeat follow-ups advance through the delay list.
ALTER TABLE public.clapcheeks_scheduled_messages
  ADD COLUMN IF NOT EXISTS sequence_step SMALLINT DEFAULT 0;

ALTER TABLE public.clapcheeks_scheduled_messages
  ADD COLUMN IF NOT EXISTS match_id TEXT;

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_match
  ON public.clapcheeks_scheduled_messages(user_id, match_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_scheduled_at
  ON public.clapcheeks_scheduled_messages(scheduled_at)
  WHERE status IN ('pending', 'approved');
