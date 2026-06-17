-- Email send tracking and unsubscribe support for onboarding sequence

-- Track which onboarding emails have been sent to each user
CREATE TABLE IF NOT EXISTS email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type text NOT NULL CHECK (email_type IN ('welcome', 'day3', 'day7', 'day14')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email_type)
);

-- Unsubscribe tracking
CREATE TABLE IF NOT EXISTS email_unsubscribes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  unsubscribed_at timestamptz NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_unsubscribes ENABLE ROW LEVEL SECURITY;

-- Service role can read/write (API uses service key)
CREATE POLICY "service_role_all_email_sends" ON email_sends
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_email_unsubscribes" ON email_unsubscribes
  FOR ALL USING (true) WITH CHECK (true);

-- Index for fast lookups during sequence processing
CREATE INDEX idx_email_sends_user ON email_sends(user_id);
