-- Phase 42: Scheduled Messaging
CREATE TABLE IF NOT EXISTS clapcheeks_scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'iMessage',
  phone TEXT,
  message_text TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','sent','failed')),
  sequence_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (sequence_type IN ('follow_up','manual','app_to_text')),
  delay_hours INTEGER,
  rejection_reason TEXT,
  sent_at TIMESTAMPTZ,
  god_draft_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clapcheeks_scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own scheduled messages"
  ON clapcheeks_scheduled_messages FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user_status
  ON clapcheeks_scheduled_messages(user_id, status);

CREATE OR REPLACE FUNCTION update_scheduled_messages_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER scheduled_messages_updated_at
  BEFORE UPDATE ON clapcheeks_scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION update_scheduled_messages_updated_at();
