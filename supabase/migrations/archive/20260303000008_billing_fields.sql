-- Add billing lifecycle columns to profiles
-- access_expires_at: used for grace period after payment failure
-- trial_end: tracks Stripe trial end date for trialing subscriptions

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;

-- Index for efficient grace period checks
CREATE INDEX IF NOT EXISTS idx_profiles_access_expires_at
  ON profiles (access_expires_at)
  WHERE access_expires_at IS NOT NULL;
